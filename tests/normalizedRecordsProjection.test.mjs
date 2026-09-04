import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNormalizedRecordsProjection,
  isOfficialNormalizedRecordsEvent,
} from "../src/services/normalizedRecordsProjection.js";
import { buildRecordsSnapshot, displayRecordMeta, displayTeamName } from "../src/services/recordsAnalytics.js";

const EVENT_ID = "event-official";
const SEASON_ID = "season-3";
const TEAM_EVENT_ID = "event-team-official";

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

function teamRawData() {
  const raw = rawData();
  raw.events.push({
    id: TEAM_EVENT_ID,
    season_id: SEASON_ID,
    name: "YPL 팀전",
    event_type: "pokecup",
    division: "master",
    regulation_id: "m-b",
    cup_rule_id: "none",
    competition_format: "double_elimination",
    is_team_event: true,
    held_on: "2026-09-06",
    date_precision: "exact",
    status: "completed",
    record_applied_at: "2026-09-06T00:00:00Z",
  });

  const teams = [
    ["a", "Team Alpha", "champion"],
    ["b", "Team Beta", "runner_up"],
    ["c", "Team Gamma", "semifinalist"],
    ["d", "Team Delta", "semifinalist"],
  ];
  for (const [teamId, teamName] of teams) {
    const entryId = `team-entry-${teamId}`;
    raw.entries.push({ id: entryId, event_id: TEAM_EVENT_ID, entry_type: "team", display_name: teamName, status: "active" });
    for (const [memberOrder, suffix] of ["1", "2"].entries()) {
      const playerId = `player-team-${teamId}-${suffix}`;
      raw.players.push({ id: playerId, display_name: `${teamId.toUpperCase()}${suffix}` });
      raw.eventRegistrations.push({
        id: `registration-team-${teamId}-${suffix}`,
        event_id: TEAM_EVENT_ID,
        player_id: playerId,
        final_submission_id: null,
      });
      raw.entryParticipants.push({
        id: `entry-participant-team-${teamId}-${suffix}`,
        event_id: TEAM_EVENT_ID,
        entry_id: entryId,
        registration_id: `registration-team-${teamId}-${suffix}`,
        player_id: playerId,
        member_order: memberOrder + 1,
        role: memberOrder === 0 ? "captain" : "member",
      });
    }
    const resultId = `result-team-${teamId}`;
    raw.results.push({
      id: resultId,
      event_id: TEAM_EVENT_ID,
      entry_id: entryId,
      placement_code: teams.find(([id]) => id === teamId)[2],
      placement_label: teams.find(([id]) => id === teamId)[2] === "champion" ? "우승" : teams.find(([id]) => id === teamId)[2] === "runner_up" ? "준우승" : "4강",
      rank_min: teamId === "a" ? 1 : teamId === "b" ? 2 : 3,
    });

    if (teamId === "a" || teamId === "b") {
      const points = teamId === "a" ? 30 : 20;
      for (const suffix of ["1", "2"]) {
        raw.rankingAwards.push({
          id: `award-team-${teamId}-${suffix}`,
          event_id: TEAM_EVENT_ID,
          player_id: `player-team-${teamId}-${suffix}`,
          result_id: resultId,
          award_kind: "placement",
          points_delta: points,
          win_delta: 0,
          runner_up_delta: 0,
          top4_delta: 0,
          counts_series: true,
          counts_season: true,
        });
      }
    }
  }

  raw.matches.push(
    {
      id: "team-parent-match",
      event_id: TEAM_EVENT_ID,
      match_kind: "bracket",
      entry_a_id: "team-entry-a",
      entry_b_id: "team-entry-b",
      winner_entry_id: "team-entry-a",
      resolution: "played",
      source: "legacy_bracket_runtime",
      source_node_key: "gf",
    },
    {
      id: "team-bout-match",
      event_id: TEAM_EVENT_ID,
      match_kind: "team_bout",
      parent_match_id: "team-parent-match",
      entry_a_id: "team-entry-a",
      entry_b_id: "team-entry-b",
      winner_entry_id: "team-entry-a",
      resolution: "played",
      source: "legacy_bracket_runtime",
      source_node_key: "gf:bout:1",
    },
    {
      id: "team-ace-match",
      event_id: TEAM_EVENT_ID,
      match_kind: "ace",
      parent_match_id: "team-parent-match",
      entry_a_id: "team-entry-a",
      entry_b_id: "team-entry-b",
      winner_entry_id: "team-entry-a",
      resolution: "played",
      source: "legacy_bracket_runtime",
      source_node_key: "gf:ace",
    }
  );

  return raw;
}

function teamLegacyData() {
  const legacy = legacyData();
  legacy.tournaments[0].rounds.push({
    id: "linked-team-round",
    date: "2026.09.06",
    round: "team-1",
    season: "YPL 시즌 3",
    win: "Team Alpha",
    winMembers: ["A1", "A2"],
    ru: "Team Beta",
    ruMembers: ["B1", "B2"],
    sf: ["Team Gamma", "Team Delta"],
    sfMembers: [["C1", "C2"], ["D1", "D2"]],
    team: true,
    recordMeta: { eventId: TEAM_EVENT_ID },
  });
  legacy.brackets.push({
    id: "linked-team-bracket",
    eventId: TEAM_EVENT_ID,
    name: "linked team",
    mode: "team",
    format: "elim",
    participants: [
      { id: "legacy-team-a", name: "Team Alpha", members: ["A1", "A2"], memberParties: { A1: "피카츄", A2: "라이츄" } },
      { id: "legacy-team-b", name: "Team Beta", members: ["B1", "B2"], memberParties: { B1: "꼬부기", B2: "어니부기" } },
    ],
    graph: {
      rounds: [[{
        id: "legacy-team-final",
        a: { pid: "legacy-team-a" },
        b: { pid: "legacy-team-b" },
        winner: "a",
        series: { lineupA: ["A1"], lineupB: ["B1"], games: ["a"], ace: { a: "A1", b: "B1", winner: "a" } },
      }]],
    },
    applied: { tournamentKey: "pylite", date: "2026.09.06", season: "YPL 시즌 3", roundId: "linked-team-round" },
  });
  return legacy;
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

test("normalized team Results expand to member history and team archive without individual counts", () => {
  const snapshot = buildNormalizedRecordsProjection(teamLegacyData(), teamRawData());
  assert.deepEqual(snapshot.normalized.eventIds, [EVENT_ID, TEAM_EVENT_ID]);

  const champion = snapshot.profiles["player:player-team-a-1"];
  const runnerUp = snapshot.profiles["player:player-team-b-1"];
  const semifinalist = snapshot.profiles["player:player-team-c-1"];
  assert.equal(champion.placements.filter((row) => row.eventId === TEAM_EVENT_ID).length, 1);
  assert.deepEqual(
    champion.placements.find((row) => row.eventId === TEAM_EVENT_ID),
    {
      id: `${TEAM_EVENT_ID}:entry-participant-team-a-1`,
      eventId: TEAM_EVENT_ID,
      tournamentKey: "master",
      tournamentName: "마스터 리그",
      eventName: "YPL 팀전",
      date: "2026.09.06",
      round: "",
      season: "YPL 시즌 3",
      seasonId: SEASON_ID,
      series: "ypl",
      rule: "m-b · none",
      championSeries: false,
      team: true,
      mode: "team",
      format: "double_elimination",
      source: "normalized",
      entryId: "team-entry-a",
      playerId: "player-team-a-1",
      name: "A1",
      teamName: "Team Alpha",
      placement: "win",
      resultLabel: "팀 우승",
      resultRank: 1,
    }
  );
  assert.equal(runnerUp.placements.find((row) => row.eventId === TEAM_EVENT_ID).resultLabel, "팀 준우승");
  assert.equal(semifinalist.placements.find((row) => row.eventId === TEAM_EVENT_ID).resultLabel, "팀 4강");
  assert.equal(displayRecordMeta(champion.placements.find((row) => row.eventId === TEAM_EVENT_ID).rule), "");
  for (const teamId of ["a", "b", "c", "d"]) {
    for (const suffix of ["1", "2"]) {
      const profile = snapshot.profiles[`player:player-team-${teamId}-${suffix}`];
      assert.equal(profile.history.filter((row) => row.eventId === TEAM_EVENT_ID).length, 1);
    }
  }
  assert.equal(champion.history.filter((row) => row.team && row.placement === "win").length, 1);
  assert.equal(champion.history.filter((row) => row.bracketId === "linked-team-bracket").length, 0);
  assert.equal(snapshot.participations.filter((row) => row.bracketId === "linked-team-bracket").length, 0);

  const championTrainer = snapshot.trainers.find((row) => row.playerId === "player-team-a-1");
  assert.deepEqual(
    { wins: championTrainer.wins, runnerUps: championTrainer.runnerUps, top4: championTrainer.top4 },
    { wins: 0, runnerUps: 0, top4: 0 }
  );
  const individualTrainer = snapshot.trainers.find((row) => row.playerId === "player-a");
  assert.equal(individualTrainer.wins, 1);

  const archive = snapshot.archives.find((row) => row.id === TEAM_EVENT_ID);
  assert.equal(archive.team, true);
  assert.equal(archive.win, "Team Alpha");
  assert.deepEqual(archive.winMembers, ["A1", "A2"]);
  assert.deepEqual(archive.ru, ["Team Beta"]);
  assert.deepEqual(archive.ruMembers, ["B1", "B2"]);
  assert.deepEqual(archive.sf, ["Team Gamma", "Team Delta"]);
  assert.deepEqual(archive.sfMembers, [["C1", "C2"], ["D1", "D2"]]);
  assert.equal(archive.source, "normalized");
  assert.equal(displayRecordMeta(archive.rule), "");
  assert.equal(snapshot.archives.some((row) => row.id === "linked-team-round"), false);
  assert.ok(snapshot.rosters.some((row) => row.bracketId === "linked-team-bracket" && row.owner === "A1"));
  assert.ok(snapshot.pokemon.find((row) => row.name === "피카츄").trainers.some((row) => row.name === "A1"));
  assert.ok(snapshot.matches.some((row) => row.bracketId === "linked-team-bracket" && row.teamMatch === true));
  assert.equal(snapshot.matches.some((row) => row.eventId === TEAM_EVENT_ID), false);
});

test("team RankingAwards use ledger points and never add placement counts", () => {
  const snapshot = buildNormalizedRecordsProjection(teamLegacyData(), teamRawData());
  const series = snapshot.ranking.series.find((item) => item.key === "era2");
  const season = snapshot.ranking.seasons.find((item) => item.id === SEASON_ID);
  const seriesChampion = series.rows.find((row) => row.playerId === "player-team-a-1");
  const seriesRunnerUp = series.rows.find((row) => row.playerId === "player-team-b-1");
  const seasonChampion = season.rows.find((row) => row.playerId === "player-team-a-1");
  assert.deepEqual(
    { points: seriesChampion.points, win: seriesChampion.win, ru: seriesChampion.ru, top4: seriesChampion.top4 },
    { points: 30, win: 0, ru: 0, top4: 0 }
  );
  assert.equal(seriesRunnerUp.points, 20);
  assert.equal(seasonChampion.points, 30);
  assert.equal(series.rows.some((row) => row.playerId === "player-team-c-1"), false);
});

test("team Light RankingAwards keep fixed points per member", () => {
  const raw = teamRawData();
  raw.events.find((event) => event.id === TEAM_EVENT_ID).division = "light";
  for (const award of raw.rankingAwards.filter((row) => row.event_id === TEAM_EVENT_ID)) {
    award.points_delta = award.player_id.includes("-a-") ? 15 : 10;
  }
  const snapshot = buildNormalizedRecordsProjection(teamLegacyData(), raw);
  const series = snapshot.ranking.series.find((item) => item.key === "era2");
  assert.equal(series.rows.find((row) => row.playerId === "player-team-a-1").points, 15);
  assert.equal(series.rows.find((row) => row.playerId === "player-team-b-1").points, 10);
});

test("legacy team placement remains in history but is excluded from trainer counts", () => {
  const legacy = legacyData();
  legacy.tournaments[0].rounds.push({
    id: "legacy-only-team-round",
    date: "2024.01",
    round: "1",
    season: "YPL 시즌 1",
    win: "Legacy Team",
    winMembers: ["Legacy Team Member"],
    ru: "",
    ruMembers: [],
    sf: [],
    sfMembers: [],
    team: true,
  });
  legacy.brackets.push({
    id: "legacy-only-team-bracket",
    eventId: "legacy-only-team-event",
    name: "legacy-only team",
    mode: "team",
    format: "elim",
    participants: [
      { id: "legacy-only-team-a", name: "Legacy Only Team", members: ["Legacy Bracket Member"] },
      { id: "legacy-only-team-b", name: "Legacy Other Team", members: ["Legacy Other Member"] },
    ],
    graph: {
      rounds: [[{ id: "legacy-only-team-final", a: { pid: "legacy-only-team-a" }, b: { pid: "legacy-only-team-b" }, winner: "a" }]],
    },
    applied: { tournamentKey: "pylite", date: "2024.02", season: "YPL 시즌 1" },
  });
  const snapshot = buildRecordsSnapshot(legacy);
  const profile = snapshot.profiles["Legacy Team Member"];
  const trainer = snapshot.trainers.find((row) => row.name === "Legacy Team Member");
  const legacyBracketProfile = snapshot.profiles["Legacy Bracket Member"];
  assert.equal(profile.placements[0].team, true);
  assert.equal(profile.history[0].resultLabel, "팀 우승");
  assert.ok(snapshot.archives.some((row) => row.id === "legacy-only-team-round"));
  assert.equal(legacyBracketProfile.history.filter((row) => row.team && row.placement === "win").length, 1);
  assert.deepEqual(
    { wins: trainer.wins, runnerUps: trainer.runnerUps, top4: trainer.top4 },
    { wins: 0, runnerUps: 0, top4: 0 }
  );
});

test("Records display helpers hide raw metadata and format numeric team names", () => {
  assert.equal(displayTeamName("1"), "1팀");
  assert.equal(displayTeamName("1팀"), "1팀");
  assert.equal(displayTeamName("Alpha"), "Alpha");
  assert.equal(displayTeamName("none"), "");
  assert.equal(displayTeamName(null), "");
  assert.equal(displayRecordMeta("m-a"), "");
  assert.equal(displayRecordMeta("m-b · none"), "");
  assert.equal(displayRecordMeta("bo3 · m-b · none"), "bo3");
  assert.equal(displayRecordMeta("single elimination"), "single elimination");
  assert.equal(displayRecordMeta(undefined), "");
});
