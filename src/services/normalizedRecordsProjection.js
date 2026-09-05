import { buildPokemonStats, buildRecordsSnapshot } from "./recordsAnalytics.js";
import { resolveRecordsPokemonName } from "./recordsPokemon.js";

const cleanName = (value) => String(value || "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const number = (value) => Number(value || 0);

const PLACEMENT = {
  champion: "win",
  runner_up: "ru",
  semifinalist: "sf",
};

const TEAM_RESULT_LABEL = {
  champion: "팀 우승",
  runner_up: "팀 준우승",
  semifinalist: "팀 4강",
};

function resultLabel(result, team) {
  if (team) return TEAM_RESULT_LABEL[result?.placement_code] || result?.placement_label || "참가";
  return result?.placement_label || "참가";
}

function uniqueRows(rows, keyFor) {
  const seen = new Set();
  return asArray(rows).filter((row) => {
    const key = keyFor(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isOfficialNormalizedRecordsEvent(event) {
  return Boolean(
    event?.id &&
    event.status === "completed" &&
    (event.record_applied_at || event.championship_phase === "qualifier")
  );
}

function formatEventDate(event) {
  const date = String(event?.held_on || "");
  if (!date) return "";
  if (event.date_precision === "year") return date.slice(0, 4);
  if (event.date_precision === "month") return date.slice(0, 7).replace("-", ".");
  if (event.date_precision === "unknown") return "";
  return date.replaceAll("-", ".");
}

function tournamentDescriptor(event, season, legacyData) {
  let key = event.event_type || "event";
  if (event.event_type === "light" || event.division === "light") key = "pylite";
  else if (event.event_type === "champions") key = season?.series === "classic" ? "pycup" : "master";
  else if (event.division === "master") key = "master";
  else if (event.division === "rookie") key = "rookie";
  else if (event.event_type === "pokecup" && season?.series === "classic") key = "pycup";
  else if (event.event_type === "pokecup" && season?.series === "ypl") key = "master";

  const legacy = asArray(legacyData?.tournaments).find((item) => item.key === key);
  const fallbackLabel =
    key === "pylite" ? "파이컵 라이트" :
    key === "master" ? "마스터 리그" :
    key === "rookie" ? "루키 리그" :
    key === "pycup" ? "클래식 파이컵" :
    event.name || "대회";

  return { key, label: legacy?.label || fallbackLabel, color: legacy?.color || "#9FB3C8" };
}

function filterLinkedLegacyRecords(data, normalizedEventIds, normalizedTeamEventIds = new Set()) {
  return {
    ...data,
    tournaments: asArray(data?.tournaments).map((tournament) => ({
      ...tournament,
      rounds: asArray(tournament.rounds).filter(
        (round) => !normalizedEventIds.has(round?.recordMeta?.eventId)
      ),
    })),
    brackets: asArray(data?.brackets).filter(
      (bracket) => !normalizedEventIds.has(bracket?.eventId) || normalizedTeamEventIds.has(bracket?.eventId)
    ),
  };
}

function normalizedModels(data, raw) {
  const events = uniqueRows(raw?.events, (event) => event?.id)
    .filter(isOfficialNormalizedRecordsEvent);
  const eventIds = new Set(events.map((event) => event.id));
  const seasons = uniqueRows(raw?.seasons, (season) => season?.id);
  const players = uniqueRows(raw?.players, (player) => player?.id);
  const entries = uniqueRows(raw?.entries, (entry) => entry?.id)
    .filter((entry) => eventIds.has(entry.event_id));
  const participants = uniqueRows(
    raw?.entryParticipants,
    (participant) => participant?.id || `${participant?.event_id}:${participant?.player_id}`
  ).filter((participant) => eventIds.has(participant.event_id));
  const results = uniqueRows(
    raw?.results,
    (result) => result?.id || `${result?.event_id}:${result?.entry_id}`
  ).filter((result) => eventIds.has(result.event_id));
  const registrationById = new Map(
    asArray(raw?.eventRegistrations).map((registration) => [registration.id, registration])
  );

  const eventById = new Map(events.map((event) => [event.id, event]));
  const seasonById = new Map(seasons.map((season) => [season.id, season]));
  const playerById = new Map(players.map((player) => [player.id, player]));
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const participantsByEntryId = new Map();
  for (const participant of participants) {
    if (!participantsByEntryId.has(participant.entry_id)) participantsByEntryId.set(participant.entry_id, []);
    participantsByEntryId.get(participant.entry_id).push(participant);
  }
  const resultByEntryId = new Map(results.map((result) => [result.entry_id, result]));

  const participantsForEntry = (entryId) => (participantsByEntryId.get(entryId) || [])
    .slice()
    .sort((a, b) => number(a.member_order) - number(b.member_order));

  const eventMeta = (event) => {
    const season = seasonById.get(event.season_id);
    const tournament = tournamentDescriptor(event, season, data);
    return {
      eventId: event.id,
      tournamentKey: tournament.key,
      tournamentName: tournament.label,
      eventName: event.name,
      date: formatEventDate(event),
      round: event.round_number || "",
      season: season?.name || "",
      seasonId: season?.id || null,
      series: season?.series || "",
      rule: [event.regulation_id, event.cup_rule_id].filter(Boolean).join(" · "),
      championSeries: event.event_type === "champions",
      team: Boolean(event.is_team_event),
      mode: event.is_team_event ? "team" : "single",
      format: event.competition_format || "",
      source: "normalized",
    };
  };

  const participations = participants.flatMap((participant) => {
    const event = eventById.get(participant.event_id);
    const player = playerById.get(participant.player_id);
    const entry = entryById.get(participant.entry_id);
    const team = Boolean(event?.is_team_event);
    const expectedEntryType = team ? "team" : "individual";
    if (!event || !player || entry?.entry_type !== expectedEntryType) return [];
    const result = resultByEntryId.get(participant.entry_id);
    const placement = PLACEMENT[result?.placement_code] || "participant";
    return [{
      id: `${event.id}:${participant.id}`,
      ...eventMeta(event),
      entryId: participant.entry_id,
      playerId: participant.player_id,
      name: cleanName(player.display_name),
      teamName: team ? cleanName(entry.display_name) : "",
      placement,
      resultLabel: resultLabel(result, team),
      resultRank: result?.rank_min || null,
    }];
  });

  const placements = participations.filter((row) => row.placement !== "participant");

  const matches = uniqueRows(
    raw?.matches,
    (match) => match?.id || `${match?.event_id}:${match?.source}:${match?.source_node_key}`
  ).flatMap((match) => {
    const event = eventById.get(match.event_id);
    if (
      !eventIds.has(match.event_id) ||
      event?.is_team_event ||
      match.match_kind !== "bracket" ||
      !["played", "forfeit", "admin"].includes(match.resolution) ||
      !match.entry_a_id ||
      !match.entry_b_id ||
      !match.winner_entry_id
    ) return [];

    const a = participantsByEntryId.get(match.entry_a_id)?.[0];
    const b = participantsByEntryId.get(match.entry_b_id)?.[0];
    const winner = participantsByEntryId.get(match.winner_entry_id)?.[0];
    if (!a || !b || !winner) return [];
    const loser = winner.entry_id === a.entry_id ? b : a;
    return [{
      id: match.id,
      ...eventMeta(event),
      stage: match.stage_label || "",
      playerAId: a.player_id,
      playerBId: b.player_id,
      winnerPlayerId: winner.player_id,
      loserPlayerId: loser.player_id,
      winner: cleanName(playerById.get(winner.player_id)?.display_name),
      loser: cleanName(playerById.get(loser.player_id)?.display_name),
      resolution: match.resolution,
      sourceNodeKey: match.source_node_key || null,
    }];
  });

  const archives = events.map((event) => {
    const meta = eventMeta(event);
    const eventResults = results.filter((result) => result.event_id === event.id);
    const team = Boolean(event.is_team_event);
    const entryIdsFor = (code) => eventResults
      .filter((result) => result.placement_code === code)
      .map((result) => result.entry_id)
      .filter(Boolean);
    const namesFor = (code) => eventResults
      .filter((result) => result.placement_code === code)
      .map((result) => participantsByEntryId.get(result.entry_id)?.[0])
      .map((participant) => cleanName(playerById.get(participant?.player_id)?.display_name))
      .filter(Boolean);
    const teamRowsFor = (code) => eventResults
      .filter((result) => result.placement_code === code)
      .flatMap((result) => {
        const entry = entryById.get(result.entry_id);
        if (entry?.entry_type !== "team") return [];
        const members = participantsForEntry(result.entry_id)
          .map((participant) => cleanName(playerById.get(participant.player_id)?.display_name))
          .filter(Boolean);
        const name = cleanName(entry.display_name);
        if (!name && !members.length) return [];
        return [{ name, members }];
      });
    const tournament = tournamentDescriptor(event, seasonById.get(event.season_id), data);
    const champions = team ? teamRowsFor("champion") : [];
    const runnerUps = team ? teamRowsFor("runner_up") : [];
    const semifinalists = team ? teamRowsFor("semifinalist") : [];
    const individualParticipants = team ? [] : uniqueRows(
      participants
        .filter((participant) => participant.event_id === event.id)
        .filter((participant) => entryById.get(participant.entry_id)?.entry_type === "individual")
        .filter((participant) => registrationById.get(participant.registration_id)?.event_id === event.id),
      (participant) => participant.entry_id
    ).map((participant) => {
      const result = resultByEntryId.get(participant.entry_id);
      return {
        entryId: participant.entry_id,
        playerId: participant.player_id,
        name: cleanName(playerById.get(participant.player_id)?.display_name),
        placement: PLACEMENT[result?.placement_code] || "participant",
        hasResult: Boolean(result),
      };
    }).filter((participant) => participant.name);

    return {
      id: event.id,
      ...meta,
      color: tournament.color,
      eventType: event.event_type,
      division: event.division,
      battleFormat: event.battle_format,
      competitionFormat: event.competition_format,
      regulationId: event.regulation_id,
      cupRuleId: event.cup_rule_id,
      datePrecision: event.date_precision,
      recordCompleteness: event.record_completeness,
      win: team ? champions[0]?.name || "" : namesFor("champion")[0] || "",
      winMembers: team ? champions.flatMap((row) => row.members) : [],
      ru: team ? runnerUps.map((row) => row.name) : namesFor("runner_up"),
      ruMembers: team ? runnerUps.flatMap((row) => row.members) : [],
      sf: team ? semifinalists.map((row) => row.name) : namesFor("semifinalist"),
      sfMembers: team ? semifinalists.map((row) => row.members) : [],
      winEntryIds: team ? [] : entryIdsFor("champion"),
      ruEntryIds: team ? [] : entryIdsFor("runner_up"),
      sfEntryIds: team ? [] : entryIdsFor("semifinalist"),
      individualParticipants,
      brackets: [],
      rosters: [],
    };
  });

  return {
    events,
    eventIds,
    seasons,
    players,
    entries,
    participants,
    results,
    matches,
    placements,
    participations,
    archives,
    eventById,
    seasonById,
    playerById,
    participantsByEntryId,
    resultByEntryId,
    eventMeta,
  };
}

function normalizedRosters(raw, models, pokemonDirectory) {
  const registrationById = new Map(
    asArray(raw?.eventRegistrations).map((registration) => [registration.id, registration])
  );
  const submissionById = new Map(
    asArray(raw?.registrationSubmissions).map((submission) => [submission.id, submission])
  );
  const snapshotById = new Map(
    asArray(raw?.teamSnapshots).map((snapshot) => [snapshot.id, snapshot])
  );
  const membersBySnapshotId = new Map();
  for (const member of asArray(raw?.teamSnapshotMembers)) {
    if (!membersBySnapshotId.has(member.snapshot_id)) membersBySnapshotId.set(member.snapshot_id, []);
    membersBySnapshotId.get(member.snapshot_id).push(member);
  }

  return models.participants.flatMap((participant) => {
    const event = models.eventById.get(participant.event_id);
    if (!event || event.is_team_event || !event.team_revealed_at) return [];
    const registration = registrationById.get(participant.registration_id);
    const submission = submissionById.get(registration?.final_submission_id);
    if (!submission || submission.registration_id !== registration?.id || !snapshotById.has(submission.snapshot_id)) return [];
    const members = asArray(membersBySnapshotId.get(submission.snapshot_id))
      .slice()
      .sort((a, b) => number(a.slot) - number(b.slot));
    const resolvedMembers = members
      .map((member) => ({
        pokemonId: cleanName(member.pokemon_id),
        name: resolveRecordsPokemonName(member.pokemon_id, member.pokemon_name_snapshot, pokemonDirectory),
      }))
      .filter((member) => member.name);
    if (!resolvedMembers.length) return [];
    const player = models.playerById.get(participant.player_id);
    const result = models.resultByEntryId.get(participant.entry_id);
    if (!event || !player) return [];
    return [{
      id: `${event.id}:${participant.entry_id}:${submission.snapshot_id}`,
      ...models.eventMeta(event),
      entryId: participant.entry_id,
      playerId: participant.player_id,
      owner: cleanName(player.display_name),
      pokemon: resolvedMembers.map((member) => member.name),
      pokemonIds: resolvedMembers.map((member) => member.pokemonId),
      placement: PLACEMENT[result?.placement_code] || "participant",
      team: false,
      snapshotId: submission.snapshot_id,
    }];
  });
}

function summarizeMatches(matches, playerId) {
  const rows = matches
    .filter((match) => match.playerAId === playerId || match.playerBId === playerId)
    .map((match) => ({
      ...match,
      won: match.winnerPlayerId === playerId,
      opponentPlayerId: match.playerAId === playerId ? match.playerBId : match.playerAId,
    }));
  const wins = rows.filter((match) => match.won).length;
  return {
    rows,
    summary: {
      wins,
      losses: rows.length - wins,
      total: rows.length,
      winRate: rows.length ? (wins / rows.length) * 100 : null,
      rival: null,
    },
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

function mergeProfiles(legacySnapshot, legacyRosterSnapshot, normalizedRosterRows, models, linkedTeamBracketIds = new Set()) {
  const profiles = {};
  const consumedLegacyNames = new Set();
  const playersByName = new Map();
  for (const player of models.players) {
    const name = cleanName(player.display_name);
    if (!playersByName.has(name)) playersByName.set(name, []);
    playersByName.get(name).push(player);
  }

  const relevantPlayerIds = new Set([
    ...models.participants.map((row) => row.player_id),
    ...asArray(models.rawRankingBaselines).map((row) => row.player_id),
    ...asArray(models.rawRankingAwards)
      .filter((row) => models.eventIds.has(row.event_id))
      .map((row) => row.player_id),
  ]);

  const normalizedRostersByPlayer = new Map();
  for (const roster of normalizedRosterRows) {
    if (!normalizedRostersByPlayer.has(roster.playerId)) normalizedRostersByPlayer.set(roster.playerId, []);
    normalizedRostersByPlayer.get(roster.playerId).push(roster);
  }

  for (const player of models.players) {
    if (!relevantPlayerIds.has(player.id)) continue;
    const name = cleanName(player.display_name);
    const exactSingle = asArray(playersByName.get(name)).length === 1;
    const legacy = exactSingle ? legacySnapshot.profiles[name] : null;
    if (legacy) consumedLegacyNames.add(name);
    const normalizedPlacements = models.placements.filter((row) => row.playerId === player.id);
    const normalizedParticipations = models.participations.filter((row) => row.playerId === player.id);
    const legacyParticipations = asArray(legacy?.participations)
      .filter((row) => !linkedTeamBracketIds.has(row.bracketId));
    const legacyHistory = asArray(legacy?.history)
      .filter((row) => !linkedTeamBracketIds.has(row.bracketId));
    const rosters = [
      ...(exactSingle ? asArray(legacyRosterSnapshot.profiles[name]?.rosters) : []),
      ...asArray(normalizedRostersByPlayer.get(player.id)),
    ];
    const matchData = summarizeMatches(models.matches, player.id);
    const key = `player:${player.id}`;
    profiles[key] = {
      key,
      playerId: player.id,
      identitySource: "player_id",
      name,
      matches: [...asArray(legacy?.matches), ...matchData.rows],
      placements: [...asArray(legacy?.placements), ...normalizedPlacements],
      participations: [...legacyParticipations, ...normalizedParticipations],
      history: [...legacyHistory, ...normalizedParticipations],
      rosters,
      titles: asArray(legacy?.titles),
      champions: asArray(legacy?.champions),
      matchSummary: {
        wins: number(legacy?.matchSummary?.wins) + matchData.summary.wins,
        losses: number(legacy?.matchSummary?.losses) + matchData.summary.losses,
        total: number(legacy?.matchSummary?.total) + matchData.summary.total,
        winRate: null,
        rival: null,
      },
      favoritePokemon: favoritePokemon(rosters),
    };
  }

  for (const [name, legacy] of Object.entries(legacySnapshot.profiles || {})) {
    if (consumedLegacyNames.has(name)) continue;
    const key = `legacy:${name}`;
    profiles[key] = {
      ...legacy,
      key,
      playerId: null,
      identitySource: "legacy_name",
      rosters: asArray(legacyRosterSnapshot.profiles[name]?.rosters),
    };
  }

  const trainers = Object.values(profiles)
    .map((profile) => ({
      key: profile.key,
      playerId: profile.playerId,
      name: profile.name,
      wins: profile.placements.filter((row) => row.team !== true && row.placement === "win").length,
      runnerUps: profile.placements.filter((row) => row.team !== true && row.placement === "ru").length,
      top4: profile.placements.filter((row) => row.team !== true && row.placement === "sf").length,
      matches: profile.matchSummary?.total || 0,
    }))
    .sort((a, b) =>
      b.wins - a.wins ||
      b.runnerUps - a.runnerUps ||
      b.top4 - a.top4 ||
      a.name.localeCompare(b.name, "ko") ||
      a.key.localeCompare(b.key)
    );

  return { profiles, trainers };
}

function dedupeRankingAwards(rawAwards, eventIds) {
  const ids = new Set();
  const placementKeys = new Set();
  const rows = [];
  for (const award of asArray(rawAwards)) {
    if (!eventIds.has(award?.event_id)) continue;
    if (award.id && ids.has(award.id)) continue;
    if (award.id) ids.add(award.id);
    if (award.award_kind === "placement" && award.result_id) {
      const key = `${award.result_id}:${award.player_id}`;
      if (placementKeys.has(key)) continue;
      placementKeys.add(key);
    }
    rows.push(award);
  }
  return rows;
}

function rankingRows(raw, models, legacyData) {
  const seriesRows = new Map();
  const seasonRows = new Map();
  const ensure = (map, scope, playerId) => {
    const key = `${scope}:${playerId}`;
    if (!map.has(key)) {
      map.set(key, { playerId, name: cleanName(models.playerById.get(playerId)?.display_name), win: 0, ru: 0, top4: 0, points: 0 });
    }
    return map.get(key);
  };
  const apply = (row, delta) => {
    row.points += number(delta.points);
    row.win += number(delta.win);
    row.ru += number(delta.ru);
    row.top4 += number(delta.top4);
  };

  for (const baseline of asArray(raw?.rankingBaselines)) {
    if (!models.playerById.has(baseline.player_id)) continue;
    if (baseline.scope === "series" && baseline.series) {
      apply(ensure(seriesRows, baseline.series, baseline.player_id), {
        points: baseline.points, win: baseline.wins, ru: baseline.runner_ups, top4: baseline.top4s,
      });
    }
    if (baseline.scope === "season" && baseline.season_id) {
      apply(ensure(seasonRows, baseline.season_id, baseline.player_id), {
        points: baseline.points, win: baseline.wins, ru: baseline.runner_ups, top4: baseline.top4s,
      });
    }
  }

  const awards = dedupeRankingAwards(raw?.rankingAwards, models.eventIds);
  for (const award of awards) {
    const event = models.eventById.get(award.event_id);
    const season = models.seasonById.get(event?.season_id);
    const delta = {
      points: award.points_delta,
      win: award.win_delta,
      ru: award.runner_up_delta,
      top4: award.top4_delta,
    };
    if (award.counts_series && season?.series) {
      apply(ensure(seriesRows, season.series, award.player_id), delta);
    }
    if (award.counts_season && season?.id) {
      apply(ensure(seasonRows, season.id, award.player_id), delta);
    }
  }

  const legacySeries = asArray(legacyData?.rankings);
  const seriesNames = new Set([
    ...asArray(raw?.rankingBaselines).filter((row) => row.scope === "series").map((row) => row.series),
    ...models.seasons.map((season) => season.series),
  ].filter(Boolean));
  const series = [...seriesNames].map((seriesName) => {
    const legacy = legacySeries.find((item) =>
      seriesName === "classic" ? String(item.label || "").includes("클래식") : String(item.label || "").toLowerCase() === seriesName.toLowerCase()
    );
    return {
      key: legacy?.key || `normalized-series-${seriesName}`,
      label: legacy?.label || (seriesName === "ypl" ? "YPL" : seriesName === "classic" ? "클래식" : seriesName),
      source: "normalized",
      rows: [...seriesRows.entries()]
        .filter(([key, row]) => key.startsWith(`${seriesName}:`) && row.name)
        .map(([, row]) => row),
    };
  });
  for (const legacy of legacySeries) {
    if (!series.some((item) => item.key === legacy.key)) series.push({ ...legacy, source: "legacy" });
  }

  const normalizedSeasonIds = new Set(models.seasons.map((season) => season.id));
  const seasons = models.seasons
    .slice()
    .sort((a, b) => number(a.sort_order) - number(b.sort_order))
    .map((season) => ({
      id: season.id,
      code: season.code,
      name: season.name,
      source: "normalized",
      rows: [...seasonRows.entries()]
        .filter(([key, row]) => key.startsWith(`${season.id}:`) && row.name)
        .map(([, row]) => row),
    }));
  for (const legacy of asArray(legacyData?.seasons)) {
    if (!seasons.some((season) => season.name === legacy.name)) {
      seasons.push({ ...legacy, source: "legacy" });
    }
  }

  return { series, seasons, awardRows: awards, normalizedSeasonIds };
}

export function buildNormalizedRecordsProjection(legacyData = {}, raw = {}, pokemonDirectory = null) {
  const models = normalizedModels(legacyData, raw);
  models.rawRankingBaselines = asArray(raw.rankingBaselines);
  models.rawRankingAwards = asArray(raw.rankingAwards);

  const normalizedTeamEventIds = new Set(
    models.events.filter((event) => event.is_team_event).map((event) => event.id)
  );
  const filteredLegacyData = filterLinkedLegacyRecords(legacyData, models.eventIds, normalizedTeamEventIds);
  const linkedTeamBracketIds = new Set(
    asArray(filteredLegacyData.brackets)
      .filter((bracket) => normalizedTeamEventIds.has(bracket?.eventId))
      .map((bracket) => bracket.id)
      .filter(Boolean)
  );
  const legacySnapshot = buildRecordsSnapshot(filteredLegacyData);
  const allLegacySnapshot = buildRecordsSnapshot(legacyData);
  const normalizedRosterRows = normalizedRosters(raw, models, pokemonDirectory);
  const finalizedEventIds = new Set(
    models.events
      .filter((event) => Boolean(event.team_revealed_at))
      .map((event) => event.id)
  );
  const linkedBracketEvent = new Map(
    asArray(legacyData.brackets).map((bracket) => [bracket.id, bracket.eventId])
  );
  const fallbackLegacyRosters = allLegacySnapshot.rosters.filter((roster) => {
    const eventId = linkedBracketEvent.get(roster.bracketId);
    return !eventId || !finalizedEventIds.has(eventId);
  });
  const rosterLegacyData = {
    ...filteredLegacyData,
    brackets: asArray(legacyData.brackets).filter((bracket) => {
      if (!models.eventIds.has(bracket.eventId)) return true;
      return !finalizedEventIds.has(bracket.eventId);
    }),
  };
  const legacyRosterSnapshot = buildRecordsSnapshot(rosterLegacyData);
  legacyRosterSnapshot.rosters = fallbackLegacyRosters;

  const identity = mergeProfiles(
    legacySnapshot,
    legacyRosterSnapshot,
    normalizedRosterRows,
    models,
    linkedTeamBracketIds
  );
  const legacyParticipations = legacySnapshot.participations
    .filter((row) => !linkedTeamBracketIds.has(row.bracketId));
  const rosters = [...fallbackLegacyRosters, ...normalizedRosterRows];
  const ranking = rankingRows(raw, models, legacyData);
  const compatibilityTeamBrackets = asArray(filteredLegacyData.brackets)
    .filter((bracket) => bracket?.applied && normalizedTeamEventIds.has(bracket.eventId)).length;
  const normalizedArchives = models.archives.map((archive) => {
    if (archive.team) return archive;
    const rosterByEntryId = new Map(
      normalizedRosterRows
        .filter((roster) => roster.eventId === archive.eventId)
        .map((roster) => [roster.entryId, roster])
    );
    const previews = (entryIds) => asArray(entryIds).map((entryId) => rosterByEntryId.get(entryId) || null);
    return {
      ...archive,
      rosters: [...rosterByEntryId.values()],
      individualParticipants: archive.individualParticipants.map((participant) => ({
        ...participant,
        roster: rosterByEntryId.get(participant.entryId) || null,
      })),
      partyPreviews: {
        win: previews(archive.winEntryIds),
        ru: previews(archive.ruEntryIds),
        sf: previews(archive.sfEntryIds),
      },
    };
  });
  const archives = [...legacySnapshot.archives.map((row) => ({ ...row, source: "legacy" })), ...normalizedArchives]
    .sort((a, b) => (a.date === b.date ? String(b.round || "").localeCompare(String(a.round || ""), "ko") : a.date < b.date ? 1 : -1));
  const seasons = [...new Set([
    ...models.seasons.slice().sort((a, b) => number(b.sort_order) - number(a.sort_order)).map((season) => season.name),
    ...legacySnapshot.seasons,
  ].filter(Boolean))];

  return {
    ...legacySnapshot,
    profiles: identity.profiles,
    trainers: identity.trainers,
    matches: [...legacySnapshot.matches, ...models.matches],
    rosters,
    participations: [...legacyParticipations, ...models.participations],
    placements: [...legacySnapshot.placements, ...models.placements],
    archives,
    pokemon: buildPokemonStats(rosters, legacyData.champions || []),
    seasons,
    ranking,
    normalized: {
      schema: raw.schema || null,
      eventIds: [...models.eventIds],
      events: models.events,
      awards: ranking.awardRows,
    },
    coverage: {
      appliedBrackets: legacySnapshot.coverage.appliedBrackets - compatibilityTeamBrackets + models.events.length,
      officialMatches: legacySnapshot.coverage.officialMatches + models.matches.length,
      savedRosters: rosters.length,
      archiveEvents: archives.length,
      normalizedEvents: models.events.length,
    },
  };
}
