import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketRankingAwardSyncPlan,
  buildEventRankingAwardSnapshot,
  getIndividualPlacementPointPolicy,
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
