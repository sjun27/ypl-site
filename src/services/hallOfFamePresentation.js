import { loadRecordsPokemonDirectory } from "./recordsPokemon.js";

const clean = (value) => String(value || "").trim();
const key = (value) => clean(value).toLowerCase();

export function isNormalizedChampionsHallOfFame(event = {}) {
  return event?.event_type === "champions" && event?.championship_phase === "final";
}

export function normalizedChampionLabel(generationNumber, battleFormat) {
  const generation = Number(generationNumber);
  if (!Number.isInteger(generation) || generation <= 0) return "챔피언";
  const format = battleFormat === "singles" ? "싱글" : battleFormat === "doubles" ? "더블" : "";
  return `${generation}대${format ? ` ${format}` : ""} 챔피언`;
}

export function legacyChampionLabel(label) {
  const stored = clean(label);
  if (!stored) return "챔피언";
  return /챔피언\s*$/.test(stored) ? stored : `${stored} 챔피언`;
}

export function normalizedSeasonLabel(season = {}) {
  const series = clean(season?.series).toUpperCase();
  const number = Number(season?.number);
  if (!series || !Number.isInteger(number) || number <= 0) return "";
  return `${series} SEASON ${number}`;
}

export function generationNumberFromLegacyLabel(label) {
  const stored = clean(label);
  if (stored === "초대") return 1;
  const number = Number(stored.match(/\d+/)?.[0]);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export function buildHallOfFameArtworkLookup(directory) {
  const lookup = new Map();
  for (const [pokemonId, record] of directory || []) {
    const dexNumber = Number(record?.dexNumber);
    if (!Number.isInteger(dexNumber) || dexNumber <= 0) continue;
    const image = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexNumber}.png`;
    for (const candidate of [pokemonId, record?.pokemonId, record?.canonicalName, record?.displayName]) {
      if (key(candidate)) lookup.set(key(candidate), image);
    }
  }
  return lookup;
}

let artworkLookupPromise = null;

export function loadHallOfFameArtworkLookup() {
  if (!artworkLookupPromise) {
    artworkLookupPromise = loadRecordsPokemonDirectory().then(buildHallOfFameArtworkLookup);
  }
  return artworkLookupPromise;
}

export function resolveHallOfFameArtwork(member = {}, lookup) {
  for (const candidate of [member?.pokemonId, member?.pokemon_id, member?.id, member?.name]) {
    const image = lookup?.get?.(key(candidate));
    if (image) return image;
  }
  return "";
}
