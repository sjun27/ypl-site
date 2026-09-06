import { supa as client } from "../storage.js";
import { NORMALIZED_DATA_SCHEMA } from "./normalizedCompetitionService.js";
import {
  isNormalizedChampionsHallOfFame,
  loadHallOfFameArtworkLookup,
  normalizedChampionLabel,
  normalizedSeasonLabel,
  resolveHallOfFameArtwork,
} from "./hallOfFamePresentation.js";
import {
  CHAMPIONSHIP_FINAL_FORMAT,
  CHAMPIONSHIP_QUALIFIER_FORMAT,
  advancementCancellationError,
  buildChampionshipSettings,
  championshipFinalCapacity,
  championshipGeneration,
  isChampionshipFinal,
  isChampionshipQualifier,
  normalizeChampionshipApplicationDraft,
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

function databaseUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("안전한 UUID 생성을 지원하지 않는 브라우저입니다.");
  return globalThis.crypto.randomUUID();
}

async function currentSeasonId() {
  const seasons = await rows(
    db().from("seasons").select("id").eq("series", "ypl").eq("status", "current").order("sort_order", { ascending: true }),
    "현재 시즌을 확인하지 못했습니다."
  );
  if (seasons.length !== 1) throw new Error(`현재 시즌은 정확히 1개여야 하지만 ${seasons.length}개입니다.`);
  return seasons[0].id;
}

export async function saveChampionshipApplicationEventPair({
  qualifierEventId = null,
  announcementId = null,
  eventDraft = {},
} = {}) {
  const draft = normalizeChampionshipApplicationDraft(eventDraft);
  const existingQualifier = qualifierEventId ? await readEvent(qualifierEventId) : null;
  if (qualifierEventId && !existingQualifier) throw new Error("수정할 Champions 선발전 Event를 찾을 수 없습니다.");
  if (existingQualifier && !isChampionshipQualifier(existingQualifier)) {
    throw new Error("기존 공지가 Qualifier/Final pair에 연결되어 있지 않아 자동으로 다시 만들지 않습니다.");
  }
  const finalEventId = existingQualifier?.championship_final_event_id || databaseUuid();
  const qualifierId = existingQualifier?.id || databaseUuid();
  const seasonId = existingQualifier?.season_id || await currentSeasonId();
  const registrationSettings = {
    ...(existingQualifier?.registration_settings || {}),
    ...(draft.registrationSettings || {}),
    ...(announcementId ? { announcementId } : {}),
  };
  const competitionSettings = {
    ...(draft.competitionSettings || existingQualifier?.competition_settings || {}),
    rankingEnabled: typeof draft.competitionSettings?.rankingEnabled === "boolean"
      ? draft.competitionSettings.rankingEnabled
      : true,
  };
  const { data, error } = await db().rpc("save_championship_application_event_pair", {
    p_qualifier_event_id: qualifierId,
    p_final_event_id: finalEventId,
    p_season_id: seasonId,
    p_announcement_id: announcementId,
    p_base_name: draft.name,
    p_round_number: draft.roundNumber ? Number(draft.roundNumber) : null,
    p_battle_format: draft.battleFormat,
    p_generation: draft.generation,
    p_final_capacity: draft.finalCapacity,
    p_qualification_slots: draft.qualificationSlots,
    p_regulation_id: draft.regulationId || null,
    p_cup_rule_id: draft.cupRuleId || null,
    p_cup_rule_settings: draft.cupRuleSettings || {},
    p_registration_settings: registrationSettings,
    p_competition_settings: competitionSettings,
    p_held_on: draft.heldOn || null,
    p_submission_target_at: draft.submissionTargetAt ? new Date(draft.submissionTargetAt).toISOString() : null,
  });
  if (error) fail(error, "Champions Qualifier/Final Event pair를 저장하지 못했습니다.");
  const result = Array.isArray(data) ? data[0] : data;
  const [qualifierEvent, finalEvent] = await Promise.all([
    readEvent(result?.qualifier_event_id || qualifierId),
    readEvent(result?.final_event_id || finalEventId),
  ]);
  if (!qualifierEvent || !finalEvent
      || qualifierEvent.competition_format !== CHAMPIONSHIP_QUALIFIER_FORMAT
      || finalEvent.competition_format !== CHAMPIONSHIP_FINAL_FORMAT) {
    throw new Error("저장된 Champions Event pair를 다시 확인하지 못했습니다.");
  }
  return { qualifierEvent, finalEvent, created: Boolean(result?.created) };
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
  const qualifierEvent = snapshot.events.find((event) => event.championship_final_event_id === finalEvent.id) || null;
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

  const registrationId = databaseUuid();
  const advancementId = databaseUuid();
  const { data, error } = await db().rpc("create_championship_advancement", {
    p_advancement_id: advancementId,
    p_registration_id: registrationId,
    p_final_event_id: finalEvent.id,
    p_player_id: player.id,
    p_advancement_type: advancementType,
    p_source_entry_id: advancementType === "qualifier" ? sourceEntry.id : null,
    p_reason: String(reason || "").trim() || null,
  });
  if (error) fail(error, "ChampionshipAdvancement와 Final Registration을 생성하지 못했습니다.");
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.advancement_id !== advancementId || result?.registration_id !== registrationId) {
    throw new Error("Champions advancement 생성 결과를 확인하지 못했습니다.");
  }
  return { advancementId, registrationId };
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

  const { data, error } = await db().rpc("cancel_championship_advancement", {
    p_advancement_id: advancement.id,
  });
  if (error) fail(error, "advancement와 runtime-owned Final Registration을 취소하지 못했습니다.");
  const result = Array.isArray(data) ? data[0] : data;
  if (result?.advancement_id !== advancement.id || result?.registration_id !== registration.id) {
    throw new Error("Champions advancement 취소 결과를 확인하지 못했습니다.");
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

export async function ensureChampionshipHallOfFameEntry(eventId, { hallOfFameId = null } = {}) {
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
  const requestedHallOfFameId = hallOfFameId || databaseUuid();
  const { data, error } = await db().rpc("ensure_championship_final_hall_of_fame", {
    p_event_id: event.id,
    p_hall_of_fame_id: requestedHallOfFameId,
  });
  if (error) fail(error, "Hall of Fame 등록을 저장하지 못했습니다.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.hall_of_fame_id || row.result_id !== result.id || row.player_id !== participants[0].player_id || Number(row.generation_number) !== generation) {
    throw new Error("Hall of Fame 등록 결과를 확인하지 못했습니다.");
  }
  return row;
}

export async function removeChampionshipHallOfFameEntry(eventId) {
  const event = await readEvent(eventId);
  if (!event || !isChampionshipFinal(event)) return { removed: false };
  const { data, error } = await db().rpc("remove_championship_final_hall_of_fame", {
    p_event_id: event.id,
  });
  if (error) fail(error, "Hall of Fame 등록을 취소하지 못했습니다.");
  const row = Array.isArray(data) ? data[0] : data;
  return {
    hallOfFameId: row?.hall_of_fame_id || null,
    resultId: row?.result_id || null,
    playerId: row?.player_id || null,
    generationNumber: Number(row?.generation_number) || null,
    removed: Boolean(row?.removed),
  };
}
export async function fetchNormalizedChampionsHallOfFame() {
  if (!championsOperationsEnabled()) return [];
  const hof = await rows(db().from("hall_of_fame_entries").select("id, event_id, result_id, player_id, generation_number, generation_label, image_ref, note").order("generation_number", { ascending: false }), "Hall of Fame를 불러오지 못했습니다.");
  if (!hof.length) return [];
  const eventIds = [...new Set(hof.map((row) => row.event_id).filter(Boolean))];
  const playerIds = hof.map((row) => row.player_id).filter(Boolean);
  const resultIds = hof.map((row) => row.result_id).filter(Boolean);
  const [events, players, results, artworkLookup] = await Promise.all([
    rowsFor("events", "id, season_id, name, round_number, battle_format, competition_format, event_type, championship_phase", "id", eventIds, "HOF Event를 불러오지 못했습니다."),
    rowsFor("players", "id, display_name", "id", playerIds, "HOF Player를 불러오지 못했습니다."),
    rowsFor("results", "id, event_id, entry_id, placement_code", "id", resultIds, "HOF Result를 불러오지 못했습니다."),
    loadHallOfFameArtworkLookup().catch(() => new Map()),
  ]);
  const seasonIds = [...new Set(events.map((row) => row.season_id).filter(Boolean))];
  const seasons = await rowsFor("seasons", "id, series, number, name", "id", seasonIds, "HOF Season을 불러오지 못했습니다.");
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
  const seasonById = new Map(seasons.map((row) => [row.id, row]));
  const playerById = new Map(players.map((row) => [row.id, row]));
  const resultById = new Map(results.map((row) => [row.id, row]));
  const entryById = new Map(entries.map((row) => [row.id, row]));
  const registrationById = new Map(registrations.map((row) => [row.id, row]));
  const submissionById = new Map(submissions.map((row) => [row.id, row]));
  return hof.map((row) => {
    const event = eventById.get(row.event_id) || {};
    const season = seasonById.get(event.season_id) || {};
    const normalized = isNormalizedChampionsHallOfFame(event);
    const result = resultById.get(row.result_id) || {};
    const entry = entryById.get(result.entry_id) || {};
    const participantRows = participants.filter((item) => item.entry_id === result.entry_id).sort((a, b) => Number(a.member_order || 0) - Number(b.member_order || 0));
    const party = participantRows.flatMap((participant) => {
      const registration = registrationById.get(participant.registration_id);
      const submission = submissionById.get(registration?.final_submission_id);
      return members.filter((member) => member.snapshot_id === submission?.snapshot_id).map((member) => ({
        name: member.pokemon_name_snapshot || member.pokemon_id || "",
        pokemonId: member.pokemon_id || "",
        img: resolveHallOfFameArtwork({ pokemonId: member.pokemon_id, name: member.pokemon_name_snapshot }, artworkLookup),
      }));
    });
    return {
      id: row.id,
      kind: normalized ? "normalized" : "legacy",
      generationNumber: row.generation_number,
      gen: normalized ? normalizedChampionLabel(row.generation_number, event.battle_format) : (row.generation_label || `${row.generation_number}대`),
      season: season.number || event.round_number || row.generation_number,
      slabel: normalized ? normalizedSeasonLabel(season) : (season.name || ""),
      name: playerById.get(row.player_id)?.display_name || "알 수 없는 선수",
      team: party,
      format: event.battle_format || null,
      eventName: event.name || "",
      legacyImageRef: row.image_ref || null,
      entryType: entry.entry_type || null,
    };
  });
}
