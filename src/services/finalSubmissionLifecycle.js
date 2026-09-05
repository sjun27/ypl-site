const asArray = (value) => (Array.isArray(value) ? value : []);

function id(value) {
  return String(value || "").trim();
}

export function buildFinalSubmissionFreezePlan({
  eventId,
  entryParticipants = [],
  registrations = [],
  submissions = [],
} = {}) {
  const targetIds = [...new Set(
    asArray(entryParticipants)
      .filter((participant) => participant?.event_id === eventId)
      .map((participant) => id(participant.registration_id))
      .filter(Boolean)
  )];
  const registrationById = new Map(
    asArray(registrations)
      .filter((registration) => registration?.event_id === eventId)
      .map((registration) => [id(registration.id), registration])
      .filter(([registrationId]) => registrationId)
  );

  return targetIds.map((registrationId) => {
    const registration = registrationById.get(registrationId);
    if (!registration) {
      throw new Error(`실제 참가 Registration ${registrationId}을 찾을 수 없습니다.`);
    }
    const candidates = asArray(submissions)
      .filter((submission) => id(submission.registration_id) === registrationId)
      .slice()
      .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0));
    if (candidates.length > 1 && Number(candidates[0].revision) === Number(candidates[1].revision)) {
      throw new Error(`${registrationId}의 Submission revision이 중복되었습니다.`);
    }
    return {
      registrationId,
      previousFinalSubmissionId: registration.final_submission_id || null,
      finalSubmissionId: candidates[0]?.id || null,
    };
  });
}

export function normalizeFinalSubmissionFreezeSnapshot(rows = []) {
  const seen = new Set();
  return asArray(rows).map((row) => {
    const registrationId = id(row?.registration_id ?? row?.registrationId);
    if (!registrationId || seen.has(registrationId)) {
      throw new Error("final submission freeze 결과의 Registration을 안전하게 확인할 수 없습니다.");
    }
    seen.add(registrationId);
    return {
      registrationId,
      previousFinalSubmissionId: row?.previous_final_submission_id ?? row?.previousFinalSubmissionId ?? null,
      finalSubmissionId: row?.final_submission_id ?? row?.finalSubmissionId ?? null,
    };
  });
}

export function restoreFinalSubmissionPointers(registrations = [], snapshot = []) {
  const byId = new Map(asArray(registrations).map((registration) => [id(registration?.id), registration]));
  return normalizeFinalSubmissionFreezeSnapshot(snapshot).map((change) => {
    const registration = byId.get(change.registrationId);
    if (!registration || (registration.final_submission_id || null) !== change.finalSubmissionId) {
      throw new Error(`${change.registrationId}의 final submission 보상 대상이 변경되었습니다.`);
    }
    return { ...registration, final_submission_id: change.previousFinalSubmissionId };
  });
}

export function releaseFinalSubmissionPointers(registrations = [], targetRegistrationIds = []) {
  const targets = new Set(asArray(targetRegistrationIds).map(id).filter(Boolean));
  return asArray(registrations).map((registration) => (
    targets.has(id(registration?.id))
      ? { ...registration, final_submission_id: null }
      : registration
  ));
}

export function isFinalSubmissionRestoreAllowed(event = {}) {
  return event?.status !== "completed" &&
    event?.record_applied_at == null &&
    event?.team_revealed_at == null;
}

export function isRecordApplyCompletionConfirmed(event = {}, { requireTeamReveal = false } = {}) {
  return event?.status === "completed" &&
    event?.record_applied_at != null &&
    (!requireTeamReveal || event?.team_revealed_at != null);
}

export async function compensateFinalSubmissionReleaseFailure({
  restoreLegacy,
  restoreResults,
  restoreAwards,
} = {}) {
  const failures = [];
  const restorations = [
    ["legacy", restoreLegacy],
    ["Result", restoreResults],
    ["RankingAward", restoreAwards],
  ];

  for (const [label, restore] of restorations) {
    if (typeof restore !== "function") continue;
    try {
      const restored = await restore();
      if (restored === false) throw new Error(`${label} snapshot 복구가 저장되지 않았습니다.`);
    } catch (error) {
      failures.push({ label, error });
    }
  }

  if (failures.length) {
    const error = new Error(failures.map(({ label, error: cause }) =>
      `${label}: ${cause?.message || "알 수 없는 오류"}`
    ).join(" / "));
    error.code = "YPL_FINAL_SUBMISSION_RELEASE_COMPENSATION_FAILED";
    error.failures = failures;
    throw error;
  }

  return { restored: true };
}
