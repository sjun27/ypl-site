const URLS = {
  pokedex: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/pokedex.ts',
  moves: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/moves.ts',
  items: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/items.ts',
  championsLearnsets: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/mods/champions/learnsets.ts',
  championsMoves: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/mods/champions/moves.ts',
  championsItems: 'https://raw.githubusercontent.com/smogon/pokemon-showdown/refs/heads/master/data/mods/champions/items.ts',
};

const MB_ONLY_ITEM_IDS = new Set([
  // Regulation M-B newly added standard held items.
  'widelens', 'muscleband', 'wiseglasses', 'expertbelt', 'lightclay',
  'lifeorb', 'zoomlens', 'metronome', 'ironball', 'icyrock',
  'smoothrock', 'heatrock', 'damprock', 'shedshell', 'bigroot',
  // Mega Stones newly enabled together with the M-B Mega Evolutions.
  'raichunitex', 'raichunitey', 'sceptilite', 'blazikenite', 'swampertite',
  'mawilite', 'metagrossite', 'staraptite', 'scolipite', 'scraftinite',
  'eelektrossite', 'pyroarite', 'malamarite', 'barbaracite', 'dragalgite', 'falinksite',
]);

const CACHE_KEY = 'ypl-champions-data-v3';
const CACHE_TTL = 12 * 60 * 60 * 1000;

function toID(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function topLevelEntries(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const entries = new Map();
  let id = null;
  let buffer = [];

  for (const line of lines) {
    const start = line.match(/^\t([a-z0-9]+): \{$/);
    if (!id && start) {
      id = start[1];
      buffer = [line];
      continue;
    }
    if (!id) continue;
    buffer.push(line);
    if (line === '\t},') {
      entries.set(id, buffer.join('\n'));
      id = null;
      buffer = [];
    }
  }
  return entries;
}

function parseQuoted(raw, key) {
  const re = new RegExp(`\\b${key}:\\s*["']([^"']+)["']`);
  return raw.match(re)?.[1] || '';
}

function parseNumber(raw, key) {
  const re = new RegExp(`\\b${key}:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const value = raw.match(re)?.[1];
  return value === undefined ? null : Number(value);
}

function parseBooleanishNonstandard(raw) {
  const nullMatch = raw.match(/\bisNonstandard:\s*null/);
  if (nullMatch) return null;
  const text = parseQuoted(raw, 'isNonstandard');
  return text || undefined;
}

function parseStats(raw) {
  const body = raw.match(/\bbaseStats:\s*\{([^}]+)\}/)?.[1];
  if (!body) return null;
  const out = {};
  for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
    const value = body.match(new RegExp(`\\b${stat}:\\s*(\\d+)`))?.[1];
    if (value !== undefined) out[stat] = Number(value);
  }
  return Object.keys(out).length === 6 ? out : null;
}

function parseAbilities(raw) {
  const body = raw.match(/\babilities:\s*\{([^}]+)\}/)?.[1];
  if (!body) return [];
  return [...body.matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
}

function parsePokedex(source) {
  const out = {};
  for (const [id, raw] of topLevelEntries(source)) {
    const name = parseQuoted(raw, 'name');
    const num = parseNumber(raw, 'num');
    const baseStats = parseStats(raw);
    const abilities = parseAbilities(raw);
    const typesBody = raw.match(/\btypes:\s*\[([^\]]+)\]/)?.[1] || '';
    const types = [...typesBody.matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
    if (!name || num === null) continue;
    out[id] = {
      id,
      num,
      name,
      baseSpecies: parseQuoted(raw, 'baseSpecies') || name,
      baseStats,
      abilities,
      types,
    };
  }
  return out;
}

function parseLearnsets(source) {
  const out = {};
  for (const [id, raw] of topLevelEntries(source)) {
    const moves = [];
    for (const line of raw.split('\n')) {
      const m = line.match(/^\t{3}([a-z0-9]+): \[/);
      if (m) moves.push(m[1]);
    }
    if (moves.length) out[id] = [...new Set(moves)];
  }
  return out;
}

function parseMoves(source) {
  const out = {};
  for (const [id, raw] of topLevelEntries(source)) {
    const name = parseQuoted(raw, 'name');
    if (!name) continue;
    const accuracyText = raw.match(/\baccuracy:\s*(true|\d+)/)?.[1];
    out[id] = {
      id,
      name,
      type: parseQuoted(raw, 'type'),
      category: parseQuoted(raw, 'category'),
      basePower: parseNumber(raw, 'basePower') ?? 0,
      accuracy: accuracyText === 'true' ? true : accuracyText ? Number(accuracyText) : null,
      pp: parseNumber(raw, 'pp'),
      priority: parseNumber(raw, 'priority') ?? 0,
      isNonstandard: parseBooleanishNonstandard(raw),
    };
  }
  return out;
}

function applyMoveOverrides(base, source) {
  for (const [id, raw] of topLevelEntries(source)) {
    const target = base[id] || { id, name: id };
    const name = parseQuoted(raw, 'name');
    const type = parseQuoted(raw, 'type');
    const category = parseQuoted(raw, 'category');
    if (name) target.name = name;
    if (type) target.type = type;
    if (category) target.category = category;
    for (const key of ['basePower', 'pp', 'priority']) {
      const n = parseNumber(raw, key);
      if (n !== null) target[key] = n;
    }
    const accuracyText = raw.match(/\baccuracy:\s*(true|\d+)/)?.[1];
    if (accuracyText) target.accuracy = accuracyText === 'true' ? true : Number(accuracyText);
    const nonstandard = parseBooleanishNonstandard(raw);
    if (nonstandard !== undefined) target.isNonstandard = nonstandard;
    base[id] = target;
  }
  return base;
}

function parseItems(source) {
  const out = {};
  for (const [id, raw] of topLevelEntries(source)) {
    const name = parseQuoted(raw, 'name');
    if (!name) continue;
    out[id] = {
      id,
      name,
      isNonstandard: parseBooleanishNonstandard(raw),
      megaStone: parseQuoted(raw, 'megaStone'),
    };
  }
  return out;
}

function applyItemOverrides(base, source) {
  for (const [id, raw] of topLevelEntries(source)) {
    const target = base[id] || { id, name: id };
    const name = parseQuoted(raw, 'name');
    if (name) target.name = name;
    const nonstandard = parseBooleanishNonstandard(raw);
    if (nonstandard !== undefined) target.isNonstandard = nonstandard;
    base[id] = target;
  }
  return base;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CACHE_TTL) return null;
    return parsed.data || null;
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Browser storage is an optimization only. The builder still works without it.
  }
}

async function load() {
  const cached = readCache();
  if (cached) return cached;

  const [pokedexSrc, movesSrc, itemsSrc, learnsetsSrc, championsMovesSrc, championsItemsSrc] = await Promise.all([
    fetchText(URLS.pokedex),
    fetchText(URLS.moves),
    fetchText(URLS.items),
    fetchText(URLS.championsLearnsets),
    fetchText(URLS.championsMoves),
    fetchText(URLS.championsItems),
  ]);

  const pokedex = parsePokedex(pokedexSrc);
  const learnsets = parseLearnsets(learnsetsSrc);
  const moves = applyMoveOverrides(parseMoves(movesSrc), championsMovesSrc);
  const items = applyItemOverrides(parseItems(itemsSrc), championsItemsSrc);

  const data = { pokedex, learnsets, moves, items };
  saveCache(data);
  return data;
}

function legalItems(data, regulationId) {
  const values = Object.values(data?.items || {})
    .filter(item => item.name && (item.isNonstandard === null || item.isNonstandard === undefined))
    .filter(item => regulationId !== 'm-a' || !MB_ONLY_ITEM_IDS.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return values;
}


export { load, legalItems, toID, MB_ONLY_ITEM_IDS };
