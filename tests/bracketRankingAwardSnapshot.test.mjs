import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketRankingAwardSyncPlan,
  buildEventRankingAwardSnapshot,
  getIndividualPlacementPointPolicy,
  getTeamPlacementPointPolicy,
} from "../src/services/bracketRankingAwardSnapshot.js";

const runtimeResults = [
  { id: "result-a", entry_id: "entry-a", placement_code: "champion", source: "legacy_bracket_runtime" },
  { id: "result-b", entry_id: "entry-b", placement_code: "runner_up", source: "legacy_bracket_runtime" },
  { id: "result-c", entry_id: "entry-c", placement_code: "semifinalist", source: "legacy_bracket_runtime" },
];

const entryParticipants = [
  { id: "ep-a", entry_id: "entry-a", player_id: "player-a" },
  { id: "ep-b", entry_id: "entry-b", player_id: "player-b" },
  { id: "ep-c", entry_id: "entry-c", player_id: "player-c" },
];

const event = (division, settings = {}) => ({
  event_type: "pokecup",
  division,
  is_team_event: false,
  competition_settings: settings,
});

const teamEvent = (division, settings = {}) => ({
  event_type: "pokecup",
  division,
  is_team_event: true,
  competition_settings: settings,
});

const teamResult = (id, entryId, placement_code) => ({
  id,
  entry_id: entryId,
  placement_code,
  source: "legacy_bracket_runtime",
});

const teamMembers = (entryId, count = 4) => Array.from({ length: count }, (_, index) => ({
  id: `${entryId}-participant-${index + 1}`,
  entry_id: entryId,
  player_id: `${entryId}-player-${index + 1}`,
  member_order: index + 1,
}));

test("Master placement policy is 60 / 40 / 20", () => {
  assert.deepEqual(getIndividualPlacementPointPolicy(event("master")).points, {
    win: 60,
    ru: 40,
    sf: 20,
  });
});

test("Light placement policy is 30 / 20 / 10 including legacy event_type fallback", () => {
  assert.deepEqual(getIndividualPlacementPointPolicy(event("light")).points, {
    win: 30,
    ru: 20,
    sf: 10,
  });
  assert.equal(getIndividualPlacementPointPolicy({
    event_type: "light",
    division: null,
    is_team_event: false,
    competition_settings: {},
  }).division, "light");
});

test("team placement preview policy is fixed per member with no semifinalist points", () => {
  assert.deepEqual(getTeamPlacementPointPolicy(teamEvent("master")).points, {
    win: 30,
    ru: 20,
    sf: 0,
  });
  assert.deepEqual(getTeamPlacementPointPolicy(teamEvent("light")).points, {
    win: 15,
    ru: 10,
    sf: 0,
  });
});

test("Rookie creates no RankingAward even if incorrectly enabled", () => {
  const rookie = event("rookie", { rankingEnabled: true });
  assert.equal(getIndividualPlacementPointPolicy(rookie).enabled, false);
  assert.deepEqual(
    buildEventRankingAwardSnapshot(rookie, runtimeResults, entryParticipants).rows,
    []
  );
});

test("rankingEnabled=false creates no RankingAward", () => {
  const disabled = event("master", { rankingEnabled: false });
  const snapshot = buildEventRankingAwardSnapshot(disabled, runtimeResults, entryParticipants);
  assert.equal(snapshot.reason, "ranking_disabled");
  assert.deepEqual(snapshot.rows, []);
});

test("maps champion, runner-up, and semifinalist deltas", () => {
  const snapshot = buildEventRankingAwardSnapshot(event("master"), runtimeResults, entryParticipants);
  assert.deepEqual(snapshot.rows.map(row => ({
    points: row.points_delta,
    win: row.win_delta,
    runnerUp: row.runner_up_delta,
    top4: row.top4_delta,
  })), [
    { points: 60, win: 1, runnerUp: 0, top4: 0 },
    { points: 40, win: 0, runnerUp: 1, top4: 0 },
    { points: 20, win: 0, runnerUp: 0, top4: 1 },
  ]);
});

test("Light halves points without halving placement counts", () => {
  const snapshot = buildEventRankingAwardSnapshot(event("light"), runtimeResults, entryParticipants);
  assert.deepEqual(snapshot.rows.map(row => [
    row.points_delta,
    row.win_delta,
    row.runner_up_delta,
    row.top4_delta,
  ]), [
    [30, 1, 0, 0],
    [20, 0, 1, 0],
    [10, 0, 0, 1],
  ]);
});

test("4-member Master champion team creates one 30-point Award per member with points only", () => {
  const snapshot = buildEventRankingAwardSnapshot(
    teamEvent("master"),
    [teamResult("team-result-a", "team-entry-a", "champion")],
    teamMembers("team-entry-a")
  );

  assert.equal(snapshot.rows.length, 4);
  assert.deepEqual(snapshot.rows.map(row => row.points_delta), [30, 30, 30, 30]);
  assert.ok(snapshot.rows.every(row =>
    row.win_delta === 0 &&
    row.runner_up_delta === 0 &&
    row.top4_delta === 0 &&
    row.counts_series === true &&
    row.counts_season === true
  ));
  assert.ok(snapshot.rows.every(row => row.result_id === "team-result-a"));
});

test("team Award points are fixed per member regardless of team size", () => {
  const awardPoints = (division, placement, count) => {
    const entryId = `team-entry-${division}-${placement}-${count}`;
    return buildEventRankingAwardSnapshot(
      teamEvent(division),
      [teamResult(`team-result-${entryId}`, entryId, placement)],
      teamMembers(entryId, count)
    ).rows.map(row => row.points_delta);
  };

  assert.deepEqual(awardPoints("master", "champion", 4), [30, 30, 30, 30]);
  assert.deepEqual(awardPoints("master", "champion", 2), [30, 30]);
  assert.deepEqual(awardPoints("master", "runner_up", 3), [20, 20, 20]);
  assert.deepEqual(awardPoints("light", "champion", 4), [15, 15, 15, 15]);
  assert.deepEqual(awardPoints("light", "runner_up", 2), [10, 10]);
});

test("team semifinalist Results create no RankingAward rows", () => {
  const entryId = "team-entry-semifinalist";
  const snapshot = buildEventRankingAwardSnapshot(
    teamEvent("master"),
    [teamResult("team-result-semifinalist", entryId, "semifinalist")],
    teamMembers(entryId, 4)
  );

  assert.equal(snapshot.skipped, false);
  assert.deepEqual(snapshot.rows, []);
});

test("multiple members create multiple Awards for one Team Result", () => {
  const snapshot = buildEventRankingAwardSnapshot(
    teamEvent("master"),
    [teamResult("team-result-a", "team-entry-a", "runner_up")],
    teamMembers("team-entry-a", 2)
  );

  assert.deepEqual(snapshot.rows.map(row => row.player_id), [
    "team-entry-a-player-1",
    "team-entry-a-player-2",
  ]);
  assert.ok(snapshot.rows.every(row => row.result_id === "team-result-a"));
});

test("team Result requires members and a unique Player identity for every member", () => {
  const result = teamResult("team-result-a", "team-entry-a", "champion");
  assert.throws(
    () => buildEventRankingAwardSnapshot(teamEvent("master"), [result], []),
    /최소 1명이어야 합니다/
  );

  const members = teamMembers("team-entry-a", 2);
  assert.throws(
    () => buildEventRankingAwardSnapshot(teamEvent("master"), [result], [
      { ...members[0], player_id: null },
      members[1],
    ]),
    /Player identity가 없습니다/
  );
  assert.throws(
    () => buildEventRankingAwardSnapshot(teamEvent("master"), [result], [
      members[0],
      { ...members[1], player_id: members[0].player_id },
    ]),
    /중복되어 있습니다/
  );
});

test("team rankingEnabled=false creates no RankingAward", () => {
  const snapshot = buildEventRankingAwardSnapshot(
    teamEvent("master", { rankingEnabled: false }),
    [teamResult("team-result-a", "team-entry-a", "champion")],
    teamMembers("team-entry-a")
  );

  assert.equal(snapshot.reason, "ranking_disabled");
  assert.deepEqual(snapshot.rows, []);
});

test("uses Result.entry_id to map exactly one EntryParticipant.player_id", () => {
  const [award] = buildEventRankingAwardSnapshot(
    event("master"),
    runtimeResults.slice(0, 1),
    entryParticipants
  ).rows;
  assert.equal(award.result_id, "result-a");
  assert.equal(award.player_id, "player-a");
  assert.equal(award.award_kind, "placement");
  assert.equal(award.counts_series, true);
  assert.equal(award.counts_season, true);
});

test("blocks a missing EntryParticipant", () => {
  assert.throws(
    () => buildEventRankingAwardSnapshot(event("master"), runtimeResults.slice(0, 1), []),
    /정확히 1명이어야 하지만 0명/
  );
});

test("blocks multiple EntryParticipants for an individual Result", () => {
  assert.throws(
    () => buildEventRankingAwardSnapshot(event("master"), runtimeResults.slice(0, 1), [
      entryParticipants[0],
      { id: "ep-a2", entry_id: "entry-a", player_id: "player-a2" },
    ]),
    /정확히 1명이어야 하지만 2명/
  );
});

const desiredAward = {
  result_id: "result-a",
  player_id: "player-a",
  award_kind: "placement",
  points_delta: 60,
  win_delta: 1,
  runner_up_delta: 0,
  top4_delta: 0,
  counts_series: true,
  counts_season: true,
  reason: "normalized bracket placement",
};

test("same desired snapshot is idempotent", () => {
  const existing = [{ id: "award-a", source: "legacy_bracket_runtime", ...desiredAward }];
  assert.deepEqual(
    buildBracketRankingAwardSyncPlan(existing, [desiredAward]),
    { inserts: [], updates: [], deleteIds: [] }
  );
});

test("team Result/Player keyed Award snapshot remains idempotent", () => {
  const desired = buildEventRankingAwardSnapshot(
    teamEvent("master"),
    [teamResult("team-result-a", "team-entry-a", "champion")],
    teamMembers("team-entry-a")
  ).rows;
  const existing = desired.map((row, index) => ({
    id: `team-award-${index + 1}`,
    source: "legacy_bracket_runtime",
    ...row,
  }));

  assert.deepEqual(
    buildBracketRankingAwardSyncPlan(existing, desired),
    { inserts: [], updates: [], deleteIds: [] }
  );
});

test("stale runtime placement is deleted", () => {
  const existing = [
    { id: "award-a", source: "legacy_bracket_runtime", ...desiredAward },
    { id: "award-b", source: "legacy_bracket_runtime", ...desiredAward, result_id: "result-b", player_id: "player-b" },
  ];
  assert.deepEqual(
    buildBracketRankingAwardSyncPlan(existing, [desiredAward]).deleteIds,
    ["award-b"]
  );
});

test("other source placement Award is protected and conflicts clearly", () => {
  assert.throws(
    () => buildBracketRankingAwardSyncPlan([
      { id: "historical", source: "legacy_tournament", ...desiredAward },
    ], [desiredAward]),
    /덮어쓸 수 없습니다/
  );
});

test("adjustment and reversal Awards are never cleanup targets", () => {
  const existing = [
    { id: "adjustment", source: "manual", award_kind: "adjustment", result_id: "result-a", player_id: "player-a" },
    { id: "reversal", source: "manual", award_kind: "reversal", result_id: "result-a", player_id: "player-a" },
    { id: "runtime", source: "legacy_bracket_runtime", ...desiredAward },
  ];
  const plan = buildBracketRankingAwardSyncPlan(existing, []);
  assert.deepEqual(plan.deleteIds, ["runtime"]);
});

test("future team Result can create placement Awards for different Players", () => {
  const secondPlayer = { ...desiredAward, player_id: "player-b", points_delta: 30 };
  const plan = buildBracketRankingAwardSyncPlan([], [desiredAward, secondPlayer]);
  assert.equal(plan.inserts.length, 2);
  assert.deepEqual(plan.inserts.map(row => row.player_id), ["player-a", "player-b"]);
});

test("duplicate Result/Player placement in one desired snapshot is rejected", () => {
  assert.throws(
    () => buildBracketRankingAwardSyncPlan([], [desiredAward, { ...desiredAward }]),
    /중복되어 있습니다/
  );
});

test("changed placement delta updates the existing runtime Award", () => {
  const existing = [{ id: "award-a", source: "legacy_bracket_runtime", ...desiredAward }];
  const changed = {
    ...desiredAward,
    points_delta: 40,
    win_delta: 0,
    runner_up_delta: 1,
  };
  const plan = buildBracketRankingAwardSyncPlan(existing, [changed]);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "award-a");
});

test("unsupported Champions and team Events create no Award", () => {
  assert.equal(getIndividualPlacementPointPolicy({
    event_type: "champions",
    division: "master",
    is_team_event: false,
    competition_settings: { rankingEnabled: true },
  }).enabled, false);
  assert.equal(getIndividualPlacementPointPolicy({
    ...event("master"),
    is_team_event: true,
  }).enabled, false);
});
