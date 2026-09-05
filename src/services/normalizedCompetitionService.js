import { supa as client } from "../storage.js";
import {
  LEGACY_BRACKET_RUNTIME_SOURCE,
  buildBracketMatchSyncPlan,
  buildEventBracketMatchSnapshot,
  resolveBracketMatchParentIds,
} from "./bracketMatchSnapshot.js";
import {
  bracketResultIdentityState,
  buildBracketResultSyncPlan,
  buildEventBracketResultSnapshot,
} from "./bracketResultSnapshot.js";
import {
  buildBracketRankingAwardSyncPlan,
  buildEventRankingAwardSnapshot,
  samePlacementAwardValues,
} from "./bracketRankingAwardSnapshot.js";
import {
  attachConfirmedTeamIdentities,
  buildTeamMemberCandidates,
  getConfirmedTeamMemberIdentities,
} from "./bracketTeamParticipants.js";
import { isInterruptedBracketCleanupState, validateBracketParticipantConfirmation } from "./bracketLifecycle.js";
import { buildSubmissionStatusRows, selectSubmissionRegistration } from "./teamBuilderCore.js";
import { buildTeamSnapshotSubmission } from "./teamSubmission.js";
import { normalizeFinalSubmissionFreezeSnapshot } from "./finalSubmissionLifecycle.js";
import {
  projectNormalizedDoubleEliminationBracket,
  projectNormalizedSingleEliminationBracket,
} from "./bracketProjection.js";

const DATA_SCHEMA = import.meta.env.VITE_YPL_DATA_SCHEMA || "public";
const CHAMPIONS_EVENT_SELECT_FIELDS = DATA_SCHEMA === "ypl_schema_validation"
  ? `,
      championship_phase,
      championship_final_event_id,
      qualification_slots`
  : "";

function db() {
  if (!client) throw new Error("Supabase 연결이 설정되지 않았습니다.");
  return client.schema(DATA_SCHEMA);
}

function fail(error, fallback) {
  const next = new Error(error?.message || fallback);
  next.code = error?.code || "YPL_DB_ERROR";
  next.details = error?.details || null;
  throw next;
}

export const NORMALIZED_DATA_SCHEMA = DATA_SCHEMA;

export function normalizedDbAvailable() {
  return Boolean(client);
}

// P2-7 normalized bracket runtimes are intentionally enabled only in the Test
// normalized schema. Production remains on the legacy ypl_data_v4 adapter
// until an explicit migration/cutover changes this boundary.
export function normalizedSingleBracketRuntimeEnabled() {
  return Boolean(client && DATA_SCHEMA === "ypl_schema_validation");
}

export function normalizedBracketRuntimeEnabled() {
  return normalizedSingleBracketRuntimeEnabled();
}

const NORMALIZED_SINGLE_RUNTIME_SELECT = `
  id, event_id, topology_kind, projection_version, previous_event_status,
  created_at, updated_at
`;
const NORMALIZED_SINGLE_SLOT_SELECT = `
  bracket_runtime_id, event_id, stage_kind, stage_no, pool_no, slot_no, entry_id,
  created_at
`;
const NORMALIZED_SINGLE_ENTRY_SELECT = `id, event_id, entry_type, display_name, status, seed`;
const NORMALIZED_SINGLE_PARTICIPANT_SELECT = `
  id, event_id, entry_id, registration_id, player_id, member_order, role
`;

async function readNormalizedBracketRuntimeFacts(eventId, runtimeId = null) {
  if (!normalizedBracketRuntimeEnabled()) return null;
  const runtimeQuery = db().from("bracket_runtimes").select(NORMALIZED_SINGLE_RUNTIME_SELECT);
  const { data: runtimeRows, error: runtimeError } = await (runtimeId
    ? runtimeQuery.eq("id", runtimeId).eq("event_id", eventId)
    : runtimeQuery.eq("event_id", eventId));
  if (runtimeError) fail(runtimeError, "normalized bracket runtime을 불러오지 못했습니다.");
  const runtime = (runtimeRows || [])[0] || null;
  if (!runtime) return null;

  const [event, slotsResult, entriesResult, participantsResult, matchesResult] = await Promise.all([
    getEvent(eventId),
    db().from("bracket_entry_slots").select(NORMALIZED_SINGLE_SLOT_SELECT)
      .eq("bracket_runtime_id", runtime.id).eq("event_id", eventId).order("slot_no"),
    db().from("entries").select(NORMALIZED_SINGLE_ENTRY_SELECT).eq("event_id", eventId),
    db().from("entry_participants").select(NORMALIZED_SINGLE_PARTICIPANT_SELECT).eq("event_id", eventId),
    db().from("matches").select(EVENT_RUNTIME_MATCH_SELECT).eq("event_id", eventId),
  ]);
  if (!event) throw new Error("normalized bracket Event를 찾을 수 없습니다.");
  const failed = [slotsResult, entriesResult, participantsResult, matchesResult].find(result => result.error);
  if (failed) fail(failed.error, "normalized bracket canonical facts를 불러오지 못했습니다.");

  if (!["single_elimination", "double_elimination"].includes(runtime.topology_kind) || runtime.projection_version !== 1) {
    throw new Error("지원하지 않는 normalized bracket runtime topology/version입니다.");
  }
  const registrationIds = [...new Set((participantsResult.data || []).map(row => row.registration_id).filter(Boolean))];
  const { data: registrations, error: registrationsError } = registrationIds.length
    ? await db().from("event_registrations").select("id, registration_name").eq("event_id", eventId).in("id", registrationIds)
    : { data: [], error: null };
  if (registrationsError) fail(registrationsError, "normalized bracket 참가자 이름을 불러오지 못했습니다.");
  if ((matchesResult.data || []).some(row => row?.source !== "normalized_bracket_runtime")) {
    throw new Error("normalized runtime에 foreign-source Match가 있어 legacy fallback을 중단했습니다.");
  }
  const registrationNames = new Map((registrations || []).map(row => [row.id, row.registration_name]));
  const entryParticipants = (participantsResult.data || []).map(row => ({
    ...row,
    registration_name: registrationNames.get(row.registration_id) || null,
  }));
  const bracket = runtime.topology_kind === "double_elimination"
    ? projectNormalizedDoubleEliminationBracket({
      event,
      runtimeId: runtime.id,
      entries: entriesResult.data || [],
      entryParticipants,
      entrySlots: slotsResult.data || [],
      matches: matchesResult.data || [],
    })
    : projectNormalizedSingleEliminationBracket({
    event,
    runtimeId: runtime.id,
    entries: entriesResult.data || [],
    entryParticipants,
    entrySlots: slotsResult.data || [],
    matches: matchesResult.data || [],
  });
  bracket.applied = event.record_applied_at
    ? { normalized: true, recordAppliedAt: event.record_applied_at, recordMeta: { eventId } }
    : null;
  return {
    bracket,
    event,
    runtime,
    entries: entriesResult.data || [],
    entryParticipants,
    entrySlots: slotsResult.data || [],
    matches: matchesResult.data || [],
  };
}

export async function fetchNormalizedSingleBracketRuntime(eventId, runtimeId = null) {
  return readNormalizedBracketRuntimeFacts(eventId, runtimeId);
}

export async function fetchNormalizedBracketRuntime(eventId, runtimeId = null) {
  return readNormalizedBracketRuntimeFacts(eventId, runtimeId);
}

export async function listNormalizedSingleBracketRuntimes() {
  if (!normalizedBracketRuntimeEnabled()) return [];
  const { data, error } = await db().from("bracket_runtimes").select("id, event_id").order("created_at");
  if (error) fail(error, "normalized bracket runtime 목록을 불러오지 못했습니다.");
  const rows = await Promise.all((data || []).map(row => readNormalizedBracketRuntimeFacts(row.event_id, row.id)));
  return rows.filter(Boolean);
}

export async function listNormalizedBracketRuntimes() {
  return listNormalizedSingleBracketRuntimes();
}

function databaseUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("안전한 UUID 생성을 지원하지 않는 브라우저입니다.");
  return globalThis.crypto.randomUUID();
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

export function buildNormalizedSingleCreateAttempt(participants = []) {
  const input = (participants || []).map((participant, index) => ({
    participant_key: participant.id || `participant-${index + 1}`,
    display_name: String(participant.name || participant.display_name || "").trim(),
    player_id: participant.playerId || participant.player_id || databaseUuid(),
    registration_id: participant.registrationId || participant.registration_id || databaseUuid(),
    entry_id: participant.entryId || participant.entry_id || databaseUuid(),
    entry_participant_id: participant.entryParticipantId || participant.entry_participant_id || databaseUuid(),
  }));
  if (input.length < 2) throw new Error("normalized Single bracket에는 참가자가 2명 이상 필요합니다.");
  const size = nextPowerOfTwo(input.length);
  const matchCount = size / 2;
  const byeCount = size - input.length;
  const shuffled = [...input].sort(() => Math.random() - 0.5);
  const matchOrder = Array.from({ length: matchCount }, (_, index) => index)
    .sort(() => Math.random() - 0.5);
  const byeMatches = new Set(matchOrder.slice(0, byeCount));
  const slots = [];
  let cursor = 0;
  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    const firstSlot = matchIndex * 2 + 1;
    if (byeMatches.has(matchIndex)) {
      slots.push({ slot_no: firstSlot, entry_id: shuffled[cursor++].entry_id });
      continue;
    }
    slots.push({ slot_no: firstSlot, entry_id: shuffled[cursor++].entry_id });
    slots.push({ slot_no: firstSlot + 1, entry_id: shuffled[cursor++].entry_id });
  }
  return { runtimeId: databaseUuid(), participants: input, slots };
}

export function buildNormalizedRuntimeCreateAttempt(participants = [], { runtimeId = databaseUuid() } = {}) {
  const actual = (participants || []).filter(Boolean);
  if (actual.length < 2) throw new Error("normalized bracket에는 참가자 또는 팀이 2개 이상 필요합니다.");
  const size = nextPowerOfTwo(actual.length);
  const shuffled = [...actual].sort(() => Math.random() - 0.5);
  const matchOrder = Array.from({ length: size / 2 }, (_, index) => index)
    .sort(() => Math.random() - 0.5);
  const byeMatches = new Set(matchOrder.slice(0, size - actual.length));
  const slots = [];
  let cursor = 0;
  for (let matchIndex = 0; matchIndex < size / 2; matchIndex += 1) {
    const slotNo = matchIndex * 2 + 1;
    slots.push({ slot_no: slotNo, entry_id: shuffled[cursor++].entryId || shuffled[cursor - 1].entry_id });
    if (!byeMatches.has(matchIndex)) {
      const next = shuffled[cursor++];
      slots.push({ slot_no: slotNo + 1, entry_id: next.entryId || next.entry_id });
    }
  }
  return { runtimeId, participants: actual, slots };
}

export async function createNormalizedSingleBracketRuntime({ runtimeId, eventId, participants, slots } = {}) {
  const { data, error } = await db().rpc("create_normalized_single_bracket_runtime", {
    p_runtime_id: runtimeId,
    p_event_id: eventId,
    p_participants: participants,
    p_slots: slots,
  });
  if (error) fail(error, "normalized Single bracket을 생성하지 못했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function createNormalizedBracketRuntime({ runtimeId, eventId, topologyKind, participants, slots } = {}) {
  const { data, error } = await db().rpc("create_normalized_bracket_runtime", {
    p_runtime_id: runtimeId,
    p_event_id: eventId,
    p_topology_kind: topologyKind,
    p_participants: participants,
    p_slots: slots,
  });
  if (error) fail(error, "normalized bracket을 생성하지 못했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function setNormalizedSingleBracketWinner({ runtimeId, eventId, sourceNodeKey, winnerEntryId = null } = {}) {
  const { data, error } = await db().rpc("set_normalized_single_bracket_winner", {
    p_runtime_id: runtimeId,
    p_event_id: eventId,
    p_source_node_key: sourceNodeKey,
    p_winner_entry_id: winnerEntryId,
  });
  if (error) fail(error, "normalized Single bracket 승자 저장에 실패했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function deleteNormalizedSingleBracketRuntime({ runtimeId, eventId } = {}) {
  const { data, error } = await db().rpc("delete_normalized_single_bracket_runtime", {
    p_runtime_id: runtimeId,
    p_event_id: eventId,
  });
  if (error) fail(error, "normalized Single bracket을 삭제하지 못했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function deleteNormalizedBracketRuntime({ runtimeId, eventId } = {}) {
  const { data, error } = await db().rpc("delete_normalized_bracket_runtime", {
    p_runtime_id: runtimeId,
    p_event_id: eventId,
  });
  if (error) fail(error, "normalized bracket을 삭제하지 못했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

const eventMatchMutationQueues = new Map();
const eventResultMutationQueues = new Map();
const eventRankingAwardMutationQueues = new Map();

function queueEventMatchMutation(eventId, operation) {
  const previous = eventMatchMutationQueues.get(eventId) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  eventMatchMutationQueues.set(eventId, current);
  const clear = () => {
    if (eventMatchMutationQueues.get(eventId) === current) {
      eventMatchMutationQueues.delete(eventId);
    }
  };
  current.then(clear, clear);
  return current;
}

function queueEventResultMutation(eventId, operation) {
  const previous = eventResultMutationQueues.get(eventId) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  eventResultMutationQueues.set(eventId, current);
  const clear = () => {
    if (eventResultMutationQueues.get(eventId) === current) {
      eventResultMutationQueues.delete(eventId);
    }
  };
  current.then(clear, clear);
  return current;
}

function queueEventRankingAwardMutation(eventId, operation) {
  const previous = eventRankingAwardMutationQueues.get(eventId) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  eventRankingAwardMutationQueues.set(eventId, current);
  const clear = () => {
    if (eventRankingAwardMutationQueues.get(eventId) === current) {
      eventRankingAwardMutationQueues.delete(eventId);
    }
  };
  current.then(clear, clear);
  return current;
}

function bracketMatchIdentityState(eventId, bracket) {
  if (!eventId) return { eligible: false, reason: "event_unlinked" };
  if (!bracket || (bracket.eventId && bracket.eventId !== eventId)) {
    throw new Error("normalized Match 대상 Event와 대진표 연결이 일치하지 않습니다.");
  }
  const participants = (bracket.participants || [])
    .filter(participant => bracket.mode === "team"
      ? Array.isArray(participant?.members)
      : !Array.isArray(participant?.members));
  if (!participants.length) return { eligible: false, reason: "legacy_bracket" };

  const entryLinkedCount = participants.filter(participant => participant?.entryId).length;
  if (!entryLinkedCount) return { eligible: false, reason: "legacy_bracket" };
  if (entryLinkedCount !== participants.length) {
    throw new Error("일부 참가자에게만 Entry identity가 있어 normalized Match를 동기화할 수 없습니다.");
  }

  const entryIds = participants.map(participant => participant.entryId);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error("동일한 Entry identity가 대진표 참가자 두 명 이상에게 연결되어 있습니다.");
  }

  return { eligible: true, participants };
}

const EVENT_RUNTIME_MATCH_SELECT = `
  id,
  event_id,
  source,
  source_node_key,
  match_kind,
  parent_match_id,
  round_number,
  stage_label,
  sequence_no,
  entry_a_id,
  entry_b_id,
  player_a_id,
  player_b_id,
  winner_entry_id,
  winner_player_id,
  resolution,
  played_at
`;

function sameRuntimeMatchSnapshot(left, right) {
  const normalize = rows => (Array.isArray(rows) ? rows : [])
    .map(row => JSON.stringify(row))
    .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function readEventRuntimeMatchesNow(eventId, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  const { data, error } = await db()
    .from("matches")
    .select(EVENT_RUNTIME_MATCH_SELECT)
    .eq("event_id", eventId)
    .eq("source", source);

  if (error) fail(error, "기존 normalized Match를 확인하지 못했습니다.");
  return data || [];
}

async function readEventAllMatchesNow(eventId) {
  const { data, error } = await db()
    .from("matches")
    .select(EVENT_RUNTIME_MATCH_SELECT)
    .eq("event_id", eventId);

  if (error) fail(error, "Event의 normalized Match ownership을 확인하지 못했습니다.");
  return data || [];
}

async function updateEventRuntimeMatchesNow(eventId, updates, now, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  for (const update of updates) {
    const { data, error } = await db()
      .from("matches")
      .update({ ...update.payload, updated_at: now })
      .eq("id", update.id)
      .eq("event_id", eventId)
      .eq("source", source)
      .select("id")
      .maybeSingle();

    if (error) fail(error, `normalized Match '${update.payload.source_node_key}'를 수정하지 못했습니다.`);
    if (!data) throw new Error(`normalized Match '${update.payload.source_node_key}'가 동기화 중 변경되었습니다.`);
  }
}

async function insertEventRuntimeMatchesNow(eventId, rows, now, preserveIds = false, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  if (!rows.length) return;
  const payloads = rows.map(row => {
    const { id, ...values } = row;
    return {
      ...values,
      ...(preserveIds && id ? { id } : {}),
      event_id: eventId,
      source,
      updated_at: now,
    };
  });

  const { data, error } = await db()
    .from("matches")
    .insert(payloads)
    .select("id");

  if (error) fail(error, "신규 normalized Match를 생성하지 못했습니다.");
  if ((data || []).length !== rows.length) {
    throw new Error("일부 신규 normalized Match가 저장되지 않았습니다.");
  }
}

async function deleteEventRuntimeMatchIdsNow(eventId, ids, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  if (!ids.length) return;
  const { data, error } = await db()
    .from("matches")
    .delete()
    .eq("event_id", eventId)
    .eq("source", source)
    .in("id", ids)
    .select("id");

  if (error) fail(error, "더 이상 성립하지 않는 normalized Match를 정리하지 못했습니다.");
  if ((data || []).length !== ids.length) {
    throw new Error("일부 stale normalized Match가 삭제되지 않았습니다.");
  }
}

async function deleteEventRuntimeMatchRowsNow(eventId, rows, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  const children = rows.filter(row => row?.id && row.match_kind !== "bracket").map(row => row.id);
  const parents = rows.filter(row => row?.id && row.match_kind === "bracket").map(row => row.id);
  await deleteEventRuntimeMatchIdsNow(eventId, children, source);
  await deleteEventRuntimeMatchIdsNow(eventId, parents, source);
}

async function replaceEventRuntimeMatchesNow(eventId, rows, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  const snapshot = Array.isArray(rows) ? rows : [];
  const currentRows = await readEventRuntimeMatchesNow(eventId, source);
  await deleteEventRuntimeMatchRowsNow(eventId, currentRows, source);

  const now = new Date().toISOString();
  const parents = snapshot.filter(row => row.match_kind === "bracket");
  const children = snapshot.filter(row => row.match_kind !== "bracket");
  await insertEventRuntimeMatchesNow(eventId, parents, now, true, source);
  await insertEventRuntimeMatchesNow(eventId, children, now, true, source);
}

async function syncEventBracketMatchesNow(eventId, bracket, source = LEGACY_BRACKET_RUNTIME_SOURCE) {
  const identityState = bracketMatchIdentityState(eventId, bracket);
  if (!identityState.eligible) {
    return { skipped: true, reason: identityState.reason, inserted: 0, updated: 0, deleted: 0 };
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("normalized Match를 연결할 Event를 찾을 수 없습니다.");
  if (Boolean(event.is_team_event) !== (bracket.mode === "team")) {
    throw new Error("Event의 팀전 구분과 대진표 모드가 일치하지 않습니다.");
  }
  if (source === "normalized_bracket_runtime") {
    const allRows = await readEventAllMatchesNow(eventId);
    if (allRows.some(row => row?.source !== source)) {
      throw new Error("normalized runtime에 foreign-source Match가 있어 동기화를 중단했습니다.");
    }
  }

  const desiredRows = buildEventBracketMatchSnapshot(bracket);
  const previousRows = await readEventRuntimeMatchesNow(eventId, source);
  const now = new Date().toISOString();
  const desiredParents = desiredRows.filter(row => row.match_kind === "bracket");
  const desiredChildren = desiredRows.filter(row => row.match_kind !== "bracket");
  const existingParents = previousRows.filter(row => row.match_kind === "bracket");
  const existingChildren = previousRows.filter(row => row.match_kind !== "bracket");
  const parentPlan = buildBracketMatchSyncPlan(existingParents, desiredParents, now);

  try {
    await updateEventRuntimeMatchesNow(eventId, parentPlan.updates, now, source);
    await insertEventRuntimeMatchesNow(eventId, parentPlan.inserts, now, false, source);

    const currentParents = (await readEventRuntimeMatchesNow(eventId, source))
      .filter(row => row.match_kind === "bracket");
    const resolvedChildren = resolveBracketMatchParentIds(desiredChildren, currentParents);
    const childPlan = buildBracketMatchSyncPlan(existingChildren, resolvedChildren, now);

    await deleteEventRuntimeMatchIdsNow(eventId, childPlan.deleteIds, source);
    await updateEventRuntimeMatchesNow(eventId, childPlan.updates, now, source);
    await insertEventRuntimeMatchesNow(eventId, childPlan.inserts, now, false, source);
    await deleteEventRuntimeMatchIdsNow(eventId, parentPlan.deleteIds, source);

    return {
      skipped: false,
      inserted: parentPlan.inserts.length + childPlan.inserts.length,
      updated: parentPlan.updates.length + childPlan.updates.length,
      deleted: parentPlan.deleteIds.length + childPlan.deleteIds.length,
      previousRows,
    };
  } catch (error) {
    try {
      await replaceEventRuntimeMatchesNow(eventId, previousRows, source);
    } catch (restoreError) {
      throw new Error(
        `${error?.message || "normalized Match 동기화에 실패했습니다."} (이전 Match snapshot 복구 실패: ${restoreError?.message || "알 수 없는 오류"})`
      );
    }
    throw error;
  }
}

export async function syncEventBracketMatches(eventId, bracket) {
  if (!eventId) return { skipped: true, reason: "event_unlinked", inserted: 0, updated: 0, deleted: 0 };
  return queueEventMatchMutation(eventId, () => syncEventBracketMatchesNow(eventId, bracket));
}

export async function syncNormalizedBracketMatches(eventId, bracket) {
  if (!eventId) return { skipped: true, reason: "event_unlinked", inserted: 0, updated: 0, deleted: 0 };
  return queueEventMatchMutation(eventId, () => syncEventBracketMatchesNow(eventId, bracket, "normalized_bracket_runtime"));
}

export async function deleteEventBracketMatches(eventId, expectedRows = null) {
  if (!eventId) return { deleted: 0 };

  return queueEventMatchMutation(eventId, async () => {
    const rows = await readEventRuntimeMatchesNow(eventId);
    if (Array.isArray(expectedRows) && !sameRuntimeMatchSnapshot(rows, expectedRows)) {
      throw new Error("삭제 Phase A 이후 normalized Match 상태가 변경되어 삭제를 중단했습니다.");
    }
    try {
      await deleteEventRuntimeMatchRowsNow(eventId, rows);
      return { deleted: rows.length, previousRows: rows };
    } catch (error) {
      try {
        await replaceEventRuntimeMatchesNow(eventId, rows);
      } catch (restoreError) {
        throw new Error(
          `${error?.message || "normalized Match 삭제에 실패했습니다."} (삭제 전 Match snapshot 복구 실패: ${restoreError?.message || "알 수 없는 오류"})`
        );
      }
      throw error;
    }
  });
}

function unsafeBracketCleanup(message) {
  const error = new Error(message);
  error.code = "YPL_UNSAFE_BRACKET_CLEANUP";
  return error;
}

/**
 * Read the rows that a bracket deletion is allowed to remove. This is also
 * the guard for Event-linked brackets: an existing normalized artifact must
 * never be hidden by deleting only the legacy JSON bracket.
 */
export async function inspectEventBracketCleanup(eventId, bracket, identityChanges = []) {
  if (!eventId) return { safe: true, event: null, matchRows: [], entries: [], entryParticipants: [], registrations: [], players: [] };

  if (!bracket?.eventId || bracket.eventId !== eventId) {
    throw unsafeBracketCleanup("대진표의 eventId와 삭제 대상 Event가 일치하지 않아 삭제를 중단했습니다.");
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("대진표를 삭제할 Event를 찾을 수 없습니다.");
  if (Boolean(event.is_team_event) !== (bracket?.mode === "team")) {
    throw unsafeBracketCleanup("Event의 팀전 구분과 대진표 모드가 일치하지 않아 삭제를 중단했습니다.");
  }
  if (event.record_applied_at || event.status === "completed") {
    throw new Error("기록이 반영된 Event의 대진표는 먼저 기록 반영을 취소해야 합니다.");
  }
  if (!["open", "running"].includes(event.status)) {
    throw new Error("현재 Event 상태에서는 대진표를 삭제할 수 없습니다.");
  }

  const allMatchRows = await readEventAllMatchesNow(eventId);
  const foreignMatchRows = allMatchRows.filter(row => row.source !== LEGACY_BRACKET_RUNTIME_SOURCE);
  if (foreignMatchRows.length) {
    throw unsafeBracketCleanup("다른 source의 normalized Match가 존재해 대진표 삭제를 중단했습니다.");
  }
  const matchRows = allMatchRows.filter(row => row.source === LEGACY_BRACKET_RUNTIME_SOURCE);
  const confirmationState = validateBracketParticipantConfirmation(bracket);
  if (!confirmationState.ok) {
    throw unsafeBracketCleanup(
      "참가 확정 metadata가 없거나 불완전해 대진표 삭제를 중단했습니다."
    );
  }

  const changes = confirmationState.identityChanges;
  const entryIds = [...new Set(changes.map(change => change.entryId).filter(Boolean))];
  const entryParticipantIds = [...new Set(changes.map(change => change.entryParticipantId).filter(Boolean))];
  const registrationIds = [...new Set(changes.map(change => change.registrationId).filter(Boolean))];
  const playerIds = [...new Set(changes.map(change => change.playerId).filter(Boolean))];
  const [entryResult, entryParticipantResult, registrationResult, playerResult] = await Promise.all([
    db().from("entries").select("id, event_id, entry_type, display_name, status").eq("event_id", eventId),
    db().from("entry_participants").select("id, event_id, entry_id, registration_id, player_id, member_order, role").eq("event_id", eventId),
    db().from("event_registrations").select("id, event_id, player_id, registration_name, registration_data, registration_source, registered_at, final_submission_id, updated_at").eq("event_id", eventId).in("id", registrationIds),
    playerIds.length
      ? db().from("players").select("id, display_name, status").in("id", playerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (entryResult.error) fail(entryResult.error, "대진표 삭제 전에 Entry ownership을 확인하지 못했습니다.");
  if (entryParticipantResult.error) fail(entryParticipantResult.error, "대진표 삭제 전에 EntryParticipant ownership을 확인하지 못했습니다.");
  if (registrationResult.error) fail(registrationResult.error, "대진표 삭제 전에 Registration ownership을 확인하지 못했습니다.");
  if (playerResult.error) fail(playerResult.error, "대진표 삭제 전에 Player ownership을 확인하지 못했습니다.");

  const entries = entryResult.data || [];
  const entryParticipants = entryParticipantResult.data || [];
  const registrations = registrationResult.data || [];
  const players = playerResult.data || [];
  const expectedEntryIdSet = new Set(entryIds);
  const expectedEntryParticipantIdSet = new Set(entryParticipantIds);
  const unexpectedEntries = entries.filter(row => !expectedEntryIdSet.has(row.id));
  const unexpectedEntryParticipants = entryParticipants.filter(row => !expectedEntryParticipantIdSet.has(row.id));
  if (isInterruptedBracketCleanupState({ matchRows, entries, entryParticipants })) {
    if (registrations.length !== registrationIds.length || players.length !== playerIds.length) {
      throw unsafeBracketCleanup("interrupted deletion의 Registration/Player identity가 현재 Event와 일치하지 않아 복구를 중단했습니다.");
    }
    const registrationById = new Map(registrations.map(row => [row.id, row]));
    const playerById = new Map(players.map(row => [row.id, row]));
    for (const change of changes) {
      const registration = registrationById.get(change.registrationId);
      if (!registration || registration.event_id !== eventId || registration.player_id !== change.playerId || !playerById.has(change.playerId)) {
        throw unsafeBracketCleanup("interrupted deletion의 Registration/Player identity가 metadata와 일치하지 않아 복구를 중단했습니다.");
      }
    }
    return {
      safe: true,
      interrupted: true,
      event,
      previousEventStatus: confirmationState.previousEventStatus,
      matchRows,
      entries,
      entryParticipants,
      registrations,
      players,
      identityChanges: changes,
    };
  }
  const ownedEntries = entries.filter(row => expectedEntryIdSet.has(row.id));
  const ownedEntryParticipants = entryParticipants.filter(row => expectedEntryParticipantIdSet.has(row.id));
  const expectedEntryCount = (bracket.participants || []).length;
  if (unexpectedEntries.length || unexpectedEntryParticipants.length || ownedEntries.length !== expectedEntryCount || ownedEntryParticipants.length !== changes.length || registrations.length !== registrationIds.length || players.length !== playerIds.length) {
    throw unsafeBracketCleanup("참가 확정 metadata와 normalized identity row 수가 일치하지 않아 대진표 삭제를 중단했습니다.");
  }

  const entryById = new Map(ownedEntries.map(row => [row.id, row]));
  const entryParticipantById = new Map(ownedEntryParticipants.map(row => [row.id, row]));
  const registrationById = new Map(registrations.map(row => [row.id, row]));
  for (const change of changes) {
    const entry = entryById.get(change.entryId);
    const entryParticipant = entryParticipantById.get(change.entryParticipantId);
    const registration = registrationById.get(change.registrationId);
    if (!entry || entry.entry_type !== (bracket.mode === "team" ? "team" : "individual") || entry.status !== "active" ||
      !registration || registration.player_id !== change.playerId ||
      !entryParticipant || entryParticipant.event_id !== eventId || entryParticipant.entry_id !== change.entryId || entryParticipant.registration_id !== change.registrationId ||
      entryParticipant.player_id !== change.playerId ||
      (bracket.mode === "team" && entryParticipant.member_order !== change.memberOrder) ||
      bracket.mode !== "team" && entryParticipant.member_order !== 1) {
      throw unsafeBracketCleanup("참가 확정 metadata가 현재 normalized Entry/EntryParticipant와 일치하지 않아 대진표 삭제를 중단했습니다.");
    }
  }

  return { safe: true, event, previousEventStatus: confirmationState.previousEventStatus, matchRows, entries: ownedEntries, entryParticipants: ownedEntryParticipants, registrations, players, identityChanges: changes };
}

export async function preflightEventBracketDeletion(eventId, bracket) {
  const ownership = await inspectEventBracketCleanup(eventId, bracket);
  await assertEventHasNoResults(eventId);
  await assertEventHasNoRankingAwards(eventId);
  return ownership;
}

export async function restoreEventBracketMatches(eventId, previousRows) {
  if (!eventId) return { restored: 0 };
  const snapshot = Array.isArray(previousRows) ? previousRows : [];
  return queueEventMatchMutation(eventId, async () => {
    await replaceEventRuntimeMatchesNow(eventId, snapshot);
    return { restored: snapshot.length };
  });
}

async function readEventResults(eventId) {
  const { data, error } = await db()
    .from("results")
    .select(`
      id,
      entry_id,
      placement_code,
      rank_min,
      rank_max,
      placement_label,
      source,
      created_at,
      updated_at
    `)
    .eq("event_id", eventId);

  if (error) fail(error, "Event의 기존 normalized Result를 확인하지 못했습니다.");
  return data || [];
}

async function applyEventResultSyncPlan(eventId, plan, now) {
  for (const update of plan.updates) {
    const { data, error } = await db()
      .from("results")
      .update({
        ...update.payload,
        updated_at: update.payload.updated_at || now,
      })
      .eq("id", update.id)
      .eq("event_id", eventId)
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .select("id")
      .maybeSingle();

    if (error) fail(error, `normalized Result '${update.payload.entry_id}'를 수정하지 못했습니다.`);
    if (!data) throw new Error(`normalized Result '${update.payload.entry_id}'가 동기화 중 변경되었습니다.`);
  }

  if (plan.inserts.length) {
    const { data, error } = await db()
      .from("results")
      .insert(plan.inserts.map(row => ({
        ...row,
        event_id: eventId,
        source: LEGACY_BRACKET_RUNTIME_SOURCE,
        updated_at: row.updated_at || now,
      })))
      .select("id");

    if (error) fail(error, "신규 normalized Result를 생성하지 못했습니다.");
    if ((data || []).length !== plan.inserts.length) {
      throw new Error("일부 신규 normalized Result가 저장되지 않았습니다.");
    }
  }

  if (plan.deleteIds.length) {
    const { data, error } = await db()
      .from("results")
      .delete()
      .eq("event_id", eventId)
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .in("id", plan.deleteIds)
      .select("id");

    if (error) fail(error, "더 이상 유효하지 않은 runtime normalized Result를 정리하지 못했습니다.");
    if ((data || []).length !== plan.deleteIds.length) {
      throw new Error("일부 stale normalized Result가 삭제되지 않았습니다.");
    }
  }

  return {
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    deleted: plan.deleteIds.length,
  };
}

async function replaceEventRuntimeResultsNow(eventId, desiredRows) {
  const existingRows = await readEventResults(eventId);
  const plan = buildBracketResultSyncPlan(existingRows, desiredRows);
  return applyEventResultSyncPlan(eventId, plan, new Date().toISOString());
}

async function validateResultEntries(eventId, desiredRows, entryType = "individual") {
  const entryIds = desiredRows.map(row => row.entry_id);
  const { data, error } = await db()
    .from("entries")
    .select("id, event_id, entry_type, status")
    .eq("event_id", eventId)
    .in("id", entryIds);

  if (error) fail(error, "입상자의 Entry identity를 확인하지 못했습니다.");

  const entryById = new Map((data || []).map(row => [row.id, row]));
  for (const entryId of entryIds) {
    const entry = entryById.get(entryId);
    if (!entry || entry.event_id !== eventId || entry.entry_type !== entryType || entry.status !== "active") {
      const entryLabel = entryType === "team" ? "팀" : "개인";
      throw new Error(`입상자 Entry '${entryId}'가 현재 Event의 활성 ${entryLabel} Entry와 일치하지 않습니다.`);
    }
  }
}

async function syncEventBracketResultsNow(eventId, bracket, result) {
  if (!bracket || bracket.eventId !== eventId) {
    throw new Error("normalized Result 대상 Event와 대진표 연결이 일치하지 않습니다.");
  }

  const snapshot = buildEventBracketResultSnapshot(bracket, result);
  if (snapshot.skipped) {
    return {
      skipped: true,
      reason: snapshot.reason,
      inserted: 0,
      updated: 0,
      deleted: 0,
      previousRows: [],
    };
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("normalized Result를 연결할 Event를 찾을 수 없습니다.");
  if (Boolean(event.is_team_event) !== (bracket.mode === "team")) {
    throw new Error("Event의 팀전 구분과 대진표 모드가 일치하지 않습니다.");
  }

  await validateResultEntries(eventId, snapshot.rows, event.is_team_event ? "team" : "individual");
  const existingRows = await readEventResults(eventId);
  const previousRows = existingRows.filter(row => row.source === LEGACY_BRACKET_RUNTIME_SOURCE);
  const plan = buildBracketResultSyncPlan(existingRows, snapshot.rows);

  try {
    const counts = await applyEventResultSyncPlan(eventId, plan, new Date().toISOString());
    return { skipped: false, ...counts, previousRows };
  } catch (error) {
    try {
      await replaceEventRuntimeResultsNow(eventId, previousRows);
    } catch (restoreError) {
      const combined = new Error(
        `${error?.message || "normalized Result 동기화에 실패했습니다."} (이전 Result snapshot 복구 실패: ${restoreError?.message || "알 수 없는 오류"})`
      );
      combined.code = "YPL_RESULT_ROLLBACK_FAILED";
      combined.cause = error;
      throw combined;
    }
    throw error;
  }
}

export async function syncEventBracketResults(eventId, bracket, result) {
  if (!eventId) {
    return {
      skipped: true,
      reason: "event_unlinked",
      inserted: 0,
      updated: 0,
      deleted: 0,
      previousRows: [],
    };
  }
  return queueEventResultMutation(eventId, () => syncEventBracketResultsNow(eventId, bracket, result));
}

export async function deleteEventBracketResults(eventId, bracket) {
  if (!eventId) return { skipped: true, reason: "event_unlinked", deleted: 0, previousRows: [] };
  if (!bracket || bracket.eventId !== eventId) {
    throw new Error("정리할 normalized Result의 Event와 대진표 연결이 일치하지 않습니다.");
  }

  const identityState = bracketResultIdentityState(bracket);
  if (!identityState.eligible) {
    return { skipped: true, reason: identityState.reason, deleted: 0, previousRows: [] };
  }

  return queueEventResultMutation(eventId, async () => {
    const event = await getEvent(eventId);
    if (!event) throw new Error("runtime normalized Result를 정리할 Event를 찾을 수 없습니다.");
    if (Boolean(event.is_team_event) !== (bracket.mode === "team")) {
      throw new Error("Event의 팀전 구분과 대진표 모드가 일치하지 않습니다.");
    }

    const existingRows = await readEventResults(eventId);
    const previousRows = existingRows.filter(row => row.source === LEGACY_BRACKET_RUNTIME_SOURCE);
    const plan = buildBracketResultSyncPlan(existingRows, []);
    const counts = await applyEventResultSyncPlan(eventId, plan, new Date().toISOString());
    return { skipped: false, ...counts, previousRows };
  });
}

export async function restoreEventBracketResults(eventId, previousRows = []) {
  if (!eventId) return { inserted: 0, updated: 0, deleted: 0 };
  const snapshot = Array.isArray(previousRows) ? previousRows : [];
  return queueEventResultMutation(eventId, () => replaceEventRuntimeResultsNow(eventId, snapshot));
}

export async function assertEventHasNoResults(eventId) {
  if (!eventId) return null;
  const rows = await readEventResults(eventId);
  if (rows.length) {
    const sources = [...new Set(rows.map(row => row.source || "unknown"))].join(", ");
    throw new Error(`Event에 Result가 ${rows.length}건 남아 있습니다 (${sources}). 기록 반영 취소를 먼저 확인해 주세요.`);
  }
  return null;
}

async function readEventRankingAwards(eventId) {
  const { data, error } = await db()
    .from("ranking_awards")
    .select(`
      id,
      event_id,
      player_id,
      result_id,
      award_kind,
      points_delta,
      win_delta,
      runner_up_delta,
      top4_delta,
      counts_series,
      counts_season,
      related_award_id,
      reason,
      source,
      created_at
    `)
    .eq("event_id", eventId);

  if (error) fail(error, "Event의 기존 RankingAward를 확인하지 못했습니다.");
  return data || [];
}

async function readEventResultParticipants(eventId, resultRows) {
  const entryIds = [...new Set((resultRows || []).map(row => row?.entry_id).filter(Boolean))];
  if (!entryIds.length) return [];

  const { data, error } = await db()
    .from("entry_participants")
    .select("id, event_id, entry_id, player_id, member_order")
    .eq("event_id", eventId)
    .in("entry_id", entryIds);

  if (error) fail(error, "Result의 EntryParticipant/Player identity를 확인하지 못했습니다.");
  return data || [];
}

async function readPlacementAwardByIdentity(eventId, resultId, playerId) {
  const { data, error } = await db()
    .from("ranking_awards")
    .select(`
      id,
      event_id,
      player_id,
      result_id,
      award_kind,
      points_delta,
      win_delta,
      runner_up_delta,
      top4_delta,
      counts_series,
      counts_season,
      reason,
      source,
      created_at
    `)
    .eq("event_id", eventId)
    .eq("result_id", resultId)
    .eq("player_id", playerId)
    .eq("award_kind", "placement")
    .maybeSingle();

  if (error) fail(error, "중복 방지 후 기존 placement RankingAward를 확인하지 못했습니다.");
  return data || null;
}

async function applyEventRankingAwardSyncPlan(eventId, plan) {
  for (const update of plan.updates) {
    const { id: _id, created_at: _createdAt, ...payload } = update.payload;
    const { data, error } = await db()
      .from("ranking_awards")
      .update(payload)
      .eq("id", update.id)
      .eq("event_id", eventId)
      .eq("award_kind", "placement")
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .select("id")
      .maybeSingle();

    if (error) fail(error, `placement RankingAward '${update.id}'를 수정하지 못했습니다.`);
    if (!data) throw new Error(`placement RankingAward '${update.id}'가 동기화 중 변경되었습니다.`);
  }

  let inserted = 0;
  for (const row of plan.inserts) {
    const payload = {
      ...row,
      event_id: eventId,
      source: LEGACY_BRACKET_RUNTIME_SOURCE,
    };
    const { data, error } = await db()
      .from("ranking_awards")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (!error && data) {
      inserted += 1;
      continue;
    }

    if (String(error?.code || "") === "23505") {
      const concurrent = await readPlacementAwardByIdentity(eventId, row.result_id, row.player_id);
      if (
        concurrent?.source === LEGACY_BRACKET_RUNTIME_SOURCE &&
        samePlacementAwardValues(concurrent, row)
      ) {
        continue;
      }
    }

    fail(error, "신규 placement RankingAward를 생성하지 못했습니다.");
  }

  if (plan.deleteIds.length) {
    const { data, error } = await db()
      .from("ranking_awards")
      .delete()
      .eq("event_id", eventId)
      .eq("award_kind", "placement")
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .in("id", plan.deleteIds)
      .select("id");

    if (error) fail(error, "더 이상 유효하지 않은 runtime placement RankingAward를 정리하지 못했습니다.");
    if ((data || []).length !== plan.deleteIds.length) {
      throw new Error("일부 stale runtime placement RankingAward가 삭제되지 않았습니다.");
    }
  }

  return {
    inserted,
    updated: plan.updates.length,
    deleted: plan.deleteIds.length,
  };
}

async function replaceEventRuntimeRankingAwardsNow(eventId, desiredRows) {
  const existingRows = await readEventRankingAwards(eventId);
  const plan = buildBracketRankingAwardSyncPlan(existingRows, desiredRows);
  return applyEventRankingAwardSyncPlan(eventId, plan);
}

async function syncEventBracketRankingAwardsNow(eventId, bracket) {
  if (!bracket || bracket.eventId !== eventId) {
    throw new Error("RankingAward 대상 Event와 대진표 연결이 일치하지 않습니다.");
  }

  const identityState = bracketResultIdentityState(bracket);
  if (!identityState.eligible) {
    return {
      skipped: true,
      reason: identityState.reason,
      inserted: 0,
      updated: 0,
      deleted: 0,
      previousRows: [],
    };
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("RankingAward를 연결할 Event를 찾을 수 없습니다.");
  if (Boolean(event.is_team_event) !== (bracket.mode === "team")) {
    throw new Error("Event의 팀전 구분과 대진표 모드가 일치하지 않습니다.");
  }

  const resultRows = await readEventResults(eventId);
  const runtimeResults = resultRows.filter(row => row.source === LEGACY_BRACKET_RUNTIME_SOURCE);
  const entryParticipants = await readEventResultParticipants(eventId, runtimeResults);
  const snapshot = buildEventRankingAwardSnapshot(event, runtimeResults, entryParticipants);
  if (!snapshot.skipped && !runtimeResults.length) {
    throw new Error("RankingAward를 생성할 runtime Result가 없습니다.");
  }
  const existingRows = await readEventRankingAwards(eventId);
  const previousRows = existingRows.filter(row =>
    row.source === LEGACY_BRACKET_RUNTIME_SOURCE && row.award_kind === "placement"
  );
  const plan = buildBracketRankingAwardSyncPlan(existingRows, snapshot.rows);

  try {
    const counts = await applyEventRankingAwardSyncPlan(eventId, plan);
    return { skipped: snapshot.skipped, reason: snapshot.reason, ...counts, previousRows };
  } catch (error) {
    try {
      await replaceEventRuntimeRankingAwardsNow(eventId, previousRows);
    } catch (restoreError) {
      const combined = new Error(
        `${error?.message || "RankingAward 동기화에 실패했습니다."} (이전 RankingAward snapshot 복구 실패: ${restoreError?.message || "알 수 없는 오류"})`
      );
      combined.code = "YPL_RANKING_AWARD_ROLLBACK_FAILED";
      combined.cause = error;
      throw combined;
    }
    throw error;
  }
}

export async function syncEventBracketRankingAwards(eventId, bracket) {
  if (!eventId) {
    return {
      skipped: true,
      reason: "event_unlinked",
      inserted: 0,
      updated: 0,
      deleted: 0,
      previousRows: [],
    };
  }
  return queueEventRankingAwardMutation(
    eventId,
    () => syncEventBracketRankingAwardsNow(eventId, bracket)
  );
}

export async function deleteEventBracketRankingAwards(eventId, bracket) {
  if (!eventId) return { skipped: true, reason: "event_unlinked", deleted: 0, previousRows: [] };
  if (!bracket || bracket.eventId !== eventId) {
    throw new Error("정리할 RankingAward의 Event와 대진표 연결이 일치하지 않습니다.");
  }

  const identityState = bracketResultIdentityState(bracket);
  if (!identityState.eligible) {
    return { skipped: true, reason: identityState.reason, deleted: 0, previousRows: [] };
  }

  return queueEventRankingAwardMutation(eventId, async () => {
    const event = await getEvent(eventId);
    if (!event) throw new Error("runtime RankingAward를 정리할 Event를 찾을 수 없습니다.");
    if (Boolean(event.is_team_event) !== (bracket.mode === "team")) {
      throw new Error("Event의 팀전 구분과 대진표 모드가 일치하지 않습니다.");
    }

    const existingRows = await readEventRankingAwards(eventId);
    const previousRows = existingRows.filter(row =>
      row.source === LEGACY_BRACKET_RUNTIME_SOURCE && row.award_kind === "placement"
    );
    const plan = buildBracketRankingAwardSyncPlan(existingRows, []);
    const counts = await applyEventRankingAwardSyncPlan(eventId, plan);
    return { skipped: false, ...counts, previousRows };
  });
}

export async function restoreEventBracketRankingAwards(eventId, previousRows = []) {
  if (!eventId) return { inserted: 0, updated: 0, deleted: 0 };
  const snapshot = Array.isArray(previousRows) ? previousRows : [];
  return queueEventRankingAwardMutation(
    eventId,
    () => replaceEventRuntimeRankingAwardsNow(eventId, snapshot)
  );
}

export async function assertEventHasNoRankingAwards(eventId) {
  if (!eventId) return null;
  const rows = await readEventRankingAwards(eventId);
  if (rows.length) {
    const kinds = [...new Set(rows.map(row =>
      `${row.award_kind || "unknown"}/${row.source || "unknown"}`
    ))].join(", ");
    throw new Error(
      `Event에 RankingAward가 ${rows.length}건 남아 있습니다 (${kinds}). 기록 반영 취소를 먼저 확인해 주세요.`
    );
  }
  return null;
}

export async function getEvent(eventId) {
  if (!eventId) return null;

  const { data, error } = await db()
    .from("events")
    .select(`
      id,
      name,
      event_type,
      division,
      battle_format,
      competition_format,
      competition_settings,
      is_team_event,
      regulation_id,
      cup_rule_id,
      cup_rule_settings,
      registration_settings,
      season_id,
      status,
      submission_target_at,
      team_reveal_mode,
      team_revealed_at,
      record_applied_at${CHAMPIONS_EVENT_SELECT_FIELDS}
    `)
    .eq("id", eventId)
    .maybeSingle();

  if (error) fail(error, "대회 정보를 불러오지 못했습니다.");
  return data || null;
}

export async function listSubmissionEvents() {
  const { data, error } = await db()
    .from("events")
    .select(`
      id,
      name,
      event_type,
      division,
      battle_format,
      competition_format,
      competition_settings,
      is_team_event,
      regulation_id,
      cup_rule_id,
      cup_rule_settings,
      registration_settings,
      season_id,
      status,
      submission_target_at,
      record_applied_at${CHAMPIONS_EVENT_SELECT_FIELDS}
    `)
    .in("status", ["open", "running"])
    .is("record_applied_at", null)
    .order("created_at", { ascending: false });

  if (error) fail(error, "제출 가능한 대회를 불러오지 못했습니다.");
  return data || [];
}

async function findExistingApplicantPlayer(registrationName) {
  const name = String(registrationName || "").trim();
  if (!name) throw new Error("참가자 이름을 입력해 주세요.");

  const { data: matches, error } = await db()
    .from("players")
    .select("id, display_name")
    .eq("display_name", name);

  if (error) fail(error, "참가자 정보를 확인하지 못했습니다.");

  // 신청 단계에서는 기존 Player가 정확히 1명일 때만 연결한다.
  // 신규 이름 또는 동명이인은 Player를 생성/확정하지 않고 기록 반영 단계로 넘긴다.
  return (matches || []).length === 1 ? matches[0] : null;
}
export async function submitEventApplication({
  eventId,
  registrationName,
  registrationData = {},
}) {
  const name = String(registrationName || "").trim();
  if (!eventId) throw new Error("이 신청서에 연결된 대회가 없습니다.");
  if (!name) throw new Error("참가자 이름을 입력해 주세요.");

  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (event.status !== "open") throw new Error("현재 참가 신청을 받고 있는 대회가 아닙니다.");

  const player = await findExistingApplicantPlayer(name);

  const { data: existing, error: existingError } = await db()
    .from("event_registrations")
    .select("id")
    .eq("event_id", event.id)
    .eq("registration_name", name)
    .maybeSingle();

  if (existingError) fail(existingError, "기존 신청 여부를 확인하지 못했습니다.");

  if (existing) {
    const duplicate = new Error("이미 신청된 참가자입니다.");
    duplicate.code = "YPL_ALREADY_REGISTERED";
    throw duplicate;
  }

  const now = new Date().toISOString();

  const { data, error } = await db()
    .from("event_registrations")
    .insert({
      event_id: event.id,
      player_id: player?.id || null,
      registration_name: name,
      registration_data: registrationData || {},
      registration_source: "application",
      registered_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) fail(error, "참가 신청을 저장하지 못했습니다.");
  return data;
}

export async function findSubmissionRegistration(eventId, registrationName) {
  const name = String(registrationName || "").trim();
  if (!eventId || !name) return null;

  const event = await getEvent(eventId);
  if (!event) throw new Error("대회를 찾을 수 없습니다.");

  if (!["open", "running"].includes(event.status) || event.record_applied_at) {
    throw new Error("현재 파티를 제출할 수 없는 대회입니다.");
  }

  const { data, error } = await db()
    .from("event_registrations")
    .select(`
      id,
      event_id,
      player_id,
      registration_name,
      registration_source,
      final_submission_id
    `)
    .eq("event_id", event.id)
    .eq("registration_name", name)
    .in("registration_source", ["application", "advancement", "manual"]);

  if (error) fail(error, "신청 정보를 확인하지 못했습니다.");

  const selected = selectSubmissionRegistration(data || [], name);
  if (!selected) return null;

  const { data: latestSubmission, error: latestSubmissionError } = await db()
    .from("registration_submissions")
    .select("id, registration_id, snapshot_id, revision, submitted_at, source")
    .eq("registration_id", selected.id)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSubmissionError) fail(latestSubmissionError, "기존 파티 제출 상태를 확인하지 못했습니다.");

  return {
    event,
    registration: selected,
    latestSubmission: latestSubmission || null,
  };
}

export async function submitEventTeamSnapshot({
  eventId,
  registrationId,
  registrationName,
  registrationSource = "application",
  eligibility,
  team,
  regulationId,
  cupRuleId,
  cupRuleSettings,
  detailData,
  now = new Date(),
} = {}) {
  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 Event를 찾을 수 없습니다.");

  const payload = buildTeamSnapshotSubmission({
    event,
    registration: {
      id: registrationId,
      event_id: eventId,
      registration_name: String(registrationName || "").trim(),
      registration_source: registrationSource,
    },
    registrationName,
    eligibility,
    team,
    regulationId,
    cupRuleId,
    cupRuleSettings,
    detailData,
    now,
  });

  const { data, error } = await db().rpc("submit_registration_team_snapshot", {
    p_event_id: payload.eventId,
    p_registration_id: payload.registrationId,
    p_registration_name: payload.registrationName,
    p_snapshot: payload.snapshot,
    p_members: payload.members,
  });

  if (error) fail(error, "파티 제출을 저장하지 못했습니다.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.submission_id || !row?.snapshot_id || !row?.revision) {
    throw new Error("파티 제출 저장 결과를 확인하지 못했습니다.");
  }
  return {
    ...row,
    submittedAt: row.submitted_at || payload.submittedAt,
    late: payload.late,
    warning: payload.warning,
  };
}

export async function saveApplicationEvent({
  eventId = null,
  announcementId = null,
  eventDraft = {},
}) {
  const name = String(eventDraft.name || "").trim();
  if (!name) throw new Error("대회 이름을 입력해 주세요.");

  const now = new Date().toISOString();

  let seasonId;
  let existingEvent = null;
  if (eventId) {
    existingEvent = await getEvent(eventId);
    if (!existingEvent) throw new Error("수정할 대회를 찾을 수 없습니다.");
    seasonId = existingEvent.season_id || (await getCurrentSeason()).id;
  } else {
    seasonId = (await getCurrentSeason()).id;
  }

  const registrationSettings = {
    ...(existingEvent?.registration_settings || {}),
    ...(eventDraft.registrationSettings || {}),
    ...(announcementId ? { announcementId } : {}),
  };

  const requestedCompetitionSettings = eventDraft.competitionSettings || existingEvent?.competition_settings || {};
  const competitionSettings = {
    ...requestedCompetitionSettings,
    rankingEnabled: typeof requestedCompetitionSettings.rankingEnabled === "boolean"
      ? requestedCompetitionSettings.rankingEnabled
      : Boolean(eventDraft.isTeamEvent) || eventDraft.division !== "rookie",
  };

  const payload = {
    season_id: seasonId,
    name,
    round_number: eventDraft.roundNumber || null,
    event_type: eventDraft.eventType || "pokecup",
    division: eventDraft.division || null,
    battle_format: eventDraft.battleFormat || null,
    competition_format: eventDraft.competitionFormat || null,
    competition_settings: competitionSettings,
    is_team_event: Boolean(eventDraft.isTeamEvent),
    regulation_id: eventDraft.regulationId || null,
    cup_rule_id: eventDraft.cupRuleId || null,
    cup_rule_settings: eventDraft.cupRuleSettings || {},
    registration_settings: registrationSettings,
    held_on: eventDraft.heldOn || null,
    date_precision: eventDraft.heldOn ? "exact" : "unknown",
    status: eventDraft.status || existingEvent?.status || "open",
    submission_target_at: eventDraft.submissionTargetAt ? new Date(eventDraft.submissionTargetAt).toISOString() : null,
    updated_at: now,
  };

  if (eventId) {
    const { data, error } = await db()
      .from("events")
      .update(payload)
      .eq("id", eventId)
      .select()
      .single();

    if (error) fail(error, "대회 정보를 수정하지 못했습니다.");
    return data;
  }

  const { data, error } = await db()
    .from("events")
    .insert(payload)
    .select()
    .single();

  if (error) fail(error, "대회를 생성하지 못했습니다.");
  return data;
}

export async function getCurrentSeason() {
  const { data, error } = await db()
    .from("seasons")
    .select("id, code, name, series, number, starts_on, ends_on, sort_order, status")
    .eq("status", "current")
    .order("sort_order", { ascending: true });

  if (error) fail(error, "현재 시즌을 확인하지 못했습니다.");

  if ((data || []).length !== 1) {
    const count = (data || []).length;
    throw new Error(`현재 시즌은 정확히 1개여야 하지만 ${count}개입니다. 시즌 설정을 먼저 확인해 주세요.`);
  }

  return data[0];
}

export async function getEventRecordContext(eventId) {
  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (!event.season_id) throw new Error("연결된 대회에 시즌이 지정되지 않았습니다.");

  const { data: season, error } = await db()
    .from("seasons")
    .select("id, code, name, series, number, starts_on, ends_on, sort_order, status")
    .eq("id", event.season_id)
    .maybeSingle();

  if (error) fail(error, "연결된 대회의 시즌을 확인하지 못했습니다.");
  if (!season) throw new Error("연결된 대회의 시즌 정보를 찾을 수 없습니다.");

  return { event, season };
}

export async function listEventApplications(eventId) {
  if (!eventId) return [];

  const { data, error } = await db()
    .from("event_registrations")
    .select(`
      id,
      registration_name,
      registration_data,
      registration_source,
      registered_at,
      created_at
    `)
    .eq("event_id", eventId)
    .eq("registration_source", "application")
    .order("registered_at", { ascending: true });

  if (error) fail(error, "신청 기록을 불러오지 못했습니다.");

  return (data || []).map(row => ({
    id: row.id,
    createdAt: row.registered_at || row.created_at,
    registrationName: row.registration_name,
    answers: row.registration_data?.answers || {},
  }));
}

export async function listEventRegistrations(eventId) {
  if (!eventId) return [];

  const { data, error } = await db()
    .from("event_registrations")
    .select(`
      id,
      event_id,
      player_id,
      registration_name,
      registration_data,
      registration_source,
      registered_at
    `)
    .eq("event_id", eventId)
    .in("registration_source", ["application", "advancement", "manual"])
    .order("registered_at", { ascending: true });

  if (error) fail(error, "대회 참가자 목록을 불러오지 못했습니다.");

  return data || [];
}

export async function listEventRegistrationSubmissionStatuses(eventId) {
  if (!eventId) return [];

  const { data: registrations, error: registrationError } = await db()
    .from("event_registrations")
    .select("id, registration_name, registration_source")
    .eq("event_id", eventId)
    .in("registration_source", ["application", "advancement", "manual"])
    .order("registered_at", { ascending: true });

  if (registrationError) fail(registrationError, "대회 참가자 제출 상태를 불러오지 못했습니다.");

  const registrationRows = registrations || [];
  if (!registrationRows.length) return [];
  const registrationIds = registrationRows.map(registration => registration.id).filter(Boolean);
  const { data: submissions, error: submissionError } = await db()
    .from("registration_submissions")
    .select("registration_id, revision, submitted_at")
    .in("registration_id", registrationIds)
    .order("revision", { ascending: false });

  if (submissionError) fail(submissionError, "대회 참가자 제출 상태를 불러오지 못했습니다.");
  return buildSubmissionStatusRows(registrationRows, submissions || []);
}

export async function cancelApplicationEvent(eventId) {
  if (!eventId) return null;

  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("events")
    .update({
      status: "cancelled",
      updated_at: now,
    })
    .eq("id", eventId)
    .is("record_applied_at", null)
    .select("id, status")
    .maybeSingle();

  if (error) fail(error, "연결된 대회를 정리하지 못했습니다.");
  return data;
}

export async function freezeEventFinalSubmissions(eventId) {
  if (!eventId) return { snapshot: [] };

  const { data, error } = await db().rpc("freeze_event_final_submissions", {
    p_event_id: eventId,
  });
  if (error) fail(error, "참가자의 final submission을 고정하지 못했습니다.");
  return { snapshot: normalizeFinalSubmissionFreezeSnapshot(data || []) };
}

export async function restoreEventFinalSubmissions(eventId, snapshot = []) {
  if (!eventId) return null;
  const normalizedSnapshot = normalizeFinalSubmissionFreezeSnapshot(snapshot);
  const { error } = await db().rpc("restore_event_final_submissions", {
    p_event_id: eventId,
    p_snapshot: normalizedSnapshot.map((row) => ({
      registration_id: row.registrationId,
      previous_final_submission_id: row.previousFinalSubmissionId,
      final_submission_id: row.finalSubmissionId,
    })),
  });
  if (error) fail(error, "final submission을 이전 상태로 복구하지 못했습니다.");
  return null;
}

export async function releaseEventFinalSubmissions(eventId) {
  if (!eventId) return null;
  const { data, error } = await db().rpc("release_event_final_submissions", {
    p_event_id: eventId,
  });
  if (error) fail(error, "final submission과 Event 기록 상태를 원복하지 못했습니다.");
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function completeApplicationEvent(eventId, { revealFinalTeams = false } = {}) {
  if (!eventId) return null;

  const now = new Date().toISOString();
  const completion = {
    status: "completed",
    record_applied_at: now,
    updated_at: now,
  };
  if (revealFinalTeams) completion.team_revealed_at = now;

  let query = db()
    .from("events")
    .update(completion)
    .eq("id", eventId)
    .is("record_applied_at", null);
  if (revealFinalTeams) query = query.eq("team_reveal_mode", "on_record_apply");
  const { data, error } = await query
    .select("id, status, record_applied_at, team_revealed_at")
    .maybeSingle();

  if (error) fail(error, "대회 기록 반영 상태를 저장하지 못했습니다.");
  if (!data) throw new Error(revealFinalTeams
    ? "대회가 이미 완료되었거나 on_record_apply 공개 상태를 확인할 수 없습니다."
    : "대회가 이미 완료되었거나 기록 반영 상태를 변경할 수 없습니다.");
  return data;
}

function newDatabaseId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("이 브라우저에서는 안전한 UUID 생성을 지원하지 않습니다.");
  }
  return globalThis.crypto.randomUUID();
}

async function createRecordPlayer(displayName, playerId = newDatabaseId()) {
  const name = String(displayName || "").trim();
  const { data: created, error: createError } = await db()
    .from("players")
    .insert({
      id: playerId,
      display_name: name,
      status: "active",
    })
    .select("id, display_name")
    .single();

  if (createError) fail(createError, `${name}의 신규 Player를 생성하지 못했습니다.`);
  return created;
}

function actualIndividualParticipants(participants = [], emptyMessage) {
  const actual = (participants || [])
    .filter(participant => !Array.isArray(participant?.members))
    .map(participant => ({
      ...participant,
      name: String(participant?.name || "").trim(),
    }))
    .filter(participant => participant.name);

  if (!actual.length) throw new Error(emptyMessage);

  const participantIds = new Set();
  for (const participant of actual) {
    if (!participant.id) throw new Error(`'${participant.name}' 참가자의 대진표 ID가 없습니다.`);
    if (participantIds.has(participant.id)) {
      throw new Error(`'${participant.name}' 참가자가 대진표에 중복되어 있습니다.`);
    }
    participantIds.add(participant.id);
  }

  return actual;
}

function actualTeamParticipants(participants = [], emptyMessage) {
  const actual = (participants || [])
    .filter(participant => Array.isArray(participant?.members))
    .map(participant => ({
      ...participant,
      name: String(participant?.name || "").trim(),
    }))
    .filter(participant => participant.name);

  if (!actual.length) throw new Error(emptyMessage);

  const participantIds = new Set();
  for (const participant of actual) {
    if (!participant.id) throw new Error(`'${participant.name}' 팀의 대진표 ID가 없습니다.`);
    if (participantIds.has(participant.id)) {
      throw new Error(`'${participant.name}' 팀이 대진표에 중복되어 있습니다.`);
    }
    participantIds.add(participant.id);
  }

  return actual;
}

async function preflightEventParticipantIdentities(
  eventId,
  participants,
  { requireEmptyEntries = false, requireTeamEvent = false } = {}
) {
  const actualParticipants = actualIndividualParticipants(
    participants,
    "확정할 실제 참가자가 없습니다."
  );

  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (requireTeamEvent && !event.is_team_event) {
    throw new Error("개인전 Event에는 팀 참가자를 확정할 수 없습니다.");
  }
  if (!requireTeamEvent && event.is_team_event) {
    throw new Error("팀전 Event에는 개인 참가자를 확정할 수 없습니다.");
  }
  if (!["open", "running"].includes(event.status) || event.record_applied_at) {
    throw new Error("현재 참가자를 확정할 수 없는 대회입니다.");
  }

  const { data: registrations, error: registrationError } = await db()
    .from("event_registrations")
    .select("id, event_id, player_id, registration_name, registration_source")
    .eq("event_id", eventId);

  if (registrationError) fail(registrationError, "대회 참가 신청 정보를 확인하지 못했습니다.");

  if (requireEmptyEntries) {
    const { data: existingEntries, error: entryError } = await db()
      .from("entries")
      .select("id")
      .eq("event_id", eventId)
      .limit(1);

    if (entryError) fail(entryError, "기존 참가 확정 정보를 확인하지 못했습니다.");
    if (existingEntries?.length) {
      throw new Error("이 Event에는 이미 확정된 Entry가 있습니다. Event당 대진표는 하나만 생성할 수 있습니다.");
    }
  }

  const registrationRows = registrations || [];
  const registrationById = new Map(registrationRows.map(row => [row.id, row]));
  const claimedRegistrationIds = new Set();
  const plans = actualParticipants.map(participant => {
    let registration = null;

    if (participant.registrationId) {
      registration = registrationById.get(participant.registrationId) || null;
      if (!registration) {
        throw new Error(`${participant.name}의 참가 신청이 이 Event에 속하지 않거나 존재하지 않습니다.`);
      }
    } else {
      const matches = registrationRows.filter(row => row.registration_name === participant.name);
      if (matches.length > 1) {
        throw new Error(`'${participant.name}' 이름의 참가 신청이 중복되어 있습니다. 참가 확정 전에 확인이 필요합니다.`);
      }
      registration = matches[0] || null;
    }

    if (registration && claimedRegistrationIds.has(registration.id)) {
      throw new Error(`'${participant.name}' 참가 신청이 대진표에 중복되어 있습니다.`);
    }
    if (registration) claimedRegistrationIds.add(registration.id);

    return {
      participant,
      registration,
      identityName: String(registration?.registration_name || participant.name).trim(),
      playerId: registration?.player_id || null,
    };
  });

  const namesToResolve = [...new Set(plans.filter(plan => !plan.playerId).map(plan => plan.identityName))];
  let players = [];
  if (namesToResolve.length) {
    const { data, error } = await db()
      .from("players")
      .select("id, display_name")
      .in("display_name", namesToResolve);

    if (error) fail(error, "참가자 Player 정보를 확인하지 못했습니다.");
    players = data || [];
  }

  for (const plan of plans) {
    if (plan.playerId) continue;
    const matches = players.filter(player => player.display_name === plan.identityName);
    if (matches.length > 1) {
      throw new Error(`'${plan.identityName}' 이름의 Player가 2명 이상 존재합니다. 관리자가 직접 확인해야 합니다.`);
    }
    plan.playerId = matches[0]?.id || null;
  }

  const claimedIdentity = new Map();
  for (const plan of plans) {
    const key = plan.playerId ? `player:${plan.playerId}` : `new:${plan.identityName}`;
    if (claimedIdentity.has(key)) {
      throw new Error(`'${plan.identityName}' 참가자가 대진표에 중복되어 있습니다. identity를 자동 확정할 수 없습니다.`);
    }
    claimedIdentity.set(key, plan);

    if (plan.playerId) {
      const conflictingRegistration = registrationRows.find(row =>
        row.player_id === plan.playerId && row.id !== plan.registration?.id
      );
      if (conflictingRegistration) {
        throw new Error(`'${plan.identityName}' Player가 이 Event의 다른 Registration에 이미 연결되어 있습니다.`);
      }
    }
  }

  return { event, actualParticipants, plans };
}

function rollbackFailure(originalError, rollbackErrors) {
  const rollbackSummary = rollbackErrors.map(error => error.message).join(" / ");
  const combined = new Error(
    `${originalError?.message || "참가자 확정에 실패했습니다."} (자동 원복 실패: ${rollbackSummary})`
  );
  combined.code = "YPL_PARTICIPANT_CONFIRMATION_ROLLBACK_FAILED";
  combined.cause = originalError;
  combined.rollbackErrors = rollbackErrors;
  return combined;
}

export async function rollbackEventParticipantConfirmation(
  eventId,
  identityChanges = [],
  { requireUnappliedEvent = false, requireExactRows = false } = {}
) {
  if (!eventId) return null;

  if (requireUnappliedEvent) {
    const event = await getEvent(eventId);
    if (!event) throw new Error("참가 확정을 원복할 Event를 찾을 수 없습니다.");
    if (event.record_applied_at || event.status === "completed") {
      throw new Error("기록이 반영된 Event의 참가 확정은 Bracket 삭제로 원복할 수 없습니다.");
    }
  }

  const changes = Array.isArray(identityChanges) ? [...identityChanges].reverse() : [];
  const rollbackErrors = [];
  const remember = (error, fallback) => {
    if (!error) return;
    const next = new Error(error.message || fallback);
    next.code = error.code || "YPL_DB_ERROR";
    rollbackErrors.push(next);
  };

  for (const change of changes) {
    if (!change?.entryParticipantId) continue;
    const { data, error } = await db()
      .from("entry_participants")
      .delete()
      .eq("id", change.entryParticipantId)
      .eq("event_id", eventId)
      .select("id");
    remember(error, `${change.name || "참가자"}의 EntryParticipant를 정리하지 못했습니다.`);
    if (requireExactRows && !error && (data || []).length !== 1) {
      remember(new Error(`${change.name || "참가자"}의 EntryParticipant가 예상한 ownership과 일치하지 않습니다.`), "EntryParticipant ownership 확인에 실패했습니다.");
    }
  }

  for (const change of changes) {
    if (!change?.entryWasCreated || !change.entryId) continue;
    const { data, error } = await db()
      .from("entries")
      .delete()
      .eq("id", change.entryId)
      .eq("event_id", eventId)
      .select("id");
    remember(error, `${change.name || "참가자"}의 Entry를 정리하지 못했습니다.`);
    if (requireExactRows && !error && (data || []).length !== 1) {
      remember(new Error(`${change.name || "참가자"}의 Entry가 예상한 ownership과 일치하지 않습니다.`), "Entry ownership 확인에 실패했습니다.");
    }
  }

  for (const change of changes) {
    if (!change?.registrationId) continue;

    if (change.registrationWasCreated) {
      const { data, error } = await db()
        .from("event_registrations")
        .delete()
        .eq("id", change.registrationId)
        .eq("event_id", eventId)
        .select("id");
      remember(error, `${change.name || "참가자"}의 신규 참가 등록을 정리하지 못했습니다.`);
      if (requireExactRows && !error && (data || []).length !== 1) {
        remember(new Error(`${change.name || "참가자"}의 신규 Registration이 예상한 ownership과 일치하지 않습니다.`), "Registration ownership 확인에 실패했습니다.");
      }
      continue;
    }

    if (change.registrationPlayerWasLinked && change.playerId) {
      const { error } = await db()
        .from("event_registrations")
        .update({
          player_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", change.registrationId)
        .eq("event_id", eventId)
        .eq("player_id", change.playerId);
      remember(error, `${change.name || "참가자"}의 Player 연결을 정리하지 못했습니다.`);
    }
  }

  const createdPlayerIds = [...new Set(
    changes
      .filter(change => change?.playerWasCreated && change?.playerId)
      .map(change => change.playerId)
  )];

  for (const playerId of createdPlayerIds) {
    const { error } = await db()
      .from("players")
      .delete()
      .eq("id", playerId);

    if (error && String(error.code || "") !== "23503") {
      remember(error, "참가 확정 과정에서 생성된 Player를 정리하지 못했습니다.");
    }
  }

  if (rollbackErrors.length) {
    const error = new Error(rollbackErrors.map(row => row.message).join(" / "));
    error.code = "YPL_PARTICIPANT_CONFIRMATION_ROLLBACK_FAILED";
    error.rollbackErrors = rollbackErrors;
    throw error;
  }

  return null;
}

export async function restoreEventParticipantConfirmation(eventId, snapshot) {
  if (!eventId || !snapshot) return null;

  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  if (players.length) {
    const playerIds = players.map(row => row.id).filter(Boolean);
    const { data: existingPlayers, error: existingError } = await db()
      .from("players")
      .select("id")
      .in("id", playerIds);
    if (existingError) fail(existingError, "참가 확정 보상 과정에서 기존 Player를 확인하지 못했습니다.");
    const existingPlayerIds = new Set((existingPlayers || []).map(row => row.id));
    const missingPlayers = players.filter(row => !existingPlayerIds.has(row.id));
    const { error } = missingPlayers.length
      ? await db().from("players").insert(missingPlayers)
      : { error: null };
    if (error) fail(error, "참가 확정 보상 과정에서 Player를 복구하지 못했습니다.");
  }

  const registrations = Array.isArray(snapshot.registrations) ? snapshot.registrations : [];
  const registrationIds = registrations.map(row => row.id).filter(Boolean);
  if (registrationIds.length) {
    const { data: existingRegistrations, error: existingError } = await db()
      .from("event_registrations")
      .select("id, event_id, player_id")
      .in("id", registrationIds);
    if (existingError) fail(existingError, "참가 확정 보상 과정에서 기존 Registration을 확인하지 못했습니다.");
    const existingById = new Map((existingRegistrations || []).map(row => [row.id, row]));
    if ([...existingById.values()].some(row => row.event_id !== eventId)) {
      throw new Error("참가 확정 보상 대상 Registration의 Event ownership이 일치하지 않습니다.");
    }
    const missingRegistrations = registrations
      .filter(row => !existingById.has(row.id))
      .map(row => ({
        id: row.id,
        event_id: row.event_id,
        player_id: row.player_id,
        registration_name: row.registration_name,
        registration_data: row.registration_data || {},
        registration_source: row.registration_source,
        registered_at: row.registered_at,
        final_submission_id: row.final_submission_id || null,
        updated_at: row.updated_at,
      }));
    if (missingRegistrations.length) {
      const { error } = await db().from("event_registrations").insert(missingRegistrations);
      if (error) fail(error, "참가 확정 보상 과정에서 Registration을 복구하지 못했습니다.");
    }
  }

  const registrationById = new Map(registrations.map(row => [row.id, row]));
  for (const change of (snapshot.identityChanges || []).filter(row => row.registrationId)) {
    const registration = registrationById.get(change.registrationId);
    if (!registration) throw new Error(`${change.name || "참가자"}의 Registration snapshot이 없습니다.`);
    const { data, error } = await db()
      .from("event_registrations")
      .update({ player_id: registration.player_id, updated_at: new Date().toISOString() })
      .eq("id", registration.id)
      .eq("event_id", eventId)
      .select("id")
      .maybeSingle();
    if (error) fail(error, `${change.name || "참가자"}의 Registration 연결을 복구하지 못했습니다.`);
    if (!data) throw new Error(`${change.name || "참가자"}의 Registration 연결 복구 대상이 없습니다.`);
  }

  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  if (entries.length) {
    const entryIds = entries.map(row => row.id).filter(Boolean);
    const { data: existingEntries, error: existingError } = await db()
      .from("entries")
      .select("id, event_id, entry_type, display_name, status")
      .in("id", entryIds);
    if (existingError) fail(existingError, "참가 확정 보상 과정에서 기존 Entry를 확인하지 못했습니다.");
    if ((existingEntries || []).some(row => row.event_id !== eventId)) {
      throw new Error("참가 확정 보상 대상 Entry의 Event ownership이 일치하지 않습니다.");
    }
    const existingEntryIds = new Set((existingEntries || []).map(row => row.id));
    const missingEntries = entries.filter(row => !existingEntryIds.has(row.id));
    if (missingEntries.length) {
      const { error } = await db().from("entries").insert(missingEntries);
      if (error) fail(error, "참가 확정 보상 과정에서 Entry를 복구하지 못했습니다.");
    }
  }

  const entryParticipants = Array.isArray(snapshot.entryParticipants) ? snapshot.entryParticipants : [];
  if (entryParticipants.length) {
    const entryParticipantIds = entryParticipants.map(row => row.id).filter(Boolean);
    const { data: existingEntryParticipants, error: existingError } = await db()
      .from("entry_participants")
      .select("id, event_id, entry_id, registration_id, player_id, member_order, role")
      .in("id", entryParticipantIds);
    if (existingError) fail(existingError, "참가 확정 보상 과정에서 기존 EntryParticipant를 확인하지 못했습니다.");
    if ((existingEntryParticipants || []).some(row => row.event_id !== eventId)) {
      throw new Error("참가 확정 보상 대상 EntryParticipant의 Event ownership이 일치하지 않습니다.");
    }
    const existingEntryParticipantIds = new Set((existingEntryParticipants || []).map(row => row.id));
    const missingEntryParticipants = entryParticipants.filter(row => !existingEntryParticipantIds.has(row.id));
    if (missingEntryParticipants.length) {
      const { error } = await db().from("entry_participants").insert(missingEntryParticipants);
      if (error) fail(error, "참가 확정 보상 과정에서 EntryParticipant를 복구하지 못했습니다.");
    }
  }
  return null;
}

async function writeEventParticipantIdentities(eventId, plans, { createEntries = false } = {}) {
  const resolved = [];

  try {
    for (const plan of plans) {
      const { participant, registration, identityName } = plan;
      const playerWasCreated = !plan.playerId;
      const playerId = plan.playerId || newDatabaseId();
      const resolvedParticipant = {
        ...participant,
        registrationId: registration?.id || null,
        playerId,
        playerWasCreated,
        registrationWasCreated: false,
        registrationPlayerWasLinked: false,
        entryId: null,
        entryWasCreated: false,
        entryParticipantId: null,
      };
      // 생성 ID를 client에서 먼저 정해 응답이 유실되어도 rollback 대상을 안다.
      resolved.push(resolvedParticipant);

      if (playerWasCreated) await createRecordPlayer(identityName, playerId);

      if (registration?.player_id) {
        Object.assign(resolvedParticipant, {
          playerId: registration.player_id,
          playerWasCreated: false,
        });
      } else if (registration) {
        resolvedParticipant.registrationPlayerWasLinked = true;
        const { data: updated, error } = await db()
          .from("event_registrations")
          .update({
            player_id: playerId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", registration.id)
          .eq("event_id", eventId)
          .is("player_id", null)
          .select("id, player_id")
          .single();

        if (error) fail(error, `${identityName}의 Player 연결을 저장하지 못했습니다.`);
        Object.assign(resolvedParticipant, {
          registrationId: updated.id,
          playerId: updated.player_id,
        });
      } else {
        const now = new Date().toISOString();
        const registrationId = newDatabaseId();
        Object.assign(resolvedParticipant, {
          registrationId,
          registrationWasCreated: true,
        });
        const { data: createdRegistration, error } = await db()
          .from("event_registrations")
          .insert({
            id: registrationId,
            event_id: eventId,
            player_id: playerId,
            registration_name: identityName,
            registration_data: {},
            registration_source: "manual",
            registered_at: now,
            updated_at: now,
          })
          .select("id, player_id")
          .single();

        if (error) fail(error, `${identityName}의 참가자 등록을 생성하지 못했습니다.`);
        Object.assign(resolvedParticipant, {
          registrationId: createdRegistration.id,
          playerId: createdRegistration.player_id,
        });
      }

      if (createEntries) {
        const entryId = newDatabaseId();
        Object.assign(resolvedParticipant, { entryId, entryWasCreated: true });
        const { data: entry, error: entryError } = await db()
          .from("entries")
          .insert({
            id: entryId,
            event_id: eventId,
            entry_type: "individual",
            display_name: identityName,
            status: "active",
          })
          .select("id")
          .single();

        if (entryError) fail(entryError, `${identityName}의 Entry를 생성하지 못했습니다.`);
        resolvedParticipant.entryId = entry.id;

        const entryParticipantId = newDatabaseId();
        resolvedParticipant.entryParticipantId = entryParticipantId;
        const { data: entryParticipant, error: participantError } = await db()
          .from("entry_participants")
          .insert({
            id: entryParticipantId,
            event_id: eventId,
            entry_id: entry.id,
            registration_id: resolvedParticipant.registrationId,
            player_id: resolvedParticipant.playerId,
            member_order: 1,
          })
          .select("id")
          .single();

        if (participantError) fail(participantError, `${identityName}의 EntryParticipant를 생성하지 못했습니다.`);
        resolvedParticipant.entryParticipantId = entryParticipant.id;
      }
    }
  } catch (error) {
    try {
      await rollbackEventParticipantConfirmation(eventId, resolved);
    } catch (rollbackError) {
      throw rollbackFailure(error, rollbackError.rollbackErrors || [rollbackError]);
    }
    throw error;
  }

  return resolved;
}

export async function confirmEventParticipantsForBracket(eventId, participants = []) {
  if (!eventId) throw new Error("연결된 Event가 없습니다.");

  const { event, actualParticipants, plans } = await preflightEventParticipantIdentities(
    eventId,
    participants,
    { requireEmptyEntries: true }
  );
  const resolved = await writeEventParticipantIdentities(eventId, plans, { createEntries: true });

  if (
    resolved.length !== actualParticipants.length ||
    resolved.some(row => !row.playerId || !row.registrationId || !row.entryId || !row.entryParticipantId)
  ) {
    const error = new Error("모든 실제 참가자의 Player/Registration/Entry identity를 확정하지 못했습니다.");
    try {
      await rollbackEventParticipantConfirmation(eventId, resolved);
    } catch (rollbackError) {
      throw rollbackFailure(error, rollbackError.rollbackErrors || [rollbackError]);
    }
    throw error;
  }

  return {
    eventId,
    previousEventStatus: event.status,
    confirmedAt: new Date().toISOString(),
    participants: resolved,
    identityChanges: resolved.map(row => ({
      participantId: row.id,
      name: row.name,
      registrationId: row.registrationId,
      playerId: row.playerId,
      entryId: row.entryId,
      entryParticipantId: row.entryParticipantId,
      playerWasCreated: !!row.playerWasCreated,
      registrationWasCreated: !!row.registrationWasCreated,
      registrationPlayerWasLinked: !!row.registrationPlayerWasLinked,
      entryWasCreated: !!row.entryWasCreated,
    })),
  };
}

export async function confirmEventTeamsForBracket(eventId, participants = []) {
  if (!eventId) throw new Error("연결된 Event가 없습니다.");

  const { teams, members } = buildTeamMemberCandidates(participants);
  const { event, actualParticipants, plans } = await preflightEventParticipantIdentities(
    eventId,
    members,
    { requireEmptyEntries: true, requireTeamEvent: true }
  );
  const resolved = await writeEventParticipantIdentities(eventId, plans);

  try {
    for (const team of teams) {
      const teamMembers = resolved
        .filter(member => member.teamParticipantId === team.id)
        .sort((a, b) => a.memberOrder - b.memberOrder);
      const entryId = newDatabaseId();

      teamMembers.forEach((member, index) => {
        member.entryId = entryId;
        member.entryWasCreated = index === 0;
      });

      const { data: entry, error: entryError } = await db()
        .from("entries")
        .insert({
          id: entryId,
          event_id: eventId,
          entry_type: "team",
          display_name: team.name,
          status: "active",
        })
        .select("id")
        .single();

      if (entryError) fail(entryError, `'${team.name}' 팀 Entry를 생성하지 못했습니다.`);

      for (const member of teamMembers) {
        const entryParticipantId = newDatabaseId();
        member.entryId = entry.id;
        member.entryParticipantId = entryParticipantId;

        const { data: entryParticipant, error: participantError } = await db()
          .from("entry_participants")
          .insert({
            id: entryParticipantId,
            event_id: eventId,
            entry_id: entry.id,
            registration_id: member.registrationId,
            player_id: member.playerId,
            member_order: member.memberOrder,
            role: member.memberOrder === 1 ? "captain" : null,
          })
          .select("id")
          .single();

        if (participantError) {
          fail(participantError, `'${team.name}' 팀의 ${member.name} EntryParticipant를 생성하지 못했습니다.`);
        }
        member.entryParticipantId = entryParticipant.id;
      }
    }

    if (
      resolved.length !== actualParticipants.length ||
      resolved.some(row => !row.playerId || !row.registrationId || !row.entryId || !row.entryParticipantId)
    ) {
      throw new Error("모든 팀 참가자의 Player/Registration/Entry identity를 확정하지 못했습니다.");
    }

    const confirmedTeams = attachConfirmedTeamIdentities(teams, resolved);

    return {
      eventId,
      previousEventStatus: event.status,
      confirmedAt: new Date().toISOString(),
      participants: confirmedTeams,
      identityChanges: resolved.map(row => ({
        participantId: row.id,
        teamParticipantId: row.teamParticipantId,
        name: row.name,
        memberOrder: row.memberOrder,
        registrationId: row.registrationId,
        playerId: row.playerId,
        entryId: row.entryId,
        entryParticipantId: row.entryParticipantId,
        playerWasCreated: !!row.playerWasCreated,
        registrationWasCreated: !!row.registrationWasCreated,
        registrationPlayerWasLinked: !!row.registrationPlayerWasLinked,
        entryWasCreated: !!row.entryWasCreated,
      })),
    };
  } catch (error) {
    try {
      await rollbackEventParticipantConfirmation(eventId, resolved);
    } catch (rollbackError) {
      throw rollbackFailure(error, rollbackError.rollbackErrors || [rollbackError]);
    }
    throw error;
  }
}

export async function validateEventParticipantEntries(eventId, participants = []) {
  if (!eventId) throw new Error("연결된 Event가 없습니다.");

  const actualParticipants = actualIndividualParticipants(
    participants,
    "기록에 반영할 실제 참가자가 없습니다."
  );
  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (event.is_team_event) throw new Error("팀전 Event의 Entry identity 검증은 아직 지원하지 않습니다.");
  if (!["open", "running"].includes(event.status) || event.record_applied_at) {
    throw new Error("현재 기록을 반영할 수 없는 대회입니다.");
  }

  if (actualParticipants.some(row => !row.registrationId || !row.playerId || !row.entryId)) {
    throw new Error("일부 참가자에게 Entry identity가 없습니다. 전환 이전 대진표는 기존 identity 확정 경로를 사용해야 합니다.");
  }

  for (const [label, values] of [
    ["Registration", actualParticipants.map(row => row.registrationId)],
    ["Player", actualParticipants.map(row => row.playerId)],
    ["Entry", actualParticipants.map(row => row.entryId)],
  ]) {
    if (new Set(values).size !== values.length) {
      throw new Error(`동일한 ${label} identity가 대진표 참가자 두 명 이상에게 연결되어 있습니다.`);
    }
  }

  const registrationIds = actualParticipants.map(row => row.registrationId);
  const entryIds = actualParticipants.map(row => row.entryId);
  const [{ data: registrations, error: registrationError }, { data: entries, error: entryError }, { data: entryParticipants, error: participantError }] = await Promise.all([
    db()
      .from("event_registrations")
      .select("id, event_id, player_id, registration_name")
      .eq("event_id", eventId)
      .in("id", registrationIds),
    db()
      .from("entries")
      .select("id, event_id, entry_type, status")
      .eq("event_id", eventId)
      .in("id", entryIds),
    db()
      .from("entry_participants")
      .select("id, event_id, entry_id, registration_id, player_id, member_order")
      .eq("event_id", eventId)
      .in("entry_id", entryIds),
  ]);

  if (registrationError) fail(registrationError, "참가자의 Registration identity를 확인하지 못했습니다.");
  if (entryError) fail(entryError, "참가자의 Entry identity를 확인하지 못했습니다.");
  if (participantError) fail(participantError, "참가자의 EntryParticipant identity를 확인하지 못했습니다.");

  const registrationById = new Map((registrations || []).map(row => [row.id, row]));
  const entryById = new Map((entries || []).map(row => [row.id, row]));
  const participantByEntryId = new Map((entryParticipants || []).map(row => [row.entry_id, row]));

  return actualParticipants.map(participant => {
    const registration = registrationById.get(participant.registrationId);
    const entry = entryById.get(participant.entryId);
    const entryParticipant = participantByEntryId.get(participant.entryId);

    if (!registration || registration.player_id !== participant.playerId) {
      throw new Error(`'${participant.name}' 참가자의 Registration/Player 연결이 현재 DB와 일치하지 않습니다.`);
    }
    if (!entry || entry.entry_type !== "individual" || entry.status !== "active") {
      throw new Error(`'${participant.name}' 참가자의 활성 개인 Entry를 찾을 수 없습니다.`);
    }
    if (
      !entryParticipant ||
      entryParticipant.registration_id !== participant.registrationId ||
      entryParticipant.player_id !== participant.playerId ||
      entryParticipant.member_order !== 1
    ) {
      throw new Error(`'${participant.name}' 참가자의 EntryParticipant 연결이 현재 DB와 일치하지 않습니다.`);
    }

    return { ...participant, entryParticipantId: entryParticipant.id };
  });
}

export async function validateEventTeamEntries(eventId, teams = []) {
  if (!eventId) throw new Error("연결된 Event가 없습니다.");

  const actualTeams = actualTeamParticipants(
    teams,
    "기록에 반영할 실제 참가 팀이 없습니다."
  );
  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (!event.is_team_event) throw new Error("개인전 Event에는 팀 Entry를 검증할 수 없습니다.");
  if (![
    "open",
    "running",
  ].includes(event.status) || event.record_applied_at) {
    throw new Error("현재 기록을 반영할 수 없는 대회입니다.");
  }

  const entryIds = actualTeams.map(team => team.entryId);
  if (entryIds.some(entryId => !entryId)) {
    throw new Error("일부 팀에 Entry identity가 없습니다. 참가 확정 이후 대진표를 다시 확인해 주세요.");
  }
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error("동일한 팀 Entry identity가 대진표 팀 두 개 이상에 연결되어 있습니다.");
  }

  const expectedMembersByEntryId = new Map();
  const expectedMembers = [];
  for (const team of actualTeams) {
    const members = getConfirmedTeamMemberIdentities(team);
    if (members.some(member => !member.registrationId || !member.playerId || !member.entryParticipantId)) {
      throw new Error(`'${team.name}' 팀의 Registration/Player/EntryParticipant identity가 완전하지 않습니다.`);
    }

    const playerIds = members.map(member => member.playerId);
    if (new Set(playerIds).size !== playerIds.length) {
      throw new Error(`'${team.name}' 팀의 Player identity가 중복되어 있습니다.`);
    }
    const entryParticipantIds = members.map(member => member.entryParticipantId);
    if (new Set(entryParticipantIds).size !== entryParticipantIds.length) {
      throw new Error(`'${team.name}' 팀의 EntryParticipant identity가 중복되어 있습니다.`);
    }

    expectedMembersByEntryId.set(team.entryId, members);
    expectedMembers.push(...members.map(member => ({ team, member })));
  }

  const registrationIds = expectedMembers.map(({ member }) => member.registrationId);
  const [{ data: registrations, error: registrationError }, { data: entries, error: entryError }, { data: entryParticipants, error: participantError }] = await Promise.all([
    db()
      .from("event_registrations")
      .select("id, event_id, player_id, registration_name")
      .eq("event_id", eventId)
      .in("id", registrationIds),
    db()
      .from("entries")
      .select("id, event_id, entry_type, status")
      .eq("event_id", eventId)
      .in("id", entryIds),
    db()
      .from("entry_participants")
      .select("id, event_id, entry_id, registration_id, player_id, member_order")
      .eq("event_id", eventId)
      .in("entry_id", entryIds),
  ]);

  if (registrationError) fail(registrationError, "팀 참가자의 Registration identity를 확인하지 못했습니다.");
  if (entryError) fail(entryError, "팀의 Entry identity를 확인하지 못했습니다.");
  if (participantError) fail(participantError, "팀의 EntryParticipant identity를 확인하지 못했습니다.");

  const registrationById = new Map((registrations || []).map(row => [row.id, row]));
  const entryById = new Map((entries || []).map(row => [row.id, row]));
  const participantsByEntryId = new Map();
  for (const row of entryParticipants || []) {
    const rows = participantsByEntryId.get(row.entry_id) || [];
    rows.push(row);
    participantsByEntryId.set(row.entry_id, rows);
  }

  return actualTeams.map(team => {
    const entry = entryById.get(team.entryId);
    if (!entry || entry.entry_type !== "team" || entry.status !== "active") {
      throw new Error(`'${team.name}' 팀의 활성 팀 Entry를 찾을 수 없습니다.`);
    }

    const members = expectedMembersByEntryId.get(team.entryId) || [];
    const dbMembers = participantsByEntryId.get(team.entryId) || [];
    if (dbMembers.length !== members.length) {
      throw new Error(`'${team.name}' 팀의 EntryParticipant 구성이 현재 DB와 일치하지 않습니다.`);
    }

    const verifiedMembers = members.map(member => {
      const registration = registrationById.get(member.registrationId);
      const entryParticipant = dbMembers.find(row => row.id === member.entryParticipantId);
      if (!registration || registration.player_id !== member.playerId) {
        throw new Error(`'${team.name}' 팀원 '${member.name}'의 Registration/Player 연결이 현재 DB와 일치하지 않습니다.`);
      }
      if (
        !entryParticipant ||
        entryParticipant.entry_id !== team.entryId ||
        entryParticipant.registration_id !== member.registrationId ||
        entryParticipant.player_id !== member.playerId ||
        entryParticipant.member_order !== member.memberOrder
      ) {
        throw new Error(`'${team.name}' 팀원 '${member.name}'의 EntryParticipant 연결이 현재 DB와 일치하지 않습니다.`);
      }

      return { ...member, entryParticipantId: entryParticipant.id };
    });

    return { ...team, memberIdentities: verifiedMembers };
  });
}

export async function markApplicationEventRunning(eventId, previousStatus = null) {
  if (!eventId) return null;

  const event = await getEvent(eventId);
  if (!event) throw new Error("진행 상태로 바꿀 Event를 찾을 수 없습니다.");
  if (event.record_applied_at || !["open", "running"].includes(event.status)) {
    throw new Error("현재 진행 상태로 바꿀 수 없는 Event입니다.");
  }
  if (previousStatus && event.status !== previousStatus) {
    throw new Error("Bracket 생성 중 Event 상태가 변경되었습니다. 다시 확인해 주세요.");
  }
  if (event.status === "running") return event;

  const { data, error } = await db()
    .from("events")
    .update({
      status: "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("status", event.status)
    .is("record_applied_at", null)
    .select("id, status, record_applied_at")
    .maybeSingle();

  if (error) fail(error, "Event 진행 상태를 저장하지 못했습니다.");
  if (!data) throw new Error("Bracket 생성 중 Event 상태가 변경되었습니다. 다시 확인해 주세요.");
  return data;
}

export async function restoreApplicationEventStatus(eventId, previousStatus) {
  if (!eventId) return null;
  if (!["open", "running"].includes(previousStatus)) {
    throw new Error("복구할 수 없는 Event 이전 상태입니다.");
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("상태를 복구할 Event를 찾을 수 없습니다.");
  if (event.record_applied_at) throw new Error("기록이 반영된 Event의 상태는 Bracket 삭제로 복구할 수 없습니다.");
  if (event.status === previousStatus) return event;
  if (event.status !== "running") {
    throw new Error("Bracket 생성 이후 Event 상태가 별도로 변경되어 자동 복구하지 않았습니다.");
  }

  const { data, error } = await db()
    .from("events")
    .update({
      status: previousStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId)
    .eq("status", "running")
    .is("record_applied_at", null)
    .select("id, status, record_applied_at")
    .maybeSingle();

  if (error) fail(error, "Bracket 삭제 후 Event 상태를 복구하지 못했습니다.");
  if (!data) throw new Error("Event 상태가 변경되어 Bracket 생성 전 상태로 복구하지 못했습니다.");
  return data;
}

export async function resolveEventParticipantsForRecord(eventId, participants = []) {
  if (!eventId) return [];
  const { actualParticipants, plans } = await preflightEventParticipantIdentities(eventId, participants);
  const resolved = await writeEventParticipantIdentities(eventId, plans);

  if (resolved.length !== actualParticipants.length || resolved.some(row => !row.playerId || !row.registrationId)) {
    const error = new Error("모든 실제 참가자의 Player/Registration identity를 확정하지 못했습니다.");
    try {
      await rollbackEventParticipantConfirmation(eventId, resolved);
    } catch (rollbackError) {
      throw rollbackFailure(error, rollbackError.rollbackErrors || [rollbackError]);
    }
    throw error;
  }

  return resolved;
}

export async function inspectEventParticipantIdentities(eventId, participants = []) {
  if (!eventId) return [];

  const actualParticipants = (participants || [])
    .filter(p => !Array.isArray(p.members))
    .map(p => ({
      ...p,
      name: String(p.name || "").trim(),
    }))
    .filter(p => p.name);

  if (!actualParticipants.length) return [];

  const { data: registrations, error: registrationError } = await db()
    .from("event_registrations")
    .select("id, event_id, player_id, registration_name, registration_source")
    .eq("event_id", eventId);

  if (registrationError) fail(registrationError, "대회 참가자 identity를 확인하지 못했습니다.");

  const registrationById = new Map((registrations || []).map(row => [row.id, row]));

  const rows = actualParticipants.map(participant => {
    let registration = null;
    let registrationAmbiguous = false;

    if (participant.registrationId) {
      registration = registrationById.get(participant.registrationId) || null;
    }

    if (!registration) {
      const matches = (registrations || []).filter(
        row => row.registration_name === participant.name
      );

      if (matches.length > 1) {
        registrationAmbiguous = true;
      } else if (matches.length === 1) {
        registration = matches[0];
      }
    }

    return {
      participant,
      registration,
      registrationAmbiguous,
      identityName: String(registration?.registration_name || participant.name).trim(),
    };
  });

  const namesToCheck = [...new Set(
    rows
      .filter(row => !row.registrationAmbiguous && !row.registration?.player_id)
      .map(row => row.identityName)
  )];

  let players = [];
  if (namesToCheck.length) {
    const { data, error } = await db()
      .from("players")
      .select("id, display_name")
      .in("display_name", namesToCheck);

    if (error) fail(error, "Player identity를 확인하지 못했습니다.");
    players = data || [];
  }

  return rows.map(row => {
    const { participant, registration, identityName, registrationAmbiguous } = row;

    if (registrationAmbiguous) {
      return {
        participantId: participant.id,
        name: participant.name,
        registrationId: null,
        playerId: null,
        status: "ambiguous",
        reason: "동일 이름의 참가 신청이 여러 건 존재",
        willCreateRegistration: false,
      };
    }

    if (registration?.player_id) {
      return {
        participantId: participant.id,
        name: participant.name,
        registrationId: registration.id,
        playerId: registration.player_id,
        status: "existing",
        willCreateRegistration: false,
      };
    }

    const matches = players.filter(player => player.display_name === identityName);

    if (matches.length > 1) {
      return {
        participantId: participant.id,
        name: participant.name,
        registrationId: registration?.id || null,
        playerId: null,
        status: "ambiguous",
        willCreateRegistration: !registration,
      };
    }

    if (matches.length === 1) {
      return {
        participantId: participant.id,
        name: participant.name,
        registrationId: registration?.id || null,
        playerId: matches[0].id,
        status: "existing",
        willCreateRegistration: !registration,
      };
    }

    return {
      participantId: participant.id,
      name: participant.name,
      registrationId: registration?.id || null,
      playerId: null,
      status: "new",
      willCreateRegistration: !registration,
    };
  });
}

export async function revertEventRecordApplication(eventId, identityChanges = [], { reopenEvent = true } = {}) {
  if (!eventId) return null;

  const changes = Array.isArray(identityChanges) ? identityChanges : [];
  await rollbackEventParticipantConfirmation(eventId, changes);

  if (!reopenEvent) return null;

  // 기록 반영 취소는 참가 확정을 취소하지 않는다. 전환 이전 bracket의
  // recordMeta에만 남은 identityChanges가 있을 때에만 위 rollback이 동작한다.
  // final submission 해제와 Event 상태 원복은 하나의 Event lock transaction으로 처리한다.
  return releaseEventFinalSubmissions(eventId);
}
