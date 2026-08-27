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
  return {
    bracketId: bracket.id,
    tournamentKey: applied.tournamentKey || "",
    tournamentName: tournament?.label || bracket.name || "대회",
    bracketName: bracket.name || tournament?.label || "대회",
    season: applied.season || "",
    date: applied.date || bracket.createdAt || "",
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

  // 현재 정책이 확정되지 않은 팀전 개인경기는 통산 전적에서 제외한다.
  // applied가 있는 개인전 대진표만 공식 경기 전적의 원본으로 사용한다.
  for (const bracket of data.brackets || []) {
    if (!bracket?.applied || bracket.mode === "team") continue;

    const pmap = participantMap(bracket);
    const meta = bracketTournamentMeta(bracket, data);
    if (!countsForOfficialWL(meta.season)) continue;

    const pushMatch = (match, stage, slotPlayer) => {
      if (!match?.winner) return;
      const aId = slotPlayer(match.a);
      const bId = slotPlayer(match.b);
      if (!aId || !bId || aId === BYE || bId === BYE) return;
      const winnerId = match.winner === "a" ? aId : bId;
      const loserId = match.winner === "a" ? bId : aId;
      const winner = cleanName(pmap.get(winnerId)?.name);
      const loser = cleanName(pmap.get(loserId)?.name);
      if (!winner || !loser) return;
      records.push({
        id: `${bracket.id}:${match.id}`,
        ...meta,
        stage,
        winner,
        loser,
      });
    };

    const handleGraph = (graph, prefix = "") => {
      if (!graph) return;
      const ev = evalGraph(graph);
      for (const item of collectGraphMatches(graph)) {
        if (item.reset && graph.gf?.winner !== "b") continue;
        pushMatch(item.match, prefix ? `${prefix} ${item.stage}` : item.stage, ev.slotPlayer);
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

function buildParticipationRecords(data) {
  const rows = [];

  for (const bracket of data.brackets || []) {
    if (!bracket?.applied) continue;
    const meta = bracketTournamentMeta(bracket, data);
    const result = bracketResult(bracket);
    const pmap = participantMap(bracket);

    const individualPlacement = new Map();
    if (result?.champ) individualPlacement.set(result.champ, "win");
    if (result?.ru) individualPlacement.set(result.ru, "ru");
    for (const id of result?.sf || []) individualPlacement.set(id, "sf");

    if (bracket.mode === "team") {
      for (const team of bracket.participants || []) {
        const placement = individualPlacement.get(team.id) || "participant";
        for (const member of team.members || []) {
          const name = cleanName(member);
          if (!name) continue;
          rows.push({
            id: `${bracket.id}:${team.id}:${name}`,
            ...meta,
            name,
            team: true,
            teamName: cleanName(team.name),
            placement,
          });
        }
      }
    } else {
      for (const participant of bracket.participants || []) {
        const name = cleanName(participant.name);
        if (!name) continue;
        rows.push({
          id: `${bracket.id}:${participant.id}`,
          ...meta,
          name,
          team: false,
          placement: individualPlacement.get(participant.id) || "participant",
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
          if (cleanName(name)) events.push({ ...base, name: cleanName(name), placement: "win", teamName: cleanName(round.win) });
        }
        for (const name of round.ruMembers || []) {
          if (cleanName(name)) events.push({ ...base, name: cleanName(name), placement: "ru", teamName: cleanName(round.ru) });
        }
        (round.sfMembers || []).forEach((members, idx) => {
          for (const name of members || []) {
            if (cleanName(name)) events.push({ ...base, name: cleanName(name), placement: "sf", teamName: cleanName((round.sf || [])[idx]) });
          }
        });
      } else {
        const winner = cleanName(round.win);
        if (winner) events.push({ ...base, name: winner, placement: "win" });
        for (const name of splitNames(round.ru)) events.push({ ...base, name, placement: "ru" });
        for (const name of round.sf || []) {
          if (cleanName(name)) events.push({ ...base, name: cleanName(name), placement: "sf" });
        }
      }
    }
  }

  return events;
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

function buildPokemonStats(rosters, champions) {
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
      const individual = profile.placements.filter((p) => !p.team);
      return {
        name,
        wins: individual.filter((p) => p.placement === "win").length,
        runnerUps: individual.filter((p) => p.placement === "ru").length,
        top4: individual.filter((p) => p.placement === "sf").length,
        matches: profile.matchSummary.total,
      };
    })
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.runnerUps - a.runnerUps ||
        b.top4 - a.top4 ||
        b.matches - a.matches ||
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
