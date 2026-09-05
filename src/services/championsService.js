import { supa as client } from "../storage.js";
import { NORMALIZED_DATA_SCHEMA } from "./normalizedCompetitionService.js";
import { spriteUrl } from "./teamBuilderCore.js";
import {
  advancementCancellationError,
  buildChampionshipSettings,
  buildFinalRegistrationPayload,
  championshipFinalCapacity,
  championshipGeneration,
  isChampionshipFinal,
  isChampionshipQualifier,
  qualifierCompletionState,
  validateAdvancementInput,
} from "./championsCore.js";

function db() {
  if (!client || NORMALIZED_DATA_SCHEMA !== "ypl_schema_validation") {
    throw new Error("Champions normalized 운영은 Test Supabase에서만 사용할 수 있습니다.");
  }
  return client.schema(NORMALIZED_DATA_SCHEMA);
}

function fail(error, fallback) {
  const next = new Error(error?.message || fallback);
  next.code = error?.code || "YPL_CHAMPIONS_ERROR";
  next.details = error?.details || null;
  throw next;
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const ids = (rows) => asArray(rows).map((row) => row?.id).filter(Boolean);

async function rows(query, fallback) {
  const { data, error } = await query;
  if (error) fail(error, fallback);
  return data || [];
}

async function rowsFor(table, select, column, values, fallback) {
  if (!values.length) return [];
  return rows(db().from(table).select(select).in(column, values), fallback);
}

export function championsOperationsEnabled() {
  return Boolean(client && NORMALIZED_DATA_SCHEMA === "ypl_schema_validation");
}

export async function getChampionshipManagementSnapshot() {
  const events = await rows(
    db().from("events").select(`
      id, season_id, name, event_type, division, battle_format, competition_format,
      competition_settings, is_team_event, regulation_id, cup_rule_id,
      cup_rule_settings, registration_settings, held_on, status,
      team_reveal_mode, team_revealed_at, record_applied_at,
      championship_phase, championship_final_event_id, qualification_slots
    `).eq("event_type", "champions").order("round_number", { ascending: true }),
    "Champions Event를 불러오지 못했습니다."
  );
  const eventIds = ids(events);
  const registrations = await rowsFor(
    "event_registrations",
    "id, event_id, player_id, registration_name, registration_data, registration_source, registered_at, final_submission_id",
    "event_id", eventIds, "Champions Registration을 불러오지 못했습니다."
  );
  const registrationIds = ids(registrations);
  const advancements = await rowsFor(
    "championship_advancements",
    "id, final_registration_id, source_entry_id, advancement_type, reason, created_at",
    "final_registration_id", registrationIds, "Champions advancement를 불러오지 못했습니다."
  );
  const submissions = await rowsFor(
    "registration_submissions", "id, registration_id, snapshot_id, revision, submitted_at", "registration_id", registrationIds,
    "Champions Submission을 불러오지 못했습니다."
  );
  const entries = await rowsFor(
    "entries", "id, event_id, entry_type, display_name, status, seed", "event_id", eventIds,
    "Champions Entry를 불러오지 못했습니다."
  );
  const entryParticipants = await rowsFor(
    "entry_participants", "id, event_id, entry_id, registration_id, player_id, member_order, role", "event_id", eventIds,
    "Champions EntryParticipant를 불러오지 못했습니다."
  );
  const playerIds = [...new Set([...registrations.map((row) => row.player_id), ...entryParticipants.map((row) => row.player_id)].filter(Boolean))];
  const players = await rowsFor("players", "id, display_name, status", "id", playerIds, "Champions Player를 불러오지 못했습니다.");
  const sourceEntryIds = advancements.map((row) => row.source_entry_id).filter(Boolean);
  const sourceEntries = entries.filter((row) => sourceEntryIds.includes(row.id));
  const results = await rowsFor("results", "id, event_id, entry_id, placement_code, placement_label", "event_id", eventIds, "Champions Result를 불러오지 못했습니다.");
  const hallOfFame = await rowsFor("hall_of_fame_entries", "id, event_id, result_id, player_id, generation_number, generation_label, image_ref, note", "event_id", eventIds, "Hall of Fame를 불러오지 못했습니다.");
  return { events, registrations, advancements, submissions, entries, sourceEntries, entryParticipants, players, results, hallOfFame };
}

async function readEvent(eventId) {
  const data = await rows(db().from("events").select(`
    id, season_id, name, event_type, division, battle_format, competition_format,
    competition_settings, is_team_event, regulation_id, cup_rule_id,
    cup_rule_settings, registration_settings, status, team_reveal_at,
    team_revealed_at, record_applied_at, championship_phase,
    championship_final_event_id, qualification_slots
  `).eq("id", eventId), "Champions Event를 확인하지 못했습니다.");
  return data[0] || null;
}

async function updateEvent(eventId, payload) {
  const data = await rows(db().from("events").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", eventId).select().single(), "Champions Event 설정을 저장하지 못했습니다.");
  return data[0] || data;
}

export async function saveChampionshipEventRelation({
  qualifierEventId,
  finalEventId,
  generationNumber,
  battleFormat = null,
  competitionFormat = null,
  finalCapacity,
  qualificationSlots,
} = {}) {
  if (!qualifierEventId || !finalEventId || qualifierEventId === finalEventId) throw new Error("qualifier와 final Event를 서로 다르게 선택해 주세요.");
  const [qualifier, final] = await Promise.all([readEvent(qualifierEventId), readEvent(finalEventId)]);
  if (!qualifier || !final || qualifier.event_type !== "champions" || final.event_type !== "champions") throw new Error("Champions Event만 연결할 수 있습니다.");
  const slots = Number(qualificationSlots);
  const capacity = Number(finalCapacity);
  const generation = Number(generationNumber);
  if (!Number.isInteger(generation) || generation < 1 || !Number.isInteger(slots) || slots < 1 || !Number.isInteger(capacity) || capacity < 1) throw new Error("generation, final capacity와 qualification slots를 올바르게 입력해 주세요.");
  const previous = { qualifier, final };
  const common = {
    battle_format: battleFormat || qualifier.battle_format || final.battle_format || null,
    competition_format: competitionFormat || final.competition_format || qualifier.competition_format || null,
  };
  try {
    await updateEvent(final.id, {
      ...common,
      championship_phase: "final",
      championship_final_event_id: null,
      qualification_slots: null,
      competition_settings: buildChampionshipSettings(final, { generationNumber: generation, finalCapacity: capacity }),
    });
    return await updateEvent(qualifier.id, {
      ...common,
      championship_phase: "qualifier",
      championship_final_event_id: final.id,
      qualification_slots: slots,
      competition_settings: buildChampionshipSettings(qualifier, { generationNumber: generation, finalCapacity: capacity }),
    });
  } catch (error) {
    try {
      await updateEvent(previous.final.id, {
        battle_format: previous.final.battle_format,
        competition_format: previous.final.competition_format,
        competition_settings: previous.final.competition_settings,
        championship_phase: previous.final.championship_phase,
        championship_final_event_id: previous.final.championship_final_event_id,
        qualification_slots: previous.final.qualification_slots,
      });
      await updateEvent(previous.qualifier.id, {
        battle_format: previous.qualifier.battle_format,
        competition_format: previous.qualifier.competition_format,
        competition_settings: previous.qualifier.competition_settings,
        championship_phase: previous.qualifier.championship_phase,
        championship_final_event_id: previous.qualifier.championship_final_event_id,
        qualification_slots: previous.qualifier.qualification_slots,
      });
    } catch (restoreError) {
      error.message = `${error.message} / relation 복구 실패: ${restoreError.message}`;
    }
    throw error;
  }
}

export async function createChampionshipAdvancement({ finalEventId, playerId, advancementType, sourceEntryId = null, reason = "" } = {}) {
  const finalEvent = await readEvent(finalEventId);
  if (!finalEvent) throw new Error("본선 Event를 찾을 수 없습니다.");
  const snapshot = await getChampionshipManagementSnapshot();
  const qualifierEvent = snapshot.events.find((event) => event.id === finalEvent.championship_final_event_id) || null;
  const existing = snapshot.advancements
    .map((advancement) => ({ ...advancement, registration: snapshot.registrations.find((registration) => registration.id === advancement.final_registration_id) }))
    .filter((row) => row.registration?.event_id === finalEvent.id);
  const sourceEntry = snapshot.entries.find((entry) => entry.id === sourceEntryId) || null;
  const player = snapshot.players.find((row) => row.id === playerId) || null;
  const errors = validateAdvancementInput({
    finalEvent,
    qualifierEvent,
    existingAdvancements: existing.map((row) => ({ ...row, player_id: row.registration?.player_id })),
    playerId,
    advancementType,
    sourceEntry,
    finalCapacity: championshipFinalCapacity(finalEvent),
  });
  if (errors.length) throw new Error(errors.join(" "));
  if (advancementType === "qualifier") {
    const sourceParticipants = snapshot.entryParticipants.filter((row) => row.entry_id === sourceEntry.id && row.event_id === qualifierEvent.id);
    if (sourceParticipants.length !== 1 || sourceParticipants[0].player_id !== playerId) throw new Error("qualifier Entry의 실제 Player identity를 확인할 수 없습니다.");
  }

  const registrationPayload = buildFinalRegistrationPayload({ finalEvent, player, reason });
  const registration = await rows(db().from("event_registrations").insert(registrationPayload).select().single(), "본선 EventRegistration을 생성하지 못했습니다.");
  const registrationRow = registration[0] || registration;
  try {
    const advancement = await rows(db().from("championship_advancements").insert({
      final_registration_id: registrationRow.id,
      source_entry_id: advancementType === "qualifier" ? sourceEntry.id : null,
      advancement_type: advancementType,
      reason: String(reason || "").trim() || null,
    }).select().single(), "ChampionshipAdvancement를 생성하지 못했습니다.");
    return { advancement: advancement[0] || advancement, registration: registrationRow };
  } catch (error) {
    try { await db().from("event_registrations").delete().eq("id", registrationRow.id).select("id"); } catch (cleanupError) { error.message = `${error.message} / 신규 Registration 정리 실패: ${cleanupError.message}`; }
    throw error;
  }
}

export async function cancelChampionshipAdvancement(advancementId) {
  const snapshot = await getChampionshipManagementSnapshot();
  const advancement = snapshot.advancements.find((row) => row.id === advancementId);
  if (!advancement) throw new Error("취소할 advancement를 찾을 수 없습니다.");
  const registration = snapshot.registrations.find((row) => row.id === advancement.final_registration_id);
  if (!registration) throw new Error("advancement의 Final Registration을 찾을 수 없습니다.");
  const finalEvent = snapshot.events.find((event) => event.id === registration.event_id);
  if (!isChampionshipFinal(finalEvent) || finalEvent.status === "completed" || finalEvent.record_applied_at) throw new Error("완료된 본선의 advancement는 취소할 수 없습니다.");

  const [submissions, entries, entryParticipants, matches, results, rankingAwards, runtimes] = await Promise.all([
    rows(db().from("registration_submissions").select("id").eq("registration_id", registration.id), "Submission 상태를 확인하지 못했습니다."),
    rows(db().from("entries").select("id").eq("event_id", finalEvent.id), "Entry 상태를 확인하지 못했습니다."),
    rows(db().from("entry_participants").select("id").eq("registration_id", registration.id), "EntryParticipant 상태를 확인하지 못했습니다."),
    rows(db().from("matches").select("id").eq("event_id", finalEvent.id), "Match 상태를 확인하지 못했습니다."),
    rows(db().from("results").select("id").eq("event_id", finalEvent.id), "Result 상태를 확인하지 못했습니다."),
    rows(db().from("ranking_awards").select("id").eq("event_id", finalEvent.id), "RankingAward 상태를 확인하지 못했습니다."),
    rows(db().from("bracket_runtimes").select("id").eq("event_id", finalEvent.id), "Bracket runtime 상태를 확인하지 못했습니다."),
  ]);
  const blocked = advancementCancellationError({
    submissions: submissions.length,
    entries: entries.length,
    entryParticipants: entryParticipants.length,
    matches: matches.length,
    results: results.length,
    rankingAwards: rankingAwards.length,
    bracketRuntimes: runtimes.length,
    eventCompleted: finalEvent.status === "completed",
  });
  if (blocked) throw new Error(blocked);

  const { data: deletedAdvancement, error: advancementError } = await db().from("championship_advancements").delete().eq("id", advancement.id).select("id, final_registration_id");
  if (advancementError) fail(advancementError, "advancement를 취소하지 못했습니다.");
  if (!deletedAdvancement?.length) throw new Error("advancement 취소 결과를 확인하지 못했습니다.");
  try {
    const { data: deletedRegistration, error: registrationError } = await db().from("event_registrations").delete().eq("id", registration.id).select("id");
    if (registrationError) fail(registrationError, "runtime-owned Final Registration을 취소하지 못했습니다.");
    if (!deletedRegistration?.length) throw new Error("Final Registration 취소 결과를 확인하지 못했습니다.");
  } catch (error) {
    try {
      await db().from("championship_advancements").insert({ ...advancement, id: advancement.id }).select("id");
    } catch (restoreError) {
      error.message = `${error.message} / advancement 복구 실패: ${restoreError.message}`;
    }
    throw error;
  }
  return { advancementId: advancement.id, registrationId: registration.id };
}

export async function completeChampionshipQualifier(eventId) {
  const snapshot = await getChampionshipManagementSnapshot();
  const event = snapshot.events.find((row) => row.id === eventId);
  if (!event) throw new Error("qualifier Event를 찾을 수 없습니다.");
  const finalRegistrationIds = new Set(snapshot.registrations.filter((row) => row.event_id === snapshot.events.find((item) => item.id === event.championship_final_event_id)?.id).map((row) => row.id));
  const sourceEntryIds = new Set(snapshot.entryParticipants.filter((row) => row.event_id === event.id).map((row) => row.entry_id));
  const qualifiedCount = snapshot.advancements.filter((row) => finalRegistrationIds.has(row.final_registration_id) && row.advancement_type === "qualifier" && sourceEntryIds.has(row.source_entry_id)).length;
  const state = qualifierCompletionState({ qualifierEvent: event, qualificationSlots: event.qualification_slots, qualifiedCount });
  if (!state.ok) throw new Error(state.error);
  if (state.alreadyCompleted) return event;
  return updateEvent(event.id, { status: "completed" });
}

export async function ensureChampionshipHallOfFameEntry(eventId) {
  const event = await readEvent(eventId);
  if (!event || !isChampionshipFinal(event)) return null;
  if (event.status !== "completed" || !event.record_applied_at) throw new Error("본선 Event가 공식 완료되지 않아 Hall of Fame에 등록할 수 없습니다.");
  const generation = championshipGeneration(event);
  if (!generation) throw new Error("Final Event의 Champions generation 설정이 없어 Hall of Fame에 등록할 수 없습니다.");
  const [results, existing] = await Promise.all([
    rows(db().from("results").select("id, event_id, entry_id, placement_code").eq("event_id", event.id).eq("placement_code", "champion"), "champion Result를 읽지 못했습니다."),
    rows(db().from("hall_of_fame_entries").select("id, event_id, result_id, player_id, generation_number").eq("event_id", event.id), "기존 Hall of Fame를 읽지 못했습니다."),
  ]);
  if (existing.length) return existing[0];
  if (results.length !== 1) throw new Error(`본선 champion Result가 정확히 1건이 아닙니다 (${results.length}건).`);
  const result = results[0];
  const participants = await rows(db().from("entry_participants").select("player_id").eq("event_id", event.id).eq("entry_id", result.entry_id), "champion EntryParticipant를 읽지 못했습니다.");
  if (participants.length !== 1 || !participants[0].player_id) throw new Error("champion Entry의 Player identity를 확인할 수 없습니다.");
  const { data, error } = await db().from("hall_of_fame_entries").insert({
    event_id: event.id,
    result_id: result.id,
    player_id: participants[0].player_id,
    generation_number: generation,
    generation_label: `${generation}대 챔피언`,
  }).select().single();
  if (error) fail(error, "Hall of Fame 등록을 저장하지 못했습니다.");
  return data;
}

export async function fetchNormalizedChampionsHallOfFame() {
  if (!championsOperationsEnabled()) return [];
  const hof = await rows(db().from("hall_of_fame_entries").select("id, event_id, result_id, player_id, generation_number, generation_label, image_ref, note").order("generation_number", { ascending: false }), "Hall of Fame를 불러오지 못했습니다.");
  if (!hof.length) return [];
  const eventIds = [...new Set(hof.map((row) => row.event_id).filter(Boolean))];
  const playerIds = hof.map((row) => row.player_id).filter(Boolean);
  const resultIds = hof.map((row) => row.result_id).filter(Boolean);
  const [events, players, results] = await Promise.all([
    rowsFor("events", "id, name, round_number, battle_format, competition_format, event_type, championship_phase", "id", eventIds, "HOF Event를 불러오지 못했습니다."),
    rowsFor("players", "id, display_name", "id", playerIds, "HOF Player를 불러오지 못했습니다."),
    rowsFor("results", "id, event_id, entry_id, placement_code", "id", resultIds, "HOF Result를 불러오지 못했습니다."),
  ]);
  const entryIds = results.map((row) => row.entry_id).filter(Boolean);
  const entries = await rowsFor("entries", "id, event_id, entry_type, display_name", "id", entryIds, "HOF Entry를 불러오지 못했습니다.");
  const participants = await rowsFor("entry_participants", "id, event_id, entry_id, registration_id, player_id, member_order", "entry_id", entryIds, "HOF EntryParticipant를 불러오지 못했습니다.");
  const registrationIds = participants.map((row) => row.registration_id).filter(Boolean);
  const registrations = await rowsFor("event_registrations", "id, event_id, player_id, final_submission_id", "id", registrationIds, "HOF Registration을 불러오지 못했습니다.");
  const submissionIds = registrations.map((row) => row.final_submission_id).filter(Boolean);
  const submissions = await rowsFor("registration_submissions", "id, registration_id, snapshot_id", "id", submissionIds, "HOF Submission을 불러오지 못했습니다.");
  const snapshotIds = submissions.map((row) => row.snapshot_id).filter(Boolean);
  const members = await rowsFor("team_snapshot_members", "id, snapshot_id, slot, pokemon_id, pokemon_name_snapshot", "snapshot_id", snapshotIds, "HOF TeamSnapshot을 불러오지 못했습니다.");
  const eventById = new Map(events.map((row) => [row.id, row]));
  const playerById = new Map(players.map((row) => [row.id, row]));
  const resultById = new Map(results.map((row) => [row.id, row]));
  const entryById = new Map(entries.map((row) => [row.id, row]));
  const registrationById = new Map(registrations.map((row) => [row.id, row]));
  const submissionById = new Map(submissions.map((row) => [row.id, row]));
  return hof.map((row) => {
    const event = eventById.get(row.event_id) || {};
    const result = resultById.get(row.result_id) || {};
    const entry = entryById.get(result.entry_id) || {};
    const participantRows = participants.filter((item) => item.entry_id === result.entry_id).sort((a, b) => Number(a.member_order || 0) - Number(b.member_order || 0));
    const party = participantRows.flatMap((participant) => {
      const registration = registrationById.get(participant.registration_id);
      const submission = submissionById.get(registration?.final_submission_id);
      return members.filter((member) => member.snapshot_id === submission?.snapshot_id).map((member) => ({ name: member.pokemon_name_snapshot || member.pokemon_id || "", img: member.pokemon_id ? spriteUrl(member.pokemon_id) : "" }));
    });
    return {
      id: row.id,
      gen: row.generation_label || `${row.generation_number}대`,
      season: event.round_number || row.generation_number,
      slabel: event.name || `SEASON ${event.round_number || row.generation_number}`,
      name: playerById.get(row.player_id)?.display_name || "알 수 없는 선수",
      team: party,
      format: event.battle_format || null,
      eventName: event.name || "",
      legacyImageRef: row.image_ref || null,
      entryType: entry.entry_type || null,
    };
  });
}
