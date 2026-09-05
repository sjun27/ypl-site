import assert from "node:assert/strict";
import test from "node:test";

import {
  SINGLE_BRACKET_PROJECTION_CONTRACT,
  evaluateSingleEliminationGraph,
  projectNormalizedSingleEliminationBracket,
} from "../src/services/bracketProjection.js";

const EVENT_ID = "event-single-1";
const RUNTIME_ID = "runtime-single-1";

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

function inputs(count, { seedOffset = 0, slotEntryIds } = {}) {
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
  const size = 2 ** Math.ceil(Math.log2(count));
  const slotIds = slotEntryIds ? [...slotEntryIds] : Array(size).fill(null);
  if (!slotEntryIds) {
    const byeCount = size - count;
    let entryIndex = 0;
    for (let matchIndex = 0; matchIndex < size / 2; matchIndex += 1) {
      if (matchIndex < byeCount) {
        slotIds[matchIndex * 2] = entries[entryIndex].id;
        entryIndex += 1;
      } else {
        slotIds[matchIndex * 2] = entries[entryIndex].id;
        slotIds[matchIndex * 2 + 1] = entries[entryIndex + 1].id;
        entryIndex += 2;
      }
    }
  }
  const entrySlots = slotIds
    .map((entryId, index) => entryId ? {
      bracket_runtime_id: RUNTIME_ID,
      event_id: EVENT_ID,
      stage_kind: "elimination",
      stage_no: 1,
      pool_no: 0,
      slot_no: index + 1,
      entry_id: entryId,
    } : null)
    .filter(Boolean);
  return { entries, entryParticipants, entrySlots };
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
  const { entries, entryParticipants, entrySlots } = inputs(count, options);
  return projectNormalizedSingleEliminationBracket({
    event: event(),
    runtimeId: RUNTIME_ID,
    entries,
    entryParticipants,
    entrySlots,
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
  const result = project(3, [], {
    slotEntryIds: ["entry-a", "entry-b", "entry-c", null],
  });
  const firstRound = result.graph.rounds[0];
  assert.equal(result.graph.size, 4);
  assert.equal(result.graph.byes, 1);
  assert.deepEqual(firstRound[0].a, { pid: "entry-a" });
  assert.deepEqual(firstRound[0].b, { pid: "entry-b" });
  assert.equal(firstRound[0].winner, null);
  assert.deepEqual(firstRound[1].a, { pid: "entry-c" });
  assert.deepEqual(firstRound[1].b, { bye: true });
  assert.equal(firstRound[1].winner, "a");
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
    runtimeId: RUNTIME_ID,
    entries: base.entries,
    entryParticipants: base.entryParticipants,
    entrySlots: base.entrySlots,
    matches: [],
  });
  const second = projectNormalizedSingleEliminationBracket({
    event: event(),
    runtimeId: RUNTIME_ID,
    entries: [...base.entries].reverse(),
    entryParticipants: [...base.entryParticipants].reverse(),
    entrySlots: [...base.entrySlots].reverse(),
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

test("uses persisted draw slots even when they differ from Entry-id order", () => {
  const result = project(3, [], {
    slotEntryIds: ["entry-b", "entry-c", "entry-a", null],
  });
  assert.deepEqual(result.graph.rounds[0].map(node => [node.a, node.b]), [
    [{ pid: "entry-b" }, { pid: "entry-c" }],
    [{ pid: "entry-a" }, { bye: true }],
  ]);
});

test("reproduces the B2B3 A/B/C draw regardless of Entry array order", () => {
  const base = inputs(3, { slotEntryIds: ["entry-a", "entry-b", "entry-c", null] });
  const result = projectNormalizedSingleEliminationBracket({
    event: event(),
    runtimeId: RUNTIME_ID,
    entries: [base.entries[2], base.entries[0], base.entries[1]],
    entryParticipants: [base.entryParticipants[2], base.entryParticipants[0], base.entryParticipants[1]],
    entrySlots: [...base.entrySlots].reverse(),
    matches: [],
  });
  assert.deepEqual(result.graph.rounds[0].map(node => [node.a, node.b]), [
    [{ pid: "entry-a" }, { pid: "entry-b" }],
    [{ pid: "entry-c" }, { bye: true }],
  ]);
});

test("rejects a missing persisted slot set instead of falling back to Entry ids", () => {
  const base = inputs(2);
  assert.throws(
    () => projectNormalizedSingleEliminationBracket({
      event: event(),
      runtimeId: RUNTIME_ID,
      entries: base.entries,
      entryParticipants: base.entryParticipants,
      matches: [],
    }),
    /persisted entrySlots/
  );
});

test("rejects malformed persisted slots", () => {
  const base = inputs(3);
  const cases = [
    ["missing Entry", base.entrySlots.slice(0, 2), /정확히 하나/],
    ["duplicate Entry", [...base.entrySlots, { ...base.entrySlots[0], slot_no: 4 }], /중복/],
    ["duplicate slot", [...base.entrySlots, { ...base.entrySlots[2], entry_id: "entry-c", slot_no: 2 }], /중복/],
    ["out of range", base.entrySlots.map(row => row.entry_id === "entry-c" ? { ...row, slot_no: 5 } : row), /범위를/],
    ["unknown Entry", [...base.entrySlots.slice(0, 2), { ...base.entrySlots[2], entry_id: "entry-unknown" }], /일치하지/],
    ["wrong stage", base.entrySlots.map(row => ({ ...row, stage_kind: "group" })), /일치하지/],
    ["wrong stage number", base.entrySlots.map(row => ({ ...row, stage_no: 2 })), /일치하지/],
    ["wrong pool", base.entrySlots.map(row => ({ ...row, pool_no: 1 })), /일치하지/],
    ["foreign event", base.entrySlots.map(row => ({ ...row, event_id: "other-event" })), /일치하지/],
    ["foreign runtime", base.entrySlots.map(row => ({ ...row, bracket_runtime_id: "other-runtime" })), /일치하지/],
  ];
  for (const [, entrySlots, pattern] of cases) {
    assert.throws(
      () => projectNormalizedSingleEliminationBracket({
        event: event(),
        runtimeId: RUNTIME_ID,
        entries: base.entries,
        entryParticipants: base.entryParticipants,
        entrySlots,
        matches: [],
      }),
      pattern
    );
  }
});

test("rejects a first-round double-BYE draw", () => {
  const base = inputs(5, { slotEntryIds: ["entry-a", "entry-b", null, null, "entry-c", "entry-d", "entry-e", null] });
  assert.throws(
    () => projectNormalizedSingleEliminationBracket({
      event: event(),
      runtimeId: RUNTIME_ID,
      entries: base.entries,
      entryParticipants: base.entryParticipants,
      entrySlots: base.entrySlots,
      matches: [],
    }),
    /double-BYE/
  );
});

test("requires normalized Match source and validates its sides against persisted topology", () => {
  assert.throws(
    () => project(2, [match("single:r1:m1", "entry-a", "entry-b", null, { source: "legacy" })]),
    /source.*일치하지 않습니다/
  );
  assert.throws(
    () => project(3, [match("single:r1:m1", "entry-b", "entry-a")], {
      slotEntryIds: ["entry-a", "entry-b", "entry-c", null],
    }),
    /deterministic topology/
  );
});
