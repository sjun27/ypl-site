import { CUP_RULES, TYPE_OPTIONS, KO } from "../data/index.js";
import { toID } from "./championsData.js";

export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
export const STAT_LABELS = { hp: "HP", atk: "공격", def: "방어", spa: "특공", spd: "특방", spe: "스피드" };
export const TEAM_STORAGE_KEY = "ypl-team-builder:saved-teams:v1";
export const DRAFT_STORAGE_KEY = "ypl-team-builder:working-draft:v1";
export const TEAM_SCHEMA_VERSION = 2;
export const DRAFT_SCHEMA_VERSION = 2;
export const DRAFT_SAVE_DELAY_MS = 180;

export const ALIGNMENTS = [
  { id: "serious", name: "Serious", plus: null, minus: null },
  { id: "lonely", name: "Lonely", plus: "atk", minus: "def" },
  { id: "adamant", name: "Adamant", plus: "atk", minus: "spa" },
  { id: "naughty", name: "Naughty", plus: "atk", minus: "spd" },
  { id: "brave", name: "Brave", plus: "atk", minus: "spe" },
  { id: "bold", name: "Bold", plus: "def", minus: "atk" },
  { id: "impish", name: "Impish", plus: "def", minus: "spa" },
  { id: "lax", name: "Lax", plus: "def", minus: "spd" },
  { id: "relaxed", name: "Relaxed", plus: "def", minus: "spe" },
  { id: "modest", name: "Modest", plus: "spa", minus: "atk" },
  { id: "mild", name: "Mild", plus: "spa", minus: "def" },
  { id: "rash", name: "Rash", plus: "spa", minus: "spd" },
  { id: "quiet", name: "Quiet", plus: "spa", minus: "spe" },
  { id: "calm", name: "Calm", plus: "spd", minus: "atk" },
  { id: "gentle", name: "Gentle", plus: "spd", minus: "def" },
  { id: "careful", name: "Careful", plus: "spd", minus: "spa" },
  { id: "sassy", name: "Sassy", plus: "spd", minus: "spe" },
  { id: "timid", name: "Timid", plus: "spe", minus: "atk" },
  { id: "hasty", name: "Hasty", plus: "spe", minus: "def" },
  { id: "jolly", name: "Jolly", plus: "spe", minus: "spa" },
  { id: "naive", name: "Naive", plus: "spe", minus: "spd" },
];

export const DATA_ID_OVERRIDES = {
  "Raichu [Alolan Form]": "raichualola",
  "Ninetales [Alolan Form]": "ninetalesalola",
  "Arcanine [Hisuian Form]": "arcaninehisui",
  "Slowbro [Galarian Form]": "slowbrogalar",
  "Tauros [Paldean Form (Combat Breed)]": "taurospaldeacombat",
  "Tauros [Paldean Form (Blaze Breed)]": "taurospaldeablaze",
  "Tauros [Paldean Form (Aqua Breed)]": "taurospaldeaaqua",
  "Typhlosion [Hisuian Form]": "typhlosionhisui",
  "Slowking [Galarian Form]": "slowkinggalar",
  "Heat Rotom": "rotomheat",
  "Wash Rotom": "rotomwash",
  "Frost Rotom": "rotomfrost",
  "Fan Rotom": "rotomfan",
  "Mow Rotom": "rotommow",
  "Samurott [Hisuian Form]": "samurotthisui",
  "Zoroark [Hisuian Form]": "zoroarkhisui",
  "Stunfisk [Galarian Form]": "stunfiskgalar",
  "Meowstic [Female]": "meowsticf",
  "Goodra [Hisuian Form]": "goodrahisui",
  "Gourgeist [Small Variety]": "gourgeistsmall",
  "Gourgeist [Large Variety]": "gourgeistlarge",
  "Gourgeist [Jumbo Variety]": "gourgeistsuper",
  "Avalugg [Hisuian Form]": "avalugghisui",
  "Decidueye [Hisuian Form]": "decidueyehisui",
  "Lycanroc [Midnight Form]": "lycanrocmidnight",
  "Lycanroc [Dusk Form]": "lycanrocdusk",
  "Polteageist [Antique Form]": "polteageistantique",
  "Basculegion [Female]": "basculegionf",
  "Maushold [Family of Four]": "mausholdfour",
  "Sinistcha [Masterpiece Form]": "sinistchamasterpiece",
};

export const SPRITE_SLUG_OVERRIDES = {
  "Raichu [Alolan Form]": "raichu-alola",
  "Ninetales [Alolan Form]": "ninetales-alola",
  "Arcanine [Hisuian Form]": "arcanine-hisui",
  "Slowbro [Galarian Form]": "slowbro-galar",
  "Tauros [Paldean Form (Combat Breed)]": "tauros-paldea-combat",
  "Tauros [Paldean Form (Blaze Breed)]": "tauros-paldea-blaze",
  "Tauros [Paldean Form (Aqua Breed)]": "tauros-paldea-aqua",
  "Typhlosion [Hisuian Form]": "typhlosion-hisui",
  "Slowking [Galarian Form]": "slowking-galar",
  "Heat Rotom": "rotom-heat",
  "Wash Rotom": "rotom-wash",
  "Frost Rotom": "rotom-frost",
  "Fan Rotom": "rotom-fan",
  "Mow Rotom": "rotom-mow",
  "Samurott [Hisuian Form]": "samurott-hisui",
  "Zoroark [Hisuian Form]": "zoroark-hisui",
  "Stunfisk [Galarian Form]": "stunfisk-galar",
  "Meowstic [Female]": "meowstic-f",
  "Goodra [Hisuian Form]": "goodra-hisui",
  "Gourgeist [Small Variety]": "gourgeist-small",
  "Gourgeist [Large Variety]": "gourgeist-large",
  "Gourgeist [Jumbo Variety]": "gourgeist-super",
  "Avalugg [Hisuian Form]": "avalugg-hisui",
  "Decidueye [Hisuian Form]": "decidueye-hisui",
  "Lycanroc [Midnight Form]": "lycanroc-midnight",
  "Lycanroc [Dusk Form]": "lycanroc-dusk",
  "Basculegion [Female]": "basculegion-f",
  "Mr. Rime": "mrrime",
  "Kommo-o": "kommoo",
};

export const TYPE_KO = Object.fromEntries(TYPE_OPTIONS.map(type => [type.english, type.korean]));
export const CATEGORY_KO = { Physical: "물리", Special: "특수", Status: "변화" };

export function makeUid(prefix = "team") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function canonicalBaseName(name = "") {
  const regional = name.match(/^(.+?) \[(Alolan|Hisuian|Galarian) Form\]$/);
  if (regional) return regional[1];
  if (name.startsWith("Tauros [")) return "Tauros";
  if (/^(Heat|Wash|Frost|Fan|Mow) Rotom$/.test(name)) return "Rotom";
  for (const base of ["Florges", "Furfrou", "Meowstic", "Gourgeist", "Lycanroc", "Polteageist", "Alcremie", "Basculegion", "Maushold", "Sinistcha", "Vivillon"]) {
    if (name.startsWith(`${base} [`)) return base;
  }
  return name;
}

export function speciesFallbackKey(pokemon) {
  return toID(canonicalBaseName(pokemon?.name));
}

export function dataId(pokemon) {
  if (!pokemon) return "";
  return DATA_ID_OVERRIDES[pokemon.name] || toID(pokemon.name.replace(/\s*\[.*\]$/, ""));
}

export function dexRecord(detailData, pokemon) {
  if (!detailData || !pokemon) return null;
  return detailData.pokedex?.[dataId(pokemon)] || detailData.pokedex?.[speciesFallbackKey(pokemon)] || null;
}

export function speciesIdentity(detailData, pokemon) {
  const dex = dexRecord(detailData, pokemon);
  return dex?.num != null ? `dex-${dex.num}` : `species-${speciesFallbackKey(pokemon)}`;
}

export function spriteSlug(name = "") {
  if (SPRITE_SLUG_OVERRIDES[name]) return SPRITE_SLUG_OVERRIDES[name];
  return name.toLowerCase().replace(/\[.*?\]/g, "").replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

export function spriteUrl(name) {
  return `https://play.pokemonshowdown.com/sprites/gen5/${spriteSlug(name)}.png`;
}

export function makeMember(pokemon) {
  return {
    uid: makeUid("member"),
    pokemon,
    ability: "",
    alignment: "serious",
    statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    item: "",
    moves: ["", "", "", ""],
  };
}

export function serializeMembers(team) {
  return (team || []).map(member => ({
    pokemonName: member.pokemon?.name || "",
    ability: member.ability || "",
    alignment: member.alignment || "serious",
    statPoints: Object.fromEntries(STAT_KEYS.map(key => [key, Number(member.statPoints?.[key] || 0)])),
    item: member.item || "",
    moves: Array.from({ length: 4 }, (_, index) => member.moves?.[index] || ""),
  })).filter(member => member.pokemonName);
}

function normalizeMembers(members) {
  return (Array.isArray(members) ? members : []).slice(0, 6).map(member => ({
    pokemonName: String(member?.pokemonName || ""),
    ability: String(member?.ability || ""),
    alignment: String(member?.alignment || "serious"),
    statPoints: Object.fromEntries(STAT_KEYS.map(key => [key, Math.max(0, Math.min(32, Number(member?.statPoints?.[key]) || 0))])),
    item: String(member?.item || ""),
    moves: Array.from({ length: 4 }, (_, index) => String(member?.moves?.[index] || "")),
  })).filter(member => member.pokemonName);
}

export function normalizeSavedTeam(raw) {
  if (!raw || typeof raw !== "object" || !raw.id || !Array.isArray(raw.members)) return null;
  const cupRuleId = CUP_RULES[String(raw.cupRuleId || "none")] ? String(raw.cupRuleId || "none") : "none";
  const assignedType = TYPE_OPTIONS.some(type => type.id === String(raw.cupRuleSettings?.assignedType || "")) ? String(raw.cupRuleSettings?.assignedType || "") : "";
  return {
    schemaVersion: Number(raw.schemaVersion) || TEAM_SCHEMA_VERSION,
    id: String(raw.id),
    name: String(raw.name || "이름 없는 팀").slice(0, 40),
    regulationId: String(raw.regulationId || "m-b"),
    cupRuleId,
    cupRuleSettings: { assignedType: CUP_RULES[cupRuleId]?.kind === "monotype" ? assignedType : "" },
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    members: normalizeMembers(raw.members),
  };
}

export function normalizeDraft(raw, regulations) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.members)) return null;
  const regulationId = String(raw.regulationId || "m-b");
  if (!regulations?.[regulationId]) return null;
  const cupRuleId = CUP_RULES[String(raw.cupRuleId || "none")] ? String(raw.cupRuleId || "none") : "none";
  const assignedType = TYPE_OPTIONS.some(type => type.id === String(raw.cupRuleSettings?.assignedType || "")) ? String(raw.cupRuleSettings?.assignedType || "") : "";
  return {
    schemaVersion: Number(raw.schemaVersion) || DRAFT_SCHEMA_VERSION,
    regulationId,
    cupRuleId,
    cupRuleSettings: { assignedType: CUP_RULES[cupRuleId]?.kind === "monotype" ? assignedType : "" },
    activeSavedTeamId: raw.activeSavedTeamId ? String(raw.activeSavedTeamId) : null,
    dirty: Boolean(raw.dirty),
    selectedIndex: Math.max(0, Number(raw.selectedIndex) || 0),
    savedAt: String(raw.savedAt || ""),
    members: normalizeMembers(raw.members),
  };
}

export function memberFromSaved(savedMember, regulation) {
  const pokemon = regulation?.pokemon?.find(entry => entry.name === savedMember?.pokemonName);
  if (!pokemon) return null;
  return {
    ...makeMember(pokemon),
    ability: savedMember.ability || "",
    alignment: ALIGNMENTS.some(n => n.id === savedMember.alignment) ? savedMember.alignment : "serious",
    statPoints: Object.fromEntries(STAT_KEYS.map(key => [key, Math.max(0, Math.min(32, Number(savedMember.statPoints?.[key]) || 0))])),
    item: savedMember.item || "",
    moves: Array.from({ length: 4 }, (_, index) => savedMember.moves?.[index] || ""),
  };
}

export function alignmentFor(member) {
  return ALIGNMENTS.find(a => a.id === member?.alignment) || ALIGNMENTS[0];
}

export function calculatedStat(base, sp, key, alignment) {
  if (base == null) return "—";
  const raw = key === "hp" ? base + Number(sp || 0) + 75 : base + Number(sp || 0) + 20;
  if (key === "hp") return raw;
  const nature = alignment || ALIGNMENTS[0];
  const modifier = nature.plus === key ? 1.1 : nature.minus === key ? 0.9 : 1;
  return Math.floor(raw * modifier);
}

export function natureName(alignment) {
  return KO.natures?.[toID(alignment?.name)] || alignment?.name || "";
}

export function abilityName(english) {
  return KO.abilities?.[toID(english)] || english || "";
}

export function bilingualName(korean, english) {
  if (!english) return korean || "";
  if (!korean || korean === english) return english;
  return `${korean} (${english})`;
}

export function alignmentDisplay(alignment) {
  const effect = alignment?.plus ? ` · ${STAT_LABELS[alignment.plus]}↑ ${STAT_LABELS[alignment.minus]}↓` : " · 보정 없음";
  return `${bilingualName(natureName(alignment), alignment?.name)}${effect}`;
}

export function localizedPokemonName(pokemon, koreanNames) {
  if (!pokemon) return "";
  const base = canonicalBaseName(pokemon.name);
  const ko = koreanNames?.get?.(base.toLowerCase());
  if (!ko) return pokemon.name;
  if (pokemon.name.endsWith("[Alolan Form]")) return `알로라 ${ko}`;
  if (pokemon.name.endsWith("[Hisuian Form]")) return `히스이 ${ko}`;
  if (pokemon.name.endsWith("[Galarian Form]")) return `가라르 ${ko}`;
  if (pokemon.name.includes("Combat Breed")) return "켄타로스 (팔데아의 모습·컴뱃종)";
  if (pokemon.name.includes("Blaze Breed")) return "켄타로스 (팔데아의 모습·블레이즈종)";
  if (pokemon.name.includes("Aqua Breed")) return "켄타로스 (팔데아의 모습·워터종)";
  if (pokemon.name === "Heat Rotom") return `히트${ko}`;
  if (pokemon.name === "Wash Rotom") return `워시${ko}`;
  if (pokemon.name === "Frost Rotom") return `프로스트${ko}`;
  if (pokemon.name === "Fan Rotom") return `스핀${ko}`;
  if (pokemon.name === "Mow Rotom") return `커트${ko}`;
  if (pokemon.name === "Meowstic [Female]") return `${ko} (암컷)`;
  if (pokemon.name === "Lycanroc [Midnight Form]") return `${ko} (한밤중의 모습)`;
  if (pokemon.name === "Lycanroc [Dusk Form]") return `${ko} (황혼의 모습)`;
  if (pokemon.name === "Basculegion [Female]") return `${ko} (암컷)`;
  if (pokemon.name === "Maushold [Family of Four]") return `${ko} (4마리 가족)`;
  return ko;
}

export function matchesLocalizedSearch(korean, english, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const compact = toID(q);
  return String(korean || "").toLowerCase().includes(q)
    || String(english || "").toLowerCase().includes(q)
    || (compact && (toID(korean).includes(compact) || toID(english).includes(compact)));
}

export function itemEnglishName(detailData, id) {
  return detailData?.items?.[id]?.name || id || "";
}

export function moveEnglishName(detailData, id) {
  return detailData?.moves?.[id]?.name || prettifyID(id);
}

export function itemName(detailData, id) {
  const english = itemEnglishName(detailData, id);
  return KO.items?.[toID(english)] || KO.items?.[toID(id)] || english;
}

export function moveName(detailData, id) {
  const english = moveEnglishName(detailData, id);
  return KO.moves?.[toID(english)] || KO.moves?.[toID(id)] || english;
}

export function itemDisplay(detailData, id) {
  return bilingualName(itemName(detailData, id), itemEnglishName(detailData, id));
}

export function moveDisplay(detailData, id) {
  return bilingualName(moveName(detailData, id), moveEnglishName(detailData, id));
}

export function learnsetFor(detailData, pokemon) {
  if (!detailData || !pokemon) return [];
  return detailData.learnsets?.[dataId(pokemon)] || detailData.learnsets?.[speciesFallbackKey(pokemon)] || [];
}

export function moveMetadata(detailData, id) {
  const move = detailData?.moves?.[id];
  if (!move) return moveName(detailData, id);
  const power = move.category === "Status" ? "—" : move.basePower || "—";
  const accuracy = move.accuracy === true ? "—" : move.accuracy ?? "—";
  return `${TYPE_KO[move.type] || move.type || "—"} · ${CATEGORY_KO[move.category] || move.category || "—"} · 위력 ${power} · 명중 ${accuracy} · PP ${move.pp ?? "—"}`;
}

export function pokemonMatchesCupRule({ pokemon, cupRuleId, assignedTypeId, detailData }) {
  const rule = CUP_RULES[cupRuleId] || CUP_RULES.none;
  if (rule.kind === "none") return true;
  if (rule.kind === "monotype") {
    if (!assignedTypeId || !detailData) return false;
    const details = dexRecord(detailData, pokemon);
    return Boolean(details?.types?.some(type => toID(type) === assignedTypeId));
  }
  return true;
}

export function validateTeam({ team, regulation, regulationId, cupRuleId, assignedTypeId, detailData, detailStatus, legalItems }) {
  const errors = [];
  const incomplete = [];
  const warnings = [];
  const allowedNames = new Set(regulation?.pokemon?.map(p => p.name) || []);
  const cupRule = CUP_RULES[cupRuleId] || CUP_RULES.none;
  const assignedType = TYPE_OPTIONS.find(type => type.id === assignedTypeId) || null;

  if (cupRule.kind === "monotype" && !assignedType) incomplete.push("모노타입 챌린지의 배정 타입을 선택해 주세요.");
  if (cupRule.kind === "monotype" && assignedType && detailData) {
    for (const member of team) {
      if (!pokemonMatchesCupRule({ pokemon: member.pokemon, cupRuleId, assignedTypeId, detailData })) {
        errors.push(`모노타입 룰 위반: ${member.pokemon.name}은(는) ${assignedType.korean} 타입을 포함하지 않습니다.`);
      }
    }
  }

  for (const member of team) if (!allowedNames.has(member.pokemon.name)) errors.push(`${member.pokemon.name}은(는) ${regulation?.shortName || regulationId}에서 사용할 수 없습니다.`);

  const identities = new Map();
  for (const member of team) {
    const identity = speciesIdentity(detailData, member.pokemon);
    if (identities.has(identity)) {
      const dex = dexRecord(detailData, member.pokemon)?.num;
      errors.push(`Species Clause 위반: ${identities.get(identity).pokemon.name} / ${member.pokemon.name}${dex ? ` (#${String(dex).padStart(4, "0")})` : ""}`);
    } else identities.set(identity, member);
  }

  const legalItemIds = detailData ? new Set((legalItems || []).map(item => item.id)) : null;
  const itemOwners = new Map();
  for (const member of team) {
    if (!member.item) continue;
    if (legalItemIds && !legalItemIds.has(member.item)) errors.push(`${member.pokemon.name}의 ${itemName(detailData, member.item)}은(는) 사용할 수 없습니다.`);
    if (itemOwners.has(member.item)) errors.push(`Item Clause 위반: ${itemName(detailData, member.item)}을(를) 두 마리가 사용하고 있습니다.`);
    else itemOwners.set(member.item, member.uid);
  }

  for (const member of team) {
    const total = STAT_KEYS.reduce((sum, key) => sum + Number(member.statPoints?.[key] || 0), 0);
    if (total > 66 || STAT_KEYS.some(key => Number(member.statPoints?.[key] || 0) > 32)) errors.push(`${member.pokemon.name}의 Stat Point 배분이 한도를 초과했습니다.`);
    const selectedMoves = (member.moves || []).filter(Boolean);
    if (new Set(selectedMoves).size !== selectedMoves.length) errors.push(`${member.pokemon.name}에게 같은 기술을 중복 배치할 수 없습니다.`);
    if (detailData) {
      const details = dexRecord(detailData, member.pokemon);
      if (details?.abilities?.length && member.ability && !details.abilities.includes(member.ability)) errors.push(`${member.pokemon.name}이(가) 사용할 수 없는 특성입니다.`);
      const learnset = new Set(learnsetFor(detailData, member.pokemon));
      for (const move of selectedMoves) if (learnset.size && !learnset.has(move)) errors.push(`${member.pokemon.name}은(는) ${moveName(detailData, move)}을(를) 배울 수 없습니다.`);
    }
    if (selectedMoves.length < 4) incomplete.push(`${member.pokemon.name}의 기술이 ${selectedMoves.length}/4개 설정되었습니다.`);
  }

  if (team.length < (regulation?.maxTeamSize || 6)) incomplete.unshift(`포켓몬이 ${team.length}/${regulation?.maxTeamSize || 6}마리 선택되었습니다.`);
  if (detailStatus === "loading") incomplete.push("Champions 상세 데이터를 불러오는 중이라 최종 검증이 아직 완료되지 않았습니다.");
  if (detailStatus === "error") incomplete.push("상세 데이터 연결에 실패해 기술·도구 legality를 최종 검증할 수 없습니다.");

  const complete = team.length === (regulation?.maxTeamSize || 6) && incomplete.length === 0;
  const valid = errors.length === 0 && complete;
  const status = errors.length ? "invalid" : complete ? "valid" : "incomplete";
  return { valid, complete, status, errors, incomplete, warnings };
}

export function prettifyID(id) {
  return String(id || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
}
