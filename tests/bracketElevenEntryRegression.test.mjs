import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBracketMatchSyncPlan,
  buildEventBracketMatchSnapshot,
} from "../src/services/bracketMatchSnapshot.js";

const BYE = "∅BYE";
const slotNumbers = [1, 3, 5, 6, 7, 9, 10, 11, 13, 15, 16];
const participants = slotNumbers.map((slot, index) => ({
  id: `p${index + 1}`,
  name: `P${index + 1}`,
  entryId: `entry-${index + 1}`,
  slot,
}));

function singleFixture(prefix = "single") {
  const bySlot = new Map(participants.map(row => [row.slot, row.id]));
  const rounds = [];
  rounds.push(Array.from({ length: 8 }, (_, index) => {
    const a = bySlot.get(index * 2 + 1);
    const b = bySlot.get(index * 2 + 2);
    return {
      id: `${prefix}:r1:m${index + 1}`,
      a: a ? { pid: a } : { bye: true },
      b: b ? { pid: b } : { bye: true },
      winner: a && !b ? "a" : !a && b ? "b" : null,
    };
  }));
  for (let round = 2, count = 4; count >= 1; round += 1, count /= 2) {
    rounds.push(Array.from({ length: count }, (_, index) => ({
      id: `${prefix}:r${round}:m${index + 1}`,
      a: { win: rounds[round - 2][index * 2].id },
      b: { win: rounds[round - 2][index * 2 + 1].id },
      winner: null,
    })));
  }
  return { kind: "single", rounds, size: 16, byes: 5 };
}

function doubleFixture() {
  const single = singleFixture("double:w");
  const W = single.rounds;
  const L = [];
  let previous = [];
  let serial = 0;
  const id = label => `double:${label}:${++serial}`;
  const first = [];
  for (let index = 0; index < W[0].length; index += 2) {
    first.push({ id: id("l1"), a: { lose: W[0][index].id }, b: { lose: W[0][index + 1].id }, winner: null });
  }
  L.push(first);
  previous = first;
  let drop = 0;
  for (let winnerRound = 1; winnerRound < W.length - 1; winnerRound += 1) {
    drop += 1;
    const length = previous.length;
    const half = Math.floor(length / 2);
    const dropIndex = index => drop % 2 === 1 ? length - 1 - index : (index + half) % length;
    const major = previous.map((match, index) => ({
      id: id("major"), a: { win: match.id }, b: { lose: W[winnerRound][dropIndex(index)].id }, winner: null,
    }));
    L.push(major);
    if (major.length > 1) {
      const minor = [];
      for (let index = 0; index < major.length; index += 2) {
        minor.push({ id: id("minor"), a: { win: major[index].id }, b: { win: major[index + 1].id }, winner: null });
      }
      L.push(minor);
      previous = minor;
    } else previous = major;
  }
  const lowerFinal = { id: id("lower-final"), a: { win: previous[0].id }, b: { lose: W.at(-1)[0].id }, winner: null };
  L.push([lowerFinal]);
  return {
    kind: "double",
    rounds: W,
    lb: L,
    gf: { id: "double:gf", a: { win: W.at(-1)[0].id }, b: { win: lowerFinal.id }, winner: null },
    reset: { id: "double:reset", a: { win: W.at(-1)[0].id }, b: { win: lowerFinal.id }, winner: null },
    size: 16,
    byes: 5,
  };
}

function graphMatches(graph) {
  return [
    ...graph.rounds.flat(),
    ...(graph.lb || []).flat(),
    ...(graph.gf ? [graph.gf] : []),
    ...(graph.reset ? [graph.reset] : []),
  ];
}

function resolveGraph(graph) {
  const winners = new Map();
  const losers = new Map();
  const slot = value => value?.bye ? BYE : value?.pid || (value?.win ? winners.get(value.win) : value?.lose ? losers.get(value.lose) : null) || null;
  for (const match of graphMatches(graph)) {
    const a = slot(match.a);
    const b = slot(match.b);
    if (!match.winner && a && b && a !== BYE && b !== BYE && match.id !== graph.reset?.id) {
      match.winner = "a";
      return true;
    }
    const winner = match.winner === "a" ? a : match.winner === "b" ? b : a === BYE ? b : b === BYE ? a : null;
    const loser = match.winner === "a" ? b : match.winner === "b" ? a : a === BYE || b === BYE ? BYE : null;
    winners.set(match.id, winner);
    losers.set(match.id, loser);
  }
  return false;
}

function bracket(graph) {
  return { format: "elim", participants: participants.map(({ slot, ...row }) => row), graph };
}

test("11-entry Single materializes the multi-BYE formed closure and supports winner change/cancel", () => {
  const graph = singleFixture();
  const initial = buildEventBracketMatchSnapshot(bracket(graph));
  assert.equal(participants.length, 11);
  assert.equal(graph.size, 16);
  assert.equal(graph.byes, 5);
  assert.deepEqual(initial.map(row => row.source_node_key), [
    "single:r1:m3", "single:r1:m5", "single:r1:m8", "single:r2:m1",
  ]);
  assert.ok(initial.every(row => row.entry_a_id && row.entry_b_id));

  graph.rounds[0][2].winner = "a";
  const selected = buildEventBracketMatchSnapshot(bracket(graph));
  assert.ok(selected.some(row => row.source_node_key === "single:r2:m2"));
  graph.rounds[0][2].winner = "b";
  const changed = buildBracketMatchSyncPlan(selected.map((row, index) => ({ id: `db-${index}`, ...row })), buildEventBracketMatchSnapshot(bracket(graph)), "now");
  assert.ok(changed.updates.some(row => row.payload.source_node_key === "single:r1:m3"));
  graph.rounds[0][2].winner = null;
  const cancelled = buildEventBracketMatchSnapshot(bracket(graph));
  assert.ok(!cancelled.some(row => row.source_node_key === "single:r2:m2"));
  assert.ok(cancelled.some(row => row.source_node_key === "single:r2:m1"));

  let guard = 0;
  while (resolveGraph(graph) && guard++ < 32) {}
  assert.ok(graph.rounds.at(-1)[0].winner, "11-entry Single should progress to a champion");
});

test("11-entry Double snapshot persists only formed real Matches and progresses without future/BYE rows", () => {
  const graph = doubleFixture();
  const initial = buildEventBracketMatchSnapshot(bracket(graph));
  assert.equal(graph.size, 16);
  assert.equal(graph.byes, 5);
  assert.ok(initial.some(row => row.source_node_key === "double:w:r2:m1"));
  assert.ok(initial.every(row => row.entry_a_id && row.entry_b_id && row.entry_a_id !== row.entry_b_id));

  let guard = 0;
  while (resolveGraph(graph) && guard++ < 64) {}
  assert.equal(graph.gf.winner, "a");
  assert.equal(graph.reset.winner, null);
  const completed = buildEventBracketMatchSnapshot(bracket(graph));
  assert.ok(completed.some(row => row.source_node_key === "double:gf"));
  assert.ok(!completed.some(row => row.source_node_key === "double:reset"));
  assert.ok(completed.every(row => row.entry_a_id && row.entry_b_id));
});
