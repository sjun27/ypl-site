/**
 * Pure normalized bracket projection contracts.
 *
 * Phase A deliberately supports only an individual single-elimination Event.
 * The input is normalized domain data; no legacy Bracket graph is accepted or
 * consulted. The returned graph is an adapter-shaped view model for the
 * existing bracket components.
 *
 * Important boundary:
 * - Entry.seed is a seeding fact, not a bracket slot in this contract.
 * - bracket_entry_slots is the canonical persisted operator draw.
 * - Missing slot rows are deterministic BYEs; future nodes remain projection
 *   facts and are not persisted Match rows.
 */

export const SINGLE_BRACKET_PROJECTION_VERSION = 1;
export const SINGLE_BRACKET_MATCH_SOURCE_NODE_KEY = "single:r{round}:m{match}";

export const SINGLE_BRACKET_PROJECTION_CONTRACT = Object.freeze({
  version: SINGLE_BRACKET_PROJECTION_VERSION,
  supportedEvent: {
    isTeamEvent: false,
    competitionFormat: "single_elimination",
  },
  persistentFacts: Object.freeze({
    event: ["id", "name", "is_team_event", "competition_format", "status"],
    runtime: ["id", "event_id", "topology_kind", "projection_version"],
    entry: ["id", "event_id", "entry_type", "display_name", "status", "seed"],
    entryParticipant: [
      "id",
      "event_id",
      "entry_id",
      "registration_id",
      "player_id",
      "member_order",
      "role",
    ],
    entrySlot: [
      "bracket_runtime_id",
      "event_id",
      "stage_kind",
      "stage_no",
      "pool_no",
      "slot_no",
      "entry_id",
    ],
    match: [
      "id",
      "event_id",
      "match_kind",
      "source",
      "source_node_key",
      "entry_a_id",
      "entry_b_id",
      "winner_entry_id",
      "resolution",
      "played_at",
    ],
  }),
  generatedFacts: [
    "round topology",
    "future match nodes",
    "BYE slots",
    "winner-edge slot references",
  ],
  seedIsBracketSlot: false,
  nodeKeyPattern: SINGLE_BRACKET_MATCH_SOURCE_NODE_KEY,
});

const BYE = "\u2205BYE";

function fail(message) {
  throw new Error(`[single bracket projection] ${message}`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label}이(가) 없습니다.`);
  return value.trim();
}

function requireSame(value, expected, label) {
  if (value !== expected) fail(`${label}이(가) 일치하지 않습니다.`);
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function nodeKey(roundNumber, matchNumber) {
  return `single:r${roundNumber}:m${matchNumber}`;
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object") fail("Event가 없습니다.");
  const id = requireText(event.id, "Event id");
  requireSame(event.is_team_event, false, "개인전 Event 여부");
  requireSame(event.competition_format, "single_elimination", "competition_format");
  return {
    ...event,
    id,
    name: typeof event.name === "string" ? event.name : id,
  };
}

function normalizeEntries(eventId, entries) {
  const active = asArray(entries)
    .filter(entry => entry?.status !== "withdrawn")
    .map(entry => {
      if (!entry || typeof entry !== "object") fail("Entry row가 올바르지 않습니다.");
      const id = requireText(entry.id, "Entry id");
      requireSame(entry.event_id, eventId, `Entry '${id}'의 Event ownership`);
      requireSame(entry.entry_type, "individual", `Entry '${id}'의 entry_type`);
      if (entry.status && !["active", "withdrawn"].includes(entry.status)) {
        fail(`Entry '${id}'의 status가 올바르지 않습니다.`);
      }
      return {
        ...entry,
        id,
        display_name: requireText(entry.display_name, `Entry '${id}' display_name`),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const ids = new Set();
  for (const entry of active) {
    if (ids.has(entry.id)) fail(`Entry '${entry.id}'가 중복되어 있습니다.`);
    ids.add(entry.id);
  }
  if (active.length < 2) fail("single-elimination projection에는 active Entry가 2개 이상 필요합니다.");
  return active;
}

function normalizeEntryParticipants(eventId, entries, entryParticipants) {
  const entryIds = new Set(entries.map(entry => entry.id));
  const byEntryId = new Map();

  for (const row of asArray(entryParticipants)) {
    if (!row || typeof row !== "object") fail("EntryParticipant row가 올바르지 않습니다.");
    const id = requireText(row.id, "EntryParticipant id");
    requireSame(row.event_id, eventId, `EntryParticipant '${id}'의 Event ownership`);
    if (!entryIds.has(row.entry_id)) {
      if (row.entry_id) fail(`EntryParticipant '${id}'가 projection Entry에 속하지 않습니다.`);
      fail(`EntryParticipant '${id}'의 entry_id가 없습니다.`);
    }
    if (row.member_order !== undefined && row.member_order !== 1) {
      fail(`EntryParticipant '${id}'의 member_order는 개인전에서 1이어야 합니다.`);
    }
    if (byEntryId.has(row.entry_id)) {
      fail(`Entry '${row.entry_id}'에 EntryParticipant가 여러 개입니다.`);
    }
    byEntryId.set(row.entry_id, {
      ...row,
      id,
      member_order: row.member_order ?? 1,
    });
  }

  return entries.map(entry => {
    const participant = byEntryId.get(entry.id);
    if (!participant) fail(`Entry '${entry.id}'의 EntryParticipant가 없습니다.`);
    return participant;
  });
}

function normalizeEntrySlots(eventId, runtimeId, entries, entrySlots, size) {
  if (!Array.isArray(entrySlots) || entrySlots.length === 0) {
    fail("normalized Single projection에는 persisted entrySlots가 필요합니다.");
  }

  const entryIds = new Set(entries.map(entry => entry.id));
  const seenEntries = new Set();
  const seenSlots = new Set();
  const slotByNo = new Array(size + 1).fill(null);

  for (const row of entrySlots) {
    if (!row || typeof row !== "object") fail("bracket_entry_slots row가 올바르지 않습니다.");
    const entryId = requireText(row.entry_id, "bracket_entry_slots entry_id");
    requireSame(row.bracket_runtime_id, runtimeId, `Entry '${entryId}'의 bracket runtime ownership`);
    requireSame(row.event_id, eventId, `Entry '${entryId}'의 Event ownership`);
    requireSame(row.stage_kind, "elimination", `Entry '${entryId}'의 stage_kind`);
    requireSame(row.stage_no, 1, `Entry '${entryId}'의 stage_no`);
    requireSame(row.pool_no, 0, `Entry '${entryId}'의 pool_no`);

    if (!Number.isInteger(row.slot_no) || row.slot_no < 1 || row.slot_no > size) {
      fail(`Entry '${entryId}'의 slot_no가 bracket 범위를 벗어났습니다.`);
    }
    if (!entryIds.has(entryId)) fail(`bracket_entry_slots의 Entry '${entryId}'가 projection Entry와 일치하지 않습니다.`);
    if (seenEntries.has(entryId)) fail(`Entry '${entryId}'의 slot row가 중복되어 있습니다.`);
    if (seenSlots.has(row.slot_no)) fail(`slot_no '${row.slot_no}'가 중복되어 있습니다.`);

    seenEntries.add(entryId);
    seenSlots.add(row.slot_no);
    slotByNo[row.slot_no] = entryId;
  }

  if (seenEntries.size !== entries.length) {
    fail("active Entry마다 정확히 하나의 persisted slot row가 필요합니다.");
  }

  const slots = [];
  let byeCount = 0;
  for (let matchIndex = 0; matchIndex < size / 2; matchIndex += 1) {
    const left = slotByNo[matchIndex * 2 + 1];
    const right = slotByNo[matchIndex * 2 + 2];
    if (!left) byeCount += 1;
    if (!right) byeCount += 1;
    if (!left && !right) fail(`first-round node m${matchIndex + 1}에 double-BYE가 있습니다.`);
    slots.push([
      left ? { pid: left } : { bye: true },
      right ? { pid: right } : { bye: true },
    ]);
  }

  return { slots, byeCount };
}

function normalizeMatches(eventId, generatedNodeKeys, matches, entryIds) {
  const allowedKeys = new Set(generatedNodeKeys);
  const entryIdSet = new Set(entryIds);
  const byNodeKey = new Map();

  for (const row of asArray(matches)) {
    if (!row || typeof row !== "object") fail("Match row가 올바르지 않습니다.");
    const id = requireText(row.id, "Match id");
    requireSame(row.event_id, eventId, `Match '${id}'의 Event ownership`);
    requireSame(row.match_kind, "bracket", `Match '${id}'의 match_kind`);
    requireSame(row.source, "normalized_bracket_runtime", `Match '${id}'의 source`);
    const key = requireText(row.source_node_key, `Match '${id}' source_node_key`);
    if (!allowedKeys.has(key)) fail(`알 수 없는 Single bracket node key '${key}'입니다.`);
    if (byNodeKey.has(key)) fail(`Match node key '${key}'가 중복되어 있습니다.`);

    for (const field of ["entry_a_id", "entry_b_id"]) {
      if (!entryIdSet.has(row[field])) fail(`Match '${id}'의 ${field}가 projection Entry와 일치하지 않습니다.`);
    }
    if (row.entry_a_id === row.entry_b_id) fail(`Match '${id}'의 양쪽 Entry가 같습니다.`);
    if (row.winner_entry_id !== null && row.winner_entry_id !== undefined && !entryIdSet.has(row.winner_entry_id)) {
      fail(`Match '${id}'의 winner_entry_id가 projection Entry와 일치하지 않습니다.`);
    }
    if (
      row.winner_entry_id !== null &&
      row.winner_entry_id !== undefined &&
      row.winner_entry_id !== row.entry_a_id &&
      row.winner_entry_id !== row.entry_b_id
    ) {
      fail(`Match '${id}'의 winner_entry_id가 양쪽 Entry 중 하나가 아닙니다.`);
    }

    byNodeKey.set(key, row);
  }

  return byNodeKey;
}

function graphWinnerState(graph) {
  const winnerByNodeKey = new Map();
  const loserByNodeKey = new Map();
  const slotValue = slot => {
    if (!slot) return null;
    if (slot.bye) return BYE;
    if (slot.pid) return slot.pid;
    if (slot.win) return winnerByNodeKey.get(slot.win) ?? null;
    return null;
  };

  for (const round of graph.rounds) {
    for (const match of round) {
      const entryA = slotValue(match.a);
      const entryB = slotValue(match.b);
      let winner = null;
      let loser = null;

      if (match.winner === "a") {
        winner = entryA;
        loser = entryB;
      } else if (match.winner === "b") {
        winner = entryB;
        loser = entryA;
      } else if (entryA === BYE && entryB && entryB !== BYE) {
        winner = entryB;
        loser = BYE;
      } else if (entryB === BYE && entryA && entryA !== BYE) {
        winner = entryA;
        loser = BYE;
      } else if (entryA === BYE && entryB === BYE) {
        winner = BYE;
        loser = BYE;
      }

      winnerByNodeKey.set(match.id, winner);
      loserByNodeKey.set(match.id, loser);
    }
  }

  return { winnerByNodeKey, loserByNodeKey, slotValue };
}

/**
 * Evaluate a projected graph using the same adapter semantics as the current
 * bracket UI. It is pure and intentionally exported for projection tests and
 * the future normalized BracketBoard adapter.
 */
export function evaluateSingleEliminationGraph(graph) {
  if (!graph || graph.kind !== "single" || !Array.isArray(graph.rounds)) {
    fail("평가할 Single bracket graph가 올바르지 않습니다.");
  }
  return graphWinnerState(graph);
}

function buildGraph(entries, matchByNodeKey, firstRoundSlots) {
  const size = nextPowerOfTwo(entries.length);
  const { slots, byeCount } = firstRoundSlots;
  const rounds = [];
  const generatedNodeKeys = [];
  let previousRound = [];

  for (let roundNumber = 1, roundSize = size / 2; roundSize >= 1; roundNumber += 1, roundSize /= 2) {
    const round = [];
    for (let matchIndex = 1; matchIndex <= roundSize; matchIndex += 1) {
      const id = nodeKey(roundNumber, matchIndex);
      generatedNodeKeys.push(id);
      const firstRound = roundNumber === 1;
      const a = firstRound
        ? slots[matchIndex - 1][0]
        : { win: previousRound[(matchIndex - 1) * 2].id };
      const b = firstRound
        ? slots[matchIndex - 1][1]
        : { win: previousRound[(matchIndex - 1) * 2 + 1].id };
      const persisted = matchByNodeKey.get(id) || null;
      round.push({
        id,
        a,
        b,
        winner: null,
        normalizedMatchId: persisted?.id || null,
        resolution: persisted?.resolution || null,
        playedAt: persisted?.played_at || null,
      });
    }
    rounds.push(round);
    previousRound = round;
  }

  const graph = { kind: "single", rounds, size, byes: byeCount };
  const winnerByNodeKey = new Map();
  const slotValue = slot => {
    if (!slot) return null;
    if (slot.bye) return BYE;
    if (slot.pid) return slot.pid;
    if (slot.win) return winnerByNodeKey.get(slot.win) ?? null;
    return null;
  };

  // Overlay Match facts in topology order so a winner immediately becomes the
  // resolved participant of its downstream projection node.
  for (const round of rounds) {
    for (const match of round) {
      const persisted = matchByNodeKey.get(match.id) || null;
      const entryA = slotValue(match.a);
      const entryB = slotValue(match.b);
      if (persisted) {
        if (!entryA || !entryB || entryA === BYE || entryB === BYE) {
          fail(`Match '${persisted.id}'가 아직 성립하지 않은 projection node에 연결되어 있습니다.`);
        }
        if (persisted.entry_a_id !== entryA || persisted.entry_b_id !== entryB) {
          fail(`Match '${persisted.id}'의 양쪽 Entry가 deterministic topology와 다릅니다.`);
        }
        match.winner = persisted.winner_entry_id
          ? persisted.winner_entry_id === entryA ? "a" : "b"
          : null;
      } else if (entryA === BYE && entryB && entryB !== BYE) {
        match.winner = "b";
      } else if (entryB === BYE && entryA && entryA !== BYE) {
        match.winner = "a";
      } else if (entryA === BYE && entryB === BYE) {
        match.winner = "a";
      } else {
        match.winner = null;
      }

      if (match.winner === "a") winnerByNodeKey.set(match.id, entryA);
      else if (match.winner === "b") winnerByNodeKey.set(match.id, entryB);
      else if (entryA === BYE && entryB && entryB !== BYE) winnerByNodeKey.set(match.id, entryB);
      else if (entryB === BYE && entryA && entryA !== BYE) winnerByNodeKey.set(match.id, entryA);
      else if (entryA === BYE && entryB === BYE) winnerByNodeKey.set(match.id, BYE);
      else winnerByNodeKey.set(match.id, null);
    }
  }

  return graph;
}

function buildParticipants(entries, entryParticipants) {
  const participantByEntryId = new Map(entryParticipants.map(row => [row.entry_id, row]));
  return entries.map(entry => {
    const participant = participantByEntryId.get(entry.id);
    return {
      id: entry.id,
      name: entry.display_name,
      entryId: entry.id,
      entryParticipantId: participant.id,
      registrationId: participant.registration_id,
      playerId: participant.player_id,
      // Deliberately exposed as metadata only; it is not used for slot order.
      seed: entry.seed ?? null,
    };
  });
}

/**
 * Project normalized Event/Entry/EntryParticipant/Match rows into the shape
 * consumed by the existing bracket UI. The function never reads a legacy
 * Bracket object and never mutates its input.
 */
export function projectNormalizedSingleEliminationBracket({
  event,
  runtimeId,
  entries = [],
  entryParticipants = [],
  entrySlots,
  matches = [],
} = {}) {
  const normalizedEvent = normalizeEvent(event);
  const normalizedRuntimeId = requireText(runtimeId, "bracket runtime id");
  const normalizedEntries = normalizeEntries(normalizedEvent.id, entries);
  const normalizedParticipants = normalizeEntryParticipants(
    normalizedEvent.id,
    normalizedEntries,
    entryParticipants
  );
  const size = nextPowerOfTwo(normalizedEntries.length);
  const firstRoundSlots = normalizeEntrySlots(
    normalizedEvent.id,
    normalizedRuntimeId,
    normalizedEntries,
    entrySlots,
    size
  );
  const generatedNodeKeys = [];
  for (let roundSize = size / 2, roundNumber = 1; roundSize >= 1; roundSize /= 2, roundNumber += 1) {
    for (let matchNumber = 1; matchNumber <= roundSize; matchNumber += 1) {
      generatedNodeKeys.push(nodeKey(roundNumber, matchNumber));
    }
  }
  const matchByNodeKey = normalizeMatches(
    normalizedEvent.id,
    generatedNodeKeys,
    matches,
    normalizedEntries.map(entry => entry.id)
  );
  const graph = buildGraph(normalizedEntries, matchByNodeKey, firstRoundSlots);

  return {
    // Adapter identity is deterministic and is not a persisted legacy id.
    id: `normalized:event:${normalizedEvent.id}:single`,
    name: normalizedEvent.name,
    eventId: normalizedEvent.id,
    mode: "single",
    format: "elim",
    double: false,
    createdAt: normalizedEvent.created_at || null,
    status: normalizedEvent.status === "completed" ? "done" : "active",
    applied: null,
    participants: buildParticipants(normalizedEntries, normalizedParticipants),
    graph,
    groups: null,
    knockout: null,
    // Explicit boundary metadata for callers; not a catch-all runtime JSON.
    projection: {
      source: "normalized",
      version: SINGLE_BRACKET_PROJECTION_VERSION,
      topology: "single_elimination",
      runtimeId: normalizedRuntimeId,
      seedUsedAsSlot: false,
    },
  };
}
