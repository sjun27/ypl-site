import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketMatchSyncPlan,
  buildEventBracketMatchSnapshot,
} from "../src/services/bracketMatchSnapshot.js";

const participants = ["a", "b", "c", "d"].map(id => ({
  id,
  name: id.toUpperCase(),
  entryId: `entry-${id}`,
}));

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
