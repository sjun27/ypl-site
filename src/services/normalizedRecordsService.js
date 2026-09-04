import { supa as client } from "../storage.js";
import { NORMALIZED_DATA_SCHEMA } from "./normalizedCompetitionService.js";

const CONFIGURED_SCHEMA = import.meta.env.VITE_YPL_DATA_SCHEMA || "";

function db() {
  if (!client) throw new Error("Supabase 연결이 설정되지 않았습니다.");
  if (!normalizedRecordsReadEnabled()) {
    throw new Error("normalized Records read schema가 설정되지 않았습니다.");
  }
  return client.schema(NORMALIZED_DATA_SCHEMA);
}

function fail(error, fallback) {
  const next = new Error(error?.message || fallback);
  next.code = error?.code || "YPL_RECORDS_READ_ERROR";
  next.details = error?.details || null;
  throw next;
}

async function rows(query, fallback) {
  const { data, error } = await query;
  if (error) fail(error, fallback);
  return data || [];
}

function inEventIds(table, select, eventIds) {
  if (!eventIds.length) return Promise.resolve([]);
  return rows(
    db().from(table).select(select).in("event_id", eventIds),
    `${table} Records 데이터를 읽지 못했습니다.`
  );
}

export function normalizedRecordsReadEnabled() {
  // Production은 아직 public/legacy가 기준 원본이다. P0-8 read는 Test처럼
  // custom schema가 명시된 환경에서만 활성화한다.
  return Boolean(client && CONFIGURED_SCHEMA === "ypl_schema_validation");
}

export async function fetchNormalizedRecordsSnapshot() {
  const [events, seasons, players, rankingBaselines] = await Promise.all([
    rows(
      db()
        .from("events")
        .select(`
          id, season_id, name, round_number, event_type, division,
          battle_format, competition_format, competition_settings,
          is_team_event, regulation_id, cup_rule_id, held_on,
          date_precision, record_completeness, status, record_applied_at,
          championship_phase
        `)
        .eq("status", "completed")
        .eq("is_team_event", false)
        .not("record_applied_at", "is", null),
      "공식 normalized Event를 읽지 못했습니다."
    ),
    rows(
      db().from("seasons").select("id, code, name, series, number, sort_order, status"),
      "normalized Season을 읽지 못했습니다."
    ),
    rows(
      db().from("players").select("id, display_name, status"),
      "normalized Player를 읽지 못했습니다."
    ),
    rows(
      db()
        .from("ranking_baselines")
        .select("id, player_id, scope, series, season_id, points, wins, runner_ups, top4s, source, note"),
      "normalized RankingBaseline을 읽지 못했습니다."
    ),
  ]);

  const eventIds = events.map((event) => event.id);
  const [entries, entryParticipants, matches, results, rankingAwards, eventRegistrations] = await Promise.all([
    inEventIds("entries", "id, event_id, entry_type, display_name, status", eventIds),
    inEventIds(
      "entry_participants",
      "id, event_id, entry_id, registration_id, player_id, member_order, role",
      eventIds
    ),
    inEventIds(
      "matches",
      `
        id, event_id, parent_match_id, match_kind, round_number, stage_label,
        sequence_no, entry_a_id, entry_b_id, player_a_id, player_b_id,
        winner_entry_id, winner_player_id, resolution, source,
        source_node_key, played_at
      `,
      eventIds
    ),
    inEventIds(
      "results",
      "id, event_id, entry_id, placement_code, rank_min, rank_max, placement_label, source",
      eventIds
    ),
    inEventIds(
      "ranking_awards",
      `
        id, event_id, player_id, result_id, award_kind, points_delta,
        win_delta, runner_up_delta, top4_delta, counts_series,
        counts_season, related_award_id, reason, source, created_at
      `,
      eventIds
    ),
    inEventIds(
      "event_registrations",
      "id, event_id, player_id, registration_name, registration_source, final_submission_id",
      eventIds
    ),
  ]);

  const finalSubmissionIds = eventRegistrations
    .map((registration) => registration.final_submission_id)
    .filter(Boolean);
  const registrationSubmissions = finalSubmissionIds.length
    ? await rows(
        db()
          .from("registration_submissions")
          .select("id, registration_id, snapshot_id, revision, submitted_at, source")
          .in("id", finalSubmissionIds),
        "최종 RegistrationSubmission을 읽지 못했습니다."
      )
    : [];

  const snapshotIds = registrationSubmissions.map((submission) => submission.snapshot_id).filter(Boolean);
  const [teamSnapshots, teamSnapshotMembers] = snapshotIds.length
    ? await Promise.all([
        rows(
          db()
            .from("team_snapshots")
            .select("id, schema_version, regulation_id, cup_rule_id, source_type, source_reference")
            .in("id", snapshotIds),
          "최종 TeamSnapshot을 읽지 못했습니다."
        ),
        rows(
          db()
            .from("team_snapshot_members")
            .select("id, snapshot_id, slot, pokemon_id, pokemon_name_snapshot")
            .in("snapshot_id", snapshotIds),
          "최종 TeamSnapshotMember를 읽지 못했습니다."
        ),
      ])
    : [[], []];

  return {
    schema: NORMALIZED_DATA_SCHEMA,
    events,
    seasons,
    players,
    entries,
    entryParticipants,
    matches,
    results,
    rankingBaselines,
    rankingAwards,
    eventRegistrations,
    registrationSubmissions,
    teamSnapshots,
    teamSnapshotMembers,
  };
}
