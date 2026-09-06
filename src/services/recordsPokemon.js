import { load as loadChampionsData } from "./championsData.js";

const SPECIES_NAMES_URL = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";

const clean = (value) => String(value || "").trim();
const key = (value) => clean(value).toLowerCase();

function parseSpeciesNames(csv) {
  const englishById = new Map();
  const koreanById = new Map();
  for (const line of String(csv || "").split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const firstComma = line.indexOf(",");
    const secondComma = line.indexOf(",", firstComma + 1);
    const thirdComma = line.indexOf(",", secondComma + 1);
    if (firstComma < 0 || secondComma < 0 || thirdComma < 0) continue;
    const id = line.slice(0, firstComma);
    const languageId = line.slice(firstComma + 1, secondComma);
    const name = line.slice(secondComma + 1, thirdComma).replace(/^"|"$/g, "").replace(/""/g, '"');
    if (languageId === "9") englishById.set(id, name);
    if (languageId === "3") koreanById.set(id, name);
  }

  const koreanByEnglish = new Map();
  for (const [id, english] of englishById) {
    const korean = koreanById.get(id);
    if (korean) koreanByEnglish.set(key(english), korean);
  }
  return { koreanById, koreanByEnglish };
}

function formDisplayName(record, korean) {
  const id = key(record?.id);
  if (!korean) return clean(record?.name);
  if (id.endsWith("alola")) return `알로라 ${korean}`;
  if (id.endsWith("hisui")) return `히스이 ${korean}`;
  if (id.endsWith("galar")) return `가라르 ${korean}`;
  if (id === "heatrotom") return `히트${korean}`;
  if (id === "washrotom") return `워시${korean}`;
  if (id === "frostrotom") return `프로스트${korean}`;
  if (id === "fanrotom") return `스핀${korean}`;
  if (id === "mowrotom") return `커트${korean}`;
  return korean;
}

export function buildRecordsPokemonDirectory(detailData, speciesNames) {
  const directory = new Map();
  const koreanById = speciesNames?.koreanById || new Map();
  const koreanByEnglish = speciesNames?.koreanByEnglish || new Map();
  for (const [id, record] of Object.entries(detailData?.pokedex || {})) {
    const canonicalName = clean(record?.name);
    const korean = koreanById.get(String(record?.num)) || koreanByEnglish.get(key(canonicalName));
    directory.set(id, {
      pokemonId: id,
      dexNumber: record?.num ?? null,
      canonicalName,
      displayName: formDisplayName({ ...record, id }, korean),
    });
  }
  return directory;
}

export function resolveRecordsPokemonName(pokemonId, snapshotName, directory) {
  const fallback = clean(snapshotName);
  const canonical = directory?.get?.(clean(pokemonId));
  if (!canonical) return fallback;
  return clean(canonical.displayName || canonical.canonicalName || fallback) || fallback;
}

export async function loadRecordsPokemonDirectory() {
  const [detailData, response] = await Promise.all([
    loadChampionsData(),
    fetch(SPECIES_NAMES_URL, { cache: "force-cache" }),
  ]);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return buildRecordsPokemonDirectory(detailData, parseSpeciesNames(await response.text()));
}
