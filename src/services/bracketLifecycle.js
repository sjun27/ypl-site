const INDIVIDUAL_IDENTITY_KEYS = [
  "registrationId",
  "playerId",
  "entryId",
  "entryParticipantId",
];

function expectedIdentityCount(bracket) {
  if (bracket?.mode === "team") {
    return (Array.isArray(bracket?.participants) ? bracket.participants : [])
      .reduce((count, participant) => count + (Array.isArray(participant?.members) ? participant.members.length : 0), 0);
  }
  return Array.isArray(bracket?.participants) ? bracket.participants.length : 0;
}

function expectedParticipantKeys(bracket) {
  if (bracket?.mode === "team") {
    return new Set((Array.isArray(bracket?.participants) ? bracket.participants : [])
      .flatMap(participant => (Array.isArray(participant?.members) ? participant.members : [])
        .map((_, index) => `${participant?.id}:member:${index + 1}`)));
  }
  return new Set((Array.isArray(bracket?.participants) ? bracket.participants : [])
    .map(participant => participant?.id));
}

export function getExpectedBracketParticipantCount(bracket) {
  return expectedIdentityCount(bracket);
}

export function validateBracketParticipantConfirmation(bracket) {
  if (!bracket?.eventId) {
    return { ok: true, reason: "event_unlinked", identityChanges: [] };
  }

  const confirmation = bracket.participantConfirmation;
  if (!confirmation) {
    return { ok: false, reason: "missing", identityChanges: [] };
  }
  if (confirmation.eventId !== bracket.eventId) {
    return { ok: false, reason: "event_mismatch", identityChanges: [] };
  }
  if (!["open", "running"].includes(confirmation.previousEventStatus)) {
    return { ok: false, reason: "invalid_previous_status", identityChanges: [] };
  }

  const identityChanges = Array.isArray(confirmation.identityChanges)
    ? confirmation.identityChanges
    : [];
  if (bracket.mode === "team" && (bracket.participants || []).some(participant =>
    !participant?.id || !Array.isArray(participant?.members) || participant.members.length === 0
  )) {
    return { ok: false, reason: "invalid_team_members", identityChanges };
  }
  if (identityChanges.length !== expectedIdentityCount(bracket)) {
    return { ok: false, reason: "count_mismatch", identityChanges };
  }

  const expectedKeys = expectedParticipantKeys(bracket);
  const expectedTeamMemberCounts = new Map((bracket?.participants || [])
    .map(participant => [participant?.id, Array.isArray(participant?.members) ? participant.members.length : 0]));
  const seenParticipantIds = new Set();
  const seenRegistrations = new Set();
  const seenPlayers = new Set();
  const seenEntries = new Set();
  const seenEntryParticipants = new Set();
  const seenTeamMembers = new Set();
  const invalid = identityChanges.some(change => {
    if (!change?.participantId || seenParticipantIds.has(change.participantId)) return true;
    if (bracket.mode !== "team" && !expectedKeys.has(change.participantId)) return true;
    seenParticipantIds.add(change.participantId);
    if (INDIVIDUAL_IDENTITY_KEYS.some(key => !change[key])) return true;
    if (seenRegistrations.has(change.registrationId) || seenPlayers.has(change.playerId) || seenEntryParticipants.has(change.entryParticipantId)) return true;
    seenRegistrations.add(change.registrationId);
    seenPlayers.add(change.playerId);
    seenEntryParticipants.add(change.entryParticipantId);
    if (bracket.mode === "team") {
      const teamMemberKey = `${change.teamParticipantId}:${change.memberOrder}`;
      if (!expectedTeamMemberCounts.has(change.teamParticipantId) || !Number.isInteger(change.memberOrder) || change.memberOrder < 1 || change.memberOrder > expectedTeamMemberCounts.get(change.teamParticipantId) || seenTeamMembers.has(teamMemberKey)) return true;
      seenTeamMembers.add(teamMemberKey);
      return false;
    }
    if (seenEntries.has(change.entryId)) return true;
    seenEntries.add(change.entryId);
    return false;
  });
  if (invalid || seenParticipantIds.size !== expectedIdentityCount(bracket)) return { ok: false, reason: "incomplete", identityChanges };

  if (bracket.mode === "team") {
    const entryIdsByTeam = new Map();
    for (const change of identityChanges) {
      const existing = entryIdsByTeam.get(change.teamParticipantId);
      if (existing && existing !== change.entryId) {
        return { ok: false, reason: "team_entry_mismatch", identityChanges };
      }
      entryIdsByTeam.set(change.teamParticipantId, change.entryId);
    }
    if (entryIdsByTeam.size !== (bracket.participants || []).length || seenTeamMembers.size !== expectedIdentityCount(bracket)) {
      return { ok: false, reason: "team_count_mismatch", identityChanges };
    }
  }

  return {
    ok: true,
    reason: "confirmed",
    identityChanges,
    previousEventStatus: confirmation.previousEventStatus,
  };
}

export function isInterruptedBracketCleanupState({ matchRows = [], entries = [], entryParticipants = [] } = {}) {
  return !matchRows.length && !entries.length && !entryParticipants.length;
}

function errorMessage(error) {
  return error?.message || "알 수 없는 오류";
}

async function collectCompensationErrors(actions) {
  const errors = [];
  for (const { label, action } of actions) {
    if (typeof action !== "function") continue;
    try {
      await action();
    } catch (error) {
      errors.push(`${label}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

/**
 * Runs the destructive half of bracket deletion only after the caller's
 * read-only preflight succeeds. All recovery callbacks receive the same
 * preflight snapshot, so a later failure can restore the exact prior graph.
 */
export async function executeBracketDeletionLifecycle({
  preflight,
  deleteMatches,
  rollbackParticipants,
  saveLegacy,
  restoreLegacy,
  restoreParticipants,
  restoreMatches,
  restoreEventStatus,
} = {}) {
  let snapshot;
  try {
    snapshot = await preflight();
  } catch (error) {
    return { ok: false, phase: "preflight", mutationStarted: false, error, compensationErrors: [] };
  }

  const interrupted = Boolean(snapshot?.interrupted);
  const previousEventStatus = snapshot?.previousEventStatus;
  let matchRows = Array.isArray(snapshot?.matchRows) ? snapshot.matchRows : [];
  let normalizedMutationStarted = false;

  const restoreNormalized = async () => collectCompensationErrors([
    ...(!interrupted ? [
      { label: "Entry/EntryParticipant", action: () => restoreParticipants?.(snapshot) },
      { label: "Match", action: () => restoreMatches?.(matchRows) },
    ] : []),
  ]);

  if (!interrupted) {
    try {
      const deleted = await deleteMatches(matchRows);
      normalizedMutationStarted = true;
      if (Array.isArray(deleted?.previousRows)) matchRows = deleted.previousRows;
    } catch (error) {
      const compensationErrors = await collectCompensationErrors([
        { label: "Match", action: () => restoreMatches?.(matchRows) },
      ]);
      return { ok: false, phase: "match_delete", mutationStarted: true, snapshot, error, compensationErrors };
    }

    try {
      await rollbackParticipants(snapshot);
      normalizedMutationStarted = true;
    } catch (error) {
      const compensationErrors = await restoreNormalized();
      return { ok: false, phase: "participant_rollback", mutationStarted: true, snapshot, error, compensationErrors };
    }
  }

  let legacySaved = false;
  try {
    legacySaved = await saveLegacy();
  } catch (error) {
    const compensationErrors = await collectCompensationErrors([
      { label: "legacy bracket", action: restoreLegacy },
      ...(normalizedMutationStarted ? [
        { label: "Entry/EntryParticipant", action: () => restoreParticipants?.(snapshot) },
        { label: "Match", action: () => restoreMatches?.(matchRows) },
      ] : []),
    ]);
    return { ok: false, phase: "legacy_save", mutationStarted: true, snapshot, error, compensationErrors };
  }

  if (!legacySaved) {
    const compensationErrors = await collectCompensationErrors([
      { label: "legacy bracket", action: restoreLegacy },
      ...(normalizedMutationStarted ? [
        { label: "Entry/EntryParticipant", action: () => restoreParticipants?.(snapshot) },
        { label: "Match", action: () => restoreMatches?.(matchRows) },
      ] : []),
    ]);
    return {
      ok: false,
      phase: "legacy_save",
      mutationStarted: true,
      snapshot,
      error: new Error("legacy 대진표 저장에 실패했습니다."),
      compensationErrors,
    };
  }

  if (previousEventStatus) {
    try {
      await restoreEventStatus(previousEventStatus);
    } catch (error) {
      const compensationErrors = await collectCompensationErrors([
        { label: "legacy bracket", action: restoreLegacy },
        ...(normalizedMutationStarted ? [
          { label: "Entry/EntryParticipant", action: () => restoreParticipants?.(snapshot) },
          { label: "Match", action: () => restoreMatches?.(matchRows) },
        ] : []),
        // A lost response may mean the status update already happened. A
        // second idempotent attempt restores it when the first failure was
        // transient, while still reporting a genuine failure.
        { label: "Event status", action: () => restoreEventStatus(previousEventStatus) },
      ]);
      return { ok: false, phase: "event_status_restore", mutationStarted: true, snapshot, error, compensationErrors };
    }
  }

  return { ok: true, phase: interrupted ? "interrupted_recovery" : "complete", mutationStarted: true, snapshot };
}

function mergeMissingLifecycleFields(base, next) {
  const merged = { ...base, ...next };
  for (const key of ["registrationId", "playerId", "entryId", "entryParticipantId", "memberIdentities"]) {
    if (merged[key] == null && base?.[key] != null) merged[key] = base[key];
  }
  return merged;
}

/**
 * Bracket graph edits must not be allowed to rebuild away the identity
 * metadata that owns normalized cleanup. Graph/party fields from `next` win;
 * lifecycle fields are filled from the currently persisted bracket.
 */
export function preserveBracketLifecycleMetadata(currentBracket, nextBracket) {
  if (!currentBracket?.eventId || (nextBracket?.eventId && currentBracket.eventId !== nextBracket.eventId)) {
    return nextBracket;
  }

  const nextParticipants = Array.isArray(nextBracket.participants)
    ? nextBracket.participants.map(participant => {
        const current = (currentBracket.participants || []).find(row => row?.id === participant?.id);
        return current ? mergeMissingLifecycleFields(current, participant) : participant;
      })
    : nextBracket.participants;

  return {
    ...nextBracket,
    eventId: currentBracket.eventId,
    ...(currentBracket.participantConfirmation && !nextBracket.participantConfirmation
      ? { participantConfirmation: currentBracket.participantConfirmation }
      : {}),
    ...(nextParticipants ? { participants: nextParticipants } : {}),
  };
}
