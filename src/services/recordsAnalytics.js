const BYE = "\u2205BYE";

const cleanName = (value) => String(value || "").trim();
const splitNames = (value) =>
  String(value || "")
    .split("/")
    .map(cleanName)
    .filter(Boolean);

export function parseParty(value) {
  if (Array.isArray(value)) {
    return value
      .map((m) => (typeof m === "string" ? m : m?.name))
      .map(cleanName)
      .filter(Boolean);
  }
  return String(value || "")
    .split(/[,\n]/)
    .map(cleanName)
    .filter(Boolean);
}

function collectGraphMatches(graph) {
  const all = [];
  if (!graph) return all;
  (graph.rounds || []).forEach((round, ri) =>
    round.forEach((match) => all.push({ match, stage: graph.kind === "double" ? `WB R${ri + 1}` : `R${ri + 1}` }))
  );
  (graph.lb || []).forEach((round, ri) =>
    round.forEach((match) => all.push({ match, stage: `LB R${ri + 1}` }))
  );
  if (graph.gf) all.push({ match: graph.gf, stage: "Grand Final" });
  if (graph.reset) all.push({ match: graph.reset, stage: "Reset Final", reset: true });
  return all;
}

function evalGraph(graph) {
  const win = {};
  const lose = {};
  const ordered = collectGraphMatches(graph);
  const slotPlayer = (slot) => {
    if (!slot) return null;
    if (slot.bye) return BYE;
    if (slot.pid) return slot.pid;
    if (slot.win) return win[slot.win] ?? null;
    if (slot.lose) return lose[slot.lose] ?? null;
    return null;
  };

  for (const { match } of ordered) {
    const a = slotPlayer(match.a);
    const b = slotPlayer(match.b);
    let winner = null;
    let loser = null;

    if (match.winner === "a") {
      winner = a;
      loser = b;
    } else if (match.winner === "b") {
      winner = b;
      loser = a;
    } else if (a === BYE && b && b !== BYE) {
      winner = b;
      loser = BYE;
    } else if (b === BYE && a && a !== BYE) {
      winner = a;
      loser = BYE;
    }

    win[match.id] = winner;
    lose[match.id] = loser;
  }

  return { win, lose, slotPlayer };
}

function eliminationResult(graph) {
  if (!graph || !(graph.rounds || []).length) return null;
  const { win, lose } = evalGraph(graph);
  const clean = (id) => (id && id !== BYE ? id : null);

  if (graph.kind === "double") {
    const lower = graph.lb || [];
    const gf = graph.gf;
    const reset = graph.reset;
    if (!gf) return null;

    const sfMatches = [];
    if (lower.length) sfMatches.push(lower[lower.length - 1]?.[0]);
    if (lower.length >= 2) sfMatches.push(lower[lower.length - 2]?.[0]);
    const sf = sfMatches
      .filter(Boolean)
      .map((m) => clean(lose[m.id]))
      .filter(Boolean);

    if (gf.winner === "a") {
      return { champ: clean(win[gf.id]), ru: clean(lose[gf.id]), sf };
    }
    if (gf.winner === "b" && reset?.winner) {
      return { champ: clean(win[reset.id]), ru: clean(lose[reset.id]), sf };
    }
    return { champ: null, ru: null, sf };
  }

  const finalMatch = graph.rounds[graph.rounds.length - 1]?.[0];
  if (!finalMatch) return null;
  const semifinalMatches = graph.rounds.length >= 2 ? graph.rounds[graph.rounds.length - 2] : [];
  return {
    champ: clean(win[finalMatch.id]),
    ru: clean(lose[finalMatch.id]),
    sf: semifinalMatches.map((m) => clean(lose[m.id])).filter(Boolean),
  };
}

function bracketResult(bracket) {
  if (!bracket) return null;
  if (bracket.format === "group") {
    return bracket.knockout ? eliminationResult(bracket.knockout) : null;
  }
  return eliminationResult(bracket.graph);
}

function participantMap(bracket) {
  return new Map((bracket.participants || []).map((p) => [p.id, p]));
}

function bracketTournamentMeta(bracket, data) {
  const applied = bracket.applied || {};
  const tournament = (data.tournaments || []).find((t) => t.key === applied.tournamentKey);
  const rounds = tournament?.rounds || [];
  const linkedRound =
    rounds.find((r) => applied.roundId && r?.id === applied.roundId) ||
    rounds.find((r) => r?.recordMeta?.bracketId === bracket.id) ||
    rounds.find((r) => applied.date && r?.date === applied.date) ||
    null;

  return {
    bracketId: bracket.id,
    tournamentKey: applied.tournamentKey || "",
    tournamentName: tournament?.label || bracket.name || "대회",
    bracketName: bracket.name || tournament?.label || "대회",
    roundId: linkedRound?.id || applied.roundId || "",
    round: linkedRound?.round || "",
    season: linkedRound?.season || applied.season || "",
    date: linkedRound?.date || applied.date || bracket.createdAt || "",
    rule: linkedRound?.rule || "",
    championSeries: !!linkedRound?.champ,
    team: bracket.mode === "team",
    mode: bracket.mode || "single",
    format: bracket.format || "elim",
  };
}

function yplSeasonNumber(name) {
  const match = String(name || "").match(/YPL\s*시즌\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function countsForOfficialWL(season) {
  const number = yplSeasonNumber(season);
  return number !== null && number >= 3;
}

function buildMatchRecords(data) {
  const records = [];

  // YPL 시즌 3부터 기록에 반영된 개인전·팀전 대진표의 실제 경기 원본을 보존한다.
  // BYE는 경기로 보지 않는다. 공개 화면에서는 개인 승/패·승률을 기본 노출하지 않는다.
  for (const bracket of data.brackets || []) {
    if (!bracket?.applied) continue;

    const pmap = participantMap(bracket);
    const meta = bracketTournamentMeta(bracket, data);
    if (!countsForOfficialWL(meta.season)) continue;

    const pushRecord = ({ id, stage, winner, loser, extra = {} }) => {
      winner = cleanName(winner);
      loser = cleanName(loser);
      if (!winner || !loser) return;
      records.push({
        id,
        ...meta,
        stage,
        winner,
        loser,
        ...extra,
      });
    };

    const pushIndividualMatch = (match, stage, slotPlayer) => {
      if (!match?.winner) return;
      const aId = slotPlayer(match.a);
      const bId = slotPlayer(match.b);
      if (!aId || !bId || aId === BYE || bId === BYE) return;

      const winnerId = match.winner === "a" ? aId : bId;
      const loserId = match.winner === "a" ? bId : aId;
      pushRecord({
        id: `${bracket.id}:${match.id}`,
        stage,
        winner: pmap.get(winnerId)?.name,
        loser: pmap.get(loserId)?.name,
        extra: { teamMatch: false },
      });
    };

    const pushTeamSeries = (match, stage, slotPlayer) => {
      const series = match?.series;
      if (!series) return;

      const aTeamId = slotPlayer(match.a);
      const bTeamId = slotPlayer(match.b);
      if (!aTeamId || !bTeamId || aTeamId === BYE || bTeamId === BYE) return;

      const teamA = cleanName(pmap.get(aTeamId)?.name);
      const teamB = cleanName(pmap.get(bTeamId)?.name);
      const lineupA = series.lineupA || [];
      const lineupB = series.lineupB || [];
      const games = series.games || [];
      const gameCount = Math.min(lineupA.length, lineupB.length, games.length);

      for (let i = 0; i < gameCount; i += 1) {
        const side = games[i];
        if (side !== "a" && side !== "b") continue;
        const a = cleanName(lineupA[i]);
        const b = cleanName(lineupB[i]);
        if (!a || !b) continue;

        pushRecord({
          id: `${bracket.id}:${match.id}:team:${i}`,
          stage: `${stage} · ${i + 1}경기`,
          winner: side === "a" ? a : b,
          loser: side === "a" ? b : a,
          extra: {
            teamMatch: true,
            ace: false,
            teamA,
            teamB,
          },
        });
      }

      const ace = series.ace;
      if (ace && (ace.winner === "a" || ace.winner === "b")) {
        const a = cleanName(ace.a);
        const b = cleanName(ace.b);
        if (a && b) {
          pushRecord({
            id: `${bracket.id}:${match.id}:ace`,
            stage: `${stage} · 에이스 결정전`,
            winner: ace.winner === "a" ? a : b,
            loser: ace.winner === "a" ? b : a,
            extra: {
              teamMatch: true,
              ace: true,
              teamA,
              teamB,
            },
          });
        }
      }
    };

    const pushMatch = (match, stage, slotPlayer) => {
      if (bracket.mode === "team") pushTeamSeries(match, stage, slotPlayer);
      else pushIndividualMatch(match, stage, slotPlayer);
    };

    const handleGraph = (graph, prefix = "") => {
      if (!graph) return;
      const ev = evalGraph(graph);
      for (const item of collectGraphMatches(graph)) {
        if (item.reset && graph.gf?.winner !== "b") continue;
        const stage = prefix ? `${prefix} ${item.stage}` : item.stage;
        pushMatch(item.match, stage, ev.slotPlayer);
      }
    };

    if (bracket.format === "group") {
      for (const group of bracket.groups || []) {
        for (const match of group.matches || []) {
          const slotPlayer = (slot) => slot?.pid || null;
          pushMatch(match, `Group ${group.name}`, slotPlayer);
        }
      }
      handleGraph(bracket.knockout, "KO");
    } else {
      handleGraph(bracket.graph);
    }
  }

  return records;
}

function buildRosterEntries(data) {
  const entries = [];

  for (const bracket of data.brackets || []) {
    if (!bracket?.applied) continue;
    const meta = bracketTournamentMeta(bracket, data);
    const result = bracketResult(bracket);
    const resultMap = new Map();

    if (result?.champ) resultMap.set(result.champ, "win");
    if (result?.ru) resultMap.set(result.ru, "ru");
    for (const id of result?.sf || []) resultMap.set(id, "sf");

    for (const participant of bracket.participants || []) {
      if (bracket.mode === "team") {
        const teamPlacement = resultMap.get(participant.id) || "participant";
        for (const member of participant.members || []) {
          const pokemon = parseParty((participant.memberParties || {})[member]);
          if (!pokemon.length) continue;
          entries.push({
            id: `${bracket.id}:${participant.id}:${member}`,
            ...meta,
            owner: cleanName(member),
            teamName: cleanName(participant.name),
            pokemon,
            placement: teamPlacement,
            team: true,
          });
        }
      } else {
        const pokemon = parseParty(participant.party);
        if (!pokemon.length) continue;
        entries.push({
          id: `${bracket.id}:${participant.id}`,
          ...meta,
          owner: cleanName(participant.name),
          pokemon,
          placement: resultMap.get(participant.id) || "participant",
          team: false,
        });
      }
    }
  }

  return entries.filter((e) => e.owner);
}

function graphParticipantIds(graph) {
  const ids = new Set();
  for (const round of graph?.rounds || []) {
    for (const match of round || []) {
      for (const slot of [match?.a, match?.b]) {
        if (slot?.pid && slot.pid !== BYE) ids.add(slot.pid);
      }
    }
  }
  return [...ids];
}

function singleEliminationFinishMap(graph) {
  const result = new Map();
  if (!graph?.rounds?.length) return result;

  const ev = evalGraph(graph);
  const lastRoundIndex = graph.rounds.length - 1;

  graph.rounds.forEach((round, ri) => {
    for (const match of round || []) {
      if (!match?.winner) continue;
      const loser = ev.lose[match.id];
      if (!loser || loser === BYE) continue;

      if (ri === lastRoundIndex) {
        result.set(loser, { placement: "ru", resultLabel: "준우승", rank: 2 });
      } else {
        const cut = (round?.length || 0) * 2;
        result.set(loser, {
          placement: cut === 4 ? "sf" : "participant",
          resultLabel: `${cut}강`,
          rank: null,
        });
      }
    }
  });

  const finalMatch = graph.rounds[lastRoundIndex]?.[0];
  const champion = finalMatch ? ev.win[finalMatch.id] : null;
  if (champion && champion !== BYE) {
    result.set(champion, { placement: "win", resultLabel: "우승", rank: 1 });
  }

  return result;
}

function doubleEliminationFinishMap(graph) {
  const result = new Map();
  if (!graph) return result;

  const participantIds = graphParticipantIds(graph);
  const ev = evalGraph(graph);
  const finalResult = eliminationResult(graph);
  let remaining = participantIds.length;

  for (const round of graph.lb || []) {
    const losers = [];
    const seen = new Set();

    for (const match of round || []) {
      if (!match?.winner) continue;
      const loser = ev.lose[match.id];
      if (!loser || loser === BYE || seen.has(loser)) continue;
      seen.add(loser);
      losers.push(loser);
    }

    if (!losers.length) continue;
    remaining = Math.max(0, remaining - losers.length);
    const rank = remaining + 1;
    const resultLabel = losers.length > 1 ? `공동 ${rank}위` : `${rank}위`;
    const placement = rank <= 4 ? "sf" : "participant";

    for (const loser of losers) {
      result.set(loser, { placement, resultLabel, rank });
    }
  }

  if (finalResult?.ru) {
    result.set(finalResult.ru, { placement: "ru", resultLabel: "준우승", rank: 2 });
  }
  if (finalResult?.champ) {
    result.set(finalResult.champ, { placement: "win", resultLabel: "우승", rank: 1 });
  }

  return result;
}

function eliminationFinishMap(graph) {
  if (!graph) return new Map();
  return graph.kind === "double"
    ? doubleEliminationFinishMap(graph)
    : singleEliminationFinishMap(graph);
}

function bracketFinishMap(bracket) {
  if (!bracket) return new Map();

  if (bracket.format === "group") {
    const result = eliminationFinishMap(bracket.knockout);
    for (const participant of bracket.participants || []) {
      if (!result.has(participant.id)) {
        result.set(participant.id, {
          placement: "participant",
          resultLabel: "조별리그 탈락",
          rank: null,
        });
      }
    }
    return result;
  }

  return eliminationFinishMap(bracket.graph);
}

function resultLabelFor(placement, team = false) {
  const base =
    placement === "win" ? "우승" :
    placement === "ru" ? "준우승" :
    placement === "sf" ? "4강" :
    "참가";
  return team ? `팀 ${base}` : base;
}

function withTeamPrefix(label, team) {
  if (!team) return label || "참가";
  return `팀 ${label || "참가"}`;
}

function buildParticipationRecords(data) {
  const rows = [];

  for (const bracket of data.brackets || []) {
    if (!bracket?.applied) continue;

    const meta = bracketTournamentMeta(bracket, data);
    const finishMap = bracketFinishMap(bracket);

    if (bracket.mode === "team") {
      for (const team of bracket.participants || []) {
        const finish = finishMap.get(team.id) || {
          placement: "participant",
          resultLabel: "참가",
          rank: null,
        };

        for (const member of team.members || []) {
          const name = cleanName(member);
          if (!name) continue;
          rows.push({
            id: `${bracket.id}:${team.id}:${name}`,
            ...meta,
            name,
            team: true,
            teamName: cleanName(team.name),
            placement: finish.placement,
            resultLabel: withTeamPrefix(finish.resultLabel, true),
            resultRank: finish.rank,
          });
        }
      }
    } else {
      for (const participant of bracket.participants || []) {
        const name = cleanName(participant.name);
        if (!name) continue;
        const finish = finishMap.get(participant.id) || {
          placement: "participant",
          resultLabel: "참가",
          rank: null,
        };

        rows.push({
          id: `${bracket.id}:${participant.id}`,
          ...meta,
          name,
          team: false,
          placement: finish.placement,
          resultLabel: finish.resultLabel,
          resultRank: finish.rank,
        });
      }
    }
  }

  return rows;
}

function buildPlacementHistory(data) {
  const events = [];

  for (const tournament of data.tournaments || []) {
    for (const [index, round] of (tournament.rounds || []).entries()) {
      const base = {
        id: round.id || `${tournament.key}:${index}`,
        roundId: round.id || `${tournament.key}:${index}`,
        tournamentKey: tournament.key,
        tournamentName: tournament.label || tournament.key || "대회",
        date: round.date || "",
        round: round.round || "",
        season: round.season || "",
        rule: round.rule || "",
        championSeries: !!round.champ,
        team: !!round.team,
      };

      if (round.team) {
        for (const name of round.winMembers || []) {
          if (cleanName(name)) {
            events.push({
              ...base,
              name: cleanName(name),
              placement: "win",
              resultLabel: resultLabelFor("win", true),
              teamName: cleanName(round.win),
            });
          }
        }
        for (const name of round.ruMembers || []) {
          if (cleanName(name)) {
            events.push({
              ...base,
              name: cleanName(name),
              placement: "ru",
              resultLabel: resultLabelFor("ru", true),
              teamName: cleanName(round.ru),
            });
          }
        }
        (round.sfMembers || []).forEach((members, idx) => {
          for (const name of members || []) {
            if (cleanName(name)) {
              events.push({
                ...base,
                name: cleanName(name),
                placement: "sf",
                resultLabel: resultLabelFor("sf", true),
                teamName: cleanName((round.sf || [])[idx]),
              });
            }
          }
        });
      } else {
        const winner = cleanName(round.win);
        if (winner) {
          events.push({
            ...base,
            name: winner,
            placement: "win",
            resultLabel: resultLabelFor("win", false),
          });
        }
        for (const name of splitNames(round.ru)) {
          events.push({
            ...base,
            name,
            placement: "ru",
            resultLabel: resultLabelFor("ru", false),
          });
        }
        for (const name of round.sf || []) {
          if (cleanName(name)) {
            events.push({
              ...base,
              name: cleanName(name),
              placement: "sf",
              resultLabel: resultLabelFor("sf", false),
            });
          }
        }
      }
    }
  }

  return events;
}

function buildTrainerHistory(placements, participations) {
  const history = participations.map((row) => ({ ...row, source: "bracket" }));

  const hasLinkedParticipation = (placement) =>
    participations.some((row) => {
      if (row.roundId && placement.roundId) return row.roundId === placement.roundId;
      return (
        row.tournamentKey === placement.tournamentKey &&
        row.date === placement.date &&
        String(row.round || "") === String(placement.round || "")
      );
    });

  for (const placement of placements) {
    if (hasLinkedParticipation(placement)) continue;
    history.push({
      ...placement,
      source: "legacy",
      resultLabel: placement.resultLabel || resultLabelFor(placement.placement, placement.team),
    });
  }

  return history;
}

function buildArchives(data, rosterEntries) {
  const archives = [];

  for (const tournament of data.tournaments || []) {
    for (const [index, round] of (tournament.rounds || []).entries()) {
      archives.push({
        id: round.id || `${tournament.key}:${index}`,
        tournamentKey: tournament.key,
        tournamentName: tournament.label || tournament.key || "대회",
        color: tournament.color,
        date: round.date || "",
        round: round.round || "",
        season: round.season || "",
        rule: round.rule || "",
        championSeries: !!round.champ,
        team: !!round.team,
        win: cleanName(round.win),
        winMembers: (round.winMembers || []).map(cleanName).filter(Boolean),
        ru: splitNames(round.ru),
        ruMembers: (round.ruMembers || []).map(cleanName).filter(Boolean),
        sf: (round.sf || []).map(cleanName).filter(Boolean),
        sfMembers: (round.sfMembers || []).map((members) => (members || []).map(cleanName).filter(Boolean)),
        brackets: [],
        rosters: [],
      });
    }
  }

  // 기존 applied 정보에는 회차 번호가 없으므로 tournamentKey + date를 1차 기준으로 삼고,
  // 동일 날짜에 여러 회차가 있으면 우승자까지 비교해 가능한 한 한 회차에만 연결한다.
  for (const bracket of data.brackets || []) {
    if (!bracket?.applied) continue;
    const applied = bracket.applied || {};
    const candidates = archives.filter(
      (event) =>
        event.tournamentKey === (applied.tournamentKey || "") &&
        event.date === (applied.date || "")
    );
    if (!candidates.length) continue;

    const result = bracketResult(bracket);
    const pmap = participantMap(bracket);
    const champName = result?.champ ? cleanName(pmap.get(result.champ)?.name) : "";

    let target =
      candidates.find((event) => champName && event.win === champName && event.brackets.length === 0) ||
      candidates.find((event) => event.brackets.length === 0) ||
      candidates[0];

    target.brackets.push({
      id: bracket.id,
      name: bracket.name,
      mode: bracket.mode,
      format: bracket.format,
      participantCount:
        bracket.mode === "team"
          ? (bracket.participants || []).reduce((sum, t) => sum + (t.members || []).length, 0)
          : (bracket.participants || []).length,
    });

    const rosterIds = new Set([bracket.id]);
    target.rosters.push(...rosterEntries.filter((entry) => rosterIds.has(entry.bracketId)));
  }

  return archives.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(b.round || "").localeCompare(String(a.round || ""), "ko");
  });
}

function collectNames(data, placements, matches, participations, rosters) {
  const names = new Set();
  const add = (value) => {
    const name = cleanName(value);
    if (name) names.add(name);
  };

  for (const era of data.rankings || []) for (const row of era.rows || []) add(row.name);
  for (const season of data.seasons || []) for (const row of season.rows || []) add(row.name);
  for (const row of placements) add(row.name);
  for (const row of matches) {
    add(row.winner);
    add(row.loser);
  }
  for (const row of participations) add(row.name);
  for (const row of rosters) add(row.owner);
  for (const champion of data.champions || []) add(champion.name);
  for (const group of data.titleGroups || []) {
    for (const item of group.items || []) for (const holder of item.holders || []) add(holder);
  }

  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

function titleRecordsFor(data, name) {
  const items = [];
  for (const group of data.titleGroups || []) {
    for (const item of group.items || []) {
      if ((item.holders || []).some((holder) => cleanName(holder) === name)) {
        items.push({
          group: group.name,
          icon: group.icon,
          name: item.name,
          desc: item.desc || "",
        });
      }
    }
  }
  return items;
}

function championRecordsFor(data, name) {
  return (data.champions || [])
    .filter((c) => cleanName(c.name) === name)
    .map((c) => ({
      gen: c.gen,
      season: c.slabel || `SEASON ${c.season}`,
      team: parseParty(c.team),
    }));
}

function summarizeMatches(matches) {
  const wins = matches.filter((m) => m.won).length;
  const losses = matches.filter((m) => !m.won).length;
  const total = wins + losses;
  const rivals = new Map();

  for (const match of matches) {
    const cur = rivals.get(match.opponent) || { name: match.opponent, games: 0, wins: 0, losses: 0 };
    cur.games += 1;
    if (match.won) cur.wins += 1;
    else cur.losses += 1;
    rivals.set(match.opponent, cur);
  }

  const rival = [...rivals.values()].sort((a, b) => b.games - a.games || b.wins + b.losses - (a.wins + a.losses))[0] || null;
  return {
    wins,
    losses,
    total,
    winRate: total ? (wins / total) * 100 : null,
    rival,
  };
}

function favoritePokemon(rosters) {
  const count = new Map();
  for (const roster of rosters) {
    for (const pokemon of new Set(roster.pokemon || [])) {
      count.set(pokemon, (count.get(pokemon) || 0) + 1);
    }
  }
  return [...count.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, "ko"));
}

export function buildPokemonStats(rosters, champions) {
  const map = new Map();
  const totalEntries = rosters.length;

  for (const roster of rosters) {
    for (const pokemon of new Set(roster.pokemon || [])) {
      const cur = map.get(pokemon) || {
        name: pokemon,
        entries: 0,
        trainers: new Map(),
        wins: 0,
        runnerUps: 0,
        top4: 0,
        partners: new Map(),
        seasons: new Map(),
      };

      cur.entries += 1;
      cur.trainers.set(roster.owner, (cur.trainers.get(roster.owner) || 0) + 1);
      if (roster.placement === "win") cur.wins += 1;
      if (roster.placement === "ru") cur.runnerUps += 1;
      if (roster.placement === "sf") cur.top4 += 1;
      if (roster.season) cur.seasons.set(roster.season, (cur.seasons.get(roster.season) || 0) + 1);

      for (const partner of new Set(roster.pokemon || [])) {
        if (partner === pokemon) continue;
        cur.partners.set(partner, (cur.partners.get(partner) || 0) + 1);
      }

      map.set(pokemon, cur);
    }
  }

  const championMap = new Map();
  for (const champion of champions || []) {
    for (const pokemon of new Set(parseParty(champion.team))) {
      if (!championMap.has(pokemon)) championMap.set(pokemon, []);
      championMap.get(pokemon).push({
        name: cleanName(champion.name),
        gen: champion.gen,
        season: champion.slabel || `SEASON ${champion.season}`,
      });
    }
  }

  return [...map.values()]
    .map((item) => ({
      name: item.name,
      entries: item.entries,
      entryRate: totalEntries ? (item.entries / totalEntries) * 100 : 0,
      trainerCount: item.trainers.size,
      trainers: [...item.trainers.entries()]
        .map(([name, entries]) => ({ name, entries }))
        .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, "ko")),
      wins: item.wins,
      runnerUps: item.runnerUps,
      top4: item.top4,
      partners: [...item.partners.entries()]
        .map(([name, entries]) => ({ name, entries }))
        .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, "ko")),
      seasons: [...item.seasons.entries()]
        .map(([name, entries]) => ({ name, entries }))
        .sort((a, b) => b.entries - a.entries),
      champions: championMap.get(item.name) || [],
    }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, "ko"));
}

export function buildRecordsSnapshot(data = {}) {
  const matches = buildMatchRecords(data);
  const rosters = buildRosterEntries(data);
  const participations = buildParticipationRecords(data);
  const placements = buildPlacementHistory(data);
  const names = collectNames(data, placements, matches, participations, rosters);
  const archives = buildArchives(data, rosters);

  const profiles = {};
  for (const name of names) {
    const playerMatches = matches
      .filter((m) => m.winner === name || m.loser === name)
      .map((m) => ({
        ...m,
        won: m.winner === name,
        opponent: m.winner === name ? m.loser : m.winner,
      }));

    const playerPlacements = placements.filter((p) => p.name === name);
    const playerParticipations = participations.filter((p) => p.name === name);
    const playerRosters = rosters.filter((r) => r.owner === name);

    profiles[name] = {
      name,
      matches: playerMatches,
      placements: playerPlacements,
      participations: playerParticipations,
      history: buildTrainerHistory(playerPlacements, playerParticipations),
      rosters: playerRosters,
      titles: titleRecordsFor(data, name),
      champions: championRecordsFor(data, name),
      matchSummary: summarizeMatches(playerMatches),
      favoritePokemon: favoritePokemon(playerRosters),
    };
  }

  const trainers = names
    .map((name) => {
      const profile = profiles[name];
      const recorded = profile.placements;
      return {
        name,
        wins: recorded.filter((p) => p.placement === "win").length,
        runnerUps: recorded.filter((p) => p.placement === "ru").length,
        top4: recorded.filter((p) => p.placement === "sf").length,
        matches: profile.matchSummary.total,
      };
    })
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.runnerUps - a.runnerUps ||
        b.top4 - a.top4 ||
        a.name.localeCompare(b.name, "ko")
    );

  return {
    profiles,
    trainers,
    matches,
    rosters,
    participations,
    placements,
    archives,
    pokemon: buildPokemonStats(rosters, data.champions || []),
    seasons: (data.seasons || []).map((s) => s.name).filter(Boolean).reverse(),
    coverage: {
      appliedBrackets: (data.brackets || []).filter((b) => b?.applied).length,
      officialMatches: matches.length,
      savedRosters: rosters.length,
      archiveEvents: archives.length,
    },
  };
}
