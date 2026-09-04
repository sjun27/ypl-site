import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNormalizedRecordsProjection,
  isOfficialNormalizedRecordsEvent,
} from "../src/services/normalizedRecordsProjection.js";

const EVENT_ID = "event-official";
const SEASON_ID = "season-3";

function legacyData() {
  return {
    rankings: [{ key: "era2", label: "YPL", rows: [{ name: "Alpha", win: 1, ru: 0, top4: 0, points: 130 }] }],
    seasons: [{ name: "YPL 시즌 3", rows: [{ name: "Alpha", win: 1, ru: 0, top4: 0, points: 30 }] }],
    tournaments: [
      {
        key: "pylite",
        label: "파이컵 라이트",
        color: "#abc",
        rounds: [
          {
            id: "linked-round",
            date: "2026.09",
            round: "7",
            season: "YPL 시즌 3",
            win: "Alpha",
            ru: "Beta",
            sf: [],
            recordMeta: { eventId: EVENT_ID },
          },
          {
            id: "legacy-round",
            date: "2025.01",
            round: "2",
            season: "YPL 시즌 1",
            win: "Legacy Winner",
            sf: [],
          },
        ],
      },
    ],
    brackets: [
      {
        id: "linked-bracket",
        eventId: EVENT_ID,
        name: "linked",
        mode: "single",
        format: "elim",
        participants: [
          { id: "pa", name: "Alpha", party: "피카츄, 라이츄" },
          { id: "pb", name: "Beta" },
        ],
        graph: null,
        applied: { tournamentKey: "pylite", date: "2026.09", season: "YPL 시즌 3", roundId: "linked-round" },
      },
    ],
    champions: [],
    titleGroups: [],
  };
}

function rawData() {
  return {
    schema: "ypl_schema_validation",
    seasons: [{ id: SEASON_ID, code: "ypl-3", name: "YPL 시즌 3", series: "ypl", sort_order: 3 }],
    events: [
      {
        id: EVENT_ID,
        season_id: SEASON_ID,
        name: "제7회 파이컵라이트",
        event_type: "light",
        competition_format: "double_elimination",
        is_team_event: false,
        held_on: "2026-09-05",
        date_precision: "exact",
        status: "completed",
        record_applied_at: "2026-09-05T00:00:00Z",
      },
      {
        id: "event-running",
        season_id: SEASON_ID,
        name: "되돌린 대회",
        event_type: "light",
        is_team_event: false,
        status: "running",
        record_applied_at: null,
      },
    ],
    players: [
      { id: "player-a", display_name: "Alpha" },
      { id: "player-b", display_name: "Beta" },
      { id: "player-running", display_name: "Running" },
    ],
    entries: [
      { id: "entry-a", event_id: EVENT_ID, entry_type: "individual", status: "active" },
      { id: "entry-b", event_id: EVENT_ID, entry_type: "individual", status: "active" },
      { id: "entry-running", event_id: "event-running", entry_type: "individual", status: "active" },
    ],
    entryParticipants: [
      { id: "ep-a", event_id: EVENT_ID, entry_id: "entry-a", registration_id: "reg-a", player_id: "player-a" },
      { id: "ep-b", event_id: EVENT_ID, entry_id: "entry-b", registration_id: "reg-b", player_id: "player-b" },
      { id: "ep-running", event_id: "event-running", entry_id: "entry-running", registration_id: "reg-running", player_id: "player-running" },
    ],
    results: [
      { id: "result-a", event_id: EVENT_ID, entry_id: "entry-a", placement_code: "champion", placement_label: "우승", rank_min: 1 },
      { id: "result-b", event_id: EVENT_ID, entry_id: "entry-b", placement_code: "runner_up", placement_label: "준우승", rank_min: 2 },
      { id: "result-running", event_id: "event-running", entry_id: "entry-running", placement_code: "champion", placement_label: "우승", rank_min: 1 },
    ],
    matches: [
      { id: "match-a", event_id: EVENT_ID, match_kind: "bracket", entry_a_id: "entry-a", entry_b_id: "entry-b", winner_entry_id: "entry-a", resolution: "played", source: "legacy_bracket_runtime", source_node_key: "gf" },
      { id: "match-bye", event_id: EVENT_ID, match_kind: "bracket", entry_a_id: "entry-a", entry_b_id: null, winner_entry_id: "entry-a", resolution: "played", source: "legacy_bracket_runtime", source_node_key: "bye" },
      { id: "match-unknown", event_id: EVENT_ID, match_kind: "bracket", entry_a_id: "entry-a", entry_b_id: "entry-b", winner_entry_id: null, resolution: "unknown", source: "legacy_bracket_runtime", source_node_key: "future" },
    ],
    rankingBaselines: [
      { id: "base-series", player_id: "player-a", scope: "series", series: "ypl", points: 100, wins: 0, runner_ups: 0, top4s: 0 },
      { id: "base-season", player_id: "player-a", scope: "season", season_id: SEASON_ID, points: 0, wins: 0, runner_ups: 0, top4s: 0 },
    ],
    rankingAwards: [
      { id: "award-placement", event_id: EVENT_ID, player_id: "player-a", result_id: "result-a", award_kind: "placement", points_delta: 30, win_delta: 1, runner_up_delta: 0, top4_delta: 0, counts_series: true, counts_season: true },
      { id: "award-placement-duplicate", event_id: EVENT_ID, player_id: "player-a", result_id: "result-a", award_kind: "placement", points_delta: 30, win_delta: 1, runner_up_delta: 0, top4_delta: 0, counts_series: true, counts_season: true },
      { id: "award-adjustment", event_id: EVENT_ID, player_id: "player-a", result_id: null, award_kind: "adjustment", points_delta: -5, win_delta: 0, runner_up_delta: 0, top4_delta: 0, counts_series: true, counts_season: false },
      { id: "award-reversal", event_id: EVENT_ID, player_id: "player-a", result_id: null, award_kind: "reversal", points_delta: -10, win_delta: -1, runner_up_delta: 0, top4_delta: 0, counts_series: true, counts_season: true },
      { id: "award-running", event_id: "event-running", player_id: "player-running", result_id: "result-running", award_kind: "placement", points_delta: 30, win_delta: 1, runner_up_delta: 0, top4_delta: 0, counts_series: true, counts_season: true },
    ],
    eventRegistrations: [
      { id: "reg-a", event_id: EVENT_ID, player_id: "player-a", final_submission_id: null },
      { id: "reg-b", event_id: EVENT_ID, player_id: "player-b", final_submission_id: null },
    ],
    registrationSubmissions: [],
    teamSnapshots: [],
    teamSnapshotMembers: [],
  };
}

test("official Records require completed + record_applied_at and map placements by Player ID", () => {
  assert.equal(isOfficialNormalizedRecordsEvent(rawData().events[0]), true);
  assert.equal(isOfficialNormalizedRecordsEvent(rawData().events[1]), false);

  const snapshot = buildNormalizedRecordsProjection(legacyData(), rawData());
  assert.deepEqual(snapshot.normalized.eventIds, [EVENT_ID]);
  assert.equal(snapshot.profiles["player:player-a"].placements.filter((row) => row.eventId === EVENT_ID).length, 1);
  assert.equal(snapshot.profiles["player:player-a"].placements.at(-1).placement, "win");
  assert.equal(snapshot.profiles["player:player-b"].placements.at(-1).placement, "ru");
  assert.equal(snapshot.profiles["player:player-running"], undefined);
  assert.equal(snapshot.matches.filter((row) => row.eventId === EVENT_ID).length, 1);
});

test("linked legacy round and bracket are suppressed instead of double-counted", () => {
  const snapshot = buildNormalizedRecordsProjection(legacyData(), rawData());
  assert.equal(snapshot.archives.filter((row) => row.eventId === EVENT_ID || row.id === "linked-round").length, 1);
  assert.equal(snapshot.profiles["player:player-a"].placements.filter((row) => row.eventId === EVENT_ID).length, 1);
  assert.ok(snapshot.archives.some((row) => row.id === "legacy-round"));
});

test("RankingBaseline plus every ledger kind is summed with count flags and duplicate placement protection", () => {
  const snapshot = buildNormalizedRecordsProjection(legacyData(), rawData());
  const series = snapshot.ranking.series.find((item) => item.key === "era2");
  const season = snapshot.ranking.seasons.find((item) => item.id === SEASON_ID);
  const seriesAlpha = series.rows.find((row) => row.playerId === "player-a");
  const seasonAlpha = season.rows.find((row) => row.playerId === "player-a");

  assert.deepEqual(
    { points: seriesAlpha.points, win: seriesAlpha.win },
    { points: 115, win: 0 }
  );
  assert.deepEqual(
    { points: seasonAlpha.points, win: seasonAlpha.win },
    { points: 20, win: 0 }
  );
  assert.equal(snapshot.ranking.awardRows.length, 3);
  assert.equal(series.rows.some((row) => row.playerId === "player-running"), false);
});

test("same display_name Players remain separate profiles and legacy name history stays unresolved", () => {
  const raw = rawData();
  raw.players[1].display_name = "Alpha";
  const snapshot = buildNormalizedRecordsProjection(legacyData(), raw);

  assert.ok(snapshot.profiles["player:player-a"]);
  assert.ok(snapshot.profiles["player:player-b"]);
  assert.ok(snapshot.profiles["legacy:Alpha"]);
  assert.equal(snapshot.profiles["player:player-a"].playerId, "player-a");
  assert.equal(snapshot.profiles["player:player-b"].playerId, "player-b");
  assert.equal(snapshot.profiles["legacy:Alpha"].playerId, null);
});

test("Pokémon uses linked legacy party only until a final normalized TeamSnapshot exists", () => {
  const withoutSnapshot = buildNormalizedRecordsProjection(legacyData(), rawData());
  assert.ok(withoutSnapshot.rosters.some((row) => row.bracketId === "linked-bracket" && row.pokemon.includes("피카츄")));

  const raw = rawData();
  raw.eventRegistrations[0].final_submission_id = "submission-a";
  raw.registrationSubmissions = [{ id: "submission-a", registration_id: "reg-a", snapshot_id: "snapshot-a" }];
  raw.teamSnapshots = [{ id: "snapshot-a", schema_version: 1 }];
  raw.teamSnapshotMembers = [{ id: "member-a", snapshot_id: "snapshot-a", slot: 1, pokemon_name_snapshot: "이브이" }];
  const withSnapshot = buildNormalizedRecordsProjection(legacyData(), raw);

  assert.equal(withSnapshot.rosters.some((row) => row.bracketId === "linked-bracket"), false);
  assert.ok(withSnapshot.rosters.some((row) => row.snapshotId === "snapshot-a" && row.pokemon.includes("이브이")));
});
