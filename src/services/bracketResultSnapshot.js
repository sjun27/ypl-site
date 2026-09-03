import { LEGACY_BRACKET_RUNTIME_SOURCE } from "./bracketMatchSnapshot.js";

const RESULT_FIELDS = [
  "placement_code",
  "rank_min",
  "rank_max",
  "placement_label",
];

function normalizeNullable(value) {
  return value === undefined ? null : value;
}

export function bracketResultIdentityState(bracket) {
  if (!bracket?.eventId) return { eligible: false, reason: "event_unlinked" };
  if (bracket.mode === "team") return { eligible: false, reason: "team_event" };

  const participants = (bracket.participants || [])
    .filter(participant => !Array.isArray(participant?.members));
  if (!participants.length) return { eligible: false, reason: "legacy_bracket" };

  const entryLinkedCount = participants.filter(participant => participant?.entryId).length;
  if (!entryLinkedCount) return { eligible: false, reason: "legacy_bracket" };
  if (entryLinkedCount !== participants.length) {
    throw new Error("일부 참가자에게만 Entry identity가 있어 normalized Result를 동기화할 수 없습니다.");
  }

  const entryIds = participants.map(participant => participant.entryId);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error("동일한 Entry identity가 대진표 참가자 두 명 이상에게 연결되어 있습니다.");
  }

  return { eligible: true, participants };
}

export function buildEventBracketResultSnapshot(bracket, result) {
  const identityState = bracketResultIdentityState(bracket);
  if (!identityState.eligible) {
    return { skipped: true, reason: identityState.reason, rows: [] };
  }

  if (!result?.champ) {
    throw new Error("normalized Result를 만들 최종 우승자가 없습니다.");
  }

  const participantById = new Map(
    identityState.participants.map(participant => [participant.id, participant])
  );
  const placements = [
    {
      participantId: result.champ,
      placement_code: "champion",
      rank_min: 1,
      rank_max: 1,
      placement_label: "우승",
    },
    ...(result.ru ? [{
      participantId: result.ru,
      placement_code: "runner_up",
      rank_min: 2,
      rank_max: 2,
      placement_label: "준우승",
    }] : []),
    ...(result.sf || []).filter(Boolean).map(participantId => ({
      participantId,
      placement_code: "semifinalist",
      rank_min: 3,
      rank_max: 4,
      placement_label: "4강",
    })),
  ];

  const entryIds = new Set();
  const rows = placements.map(placement => {
    const participant = participantById.get(placement.participantId);
    if (!participant?.entryId) {
      throw new Error(`입상자 '${placement.participantId}'의 Entry identity를 찾을 수 없습니다.`);
    }
    if (entryIds.has(participant.entryId)) {
      throw new Error(`입상 결과에 Entry '${participant.entryId}'가 중복되어 있습니다.`);
    }
    entryIds.add(participant.entryId);

    const { participantId: _participantId, ...resultFields } = placement;
    return { entry_id: participant.entryId, ...resultFields };
  });

  return { skipped: false, rows };
}

export function buildBracketResultSyncPlan(existingRows = [], desiredRows = []) {
  const runtimeRows = (existingRows || [])
    .filter(row => row?.source === LEGACY_BRACKET_RUNTIME_SOURCE);
  const protectedRows = (existingRows || [])
    .filter(row => row?.source !== LEGACY_BRACKET_RUNTIME_SOURCE);

  const protectedByEntryId = new Map(
    protectedRows.filter(row => row?.entry_id).map(row => [row.entry_id, row])
  );
  const existingByEntryId = new Map();
  for (const row of runtimeRows) {
    if (!row?.entry_id) continue;
    if (existingByEntryId.has(row.entry_id)) {
      throw new Error(`runtime Result Entry '${row.entry_id}'가 DB에 중복되어 있습니다.`);
    }
    existingByEntryId.set(row.entry_id, row);
  }

  const desiredEntryIds = new Set();
  const inserts = [];
  const updates = [];

  for (const desired of desiredRows || []) {
    const entryId = desired?.entry_id;
    if (!entryId) throw new Error("normalized Result snapshot에 entry_id가 없습니다.");
    if (desired.source && desired.source !== LEGACY_BRACKET_RUNTIME_SOURCE) {
      throw new Error("runtime Result snapshot에 다른 source가 포함되어 있습니다.");
    }
    if (desiredEntryIds.has(entryId)) {
      throw new Error(`normalized Result snapshot에 Entry '${entryId}'가 중복되어 있습니다.`);
    }
    desiredEntryIds.add(entryId);

    const protectedRow = protectedByEntryId.get(entryId);
    if (protectedRow) {
      throw new Error(
        `Entry '${entryId}'에는 이미 '${protectedRow.source || "unknown"}' source Result가 있어 runtime Result로 덮어쓸 수 없습니다.`
      );
    }

    const existing = existingByEntryId.get(entryId);
    if (!existing) {
      inserts.push({
        ...(desired.id ? { id: desired.id } : {}),
        entry_id: entryId,
        ...Object.fromEntries(RESULT_FIELDS.map(field => [field, normalizeNullable(desired[field])])),
        ...(desired.created_at ? { created_at: desired.created_at } : {}),
        ...(desired.updated_at ? { updated_at: desired.updated_at } : {}),
      });
      continue;
    }

    const changed = RESULT_FIELDS.some(field =>
      normalizeNullable(existing[field]) !== normalizeNullable(desired[field])
    );
    if (changed) {
      updates.push({
        id: existing.id,
        payload: {
          entry_id: entryId,
          ...Object.fromEntries(RESULT_FIELDS.map(field => [field, normalizeNullable(desired[field])])),
          ...(desired.updated_at ? { updated_at: desired.updated_at } : {}),
        },
      });
    }
  }

  const deleteIds = runtimeRows
    .filter(row => row?.id && !desiredEntryIds.has(row.entry_id))
    .map(row => row.id);

  return { inserts, updates, deleteIds };
}
