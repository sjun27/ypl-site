import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketMatchSyncPlan,
  buildEventBracketMatchSnapshot,
  resolveBracketMatchParentIds,
} from "../src/services/bracketMatchSnapshot.js";

const participants = ["a", "b", "c", "d"].map(id => ({
  id,
  name: id.toUpperCase(),
  entryId: `entry-${id}`,
}));

const teamParticipants = ["a", "b", "c"].map(id => ({
  id: `team-${id}`,
  name: `${id.toUpperCase()}팀`,
  entryId: `team-entry-${id}`,
  members: [`${id}-one`, `${id}-two`],
  memberIdentities: [
    { name: `${id}-one`, playerId: `player-${id}-one`, memberOrder: 1, role: "captain" },
    { name: `${id}-two`, playerId: `player-${id}-two`, memberOrder: 2, role: null },
  ],
}));

function teamBracket(match) {
  return {
    mode: "team",
    format: "elim",
    participants: teamParticipants.map(participant => ({
      ...participant,
      members: [...participant.members],
      memberIdentities: participant.memberIdentities.map(identity => ({ ...identity })),
    })),
    graph: {
      kind: "single",
      rounds: [[match]],
    },
  };
}

test("single elimination excludes BYEs and unresolved future matches", () => {
  const bracket = {
    format: "elim",
    participants,
    graph: {
      kind: "single",
      rounds: [
        [
          { id: "m1", a: { pid: "a" }, b: { pid: "b" }, winner: null },
          { id: "m2", a: { pid: "c" }, b: { bye: true }, winner: "a" },
        ],
        [{ id: "m3", a: { win: "m1" }, b: { win: "m2" }, winner: null }],
      ],
    },
  };

  assert.deepEqual(buildEventBracketMatchSnapshot(bracket).map(row => row.source_node_key), ["m1"]);

  bracket.graph.rounds[0][0].winner = "b";
  const rows = buildEventBracketMatchSnapshot(bracket);
  assert.deepEqual(rows.map(row => row.source_node_key), ["m1", "m3"]);
  assert.equal(rows[0].winner_entry_id, "entry-b");
  assert.equal(rows[1].entry_a_id, "entry-b");
  assert.equal(rows[1].entry_b_id, "entry-c");
  assert.equal(rows[1].sequence_no, 3);
});

test("winner change updates the same node and clears played_at when cancelled", () => {
  const desired = [{
    source_node_key: "m1",
    match_kind: "bracket",
    round_number: 1,
    stage_label: "본선 1R",
    sequence_no: 1,
    entry_a_id: "entry-a",
    entry_b_id: "entry-b",
    player_a_id: null,
    player_b_id: null,
    winner_entry_id: "entry-b",
    winner_player_id: null,
    resolution: "played",
  }];
  const existing = [{
    id: "db-m1",
    ...desired[0],
    winner_entry_id: "entry-a",
    played_at: "2026-09-01T00:00:00.000Z",
  }];

  const changed = buildBracketMatchSyncPlan(existing, desired, "2026-09-03T00:00:00.000Z");
  assert.equal(changed.inserts.length, 0);
  assert.equal(changed.updates.length, 1);
  assert.equal(changed.updates[0].id, "db-m1");
  assert.equal(changed.updates[0].payload.played_at, "2026-09-03T00:00:00.000Z");

  const cancelledDesired = [{ ...desired[0], winner_entry_id: null, resolution: "unknown" }];
  const cancelled = buildBracketMatchSyncPlan(existing, cancelledDesired, "2026-09-03T00:00:00.000Z");
  assert.equal(cancelled.updates[0].payload.played_at, null);
});

test("unchanged winner reuses the row and preserves played_at", () => {
  const desired = [{
    source_node_key: "m1",
    match_kind: "bracket",
    round_number: 1,
    stage_label: "본선 1R",
    sequence_no: 1,
    entry_a_id: "entry-a",
    entry_b_id: "entry-b",
    player_a_id: null,
    player_b_id: null,
    winner_entry_id: "entry-a",
    winner_player_id: null,
    resolution: "played",
  }];
  const existing = [{ id: "db-m1", ...desired[0], played_at: "2026-09-01T00:00:00.000Z" }];

  const plan = buildBracketMatchSyncPlan(existing, desired, "2026-09-03T00:00:00.000Z");
  assert.deepEqual(plan, { inserts: [], updates: [], deleteIds: [] });
});

test("stale runtime nodes are deleted without inserting duplicate desired nodes", () => {
  const desired = [{
    source_node_key: "m1",
    match_kind: "bracket",
    round_number: 1,
    stage_label: "본선 1R",
    sequence_no: 1,
    entry_a_id: "entry-a",
    entry_b_id: "entry-b",
    player_a_id: null,
    player_b_id: null,
    winner_entry_id: null,
    winner_player_id: null,
    resolution: "unknown",
  }];
  const existing = [
    { id: "db-m1", ...desired[0], played_at: null },
    { id: "db-reset", ...desired[0], source_node_key: "reset", played_at: null },
  ];

  const plan = buildBracketMatchSyncPlan(existing, desired, "now");
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.deleteIds, ["db-reset"]);
});

test("downstream pairing change reuses its source node", () => {
  const bracket = {
    format: "elim",
    participants,
    graph: {
      kind: "single",
      rounds: [
        [
          { id: "m1", a: { pid: "a" }, b: { pid: "b" }, winner: "a" },
          { id: "m2", a: { pid: "c" }, b: { pid: "d" }, winner: "a" },
        ],
        [{ id: "m3", a: { win: "m1" }, b: { win: "m2" }, winner: null }],
      ],
    },
  };
  const before = buildEventBracketMatchSnapshot(bracket);
  const existing = before.map((row, index) => ({ id: `db-${index}`, ...row, played_at: row.winner_entry_id ? "old" : null }));

  bracket.graph.rounds[0][0].winner = "b";
  const after = buildEventBracketMatchSnapshot(bracket);
  const plan = buildBracketMatchSyncPlan(existing, after, "now");
  const downstream = plan.updates.find(update => update.payload.source_node_key === "m3");

  assert.equal(plan.inserts.length, 0);
  assert.equal(downstream.id, "db-2");
  assert.equal(downstream.payload.entry_a_id, "entry-b");
  assert.equal(downstream.payload.entry_b_id, "entry-c");
});

test("double elimination creates reset only while the loser-bracket winner activated it", () => {
  const graph = {
    kind: "double",
    rounds: [[{ id: "w1", a: { pid: "a" }, b: { pid: "b" }, winner: "a" }]],
    lb: [[{ id: "l1", a: { pid: "c" }, b: { pid: "d" }, winner: "a" }]],
    gf: { id: "gf", a: { win: "w1" }, b: { win: "l1" }, winner: "b" },
    reset: { id: "reset", a: { win: "w1" }, b: { win: "l1" }, winner: null },
  };
  const bracket = { format: "elim", participants, graph };

  assert.ok(buildEventBracketMatchSnapshot(bracket).some(row => row.source_node_key === "reset"));
  graph.gf.winner = "a";
  assert.ok(!buildEventBracketMatchSnapshot(bracket).some(row => row.source_node_key === "reset"));
});

test("group and knockout matches use deterministic labels and sequence numbers", () => {
  const bracket = {
    format: "group",
    participants,
    groups: [{
      name: "A",
      matches: [{ id: "g1", a: { pid: "a" }, b: { pid: "b" }, winner: null }],
    }],
    knockout: {
      kind: "single",
      rounds: [[{ id: "k1", a: { pid: "c" }, b: { pid: "d" }, winner: null }]],
    },
  };

  const rows = buildEventBracketMatchSnapshot(bracket);
  assert.deepEqual(rows.map(row => [row.source_node_key, row.stage_label, row.sequence_no]), [
    ["g1", "A조", 1],
    ["k1", "본선 1R", 2],
  ]);
});

test("team bracket creates Entry-linked parents and excludes BYEs and unresolved future matches", () => {
  const bracket = {
    mode: "team",
    format: "elim",
    participants: teamParticipants,
    graph: {
      kind: "single",
      rounds: [
        [
          { id: "tm1", a: { pid: "team-a" }, b: { pid: "team-b" }, winner: "b" },
          { id: "tm2", a: { pid: "team-c" }, b: { bye: true }, winner: "a" },
        ],
        [{ id: "tm3", a: { win: "tm1" }, b: { win: "tm2" }, winner: null }],
      ],
    },
  };

  const rows = buildEventBracketMatchSnapshot(bracket);
  assert.deepEqual(rows.map(row => row.source_node_key), ["tm1", "tm3"]);
  assert.deepEqual(rows[0], {
    source_node_key: "tm1",
    match_kind: "bracket",
    parent_match_id: null,
    round_number: 1,
    stage_label: "본선 1R",
    sequence_no: 1,
    entry_a_id: "team-entry-a",
    entry_b_id: "team-entry-b",
    player_a_id: null,
    player_b_id: null,
    winner_entry_id: "team-entry-b",
    winner_player_id: null,
    resolution: "played",
  });
  assert.equal(rows[1].entry_a_id, "team-entry-b");
  assert.equal(rows[1].entry_b_id, "team-entry-c");
});

test("team series maps lineup games and ace through stored member identities", () => {
  const bracket = teamBracket({
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "a",
    series: {
      lineupA: ["a-two", "a-one"],
      lineupB: ["b-two", "b-one"],
      games: ["a", "b"],
      ace: { a: "a-two", b: "b-two", winner: "a" },
    },
  });

  const rows = buildEventBracketMatchSnapshot(bracket);
  assert.deepEqual(rows.map(row => row.source_node_key), ["tm1", "tm1:bout:1", "tm1:bout:2", "tm1:ace"]);
  assert.deepEqual(rows.slice(1).map(row => [
    row.match_kind,
    row.parent_source_node_key,
    row.player_a_id,
    row.player_b_id,
    row.winner_player_id,
  ]), [
    ["team_bout", "tm1", "player-a-two", "player-b-two", "player-a-two"],
    ["team_bout", "tm1", "player-a-one", "player-b-one", "player-b-one"],
    ["ace", "tm1", "player-a-two", "player-b-two", "player-a-two"],
  ]);

  const resolved = resolveBracketMatchParentIds(rows.slice(1), [{ id: "db-parent", ...rows[0] }]);
  assert.ok(resolved.every(row => row.parent_match_id === "db-parent"));
  assert.ok(resolved.every(row => !("parent_source_node_key" in row)));
});

test("team winner edits update children and removed ace is planned as stale", () => {
  const match = {
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "a",
    series: {
      lineupA: ["a-one", "a-two"],
      lineupB: ["b-one", "b-two"],
      games: ["a", "b"],
      ace: { a: "a-one", b: "b-one", winner: "a" },
    },
  };
  const before = buildEventBracketMatchSnapshot(teamBracket(match));
  const parent = { id: "db-parent", ...before[0], played_at: "old" };
  const existingChildren = resolveBracketMatchParentIds(before.slice(1), [parent])
    .map((row, index) => ({ id: `db-child-${index + 1}`, ...row, played_at: "old" }));

  match.series.games[0] = "b";
  match.series.ace = null;
  const after = buildEventBracketMatchSnapshot(teamBracket(match));
  const desiredChildren = resolveBracketMatchParentIds(after.slice(1), [parent]);
  const plan = buildBracketMatchSyncPlan(existingChildren, desiredChildren, "now");

  assert.deepEqual(plan.deleteIds, ["db-child-3"]);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].payload.source_node_key, "tm1:bout:1");
  assert.equal(plan.updates[0].payload.winner_player_id, "player-b-one");
  assert.equal(plan.updates[0].payload.played_at, "now");
});

test("team child planning is idempotent and preserves played_at", () => {
  const rows = buildEventBracketMatchSnapshot(teamBracket({
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "a",
    series: { lineupA: ["a-one", "a-two"], lineupB: ["b-one", "b-two"], games: ["a", "b"], ace: null },
  }));
  const parent = { id: "db-parent", ...rows[0], played_at: "old" };
  const desired = resolveBracketMatchParentIds(rows.slice(1), [parent]);
  const existing = desired.map(row => ({ id: "db-child", ...row, played_at: "old" }));

  assert.deepEqual(buildBracketMatchSyncPlan(existing, desired, "now"), {
    inserts: [],
    updates: [],
    deleteIds: [],
  });
});

test("5 vs 4 persists the explicitly selected repeat player in the fifth stable bout", () => {
  const makeTeam = (id, count) => ({
    id: `team-${id}`,
    name: `${id.toUpperCase()}팀`,
    entryId: `team-entry-${id}`,
    members: Array.from({ length: count }, (_, index) => `${id}-${index + 1}`),
    memberIdentities: Array.from({ length: count }, (_, index) => ({
      name: `${id}-${index + 1}`,
      playerId: `player-${id}-${index + 1}`,
      memberOrder: index + 1,
      role: index === 0 ? "captain" : null,
    })),
  });
  const bracket = {
    mode: "team",
    format: "elim",
    participants: [makeTeam("a", 5), makeTeam("b", 4)],
    graph: {
      kind: "single",
      rounds: [[{
        id: "tm-uneven",
        a: { pid: "team-a" },
        b: { pid: "team-b" },
        winner: "a",
        series: {
          lineupA: ["a-1", "a-2", "a-3", "a-4", "a-5"],
          lineupB: ["b-1", "b-2", "b-3", "b-4", "b-2"],
          games: ["a", "b", "a", "b", "a"],
          ace: null,
        },
      }]],
    },
  };

  const children = buildEventBracketMatchSnapshot(bracket).filter(row => row.match_kind === "team_bout");
  assert.equal(children.length, 5);
  assert.deepEqual(children.map(row => row.source_node_key), [
    "tm-uneven:bout:1",
    "tm-uneven:bout:2",
    "tm-uneven:bout:3",
    "tm-uneven:bout:4",
    "tm-uneven:bout:5",
  ]);
  assert.equal(children[4].player_b_id, "player-b-2");
  assert.equal(children[1].player_b_id, "player-b-2");
});

test("changing one actual player updates only that stable bout and refreshes played_at", () => {
  const match = {
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "b",
    series: {
      lineupA: ["a-one", "a-two"],
      lineupB: ["b-one", "b-two"],
      games: ["b", "b"],
      ace: null,
    },
  };
  const before = buildEventBracketMatchSnapshot(teamBracket(match));
  const parent = { id: "db-parent", ...before[0], played_at: "old" };
  const existing = resolveBracketMatchParentIds(before.slice(1), [parent])
    .map((row, index) => ({ id: `db-child-${index + 1}`, ...row, played_at: "old" }));

  match.series.lineupA[1] = "a-one";
  const after = buildEventBracketMatchSnapshot(teamBracket(match));
  const desired = resolveBracketMatchParentIds(after.slice(1), [parent]);
  const plan = buildBracketMatchSyncPlan(existing, desired, "now");

  assert.equal(plan.inserts.length, 0);
  assert.deepEqual(plan.deleteIds, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "db-child-2");
  assert.equal(plan.updates[0].payload.player_a_id, "player-a-one");
  assert.equal(plan.updates[0].payload.winner_player_id, "player-b-two");
  assert.equal(plan.updates[0].payload.played_at, "now");
  assert.equal(existing[0].played_at, "old");
});

test("ace winner change updates the stable ace row without inserting a duplicate", () => {
  const match = {
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "a",
    series: {
      lineupA: ["a-one", "a-two"],
      lineupB: ["b-one", "b-two"],
      games: ["a", "b"],
      ace: { a: "a-one", b: "b-one", winner: "a" },
    },
  };
  const before = buildEventBracketMatchSnapshot(teamBracket(match));
  const parent = { id: "db-parent", ...before[0], played_at: "old" };
  const existingAce = {
    id: "db-ace",
    ...resolveBracketMatchParentIds(before.filter(row => row.match_kind === "ace"), [parent])[0],
    played_at: "old",
  };

  match.series.ace = { a: "a-two", b: "b-two", winner: "b" };
  const after = buildEventBracketMatchSnapshot(teamBracket(match));
  const desiredAce = resolveBracketMatchParentIds(after.filter(row => row.match_kind === "ace"), [parent]);
  const plan = buildBracketMatchSyncPlan([existingAce], desiredAce, "now");

  assert.equal(plan.inserts.length, 0);
  assert.deepEqual(plan.deleteIds, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "db-ace");
  assert.equal(plan.updates[0].payload.source_node_key, "tm1:ace");
  assert.equal(plan.updates[0].payload.player_a_id, "player-a-two");
  assert.equal(plan.updates[0].payload.player_b_id, "player-b-two");
  assert.equal(plan.updates[0].payload.winner_player_id, "player-b-two");
  assert.equal(plan.updates[0].payload.played_at, "now");
});

test("team series rejects missing or ambiguous stored member identity", () => {
  const match = {
    id: "tm1",
    a: { pid: "team-a" },
    b: { pid: "team-b" },
    winner: "a",
    series: { lineupA: ["a-one"], lineupB: ["b-one"], games: ["a"], ace: null },
  };
  const missing = teamBracket(match);
  missing.participants[0] = { ...missing.participants[0], memberIdentities: [] };
  assert.throws(
    () => buildEventBracketMatchSnapshot(missing),
    /확정 선수 순서 또는 Player identity/
  );

  const ambiguous = teamBracket(match);
  ambiguous.participants[0] = {
    ...ambiguous.participants[0],
    memberIdentities: [
      ...ambiguous.participants[0].memberIdentities,
      { name: "a-one", playerId: "duplicate-player", memberOrder: 3 },
    ],
  };
  assert.throws(
    () => buildEventBracketMatchSnapshot(ambiguous),
    /확정 선수 순서 또는 Player identity/
  );
});
