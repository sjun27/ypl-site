import { LEGACY_BRACKET_RUNTIME_SOURCE } from "./bracketMatchSnapshot.js";

export const RUNTIME_PLACEMENT_AWARD_REASON = "normalized bracket placement";

const PLACEMENT_POLICY = {
  master: {
    champion: { points_delta: 60, win_delta: 1, runner_up_delta: 0, top4_delta: 0 },
    runner_up: { points_delta: 40, win_delta: 0, runner_up_delta: 1, top4_delta: 0 },
    semifinalist: { points_delta: 20, win_delta: 0, runner_up_delta: 0, top4_delta: 1 },
  },
  light: {
    champion: { points_delta: 30, win_delta: 1, runner_up_delta: 0, top4_delta: 0 },
    runner_up: { points_delta: 20, win_delta: 0, runner_up_delta: 1, top4_delta: 0 },
    semifinalist: { points_delta: 10, win_delta: 0, runner_up_delta: 0, top4_delta: 1 },
  },
};

const AWARD_FIELDS = [
  "result_id",
  "player_id",
  "award_kind",
  "points_delta",
  "win_delta",
  "runner_up_delta",
  "top4_delta",
  "counts_series",
  "counts_season",
  "reason",
];

function eventDivision(event) {
  const division = String(event?.division || "").trim().toLowerCase();
  if (["master", "light", "rookie"].includes(division)) return division;

  const eventType = String(event?.event_type || "").trim().toLowerCase();
  if (eventType === "light") return "light";
  if (eventType === "rookie") return "rookie";
  if (eventType === "pokecup") return "master";
  return null;
}

function rankingEnabled(event, division) {
  const configured = event?.competition_settings?.rankingEnabled;
  if (typeof configured === "boolean") return configured;
  return division === "master" || division === "light";
}

export function getIndividualPlacementPointPolicy(event) {
  if (!event || event.is_team_event) {
    return { enabled: false, division: null, reason: "team_event", points: null };
  }

  if (String(event.event_type || "").toLowerCase() === "champions") {
    return { enabled: false, division: null, reason: "champions_event", points: null };
  }

  const division = eventDivision(event);
  if (!division) {
    return { enabled: false, division: null, reason: "unsupported_division", points: null };
  }
  if (division === "rookie") {
    return { enabled: false, division, reason: "rookie", points: { win: 0, ru: 0, sf: 0 } };
  }
  const placements = PLACEMENT_POLICY[division];
  const points = {
    win: placements.champion.points_delta,
    ru: placements.runner_up.points_delta,
    sf: placements.semifinalist.points_delta,
  };
  if (!rankingEnabled(event, division)) {
    return { enabled: false, division, reason: "ranking_disabled", points, placements };
  }

  return {
    enabled: true,
    division,
    reason: null,
    points,
    placements,
  };
}

export function buildEventRankingAwardSnapshot(event, resultRows = [], entryParticipants = []) {
  const policy = getIndividualPlacementPointPolicy(event);
  if (!policy.enabled) return { skipped: true, reason: policy.reason, rows: [] };

  const runtimeResults = (resultRows || [])
    .filter(row => row?.source === LEGACY_BRACKET_RUNTIME_SOURCE);
  const participantsByEntryId = new Map();
  for (const participant of entryParticipants || []) {
    if (!participant?.entry_id) continue;
    const rows = participantsByEntryId.get(participant.entry_id) || [];
    rows.push(participant);
    participantsByEntryId.set(participant.entry_id, rows);
  }

  const rows = runtimeResults.map(result => {
    if (!result?.id || !result?.entry_id) {
      throw new Error("runtime Result에 RankingAward 연결용 id 또는 entry_id가 없습니다.");
    }

    const participants = participantsByEntryId.get(result.entry_id) || [];
    if (participants.length !== 1) {
      throw new Error(
        `개인 Result '${result.id}'의 Entry '${result.entry_id}'에는 EntryParticipant가 정확히 1명이어야 하지만 ${participants.length}명입니다.`
      );
    }

    const playerId = participants[0]?.player_id;
    if (!playerId) {
      throw new Error(`개인 Result '${result.id}'의 EntryParticipant에 Player identity가 없습니다.`);
    }

    const placement = policy.placements[result.placement_code];
    if (!placement) {
      throw new Error(`지원하지 않는 runtime Result placement '${result.placement_code}'입니다.`);
    }

    return {
      result_id: result.id,
      player_id: playerId,
      award_kind: "placement",
      ...placement,
      counts_series: true,
      counts_season: true,
      reason: RUNTIME_PLACEMENT_AWARD_REASON,
    };
  });

  return { skipped: false, reason: null, rows };
}

function awardKey(row) {
  return `${row?.result_id || ""}|${row?.player_id || ""}`;
}

function normalizedValue(field, value) {
  if (["points_delta", "win_delta", "runner_up_delta", "top4_delta"].includes(field)) {
    return Number(value || 0);
  }
  if (["counts_series", "counts_season"].includes(field)) return Boolean(value);
  return value === undefined ? null : value;
}

export function samePlacementAwardValues(left, right) {
  return AWARD_FIELDS.every(field =>
    normalizedValue(field, left?.[field]) === normalizedValue(field, right?.[field])
  );
}

export function buildBracketRankingAwardSyncPlan(existingRows = [], desiredRows = []) {
  const runtimeRows = (existingRows || []).filter(row =>
    row?.source === LEGACY_BRACKET_RUNTIME_SOURCE && row?.award_kind === "placement"
  );
  const protectedPlacementRows = (existingRows || []).filter(row =>
    row?.award_kind === "placement" && row?.source !== LEGACY_BRACKET_RUNTIME_SOURCE
  );

  const protectedByKey = new Map(protectedPlacementRows.map(row => [awardKey(row), row]));
  const existingByKey = new Map();
  for (const row of runtimeRows) {
    const key = awardKey(row);
    if (!row?.result_id || !row?.player_id) continue;
    if (existingByKey.has(key)) {
      throw new Error(`runtime placement RankingAward '${key}'가 DB에 중복되어 있습니다.`);
    }
    existingByKey.set(key, row);
  }

  const desiredKeys = new Set();
  const inserts = [];
  const updates = [];

  for (const desired of desiredRows || []) {
    if (!desired?.result_id || !desired?.player_id) {
      throw new Error("RankingAward snapshot에 result_id 또는 player_id가 없습니다.");
    }
    if (desired.award_kind && desired.award_kind !== "placement") {
      throw new Error("runtime RankingAward snapshot에는 placement만 포함할 수 있습니다.");
    }
    if (desired.source && desired.source !== LEGACY_BRACKET_RUNTIME_SOURCE) {
      throw new Error("runtime RankingAward snapshot에 다른 source가 포함되어 있습니다.");
    }

    const key = awardKey(desired);
    if (desiredKeys.has(key)) {
      throw new Error(`RankingAward snapshot에 '${key}'가 중복되어 있습니다.`);
    }
    desiredKeys.add(key);

    const protectedRow = protectedByKey.get(key);
    if (protectedRow) {
      throw new Error(
        `Result/Player '${key}'에는 이미 '${protectedRow.source || "unknown"}' source placement Award가 있어 runtime Award로 덮어쓸 수 없습니다.`
      );
    }

    const payload = {
      ...(desired.id ? { id: desired.id } : {}),
      result_id: desired.result_id,
      player_id: desired.player_id,
      award_kind: "placement",
      points_delta: Number(desired.points_delta || 0),
      win_delta: Number(desired.win_delta || 0),
      runner_up_delta: Number(desired.runner_up_delta || 0),
      top4_delta: Number(desired.top4_delta || 0),
      counts_series: Boolean(desired.counts_series),
      counts_season: Boolean(desired.counts_season),
      reason: desired.reason ?? null,
      ...(desired.created_at ? { created_at: desired.created_at } : {}),
    };
    const existing = existingByKey.get(key);
    if (!existing) {
      inserts.push(payload);
    } else if (!samePlacementAwardValues(existing, payload)) {
      updates.push({ id: existing.id, payload });
    }
  }

  const deleteIds = runtimeRows
    .filter(row => row?.id && !desiredKeys.has(awardKey(row)))
    .map(row => row.id);

  return { inserts, updates, deleteIds };
}
