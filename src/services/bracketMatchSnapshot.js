export const LEGACY_BRACKET_RUNTIME_SOURCE = "legacy_bracket_runtime";

const BYE = "\u2205BYE";
const MATCH_FIELDS = [
  "match_kind",
  "round_number",
  "stage_label",
  "sequence_no",
  "entry_a_id",
  "entry_b_id",
  "player_a_id",
  "player_b_id",
  "winner_entry_id",
  "winner_player_id",
  "resolution",
  "played_at",
];

function normalizeNullable(value) {
  return value === undefined ? null : value;
}

function participantEntries(bracket) {
  return new Map(
    (bracket?.participants || [])
      .filter(participant => !Array.isArray(participant?.members))
      .filter(participant => participant?.id && participant?.entryId)
      .map(participant => [participant.id, participant.entryId])
  );
}

function makeSnapshotRow(match, participantA, participantB, entryByParticipantId, metadata) {
  if (!participantA || !participantB || participantA === BYE || participantB === BYE) return null;

  const entryA = entryByParticipantId.get(participantA);
  const entryB = entryByParticipantId.get(participantB);
  if (!entryA || !entryB || entryA === entryB) return null;

  const winnerEntry = match?.winner === "a"
    ? entryA
    : match?.winner === "b"
      ? entryB
      : null;

  return {
    source_node_key: match.id,
    match_kind: "bracket",
    round_number: metadata.roundNumber,
    stage_label: metadata.stageLabel,
    sequence_no: metadata.sequenceNo,
    entry_a_id: entryA,
    entry_b_id: entryB,
    player_a_id: null,
    player_b_id: null,
    winner_entry_id: winnerEntry,
    winner_player_id: null,
    resolution: winnerEntry ? "played" : "unknown",
  };
}

function graphNodes(graph, startSequence) {
  const nodes = [];
  let sequenceNo = startSequence;
  const double = graph?.kind === "double";

  for (const [roundIndex, round] of (graph?.rounds || []).entries()) {
    for (const match of round || []) {
      nodes.push({
        match,
        roundNumber: roundIndex + 1,
        stageLabel: `${double ? "승자조" : "본선"} ${roundIndex + 1}R`,
        sequenceNo: sequenceNo++,
      });
    }
  }

  for (const [roundIndex, round] of (graph?.lb || []).entries()) {
    for (const match of round || []) {
      nodes.push({
        match,
        roundNumber: roundIndex + 1,
        stageLabel: `패자조 ${roundIndex + 1}R`,
        sequenceNo: sequenceNo++,
      });
    }
  }

  if (graph?.gf) {
    nodes.push({
      match: graph.gf,
      roundNumber: null,
      stageLabel: "그랜드 파이널",
      sequenceNo: sequenceNo++,
    });
  }

  if (graph?.reset) {
    nodes.push({
      match: graph.reset,
      roundNumber: null,
      stageLabel: "리셋 파이널",
      sequenceNo: sequenceNo++,
      reset: true,
    });
  }

  return { nodes, nextSequence: sequenceNo };
}

function snapshotGraph(graph, entryByParticipantId, startSequence) {
  if (!graph) return { rows: [], nextSequence: startSequence };

  const winnerByMatchId = new Map();
  const loserByMatchId = new Map();
  const { nodes, nextSequence } = graphNodes(graph, startSequence);
  const rows = [];

  const resolveSlot = slot => {
    if (!slot) return null;
    if (slot.bye) return BYE;
    if (slot.pid) return slot.pid;
    if (slot.win) return winnerByMatchId.get(slot.win) ?? null;
    if (slot.lose) return loserByMatchId.get(slot.lose) ?? null;
    return null;
  };

  for (const node of nodes) {
    const { match } = node;
    const participantA = resolveSlot(match?.a);
    const participantB = resolveSlot(match?.b);
    let winner = null;
    let loser = null;

    if (match?.winner === "a") {
      winner = participantA;
      loser = participantB;
    } else if (match?.winner === "b") {
      winner = participantB;
      loser = participantA;
    } else if (participantA === BYE && participantB && participantB !== BYE) {
      winner = participantB;
      loser = BYE;
    } else if (participantB === BYE && participantA && participantA !== BYE) {
      winner = participantA;
      loser = BYE;
    } else if (participantA === BYE && participantB === BYE) {
      winner = BYE;
      loser = BYE;
    }

    winnerByMatchId.set(match?.id, winner);
    loserByMatchId.set(match?.id, loser);

    if (node.reset && graph.gf?.winner !== "b") continue;

    const row = makeSnapshotRow(match, participantA, participantB, entryByParticipantId, node);
    if (row) rows.push(row);
  }

  return { rows, nextSequence };
}

export function buildEventBracketMatchSnapshot(bracket) {
  const entryByParticipantId = participantEntries(bracket);
  const rows = [];
  let sequenceNo = 1;

  for (const group of bracket?.groups || []) {
    for (const match of group?.matches || []) {
      const row = makeSnapshotRow(
        match,
        match?.a?.pid || null,
        match?.b?.pid || null,
        entryByParticipantId,
        {
          roundNumber: null,
          stageLabel: `${group?.name || "?"}조`,
          sequenceNo,
        }
      );
      if (row) rows.push(row);
      sequenceNo += 1;
    }
  }

  const graphs = bracket?.format === "group"
    ? [bracket.knockout]
    : [bracket?.graph];

  for (const graph of graphs) {
    const snapshot = snapshotGraph(graph, entryByParticipantId, sequenceNo);
    rows.push(...snapshot.rows);
    sequenceNo = snapshot.nextSequence;
  }

  const sourceNodeKeys = new Set();
  for (const row of rows) {
    if (!row.source_node_key) throw new Error("normalized Match에 연결할 legacy match node id가 없습니다.");
    if (sourceNodeKeys.has(row.source_node_key)) {
      throw new Error(`legacy match node id '${row.source_node_key}'가 대진표에 중복되어 있습니다.`);
    }
    sourceNodeKeys.add(row.source_node_key);
  }

  return rows;
}

export function buildBracketMatchSyncPlan(existingRows = [], desiredRows = [], nowIso) {
  const existingByNodeKey = new Map();
  for (const row of existingRows || []) {
    if (!row?.source_node_key) continue;
    if (existingByNodeKey.has(row.source_node_key)) {
      throw new Error(`runtime Match '${row.source_node_key}'가 DB에 중복되어 있습니다.`);
    }
    existingByNodeKey.set(row.source_node_key, row);
  }

  const desiredNodeKeys = new Set();
  const inserts = [];
  const updates = [];

  for (const desired of desiredRows || []) {
    const nodeKey = desired?.source_node_key;
    if (!nodeKey) throw new Error("normalized Match snapshot에 source_node_key가 없습니다.");
    if (desiredNodeKeys.has(nodeKey)) {
      throw new Error(`normalized Match snapshot에 '${nodeKey}'가 중복되어 있습니다.`);
    }
    desiredNodeKeys.add(nodeKey);

    const existing = existingByNodeKey.get(nodeKey);
    const winnerChanged = Boolean(existing) &&
      normalizeNullable(existing.winner_entry_id) !== normalizeNullable(desired.winner_entry_id);
    const playedAt = desired.winner_entry_id
      ? (!existing || winnerChanged || !existing.played_at ? nowIso : existing.played_at)
      : null;
    const payload = { ...desired, played_at: playedAt };

    if (!existing) {
      inserts.push(payload);
      continue;
    }

    const changed = MATCH_FIELDS.some(field =>
      normalizeNullable(existing[field]) !== normalizeNullable(payload[field])
    );
    if (changed) updates.push({ id: existing.id, payload });
  }

  const deleteIds = (existingRows || [])
    .filter(row => row?.id && !desiredNodeKeys.has(row.source_node_key))
    .map(row => row.id);

  return { inserts, updates, deleteIds };
}
