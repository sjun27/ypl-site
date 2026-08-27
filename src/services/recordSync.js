const EPS = 1e-9;

const num = (value) => Number(value || 0);
const clean = (value) => String(value || "").trim();

function cloneData(data) {
  return {
    ...data,
    tournaments: (data.tournaments || []).map((t) => ({ ...t, rounds: [...(t.rounds || [])] })),
    rankings: (data.rankings || []).map((r) => ({ ...r, rows: [...(r.rows || [])] })),
    seasons: (data.seasons || []).map((s) => ({ ...s, rows: [...(s.rows || [])] })),
    brackets: (data.brackets || []).map((b) => ({ ...b })),
  };
}

function isZeroRow(row) {
  return Math.abs(num(row.win)) < EPS && Math.abs(num(row.ru)) < EPS &&
    Math.abs(num(row.top4)) < EPS && Math.abs(num(row.points)) < EPS;
}

function adjustRows(rows, deltas, sign, wasNew = {}) {
  let next = [...(rows || [])];
  for (const [name, delta] of Object.entries(deltas || {})) {
    if (!clean(name)) continue;
    const index = next.findIndex((row) => clean(row.name) === clean(name));
    if (index < 0) {
      if (sign < 0) continue;
      next.push({
        name,
        win: num(delta.win),
        ru: num(delta.ru),
        top4: num(delta.top4),
        points: num(delta.points),
      });
      continue;
    }
    const row = next[index];
    const updated = {
      ...row,
      win: num(row.win) + sign * num(delta.win),
      ru: num(row.ru) + sign * num(delta.ru),
      top4: num(row.top4) + sign * num(delta.top4),
      points: num(row.points) + sign * num(delta.points),
    };
    if (sign < 0 && wasNew?.[name] && isZeroRow(updated)) {
      next = next.filter((_, i) => i !== index);
    } else {
      next = next.map((item, i) => i === index ? updated : item);
    }
  }
  return next;
}

function statsReverse(data, meta) {
  let next = cloneData(data);
  if (meta?.willRank && meta.rankKey) {
    next.rankings = next.rankings.map((era) => era.key !== meta.rankKey ? era : {
      ...era,
      rows: adjustRows(era.rows, meta.deltas, -1, meta.rankWasNew),
    });
  }
  if (meta?.willSeason && meta.season) {
    next.seasons = next.seasons.map((season) => season.name !== meta.season ? season : {
      ...season,
      rows: adjustRows(season.rows, meta.deltas, -1, meta.seasonWasNew),
    });
  }
  return next;
}

function statsApply(data, meta) {
  let next = cloneData(data);
  if (meta?.willRank && meta.rankKey) {
    next.rankings = next.rankings.map((era) => era.key !== meta.rankKey ? era : {
      ...era,
      rows: adjustRows(era.rows, meta.deltas, +1),
    });
  }
  if (meta?.willSeason && meta.season) {
    next.seasons = next.seasons.map((season) => season.name !== meta.season ? season : {
      ...season,
      rows: adjustRows(season.rows, meta.deltas, +1),
    });
  }
  return next;
}

function addDelta(target, name, delta) {
  name = clean(name);
  if (!name) return;
  const cur = target[name] || { win: 0, ru: 0, top4: 0, points: 0 };
  target[name] = {
    win: cur.win + num(delta.win),
    ru: cur.ru + num(delta.ru),
    top4: cur.top4 + num(delta.top4),
    points: cur.points + num(delta.points),
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || "").split(/[,/\n]/).map(clean).filter(Boolean);
}

function distribute(target, members, totalPoints) {
  const names = splitList(members);
  if (!names.length) return;
  const each = Math.round((num(totalPoints) / names.length) * 10) / 10;
  names.forEach((name) => addDelta(target, name, { points: each }));
}

function buildDeltasFromRound(round, meta) {
  const points = meta?.pointConfig || { win: 60, ru: 40, sf: 20 };
  const deltas = {};
  if (round.team) {
    distribute(deltas, round.winMembers, points.win);
    distribute(deltas, round.ruMembers, points.ru);
    (round.sfMembers || []).forEach((members) => distribute(deltas, members, points.sf));
  } else {
    addDelta(deltas, round.win, { win: 1, points: points.win });
    addDelta(deltas, round.ru, { ru: 1, points: points.ru });
    splitList(round.sf).forEach((name) => addDelta(deltas, name, { top4: 1, points: points.sf }));
  }
  return deltas;
}

function placementSignature(round) {
  return JSON.stringify({
    team: !!round.team,
    champ: !!round.champ,
    season: clean(round.season),
    win: clean(round.win),
    ru: clean(round.ru),
    sf: splitList(round.sf),
    winMembers: splitList(round.winMembers),
    ruMembers: splitList(round.ruMembers),
    sfMembers: (round.sfMembers || []).map(splitList),
  });
}

function existingFlags(data, meta, deltas, seasonName) {
  const rankRows = (data.rankings || []).find((era) => era.key === meta.rankKey)?.rows || [];
  const seasonRows = (data.seasons || []).find((season) => season.name === seasonName)?.rows || [];
  const rankWasNew = {};
  const seasonWasNew = {};
  Object.keys(deltas || {}).forEach((name) => {
    rankWasNew[name] = !rankRows.some((row) => clean(row.name) === clean(name));
    seasonWasNew[name] = !seasonRows.some((row) => clean(row.name) === clean(name));
  });
  return { rankWasNew, seasonWasNew };
}

export function revertBracketRecord(data, bracketId) {
  const bracket = (data.brackets || []).find((item) => item.id === bracketId);
  if (!bracket?.applied) return { data, changed: false, reason: "기록에 반영된 대진표가 아닙니다." };
  const meta = bracket.applied.recordMeta;
  const roundId = bracket.applied.roundId;
  if (!meta || !roundId) {
    return {
      data,
      changed: false,
      reason: "이 기록은 동기화 기능 도입 이전에 반영되어 자동 원복 정보를 가지고 있지 않습니다. 테스트 데이터라면 로컬 데이터를 초기화한 뒤 다시 테스트해주세요.",
    };
  }

  let next = statsReverse(data, meta);
  next.tournaments = next.tournaments.map((tour) => tour.key !== bracket.applied.tournamentKey ? tour : {
    ...tour,
    rounds: (tour.rounds || []).filter((round) => round.id !== roundId),
  });
  next.brackets = next.brackets.map((item) => item.id !== bracketId ? item : {
    ...item,
    status: "active",
    applied: null,
  });
  return { data: next, changed: true };
}

export function syncTournamentRounds(data, tournamentKey, incomingRounds) {
  const originalTour = (data.tournaments || []).find((tour) => tour.key === tournamentKey);
  if (!originalTour) return data;

  const oldRounds = originalTour.rounds || [];
  const nextById = new Map((incomingRounds || []).map((round) => [round.id, round]));
  let next = cloneData(data);
  let editedRounds = [...(incomingRounds || [])];

  for (const oldRound of oldRounds) {
    const meta = oldRound.recordMeta;
    if (!meta || meta.source !== "bracket" || !oldRound.id) continue;
    const edited = nextById.get(oldRound.id);

    if (!edited) {
      next = statsReverse(next, meta);
      next.brackets = next.brackets.map((bracket) => bracket.id !== meta.bracketId ? bracket : {
        ...bracket,
        status: "active",
        applied: null,
      });
      continue;
    }

    if (placementSignature(oldRound) === placementSignature(edited)) continue;

    next = statsReverse(next, meta);
    const newDeltas = buildDeltasFromRound(edited, meta);
    const newSeason = clean(edited.season);
    const willRank = !!meta.rankEnabled && !!meta.rankKey;
    const willSeason = !!meta.seasonEnabled && !!newSeason && !edited.champ;
    const flags = existingFlags(next, meta, newDeltas, newSeason);
    const newMeta = {
      ...meta,
      season: newSeason,
      willRank,
      willSeason,
      deltas: newDeltas,
      rankWasNew: flags.rankWasNew,
      seasonWasNew: flags.seasonWasNew,
    };
    next = statsApply(next, newMeta);
    editedRounds = editedRounds.map((round) => round.id === edited.id ? { ...round, recordMeta: newMeta } : round);
    next.brackets = next.brackets.map((bracket) => bracket.id !== meta.bracketId ? bracket : {
      ...bracket,
      applied: bracket.applied ? { ...bracket.applied, season: newSeason, recordMeta: newMeta } : bracket.applied,
    });
  }

  next.tournaments = next.tournaments.map((tour) => tour.key === tournamentKey ? { ...tour, rounds: editedRounds } : tour);
  return next;
}
