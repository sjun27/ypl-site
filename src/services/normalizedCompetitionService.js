import { supa as client } from "../storage.js";

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

async function createRecordPlayer(displayName) {
  const name = String(displayName || "").trim();
  const { data: created, error: createError } = await db()
    .from("players")
    .insert({
      display_name: name,
      status: "active",
    })
    .select("id, display_name")
    .single();

  if (createError) fail(createError, `${name}의 신규 Player를 생성하지 못했습니다.`);
  return created;
}

export async function resolveEventParticipantsForRecord(eventId, participants = []) {
  if (!eventId) return [];

  const actualParticipants = (participants || [])
    .filter(p => !Array.isArray(p.members))
    .map(p => ({
      ...p,
      name: String(p.name || "").trim(),
    }))
    .filter(p => p.name);

  if (!actualParticipants.length) throw new Error("기록에 반영할 실제 참가자가 없습니다.");

  const event = await getEvent(eventId);
  if (!event) throw new Error("연결된 대회를 찾을 수 없습니다.");
  if (event.is_team_event) throw new Error("팀전 Event의 Player 확정은 아직 지원하지 않습니다.");
  if (!["open", "running"].includes(event.status) || event.record_applied_at) {
    throw new Error("현재 기록을 반영할 수 없는 대회입니다.");
  }

  const { data: registrations, error: registrationError } = await db()
    .from("event_registrations")
    .select("id, event_id, player_id, registration_name, registration_source")
    .eq("event_id", eventId);

  if (registrationError) fail(registrationError, "대회 참가 신청 정보를 확인하지 못했습니다.");

  const registrationById = new Map((registrations || []).map(row => [row.id, row]));
  const plans = actualParticipants.map(participant => {
    let registration = null;

    if (participant.registrationId) {
      registration = registrationById.get(participant.registrationId) || null;
      if (!registration) throw new Error(`${participant.name}의 참가 신청 연결을 찾을 수 없습니다.`);
    } else {
      const matches = (registrations || []).filter(row => row.registration_name === participant.name);
      if (matches.length > 1) {
        throw new Error(`'${participant.name}' 이름의 참가 신청이 중복되어 있습니다. 기록 반영 전에 확인이 필요합니다.`);
      }
      registration = matches[0] || null;
    }

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
      throw new Error(`'${plan.identityName}' 이름의 Player가 2명 이상 존재합니다. 기록 반영 전에 관리자가 직접 확인해야 합니다.`);
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
      const conflictingRegistration = (registrations || []).find(row =>
        row.player_id === plan.playerId && row.id !== plan.registration?.id
      );
      if (conflictingRegistration) {
        throw new Error(`'${plan.identityName}' Player가 이 Event의 다른 Registration에 이미 연결되어 있습니다.`);
      }
    }
  }

  const resolved = [];
  for (const plan of plans) {
    const { participant, registration, identityName } = plan;
    const playerWasCreated = !plan.playerId;
    const player = plan.playerId ? { id: plan.playerId } : await createRecordPlayer(identityName);

    if (registration?.player_id) {
      resolved.push({
        ...participant,
        registrationId: registration.id,
        playerId: registration.player_id,
        playerWasCreated: false,
        registrationWasCreated: false,
        registrationPlayerWasLinked: false,
      });
      continue;
    }

    if (registration) {
      const { data: updated, error } = await db()
        .from("event_registrations")
        .update({
          player_id: player.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", registration.id)
        .eq("event_id", eventId)
        .is("player_id", null)
        .select("id, player_id")
        .single();

      if (error) fail(error, `${identityName}의 Player 연결을 저장하지 못했습니다.`);

      resolved.push({
        ...participant,
        registrationId: updated.id,
        playerId: updated.player_id,
        playerWasCreated,
        registrationWasCreated: false,
        registrationPlayerWasLinked: true,
      });
      continue;
    }

    const now = new Date().toISOString();
    const { data: createdRegistration, error } = await db()
      .from("event_registrations")
      .insert({
        event_id: eventId,
        player_id: player.id,
        registration_name: identityName,
        registration_data: {},
        registration_source: "manual",
        registered_at: now,
        updated_at: now,
      })
      .select("id, player_id")
      .single();

    if (error) fail(error, `${identityName}의 참가자 등록을 생성하지 못했습니다.`);

    resolved.push({
      ...participant,
      registrationId: createdRegistration.id,
      playerId: createdRegistration.player_id,
      playerWasCreated,
      registrationWasCreated: true,
      registrationPlayerWasLinked: false,
    });
  }

  if (resolved.length !== actualParticipants.length || resolved.some(row => !row.playerId || !row.registrationId)) {
    throw new Error("모든 실제 참가자의 Player/Registration identity를 확정하지 못했습니다.");
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

  // 1. 이번 기록 반영에서 생성/연결한 Registration만 되돌린다.
  for (const change of changes) {
    const registrationId = change?.registrationId;
    const playerId = change?.playerId;

    if (!registrationId) continue;

    if (change.registrationWasCreated) {
      const { error } = await db()
        .from("event_registrations")
        .delete()
        .eq("id", registrationId)
        .eq("event_id", eventId);

      if (error) fail(error, `${change.name || "참가자"}의 신규 참가 등록을 원복하지 못했습니다.`);
      continue;
    }

    if (change.registrationPlayerWasLinked && playerId) {
      const { error } = await db()
        .from("event_registrations")
        .update({
          player_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", registrationId)
        .eq("event_id", eventId)
        .eq("player_id", playerId);

      if (error) fail(error, `${change.name || "참가자"}의 Player 연결을 원복하지 못했습니다.`);
    }
  }

  // 2. 이번 반영에서 실제로 생성한 Player만 삭제를 시도한다.
  //    다른 기록에서 이미 사용 중이면 FK(RESTRICT)가 보호하므로 그대로 유지한다.
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
      fail(error, "기록 반영 과정에서 생성된 Player를 정리하지 못했습니다.");
    }
  }

  if (!reopenEvent) return null;

  // 3. Event를 다시 기록 반영 가능한 상태로 연다.
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
