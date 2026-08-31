import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_OUTPUT = path.resolve("docs/db/legacy_normalized_migration.sql");

assert(process.argv[2], "Usage: node scripts/generate-normalized-migration.mjs <site_data_rows.csv> [output.sql] [target_schema]");
const inputPath = path.resolve(process.argv[2]);
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUTPUT;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sqlText(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  if (value === null || value === undefined) return "'{}'::jsonb";
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function sqlBool(value) {
  return value ? "true" : "false";
}

function stableUuid(namespace, ...parts) {
  const hex = crypto
    .createHash("sha256")
    .update([namespace, ...parts].map((v) => String(v ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 32)
    .split("");

  // UUID-compatible version/variant bits. This is only for deterministic
  // migration identifiers; it is not intended to implement RFC UUIDv5.
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);

  const raw = hex.join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function loadLegacyData(filePath) {
  assert(fs.existsSync(filePath), `Input CSV not found: ${filePath}`);

  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  assert(rows.length >= 2, "CSV has no data row");

  const header = rows[0];
  const keyIndex = header.indexOf("key");
  const valueIndex = header.indexOf("value");

  assert(keyIndex >= 0, 'CSV header "key" not found');
  assert(valueIndex >= 0, 'CSV header "value" not found');

  const sourceRow = rows.slice(1).find((row) => row[keyIndex] === "ypl_data_v4");
  assert(sourceRow, 'site_data key "ypl_data_v4" not found');

  const data = JSON.parse(sourceRow[valueIndex]);
  assert(data && typeof data === "object", "ypl_data_v4 is not an object");
  assert(Array.isArray(data.seasons), "seasons missing");
  assert(Array.isArray(data.tournaments), "tournaments missing");

  return data;
}

const data = loadLegacyData(inputPath);

console.log("Loaded ypl_data_v4");
console.log({
  seasons: data.seasons.length,
  tournamentGroups: data.tournaments.length,
  tournamentRounds: data.tournaments.reduce((n, group) => n + (group.rounds?.length || 0), 0),
  brackets: data.brackets?.length || 0,
  champions: data.champions?.length || 0,
});

function addPlayerName(target, value) {
  const name = clean(value);
  if (name) target.add(name);
}

function collectPlayerNames(source) {
  const names = new Set();

  for (const season of source.seasons || []) {
    for (const row of season.rows || []) addPlayerName(names, row.name);
  }

  for (const ranking of source.rankings || []) {
    for (const row of ranking.rows || []) addPlayerName(names, row.name);
  }

  for (const tournament of source.tournaments || []) {
    for (const round of tournament.rounds || []) {
      if (round.team === true) {
        for (const name of round.winMembers || []) addPlayerName(names, name);
        for (const name of round.ruMembers || []) addPlayerName(names, name);
        for (const group of round.sfMembers || []) {
          for (const name of group || []) addPlayerName(names, name);
        }
      } else {
        addPlayerName(names, round.win);
        addPlayerName(names, round.ru);
        for (const name of round.sf || []) addPlayerName(names, name);
      }
    }
  }

  for (const bracket of source.brackets || []) {
    for (const participant of bracket.participants || []) {
      addPlayerName(names, participant.name);
    }
  }

  for (const champion of source.champions || []) {
    addPlayerName(names, champion.name);
  }

  for (const group of source.titleGroups || []) {
    if (group.key === "partner") {
      // Legacy partner data is inverted:
      // item.name = Player, holders = Pokémon names.
      for (const item of group.items || []) addPlayerName(names, item.name);
    } else {
      for (const item of group.items || []) {
        for (const holder of item.holders || []) addPlayerName(names, holder);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

function parseSeasonName(name) {
  const value = clean(name);
  const match = value.match(/^(클래식|YPL)\s*시즌\s*(\d+)$/i);
  assert(match, `Unrecognized season name: ${value}`);

  const series = match[1].toUpperCase() === "YPL" ? "ypl" : "classic";
  const number = Number(match[2]);

  return {
    id: stableUuid("season", series, number),
    code: `${series}-${number}`,
    name: value,
    series,
    number,
  };
}

function parseLegacyDate(value) {
  const raw = clean(value).replace(/\.+$/, "");
  if (!raw) return { heldOn: null, precision: "unknown" };

  let match = raw.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    return {
      heldOn: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      precision: "exact",
    };
  }

  match = raw.match(/^(\d{4})\.(\d{1,2})$/);
  if (match) {
    const [, y, m] = match;
    return {
      heldOn: `${y}-${m.padStart(2, "0")}-01`,
      precision: "month",
    };
  }

  match = raw.match(/^(\d{4})$/);
  if (match) {
    return {
      heldOn: `${match[1]}-01-01`,
      precision: "year",
    };
  }

  throw new Error(`Unrecognized legacy date: ${value}`);
}

function eventClassification(tournamentKey, round) {
  if (round.champ === true) {
    return { eventType: "champions", division: null };
  }
  if (tournamentKey === "pylite") {
    return { eventType: "light", division: null };
  }
  if (tournamentKey === "master") {
    return { eventType: "pokecup", division: "master" };
  }
  if (tournamentKey === "rookie") {
    return { eventType: "pokecup", division: "rookie" };
  }
  if (tournamentKey === "pycup") {
    return { eventType: "pokecup", division: null };
  }
  throw new Error(`Unknown tournament key: ${tournamentKey}`);
}

function eventName(tournamentKey, round) {
  const no = clean(round.round);
  assert(no, `Round number missing: ${tournamentKey} ${round.date}`);

  if (round.champ === true) return `${no}회 챔피언스 시리즈`;
  if (tournamentKey === "master") return `${no}회 파이컵 | 마스터리그`;
  if (tournamentKey === "rookie") return `${no}회 파이컵 | 루키리그`;
  if (tournamentKey === "pylite") return `${no}회 파이컵 라이트`;
  return `${no}회 파이컵`;
}

function legacyEventKey(tournamentKey, round) {
  return [
    tournamentKey,
    round.champ === true ? "champions" : "regular",
    clean(round.round),
    clean(round.date),
    clean(round.season),
  ].join("|");
}

const bracketByAppliedKey = new Map();

for (const bracket of data.brackets || []) {
  const applied = bracket.applied || {};
  const key = [
    clean(applied.tournamentKey),
    clean(applied.season),
    clean(applied.date),
  ].join("|");

  assert(!bracketByAppliedKey.has(key), `Duplicate bracket applied key: ${key}`);
  bracketByAppliedKey.set(key, bracket);
}

const players = collectPlayerNames(data).map((displayName) => ({
  id: stableUuid("player", displayName),
  displayName,
}));

const seasons = (data.seasons || []).map((season) => parseSeasonName(season.name));
const seasonByName = new Map(seasons.map((season) => [season.name, season]));

const events = [];

for (const tournament of data.tournaments || []) {
  for (const round of tournament.rounds || []) {
    const season = seasonByName.get(clean(round.season));
    assert(season, `Season not found for event: ${round.season}`);

    const classification = eventClassification(tournament.key, round);
    const parsedDate = parseLegacyDate(round.date);
    const appliedKey = [
      tournament.key,
      clean(round.season),
      clean(round.date),
    ].join("|");
    const bracket = bracketByAppliedKey.get(appliedKey) || null;

    let competitionFormat = null;
    if (bracket) {
      assert(
        bracket.graph?.kind === "double",
        `Unsupported historical bracket kind: ${bracket.name} / ${bracket.graph?.kind}`
      );
      competitionFormat = "double_elimination";
    }

    const recordCompleteness = bracket
      ? "full_match"
      : tournament.key === "pylite"
        ? "winner_only"
        : "placement";

    const key = legacyEventKey(tournament.key, round);

    events.push({
      id: stableUuid("event", key),
      legacyKey: key,
      tournamentKey: tournament.key,
      seasonId: season.id,
      name: eventName(tournament.key, round),
      roundNumber: Number(round.round),
      eventType: classification.eventType,
      division: classification.division,
      battleFormat: null,
      competitionFormat,
      isTeamEvent: round.team === true,
      heldOn: parsedDate.heldOn,
      datePrecision: parsedDate.precision,
      recordCompleteness,
      status: "completed",
      sourceRound: round,
      sourceTournament: tournament,
      sourceBracket: bracket,
    });
  }
}

assert(players.length === 64, `Expected 64 players, got ${players.length}`);
assert(seasons.length === 6, `Expected 6 seasons, got ${seasons.length}`);
assert(events.length === 57, `Expected 57 events, got ${events.length}`);
assert(new Set(events.map((event) => event.id)).size === 57, "Duplicate Event UUID generated");

const eventSummary = {};
for (const event of events) {
  const key = `${event.eventType}/${event.division ?? "none"}`;
  eventSummary[key] = (eventSummary[key] || 0) + 1;
}

const completenessSummary = {};
for (const event of events) {
  completenessSummary[event.recordCompleteness] =
    (completenessSummary[event.recordCompleteness] || 0) + 1;
}

console.log("Normalized core model");
console.log({
  players: players.length,
  seasons: seasons.length,
  events: events.length,
  individualEvents: events.filter((event) => !event.isTeamEvent).length,
  teamEvents: events.filter((event) => event.isTeamEvent).length,
  eventSummary,
  completenessSummary,
  historicalBattleFormats: events.filter((event) => event.battleFormat !== null).length,
  doubleEliminationEvents: events.filter(
    (event) => event.competitionFormat === "double_elimination"
  ).length,
});

const playerByName = new Map(players.map((player) => [player.displayName, player]));

const registrations = [];
const registrationByEventPlayer = new Map();

const entries = [];
const entryById = new Map();

const entryParticipants = [];
const entryParticipantByEventPlayer = new Map();

const results = [];

function requirePlayer(name, context) {
  const cleaned = clean(name);
  const player = playerByName.get(cleaned);
  assert(player, `Player not found: ${cleaned} (${context})`);
  return player;
}

function ensureRegistration(event, player) {
  const key = `${event.id}|${player.id}`;

  if (registrationByEventPlayer.has(key)) {
    return registrationByEventPlayer.get(key);
  }

  const registration = {
    id: stableUuid("registration", event.id, player.id),
    eventId: event.id,
    playerId: player.id,
    registrationName: player.displayName,
    registrationData: {},
    registrationSource: "migration",
    registeredAt: null,
    finalSubmissionId: null,
  };

  registrations.push(registration);
  registrationByEventPlayer.set(key, registration);
  return registration;
}

function addEntry(event, entryType, displayName, identityKey) {
  const id = stableUuid("entry", event.id, entryType, identityKey);

  if (entryById.has(id)) return entryById.get(id);

  const entry = {
    id,
    eventId: event.id,
    entryType,
    displayName: clean(displayName) || null,
    seed: null,
    status: "active",
  };

  entries.push(entry);
  entryById.set(id, entry);
  return entry;
}

function addEntryParticipant(event, entry, player, memberOrder) {
  const eventPlayerKey = `${event.id}|${player.id}`;
  const existing = entryParticipantByEventPlayer.get(eventPlayerKey);

  if (existing) {
    assert(
      existing.entryId === entry.id,
      `Player assigned to multiple Entries in one Event: ${player.displayName} / ${event.name}`
    );
    return existing;
  }

  const registration = ensureRegistration(event, player);

  const row = {
    id: stableUuid("entry_participant", event.id, entry.id, player.id),
    eventId: event.id,
    entryId: entry.id,
    registrationId: registration.id,
    playerId: player.id,
    memberOrder,
    role: null,
  };

  entryParticipants.push(row);
  entryParticipantByEventPlayer.set(eventPlayerKey, row);
  return row;
}

function placementSpec(code, isTeam) {
  if (code === "champion") {
    return {
      placementCode: "champion",
      rankMin: 1,
      rankMax: 1,
      placementLabel: isTeam ? "팀 우승" : "우승",
    };
  }

  if (code === "runner_up") {
    return {
      placementCode: "runner_up",
      rankMin: 2,
      rankMax: 2,
      placementLabel: isTeam ? "팀 준우승" : "준우승",
    };
  }

  if (code === "semifinalist") {
    return {
      placementCode: "semifinalist",
      rankMin: 3,
      rankMax: 4,
      placementLabel: isTeam ? "팀 4강" : "4강",
    };
  }

  throw new Error(`Unknown placement code: ${code}`);
}

function addResult(event, entry, code) {
  const spec = placementSpec(code, event.isTeamEvent);

  const result = {
    id: stableUuid("result", event.id, entry.id),
    eventId: event.id,
    entryId: entry.id,
    ...spec,
    source: "legacy_tournament",
  };

  results.push(result);
  return result;
}

function addIndividualPlacement(event, name, code) {
  const player = requirePlayer(name, `${event.name} ${code}`);
  const entry = addEntry(event, "individual", player.displayName, player.id);
  addEntryParticipant(event, entry, player, 1);
  addResult(event, entry, code);
}

function addTeamPlacement(event, teamName, members, code) {
  const cleanedTeamName = clean(teamName);
  const cleanMembers = (members || []).map(clean).filter(Boolean);

  assert(cleanMembers.length > 0, `Team members missing: ${event.name} / ${cleanedTeamName || "(unnamed)"}`);

  const identityKey = `${code}|${cleanedTeamName || cleanMembers.join("|")}`;
  const entry = addEntry(event, "team", cleanedTeamName || null, identityKey);

  cleanMembers.forEach((name, index) => {
    const player = requirePlayer(name, `${event.name} / ${cleanedTeamName}`);
    addEntryParticipant(event, entry, player, index + 1);
  });

  addResult(event, entry, code);
}

for (const event of events) {
  const round = event.sourceRound;

  if (event.isTeamEvent) {
    if (clean(round.winMembers?.[0])) {
      addTeamPlacement(event, round.win, round.winMembers, "champion");
    }

    if (clean(round.ruMembers?.[0])) {
      addTeamPlacement(event, round.ru, round.ruMembers, "runner_up");
    }

    (round.sfMembers || []).forEach((members, index) => {
      if ((members || []).map(clean).filter(Boolean).length === 0) return;
      addTeamPlacement(
        event,
        (round.sf || [])[index],
        members,
        "semifinalist"
      );
    });
  } else {
    if (clean(round.win)) addIndividualPlacement(event, round.win, "champion");
    if (clean(round.ru)) addIndividualPlacement(event, round.ru, "runner_up");

    for (const name of round.sf || []) {
      if (clean(name)) addIndividualPlacement(event, name, "semifinalist");
    }
  }
}

// Historical brackets may contain participants who are not present in the
// placement-only tournament record. Add only those missing participants.
// Existing placement Entries are reused.
const bracketParticipantEntry = new Map();

for (const event of events) {
  const bracket = event.sourceBracket;
  if (!bracket) continue;

  assert(!event.isTeamEvent, `Historical bracket unexpectedly belongs to team Event: ${event.name}`);

  for (const participant of bracket.participants || []) {
    const player = requirePlayer(
      participant.name,
      `${event.name} bracket participant`
    );

    const eventPlayerKey = `${event.id}|${player.id}`;
    let participantRow = entryParticipantByEventPlayer.get(eventPlayerKey);

    if (!participantRow) {
      const entry = addEntry(
        event,
        "individual",
        player.displayName,
        player.id
      );

      participantRow = addEntryParticipant(
        event,
        entry,
        player,
        1
      );
    }

    bracketParticipantEntry.set(
      `${bracket.id}|${participant.id}`,
      participantRow.entryId
    );
  }
}

assert(registrations.length === 254, `Expected 254 registrations, got ${registrations.length}`);
assert(entries.length === 214, `Expected 214 entries, got ${entries.length}`);
assert(entryParticipants.length === 254, `Expected 254 entry participants, got ${entryParticipants.length}`);
assert(results.length === 204, `Expected 204 results, got ${results.length}`);

assert(
  new Set(registrations.map((row) => `${row.eventId}|${row.playerId}`)).size === registrations.length,
  "Duplicate EventRegistration event/player pair"
);

assert(
  new Set(entryParticipants.map((row) => `${row.eventId}|${row.playerId}`)).size === entryParticipants.length,
  "Duplicate EntryParticipant event/player pair"
);

assert(
  new Set(results.map((row) => `${row.eventId}|${row.entryId}`)).size === results.length,
  "Duplicate Result event/entry pair"
);

console.log("Participation and results model");
console.log({
  registrations: registrations.length,
  entries: entries.length,
  entryParticipants: entryParticipants.length,
  results: results.length,
  resultPlacements: Object.fromEntries(
    [...new Set(results.map((row) => row.placementCode))].map((code) => [
      code,
      results.filter((row) => row.placementCode === code).length,
    ])
  ),
  bracketParticipantMappings: bracketParticipantEntry.size,
});





const teamSnapshots = [];
const teamSnapshotMembers = [];
const registrationSubmissions = [];

function addHistoricalSnapshot(registration, pokemonNames, sourceReference) {
  const names = (pokemonNames || []).map(clean).filter(Boolean);

  assert(
    names.length >= 1 && names.length <= 6,
    `Historical snapshot must contain 1-6 Pokémon: ${sourceReference}`
  );

  assert(
    !registrationSubmissions.some((row) => row.registrationId === registration.id),
    `Historical Registration already has a submission: ${registration.registrationName} / ${sourceReference}`
  );

  const snapshot = {
    id: stableUuid("team_snapshot", registration.id, sourceReference),
    schemaVersion: 1,
    regulationId: null,
    cupRuleId: null,
    cupRuleSettings: {},
    sourceType: "historical",
    sourceReference,
    importedAt: null,
  };

  teamSnapshots.push(snapshot);

  names.forEach((pokemonName, index) => {
    teamSnapshotMembers.push({
      id: stableUuid("team_snapshot_member", snapshot.id, index + 1),
      snapshotId: snapshot.id,
      slot: index + 1,
      pokemonId: null,
      pokemonNameSnapshot: pokemonName,
      abilityId: null,
      natureId: null,
      statHp: 0,
      statAtk: 0,
      statDef: 0,
      statSpa: 0,
      statSpd: 0,
      statSpe: 0,
      itemId: null,
      move1Id: null,
      move2Id: null,
      move3Id: null,
      move4Id: null,
    });
  });

  const submission = {
    id: stableUuid("registration_submission", registration.id, 1),
    registrationId: registration.id,
    snapshotId: snapshot.id,
    revision: 1,
    submittedAt: null,
    source: "legacy_migration",
  };

  registrationSubmissions.push(submission);
  registration.finalSubmissionId = submission.id;

  return { snapshot, submission };
}

function championGenerationNumber(champion, index) {
  const label = clean(champion.gen);

  if (label === "초대") return 1;

  const match = label.match(/^(\d+)대(?:\s*챔피언)?$/);
  if (match) return Number(match[1]);

  // Preserve deterministic order as a guarded fallback, but require the
  // legacy sequence to agree with the resulting Champions Event.
  return index + 1;
}

// Historical Hall of Fame champion parties.
// Map by generation number to the actual champ=true Event, not champions.slabel.
(data.champions || []).forEach((champion, index) => {
  const generation = championGenerationNumber(champion, index);

  const event = events.find(
    (candidate) =>
      candidate.eventType === "champions" &&
      candidate.roundNumber === generation
  );

  assert(event, `Champions Event not found for generation ${generation}`);

  const championName = clean(champion.name);
  assert(
    clean(event.sourceRound.win) === championName,
    `Champion mismatch for generation ${generation}: ${championName} vs ${event.sourceRound.win}`
  );

  const player = requirePlayer(
    championName,
    `Champions generation ${generation}`
  );

  const registration = registrationByEventPlayer.get(
    `${event.id}|${player.id}`
  );

  assert(
    registration,
    `Champion Registration not found: ${generation} / ${championName}`
  );

  const pokemonNames = (champion.team || []).map((member) => clean(member?.name));

  addHistoricalSnapshot(
    registration,
    pokemonNames,
    `legacy:champions:${generation}:${championName}`
  );
});

// Historical bracket parties.
// party is a comma-separated Pokémon-name string in legacy ypl_data_v4.
for (const event of events) {
  const bracket = event.sourceBracket;
  if (!bracket) continue;

  for (const participant of bracket.participants || []) {
    const partyText = clean(participant.party);
    if (!partyText) continue;

    const player = requirePlayer(
      participant.name,
      `${event.name} historical bracket party`
    );

    const registration = registrationByEventPlayer.get(
      `${event.id}|${player.id}`
    );

    assert(
      registration,
      `Bracket party Registration not found: ${event.name} / ${participant.name}`
    );

    const pokemonNames = partyText
      .split(",")
      .map(clean)
      .filter(Boolean);

    addHistoricalSnapshot(
      registration,
      pokemonNames,
      `legacy:bracket:${bracket.id}:${participant.id}:${player.displayName}`
    );
  }
}

assert(
  teamSnapshots.length === 13,
  `Expected 13 historical TeamSnapshots, got ${teamSnapshots.length}`
);

assert(
  teamSnapshotMembers.length === 78,
  `Expected 78 historical TeamSnapshotMembers, got ${teamSnapshotMembers.length}`
);

assert(
  registrationSubmissions.length === 13,
  `Expected 13 historical RegistrationSubmissions, got ${registrationSubmissions.length}`
);

assert(
  registrations.filter((row) => row.finalSubmissionId !== null).length === 13,
  `Expected 13 final historical submissions, got ${
    registrations.filter((row) => row.finalSubmissionId !== null).length
  }`
);

assert(
  new Set(teamSnapshotMembers.map((row) => `${row.snapshotId}|${row.slot}`)).size ===
    teamSnapshotMembers.length,
  "Duplicate TeamSnapshot member slot"
);

console.log("Historical team snapshots");
console.log({
  snapshots: teamSnapshots.length,
  snapshotMembers: teamSnapshotMembers.length,
  submissions: registrationSubmissions.length,
  finalSubmissionPointers: registrations.filter(
    (row) => row.finalSubmissionId !== null
  ).length,
  championSnapshots: (data.champions || []).length,
  bracketSnapshots: teamSnapshots.length - (data.champions || []).length,
});

const matches = [];

function bracketNodeList(bracket) {
  const rows = [];

  (bracket.graph?.rounds || []).forEach((roundNodes, roundIndex) => {
    (roundNodes || []).forEach((node) => {
      rows.push({
        node,
        stageLabel: `Winners R${roundIndex + 1}`,
        stageOrder: roundIndex + 1,
      });
    });
  });

  (bracket.graph?.lb || []).forEach((roundGroup, roundIndex) => {
    const nodes = Array.isArray(roundGroup?.[0]) ? roundGroup.flat() : roundGroup;
    (nodes || []).forEach((node) => {
      rows.push({
        node,
        stageLabel: `Losers R${roundIndex + 1}`,
        stageOrder: 100 + roundIndex + 1,
      });
    });
  });

  if (bracket.graph?.gf) {
    rows.push({
      node: bracket.graph.gf,
      stageLabel: "Grand Final",
      stageOrder: 200,
    });
  }

  if (bracket.graph?.reset) {
    rows.push({
      node: bracket.graph.reset,
      stageLabel: "Grand Final Reset",
      stageOrder: 201,
    });
  }

  return rows;
}

for (const event of events) {
  const bracket = event.sourceBracket;
  if (!bracket) continue;

  const listedNodes = bracketNodeList(bracket);
  const nodeById = new Map(
    listedNodes.map(({ node }) => [node.id, node])
  );

  function resolveSlot(slot, stack = new Set()) {
    if (!slot || slot.bye === true) return null;

    if (slot.pid) {
      const entryId = bracketParticipantEntry.get(
        `${bracket.id}|${slot.pid}`
      );
      assert(
        entryId,
        `Bracket participant Entry not found: ${bracket.name} / ${slot.pid}`
      );
      return entryId;
    }

    if (slot.win) return resolveWinner(slot.win, stack);
    if (slot.lose) return resolveLoser(slot.lose, stack);

    throw new Error(
      `Unknown bracket slot: ${bracket.name} / ${JSON.stringify(slot)}`
    );
  }

  function resolveSides(nodeId, stack = new Set()) {
    assert(!stack.has(nodeId), `Bracket graph cycle detected: ${bracket.name} / ${nodeId}`);

    const nextStack = new Set(stack);
    nextStack.add(nodeId);

    const node = nodeById.get(nodeId);
    assert(node, `Bracket node not found: ${bracket.name} / ${nodeId}`);

    return {
      node,
      a: resolveSlot(node.a, nextStack),
      b: resolveSlot(node.b, nextStack),
    };
  }

  function resolveWinner(nodeId, stack = new Set()) {
    const { node, a, b } = resolveSides(nodeId, stack);

    // Structural bye / automatic advancement.
    // This is used only to resolve downstream participants and is not
    // itself materialized as a Match.
    if (a && !b) return a;
    if (!a && b) return b;

    if (!a || !b) return null;
    if (node.winner === "a") return a;
    if (node.winner === "b") return b;

    // Two real entrants with no recorded winner: do not infer.
    return null;
  }

  function resolveLoser(nodeId, stack = new Set()) {
    const { node, a, b } = resolveSides(nodeId, stack);

    // Automatic advancement has no real losing entrant.
    if (!a || !b) return null;

    if (node.winner === "a") return b;
    if (node.winner === "b") return a;

    return null;
  }

  let sequenceNo = 0;

  for (const { node, stageLabel } of listedNodes) {
    const entryAId = resolveSlot(node.a);
    const entryBId = resolveSlot(node.b);
    const winnerEntryId = resolveWinner(node.id);

    // Only materialize an actual recoverable played match:
    // two real entrants and a recorded/resolvable winner.
    if (!entryAId || !entryBId || !winnerEntryId) continue;

    sequenceNo += 1;

    assert(
      winnerEntryId === entryAId || winnerEntryId === entryBId,
      `Resolved winner is not a participant: ${bracket.name} / ${node.id}`
    );

    matches.push({
      id: stableUuid("match", event.id, node.id),
      eventId: event.id,
      parentMatchId: null,
      matchKind: "bracket",
      roundNumber: null,
      stageLabel,
      sequenceNo,
      entryAId,
      entryBId,
      playerAId: null,
      playerBId: null,
      winnerEntryId,
      winnerPlayerId: null,
      resolution: "played",
      source: "legacy_bracket",
      sourceNodeKey: node.id,
      playedAt: null,
    });
  }
}

assert(matches.length === 39, `Expected 39 recoverable Matches, got ${matches.length}`);

assert(
  new Set(matches.map((row) => `${row.eventId}|${row.sourceNodeKey}`)).size ===
    matches.length,
  "Duplicate historical Match source node"
);

const matchCountsByEvent = Object.fromEntries(
  events
    .filter((event) => event.sourceBracket)
    .map((event) => [
      event.name,
      matches.filter((row) => row.eventId === event.id).length,
    ])
);

console.log("Historical matches");
console.log({
  matches: matches.length,
  byEvent: matchCountsByEvent,
});

const rankingBaselines = [];

function numeric(value) {
  const number = Number(value ?? 0);
  assert(Number.isFinite(number), `Invalid numeric value: ${value}`);
  return number;
}

function rankingSeries(ranking) {
  if (ranking.key === "era1" || clean(ranking.label) === "클래식") return "classic";
  if (ranking.key === "era2" || clean(ranking.label).toUpperCase() === "YPL") return "ypl";
  throw new Error(`Unknown ranking series: ${ranking.key} / ${ranking.label}`);
}

function canonicalSeriesRows(ranking) {
  const groups = new Map();

  for (const row of ranking.rows || []) {
    const name = clean(row.name);
    if (!name) continue;

    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }

  const canonical = [];

  for (const [name, rows] of groups) {
    if (rows.length === 1) {
      canonical.push(rows[0]);
      continue;
    }

    // Known legacy anomaly only:
    // 클래식 누적 랭킹에 이동하가 25점/20점 두 번 남아 있다.
    // 25점 행이 최신 canonical value이며 20점 행은 stale duplicate.
    assert(
      clean(ranking.label) === "클래식" &&
        name === "이동하" &&
        rows.length === 2,
      `Unexpected duplicate ranking row: ${ranking.label} / ${name} / ${rows.length}`
    );

    const sorted = [...rows].sort(
      (a, b) => numeric(b.points) - numeric(a.points)
    );

    assert(
      numeric(sorted[0].points) === 25 &&
        numeric(sorted[1].points) === 20 &&
        numeric(sorted[0].win) === numeric(sorted[1].win) &&
        numeric(sorted[0].ru) === numeric(sorted[1].ru) &&
        numeric(sorted[0].top4) === numeric(sorted[1].top4),
      `Unexpected 이동하 legacy ranking duplicate shape`
    );

    canonical.push(sorted[0]);
  }

  return canonical;
}

// Series-wide legacy ranking snapshots.
for (const ranking of data.rankings || []) {
  const series = rankingSeries(ranking);

  for (const row of canonicalSeriesRows(ranking)) {
    const player = requirePlayer(
      row.name,
      `series ranking ${ranking.label}`
    );

    rankingBaselines.push({
      id: stableUuid("ranking_baseline", "series", series, player.id),
      playerId: player.id,
      scope: "series",
      series,
      seasonId: null,
      points: numeric(row.points),
      wins: numeric(row.win),
      runnerUps: numeric(row.ru),
      top4s: numeric(row.top4),
      source: "legacy_ranking",
      note: `Migrated from ypl_data_v4 rankings/${ranking.key}`,
    });
  }
}

// Per-season legacy ranking snapshots.
for (const legacySeason of data.seasons || []) {
  const season = seasonByName.get(clean(legacySeason.name));
  assert(season, `Season baseline target not found: ${legacySeason.name}`);

  for (const row of legacySeason.rows || []) {
    const player = requirePlayer(
      row.name,
      `season ranking ${legacySeason.name}`
    );

    rankingBaselines.push({
      id: stableUuid("ranking_baseline", "season", season.id, player.id),
      playerId: player.id,
      scope: "season",
      series: null,
      seasonId: season.id,
      points: numeric(row.points),
      wins: numeric(row.win),
      runnerUps: numeric(row.ru),
      top4s: numeric(row.top4),
      source: "legacy_season_ranking",
      note: `Migrated from ypl_data_v4 seasons/${legacySeason.name}`,
    });
  }
}

const seriesBaselines = rankingBaselines.filter(
  (row) => row.scope === "series"
);
const seasonBaselines = rankingBaselines.filter(
  (row) => row.scope === "season"
);

assert(
  seriesBaselines.length === 61,
  `Expected 61 series RankingBaselines, got ${seriesBaselines.length}`
);

assert(
  seasonBaselines.length === 99,
  `Expected 99 season RankingBaselines, got ${seasonBaselines.length}`
);

assert(
  rankingBaselines.length === 160,
  `Expected 160 RankingBaselines, got ${rankingBaselines.length}`
);

assert(
  new Set(
    seriesBaselines.map((row) => `${row.playerId}|${row.series}`)
  ).size === seriesBaselines.length,
  "Duplicate series RankingBaseline"
);

assert(
  new Set(
    seasonBaselines.map((row) => `${row.playerId}|${row.seasonId}`)
  ).size === seasonBaselines.length,
  "Duplicate season RankingBaseline"
);

const leeDongha = requirePlayer("이동하", "ranking regression");
const leeClassic = seriesBaselines.find(
  (row) =>
    row.playerId === leeDongha.id &&
    row.series === "classic"
);

assert(leeClassic, "이동하 classic RankingBaseline missing");
assert(
  leeClassic.points === 25 &&
    leeClassic.wins === 0 &&
    leeClassic.runnerUps === 1 &&
    leeClassic.top4s === 1,
  "이동하 classic RankingBaseline regression"
);

console.log("Historical ranking baselines");
console.log({
  rankingBaselines: rankingBaselines.length,
  series: seriesBaselines.length,
  season: seasonBaselines.length,
  leeDonghaClassic: {
    points: leeClassic.points,
    wins: leeClassic.wins,
    runnerUps: leeClassic.runnerUps,
    top4s: leeClassic.top4s,
  },
});

const titleDefinitions = [];
const titleAwards = [];
const playerPartners = [];

for (const group of data.titleGroups || []) {
  if (group.key === "partner") {
    for (const item of group.items || []) {
      const player = requirePlayer(
        item.name,
        `legacy partner ${item.name}`
      );

      for (const pokemonNameRaw of item.holders || []) {
        const pokemonName = clean(pokemonNameRaw);
        if (!pokemonName) continue;

        playerPartners.push({
          id: stableUuid(
            "player_partner",
            player.id,
            item.id,
            pokemonName
          ),
          playerId: player.id,
          pokemonId: null,
          pokemonNameSnapshot: pokemonName,
          source: "legacy_title_partner",
        });
      }
    }

    continue;
  }

  for (const [index, item] of (group.items || []).entries()) {
    const titleName = clean(item.name);
    assert(titleName, `Legacy title name missing: ${group.key} / ${item.id}`);

    const definition = {
      id: stableUuid("title_definition", group.key, item.id),
      code: `legacy-${group.key}-${item.id}`,
      name: titleName,
      description: clean(item.desc) || null,
      groupCode: group.key,
      awardMode: "manual",
      sortOrder: index,
      active: true,
    };

    titleDefinitions.push(definition);

    for (const holderRaw of item.holders || []) {
      const holder = clean(holderRaw);
      if (!holder) continue;

      const player = requirePlayer(
        holder,
        `legacy title ${group.key}/${titleName}`
      );

      titleAwards.push({
        id: stableUuid(
          "title_award",
          definition.id,
          player.id
        ),
        titleId: definition.id,
        playerId: player.id,
        eventId: null,
        resultId: null,
        source: "legacy_title",
        reason: null,
        awardedAt: null,
        revokedAt: null,
      });
    }
  }
}

assert(
  titleDefinitions.length === 42,
  `Expected 42 TitleDefinitions, got ${titleDefinitions.length}`
);

assert(
  titleAwards.length === 44,
  `Expected 44 TitleAwards, got ${titleAwards.length}`
);

assert(
  playerPartners.length === 8,
  `Expected 8 PlayerPartners, got ${playerPartners.length}`
);

// Regression guard for the legacy inverted partner structure:
// Pokémon names from partner.holders must never become Players merely
// because they appeared in the title system.
const partnerPokemonNames = new Set(
  playerPartners.map((row) => row.pokemonNameSnapshot)
);

for (const pokemonName of partnerPokemonNames) {
  const appearsAsRealPlayer = playerByName.has(pokemonName);

  if (appearsAsRealPlayer) {
    throw new Error(
      `Partner Pokémon incorrectly collides with Player list: ${pokemonName}`
    );
  }
}

assert(
  new Set(
    titleDefinitions.map((row) => row.code)
  ).size === titleDefinitions.length,
  "Duplicate TitleDefinition code"
);

assert(
  new Set(
    titleAwards.map((row) => `${row.titleId}|${row.playerId}`)
  ).size === titleAwards.length,
  "Duplicate legacy TitleAward"
);

console.log("Historical titles and partners");
console.log({
  titleDefinitions: titleDefinitions.length,
  titleAwards: titleAwards.length,
  playerPartners: playerPartners.length,
  partnerPokemonNames: [...partnerPokemonNames],
});

const hallOfFameEntries = [];

(data.champions || []).forEach((champion, index) => {
  const generation = championGenerationNumber(champion, index);
  const championName = clean(champion.name);

  const event = events.find(
    (candidate) =>
      candidate.eventType === "champions" &&
      candidate.roundNumber === generation
  );

  assert(
    event,
    `HOF Champions Event not found: generation ${generation}`
  );

  assert(
    clean(event.sourceRound.win) === championName,
    `HOF champion mismatch: generation ${generation} / ${championName}`
  );

  const player = requirePlayer(
    championName,
    `HOF generation ${generation}`
  );

  const participant = entryParticipantByEventPlayer.get(
    `${event.id}|${player.id}`
  );

  assert(
    participant,
    `HOF winner EntryParticipant not found: ${generation} / ${championName}`
  );

  const result = results.find(
    (candidate) =>
      candidate.eventId === event.id &&
      candidate.entryId === participant.entryId &&
      candidate.placementCode === "champion"
  );

  assert(
    result,
    `HOF champion Result not found: ${generation} / ${championName}`
  );

  const registration = registrationByEventPlayer.get(
    `${event.id}|${player.id}`
  );

  assert(
    registration?.finalSubmissionId,
    `HOF final historical submission missing: ${generation} / ${championName}`
  );

  hallOfFameEntries.push({
    id: stableUuid("hall_of_fame", event.id),
    eventId: event.id,
    resultId: result.id,
    playerId: player.id,
    generationNumber: generation,
    generationLabel: clean(champion.gen) || null,

    // Legacy champion Pokémon images were stored per team member as base64.
    // They are not copied into this single compatibility field.
    // Party display derives from the winner's final TeamSnapshot instead.
    imageRef: null,

    note: null,
  });
});

assert(
  hallOfFameEntries.length === 6,
  `Expected 6 HallOfFameEntries, got ${hallOfFameEntries.length}`
);

assert(
  new Set(hallOfFameEntries.map((row) => row.eventId)).size === 6,
  "Duplicate HallOfFame Event"
);

for (let generation = 1; generation <= 6; generation += 1) {
  assert(
    hallOfFameEntries.some(
      (row) => row.generationNumber === generation
    ),
    `Missing HOF generation ${generation}`
  );
}

console.log("Historical Hall of Fame");
console.log({
  hallOfFameEntries: hallOfFameEntries.length,
  generations: hallOfFameEntries.map((row) => ({
    generation: row.generationNumber,
    label: row.generationLabel,
    player: players.find((player) => player.id === row.playerId)?.displayName,
  })),
});

function sqlNumber(value) {
  if (value === null || value === undefined) return "NULL";
  const number = Number(value);
  assert(Number.isFinite(number), `Invalid SQL number: ${value}`);
  return String(number);
}

function insertStatement(table, columns, rows, mapper) {
  if (!rows.length) return "";

  const values = rows
    .map((row, index) => `  (${mapper(row, index).join(", ")})`)
    .join(",\n");

  return `insert into ${table} (\n  ${columns.join(",\n  ")}\n) values\n${values};`;
}

const targetSchema = process.argv[4] || "ypl_schema_validation";

assert(
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(targetSchema),
  `Invalid target schema: ${targetSchema}`
);

const revealedEventIds = new Set(
  registrations
    .filter((row) => row.finalSubmissionId !== null)
    .map((row) => row.eventId)
);

const sqlSections = [];

sqlSections.push(`-- =========================================================
-- YPL legacy ypl_data_v4 -> normalized schema migration
-- Generated by scripts/generate-normalized-migration.mjs
--
-- DEFAULT TARGET: ${targetSchema}
-- Production is intentionally NOT the default target.
--
-- Historical policy:
-- - EventRegistration source=migration is a technical anchor only.
-- - Unknown historical submission timestamps remain NULL.
-- - Historical battle_format is not inferred.
-- - Only the 3 preserved double-elimination brackets receive
--   competition_format=double_elimination.
-- - Historical ranking deltas are not reconstructed.
-- - Existing ranking state is preserved through RankingBaseline.
-- - Legacy partner Pokémon are PlayerPartner rows, never Players.
-- =========================================================

begin;

set local search_path to ${targetSchema}, public;`);

sqlSections.push(
  insertStatement(
    "players",
    ["id", "display_name", "status"],
    players,
    (row) => [
      sqlText(row.id),
      sqlText(row.displayName),
      sqlText("active"),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "seasons",
    [
      "id",
      "code",
      "name",
      "series",
      "number",
      "sort_order",
      "status",
    ],
    seasons,
    (row, index) => [
      sqlText(row.id),
      sqlText(row.code),
      sqlText(row.name),
      sqlText(row.series),
      sqlNumber(row.number),
      sqlNumber(row.number),
      sqlText("past"),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "events",
    [
      "id",
      "season_id",
      "name",
      "round_number",
      "event_type",
      "division",
      "battle_format",
      "competition_format",
      "competition_settings",
      "is_team_event",
      "regulation_id",
      "cup_rule_id",
      "cup_rule_settings",
      "registration_settings",
      "held_on",
      "date_precision",
      "record_completeness",
      "status",
      "team_reveal_mode",
      "team_revealed_at",
    ],
    events,
    (row) => {
      const competitionSettings = {
        legacyTournamentKey: row.tournamentKey,
      };

      const legacyRule = clean(row.sourceRound?.rule);
      if (legacyRule) competitionSettings.legacyRule = legacyRule;

      return [
        sqlText(row.id),
        sqlText(row.seasonId),
        sqlText(row.name),
        sqlNumber(row.roundNumber),
        sqlText(row.eventType),
        sqlText(row.division),
        sqlText(row.battleFormat),
        sqlText(row.competitionFormat),
        sqlJson(competitionSettings),
        sqlBool(row.isTeamEvent),
        "NULL",
        "NULL",
        sqlJson({}),
        sqlJson({}),
        sqlText(row.heldOn),
        sqlText(row.datePrecision),
        sqlText(row.recordCompleteness),
        sqlText(row.status),
        sqlText(revealedEventIds.has(row.id) ? "manual" : "on_record_apply"),
        revealedEventIds.has(row.id) ? "now()" : "NULL",
      ];
    }
  )
);

sqlSections.push(
  insertStatement(
    "event_registrations",
    [
      "id",
      "event_id",
      "player_id",
      "registration_name",
      "registration_data",
      "registration_source",
      "registered_at",
    ],
    registrations,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.playerId),
      sqlText(row.registrationName),
      sqlJson(row.registrationData),
      sqlText(row.registrationSource),
      "NULL",
    ]
  )
);

sqlSections.push(
  insertStatement(
    "entries",
    [
      "id",
      "event_id",
      "entry_type",
      "display_name",
      "seed",
      "status",
    ],
    entries,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.entryType),
      sqlText(row.displayName),
      sqlNumber(row.seed),
      sqlText(row.status),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "entry_participants",
    [
      "id",
      "event_id",
      "entry_id",
      "registration_id",
      "player_id",
      "member_order",
      "role",
    ],
    entryParticipants,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.entryId),
      sqlText(row.registrationId),
      sqlText(row.playerId),
      sqlNumber(row.memberOrder),
      sqlText(row.role),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "team_snapshots",
    [
      "id",
      "schema_version",
      "regulation_id",
      "cup_rule_id",
      "cup_rule_settings",
      "source_type",
      "source_reference",
      "imported_at",
    ],
    teamSnapshots,
    (row) => [
      sqlText(row.id),
      sqlNumber(row.schemaVersion),
      sqlText(row.regulationId),
      sqlText(row.cupRuleId),
      sqlJson(row.cupRuleSettings),
      sqlText(row.sourceType),
      sqlText(row.sourceReference),
      "NULL",
    ]
  )
);

sqlSections.push(
  insertStatement(
    "team_snapshot_members",
    [
      "id",
      "snapshot_id",
      "slot",
      "pokemon_id",
      "pokemon_name_snapshot",
      "ability_id",
      "nature_id",
      "stat_hp",
      "stat_atk",
      "stat_def",
      "stat_spa",
      "stat_spd",
      "stat_spe",
      "item_id",
      "move_1_id",
      "move_2_id",
      "move_3_id",
      "move_4_id",
    ],
    teamSnapshotMembers,
    (row) => [
      sqlText(row.id),
      sqlText(row.snapshotId),
      sqlNumber(row.slot),
      sqlText(row.pokemonId),
      sqlText(row.pokemonNameSnapshot),
      sqlText(row.abilityId),
      sqlText(row.natureId),
      sqlNumber(row.statHp),
      sqlNumber(row.statAtk),
      sqlNumber(row.statDef),
      sqlNumber(row.statSpa),
      sqlNumber(row.statSpd),
      sqlNumber(row.statSpe),
      sqlText(row.itemId),
      sqlText(row.move1Id),
      sqlText(row.move2Id),
      sqlText(row.move3Id),
      sqlText(row.move4Id),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "registration_submissions",
    [
      "id",
      "registration_id",
      "snapshot_id",
      "revision",
      "submitted_at",
      "source",
    ],
    registrationSubmissions,
    (row) => [
      sqlText(row.id),
      sqlText(row.registrationId),
      sqlText(row.snapshotId),
      sqlNumber(row.revision),
      "NULL",
      sqlText(row.source),
    ]
  )
);

const finalSubmissionRows = registrations.filter(
  (row) => row.finalSubmissionId !== null
);

sqlSections.push(`update event_registrations as r
set final_submission_id = v.submission_id::uuid
from (
  values
${finalSubmissionRows
  .map(
    (row) =>
      `    (${sqlText(row.id)}::uuid, ${sqlText(row.finalSubmissionId)}::uuid)`
  )
  .join(",\n")}
) as v(registration_id, submission_id)
where r.id = v.registration_id;`);

sqlSections.push(
  insertStatement(
    "matches",
    [
      "id",
      "event_id",
      "parent_match_id",
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
      "source",
      "source_node_key",
      "played_at",
    ],
    matches,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.parentMatchId),
      sqlText(row.matchKind),
      sqlNumber(row.roundNumber),
      sqlText(row.stageLabel),
      sqlNumber(row.sequenceNo),
      sqlText(row.entryAId),
      sqlText(row.entryBId),
      sqlText(row.playerAId),
      sqlText(row.playerBId),
      sqlText(row.winnerEntryId),
      sqlText(row.winnerPlayerId),
      sqlText(row.resolution),
      sqlText(row.source),
      sqlText(row.sourceNodeKey),
      "NULL",
    ]
  )
);

sqlSections.push(
  insertStatement(
    "results",
    [
      "id",
      "event_id",
      "entry_id",
      "placement_code",
      "rank_min",
      "rank_max",
      "placement_label",
      "source",
    ],
    results,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.entryId),
      sqlText(row.placementCode),
      sqlNumber(row.rankMin),
      sqlNumber(row.rankMax),
      sqlText(row.placementLabel),
      sqlText(row.source),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "ranking_baselines",
    [
      "id",
      "player_id",
      "scope",
      "series",
      "season_id",
      "points",
      "wins",
      "runner_ups",
      "top4s",
      "source",
      "note",
    ],
    rankingBaselines,
    (row) => [
      sqlText(row.id),
      sqlText(row.playerId),
      sqlText(row.scope),
      sqlText(row.series),
      sqlText(row.seasonId),
      sqlNumber(row.points),
      sqlNumber(row.wins),
      sqlNumber(row.runnerUps),
      sqlNumber(row.top4s),
      sqlText(row.source),
      sqlText(row.note),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "title_definitions",
    [
      "id",
      "code",
      "name",
      "description",
      "group_code",
      "award_mode",
      "sort_order",
      "active",
    ],
    titleDefinitions,
    (row) => [
      sqlText(row.id),
      sqlText(row.code),
      sqlText(row.name),
      sqlText(row.description),
      sqlText(row.groupCode),
      sqlText(row.awardMode),
      sqlNumber(row.sortOrder),
      sqlBool(row.active),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "title_awards",
    [
      "id",
      "title_id",
      "player_id",
      "event_id",
      "result_id",
      "source",
      "reason",
      "awarded_at",
    ],
    titleAwards,
    (row) => [
      sqlText(row.id),
      sqlText(row.titleId),
      sqlText(row.playerId),
      "NULL",
      "NULL",
      sqlText(row.source),
      sqlText(row.reason),
      sqlText(row.awardedAt),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "player_partners",
    [
      "id",
      "player_id",
      "pokemon_id",
      "pokemon_name_snapshot",
      "source",
    ],
    playerPartners,
    (row) => [
      sqlText(row.id),
      sqlText(row.playerId),
      sqlText(row.pokemonId),
      sqlText(row.pokemonNameSnapshot),
      sqlText(row.source),
    ]
  )
);

sqlSections.push(
  insertStatement(
    "hall_of_fame_entries",
    [
      "id",
      "event_id",
      "result_id",
      "player_id",
      "generation_number",
      "generation_label",
      "image_ref",
      "note",
    ],
    hallOfFameEntries,
    (row) => [
      sqlText(row.id),
      sqlText(row.eventId),
      sqlText(row.resultId),
      sqlText(row.playerId),
      sqlNumber(row.generationNumber),
      sqlText(row.generationLabel),
      sqlText(row.imageRef),
      sqlText(row.note),
    ]
  )
);

sqlSections.push(`do $$
declare
  n bigint;
begin
  select count(*) into n from players;
  if n <> 64 then raise exception 'players count: expected 64, got %', n; end if;

  select count(*) into n from seasons;
  if n <> 6 then raise exception 'seasons count: expected 6, got %', n; end if;

  select count(*) into n from events;
  if n <> 57 then raise exception 'events count: expected 57, got %', n; end if;

  select count(*) into n from event_registrations;
  if n <> 254 then raise exception 'event_registrations count: expected 254, got %', n; end if;

  select count(*) into n from entries;
  if n <> 214 then raise exception 'entries count: expected 214, got %', n; end if;

  select count(*) into n from entry_participants;
  if n <> 254 then raise exception 'entry_participants count: expected 254, got %', n; end if;

  select count(*) into n from results;
  if n <> 204 then raise exception 'results count: expected 204, got %', n; end if;

  select count(*) into n from matches;
  if n <> 39 then raise exception 'matches count: expected 39, got %', n; end if;

  select count(*) into n from ranking_baselines;
  if n <> 160 then raise exception 'ranking_baselines count: expected 160, got %', n; end if;

  select count(*) into n from ranking_awards;
  if n <> 0 then raise exception 'ranking_awards count: expected 0, got %', n; end if;

  select count(*) into n from team_snapshots;
  if n <> 13 then raise exception 'team_snapshots count: expected 13, got %', n; end if;

  select count(*) into n from team_snapshot_members;
  if n <> 78 then raise exception 'team_snapshot_members count: expected 78, got %', n; end if;

  select count(*) into n from registration_submissions;
  if n <> 13 then raise exception 'registration_submissions count: expected 13, got %', n; end if;

  select count(*) into n
  from event_registrations
  where final_submission_id is not null;
  if n <> 13 then raise exception 'final_submission pointers: expected 13, got %', n; end if;

  select count(*) into n from title_definitions;
  if n <> 42 then raise exception 'title_definitions count: expected 42, got %', n; end if;

  select count(*) into n from title_awards;
  if n <> 44 then raise exception 'title_awards count: expected 44, got %', n; end if;

  select count(*) into n from player_partners;
  if n <> 8 then raise exception 'player_partners count: expected 8, got %', n; end if;

  select count(*) into n from hall_of_fame_entries;
  if n <> 6 then raise exception 'hall_of_fame_entries count: expected 6, got %', n; end if;

  select count(*) into n
  from events
  where battle_format is not null;
  if n <> 0 then raise exception 'historical battle_format count: expected 0, got %', n; end if;

  select count(*) into n
  from events
  where competition_format = 'double_elimination';
  if n <> 3 then raise exception 'double_elimination events: expected 3, got %', n; end if;

  select count(*) into n
  from players p
  join player_partners pp
    on pp.pokemon_name_snapshot = p.display_name;
  if n <> 0 then raise exception 'partner Pokemon leaked into Player identity: % collision(s)', n; end if;
end
$$;

commit;`);

const generatedSql = sqlSections
  .filter(Boolean)
  .join("\n\n") + "\n";

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, generatedSql, "utf8");

console.log("Migration SQL generated");
console.log({
  targetSchema,
  outputPath,
  bytes: Buffer.byteLength(generatedSql, "utf8"),
});
