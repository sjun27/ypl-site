import assert from "node:assert/strict";
import test from "node:test";

import {
  SINGLE_BRACKET_PROJECTION_CONTRACT,
  evaluateSingleEliminationGraph,
  projectNormalizedSingleEliminationBracket,
} from "../src/services/bracketProjection.js";

const EVENT_ID = "event-single-1";

function event(overrides = {}) {
  return {
    id: EVENT_ID,
    name: "Projection Single",
    is_team_event: false,
    competition_format: "single_elimination",
    status: "running",
    ...overrides,
  };
}

function inputs(count, { seedOffset = 0 } = {}) {
  const entries = Array.from({ length: count }, (_, index) => {
    const id = `entry-${String.fromCharCode(97 + index)}`;
    return {
      id,
      event_id: EVENT_ID,
      entry_type: "individual",
      display_name: `Player ${index + 1}`,
      status: "active",
      seed: seedOffset + index + 1,
    };
  });
  const entryParticipants = entries.map((entry, index) => ({
    id: `entry-participant-${index + 1}`,
    event_id: EVENT_ID,
    entry_id: entry.id,
    registration_id: `registration-${index + 1}`,
    player_id: `player-${index + 1}`,
    member_order: 1,
    role: null,
  }));
  return { entries, entryParticipants };
}

function match(nodeKey, entryA, entryB, winner = null, overrides = {}) {
  return {
    id: `match-${nodeKey}`,
    event_id: EVENT_ID,
    match_kind: "bracket",
    source: "normalized_bracket_runtime",
    source_node_key: nodeKey,
    entry_a_id: entryA,
    entry_b_id: entryB,
    winner_entry_id: winner,
    resolution: winner ? "played" : "unknown",
    played_at: winner ? "2026-09-05T00:00:00.000Z" : null,
    ...overrides,
  };
}

function project(count, matches = [], options = {}) {
  const { entries, entryParticipants } = inputs(count, options);
  return projectNormalizedSingleEliminationBracket({
    event: event(),
    entries,
    entryParticipants,
    matches,
  });
}

test("contract lists normalized facts and does not treat seed as bracket slot", () => {
  assert.equal(SINGLE_BRACKET_PROJECTION_CONTRACT.seedIsBracketSlot, false);
  assert.deepEqual(SINGLE_BRACKET_PROJECTION_CONTRACT.supportedEvent, {
    isTeamEvent: false,
    competitionFormat: "single_elimination",
  });
  assert.match(SINGLE_BRACKET_PROJECTION_CONTRACT.nodeKeyPattern, /^single:r/);
});

test("projects 2 entries into one deterministic match", () => {
  const result = project(2);
  assert.equal(result.graph.size, 2);
  assert.equal(result.graph.byes, 0);
  assert.deepEqual(result.graph.rounds.map(round => round.map(node => node.id)), [
    ["single:r1:m1"],
  ]);
  assert.deepEqual(result.graph.rounds[0][0].a, { pid: "entry-a" });
  assert.deepEqual(result.graph.rounds[0][0].b, { pid: "entry-b" });
});

test("projects 3 entries with one deterministic BYE", () => {
  const result = project(3);
  const firstRound = result.graph.rounds[0];
  assert.equal(result.graph.size, 4);
  assert.equal(result.graph.byes, 1);
  assert.deepEqual(firstRound[0].a, { pid: "entry-a" });
  assert.deepEqual(firstRound[0].b, { bye: true });
  assert.equal(firstRound[0].winner, "a");
  assert.deepEqual(firstRound[1].a, { pid: "entry-b" });
  assert.deepEqual(firstRound[1].b, { pid: "entry-c" });
  assert.deepEqual(result.graph.rounds[1][0].a, { win: "single:r1:m1" });
  assert.deepEqual(result.graph.rounds[1][0].b, { win: "single:r1:m2" });
});

test("projects 4 entries with a complete future node", () => {
  const result = project(4);
  assert.deepEqual(result.graph.rounds.map(round => round.length), [2, 1]);
  assert.equal(result.graph.rounds[1][0].winner, null);
  assert.equal(result.graph.rounds[1][0].normalizedMatchId, null);
});

test("projects 5 and 6 entries with deterministic BYE counts", () => {
  const five = project(5);
  const six = project(6);
  assert.deepEqual([five.graph.size, five.graph.byes], [8, 3]);
  assert.deepEqual([six.graph.size, six.graph.byes], [8, 2]);
  assert.equal(five.graph.rounds[0].filter(node => node.winner === "a").length, 3);
  assert.equal(six.graph.rounds[0].filter(node => node.winner === "a").length, 2);
});

test("same normalized facts produce byte-for-byte equivalent topology despite input order", () => {
  const base = inputs(6);
  const first = projectNormalizedSingleEliminationBracket({
    event: event(),
    entries: base.entries,
    entryParticipants: base.entryParticipants,
    matches: [],
  });
  const second = projectNormalizedSingleEliminationBracket({
    event: event(),
    entries: [...base.entries].reverse(),
    entryParticipants: [...base.entryParticipants].reverse(),
    matches: [],
  });
  assert.deepEqual(second, first);
});

test("winner overlay uses normalized Match facts and preserves downstream node keys", () => {
  const matches = [
    match("single:r1:m1", "entry-a", "entry-b", "entry-a"),
    match("single:r1:m2", "entry-c", "entry-d", "entry-c"),
    match("single:r2:m1", "entry-a", "entry-c", null),
  ];
  const result = project(4, matches);
  const first = result.graph.rounds[0];
  const final = result.graph.rounds[1][0];
  assert.deepEqual(first.map(node => node.winner), ["a", "a"]);
  assert.deepEqual([final.a, final.b], [
    { win: "single:r1:m1" },
    { win: "single:r1:m2" },
  ]);
  assert.equal(final.normalizedMatchId, "match-single:r2:m1");
  assert.equal(final.winner, null);
  const evaluated = evaluateSingleEliminationGraph(result.graph);
  assert.equal(evaluated.winnerByNodeKey.get("single:r2:m1"), null);
});

test("winner cancellation removes the winner overlay and leaves future node unresolved", () => {
  const result = project(4, [
    match("single:r1:m1", "entry-a", "entry-b", null),
    match("single:r1:m2", "entry-c", "entry-d", "entry-d"),
  ]);
  assert.deepEqual(result.graph.rounds[0].map(node => node.winner), [null, "b"]);
  assert.equal(result.graph.rounds[1][0].winner, null);
  const evaluated = evaluateSingleEliminationGraph(result.graph);
  assert.equal(evaluated.winnerByNodeKey.get("single:r1:m1"), null);
  assert.equal(evaluated.winnerByNodeKey.get("single:r2:m1"), null);
});

test("winner changes overlay a different side without changing downstream topology", () => {
  const changed = project(4, [
    match("single:r1:m1", "entry-a", "entry-b", "entry-b"),
    match("single:r1:m2", "entry-c", "entry-d", "entry-c"),
    match("single:r2:m1", "entry-b", "entry-c", "entry-b"),
  ]);
  assert.equal(changed.graph.rounds[0][0].winner, "b");
  assert.equal(changed.graph.rounds[1][0].winner, "a");
  assert.deepEqual(changed.graph.rounds[1][0].a, { win: "single:r1:m1" });
});

test("rejects a Match whose node key or Entry sides disagree with deterministic topology", () => {
  assert.throws(
    () => project(4, [match("legacy-random-id", "entry-a", "entry-b", "entry-a")]),
    /알 수 없는 Single bracket node key/
  );
  assert.throws(
    () => project(4, [match("single:r1:m1", "entry-a", "entry-c", "entry-a")]),
    /deterministic topology/
  );
});

test("returns the legacy UI-compatible adapter shape without reading a legacy graph", () => {
  const result = project(2);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "applied",
      "createdAt",
      "double",
      "eventId",
      "format",
      "graph",
      "groups",
      "id",
      "knockout",
      "mode",
      "name",
      "participants",
      "projection",
      "status",
    ].sort()
  );
  assert.deepEqual(Object.keys(result.participants[0]).sort(), [
    "entryId",
    "entryParticipantId",
    "id",
    "name",
    "playerId",
    "registrationId",
    "seed",
  ].sort());
  assert.equal(result.projection.source, "normalized");
  assert.equal(result.projection.seedUsedAsSlot, false);
});

