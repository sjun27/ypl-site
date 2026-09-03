import { supa as client } from "../storage.js";
import {
  LEGACY_BRACKET_RUNTIME_SOURCE,
  buildBracketMatchSyncPlan,
  buildEventBracketMatchSnapshot,
} from "./bracketMatchSnapshot.js";
import {
  bracketResultIdentityState,
  buildBracketResultSyncPlan,
  buildEventBracketResultSnapshot,
} from "./bracketResultSnapshot.js";

const DATA_SCHEMA = import.meta.env.VITE_YPL_DATA_SCHEMA || "public";

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

const eventMatchMutationQueues = new Map();
const eventResultMutationQueues = new Map();

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

function bracketMatchIdentityState(eventId, bracket) {
  if (!eventId) return { eligible: false, reason: "event_unlinked" };
  if (!bracket || (bracket.eventId && bracket.eventId !== eventId)) {
    throw new Error("normalized Match 대상 Event와 대진표 연결이 일치하지 않습니다.");
  }
  if (bracket.mode === "team") return { eligible: false, reason: "team_event" };

  const participants = (bracket.participants || [])
    .filter(participant => !Array.isArray(participant?.members));
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

async function syncEventBracketMatchesNow(eventId, bracket) {
  const identityState = bracketMatchIdentityState(eventId, bracket);
  if (!identityState.eligible) {
    return { skipped: true, reason: identityState.reason, inserted: 0, updated: 0, deleted: 0 };
  }

  const event = await getEvent(eventId);
  if (!event) throw new Error("normalized Match를 연결할 Event를 찾을 수 없습니다.");
  if (event.is_team_event) {
    throw new Error("팀전 Event의 normalized Match 동기화는 아직 지원하지 않습니다.");
  }

  const desiredRows = buildEventBracketMatchSnapshot(bracket);
  const { data: existingRows, error: selectError } = await db()
    .from("matches")
    .select(`
      id,
      source_node_key,
      match_kind,
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
    `)
    .eq("event_id", eventId)
    .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE);

  if (selectError) fail(selectError, "기존 normalized Match를 확인하지 못했습니다.");

  const now = new Date().toISOString();
  const plan = buildBracketMatchSyncPlan(existingRows || [], desiredRows, now);

  for (const update of plan.updates) {
    const { data, error } = await db()
      .from("matches")
      .update({ ...update.payload, updated_at: now })
      .eq("id", update.id)
      .eq("event_id", eventId)
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .select("id")
      .maybeSingle();

    if (error) fail(error, `normalized Match '${update.payload.source_node_key}'를 수정하지 못했습니다.`);
    if (!data) throw new Error(`normalized Match '${update.payload.source_node_key}'가 동기화 중 변경되었습니다.`);
  }

  if (plan.inserts.length) {
    const { data, error } = await db()
      .from("matches")
      .insert(plan.inserts.map(row => ({
        ...row,
        event_id: eventId,
        source: LEGACY_BRACKET_RUNTIME_SOURCE,
        updated_at: now,
      })))
      .select("id");

    if (error) fail(error, "신규 normalized Match를 생성하지 못했습니다.");
    if ((data || []).length !== plan.inserts.length) {
      throw new Error("일부 신규 normalized Match가 저장되지 않았습니다.");
    }
  }

  if (plan.deleteIds.length) {
    const { data, error } = await db()
      .from("matches")
      .delete()
      .eq("event_id", eventId)
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .in("id", plan.deleteIds)
      .select("id");

    if (error) fail(error, "더 이상 성립하지 않는 normalized Match를 정리하지 못했습니다.");
    if ((data || []).length !== plan.deleteIds.length) {
      throw new Error("일부 stale normalized Match가 삭제되지 않았습니다.");
    }
  }

  return {
    skipped: false,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    deleted: plan.deleteIds.length,
  };
}

export async function syncEventBracketMatches(eventId, bracket) {
  if (!eventId) return { skipped: true, reason: "event_unlinked", inserted: 0, updated: 0, deleted: 0 };
  return queueEventMatchMutation(eventId, () => syncEventBracketMatchesNow(eventId, bracket));
}

export async function deleteEventBracketMatches(eventId) {
  if (!eventId) return { deleted: 0 };

  return queueEventMatchMutation(eventId, async () => {
    const { data, error } = await db()
      .from("matches")
      .delete()
      .eq("event_id", eventId)
      .eq("source", LEGACY_BRACKET_RUNTIME_SOURCE)
      .select("id");

    if (error) fail(error, "Event의 runtime normalized Match를 정리하지 못했습니다.");
    return { deleted: (data || []).length };
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

async function validateResultEntries(eventId, desiredRows) {
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
    if (!entry || entry.event_id !== eventId || entry.entry_type !== "individual" || entry.status !== "active") {
      throw new Error(`입상자 Entry '${entryId}'가 현재 Event의 활성 개인 Entry와 일치하지 않습니다.`);
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
  if (event.is_team_event) {
    throw new Error("팀전 Event의 normalized Result 동기화는 아직 지원하지 않습니다.");
  }

  await validateResultEntries(eventId, snapshot.rows);
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
    if (event.is_team_event) {
      throw new Error("팀전 Event의 normalized Result 정리는 아직 지원하지 않습니다.");
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
      record_applied_at
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
      record_applied_at
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

  if (!data?.length) return null;

  if (data.length > 1) {
    const ambiguous = new Error("동일한 이름의 신청자가 여러 명 존재합니다. 운영진에게 문의해 주세요.");
    ambiguous.code = "YPL_AMBIGUOUS_REGISTRATION";
    throw ambiguous;
  }

  return {
    event,
    registration: data[0],
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

export async function completeApplicationEvent(eventId) {
  if (!eventId) return null;

  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("events")
    .update({
      status: "completed",
      record_applied_at: now,
      updated_at: now,
    })
    .eq("id", eventId)
    .is("record_applied_at", null)
    .select("id, status, record_applied_at")
    .maybeSingle();

  if (error) fail(error, "대회 기록 반영 상태를 저장하지 못했습니다.");
  if (!data) throw new Error("대회가 이미 완료되었거나 기록 반영 상태를 변경할 수 없습니다.");
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

async function preflightEventParticipantIdentities(eventId, participants, { requireEmptyEntries = false } = {}) {
  const actualParticipants = actualIndividualParticipants(
    participants,
    "확정할 실제 참가자가 없습니다."
  );

  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (event.is_team_event) throw new Error("팀전 Event의 참가자 확정은 아직 지원하지 않습니다.");
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
  { requireUnappliedEvent = false } = {}
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
    const { error } = await db()
      .from("entry_participants")
      .delete()
      .eq("id", change.entryParticipantId)
      .eq("event_id", eventId);
    remember(error, `${change.name || "참가자"}의 EntryParticipant를 정리하지 못했습니다.`);
  }

  for (const change of changes) {
    if (!change?.entryWasCreated || !change.entryId) continue;
    const { error } = await db()
      .from("entries")
      .delete()
      .eq("id", change.entryId)
      .eq("event_id", eventId);
    remember(error, `${change.name || "참가자"}의 Entry를 정리하지 못했습니다.`);
  }

  for (const change of changes) {
    if (!change?.registrationId) continue;

    if (change.registrationWasCreated) {
      const { error } = await db()
        .from("event_registrations")
        .delete()
        .eq("id", change.registrationId)
        .eq("event_id", eventId);
      remember(error, `${change.name || "참가자"}의 신규 참가 등록을 정리하지 못했습니다.`);
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
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("events")
    .update({
      status: "running",
      record_applied_at: null,
      updated_at: now,
    })
    .eq("id", eventId)
    .select("id, status, record_applied_at")
    .maybeSingle();

  if (error) fail(error, "Event의 기록 반영 상태를 원복하지 못했습니다.");
  if (!data) throw new Error("원복할 Event를 찾을 수 없습니다.");

  return data;
}
