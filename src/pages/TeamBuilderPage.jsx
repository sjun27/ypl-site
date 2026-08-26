import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Reveal } from "../components/index.js";
import { CUP_RULES, KO, REGULATIONS, TYPE_OPTIONS } from "../data/index.js";
import { championsData } from "../services/index.js";
import {
  ALIGNMENTS,
  DRAFT_SAVE_DELAY_MS,
  DRAFT_SCHEMA_VERSION,
  DRAFT_STORAGE_KEY,
  STAT_KEYS,
  STAT_LABELS,
  TEAM_SCHEMA_VERSION,
  TEAM_STORAGE_KEY,
  TYPE_KO,
  alignmentDisplay,
  alignmentFor,
  abilityName,
  bilingualName,
  calculatedStat,
  dataId,
  dexRecord,
  itemDisplay,
  itemName,
  learnsetFor,
  localizedPokemonName,
  makeMember,
  makeUid,
  matchesLocalizedSearch,
  memberFromSaved,
  moveDisplay,
  moveMetadata,
  moveName,
  normalizeDraft,
  normalizeSavedTeam,
  pokemonMatchesCupRule,
  serializeMembers,
  speciesIdentity,
  spriteUrl,
  validateTeam,
} from "../services/teamBuilderCore.js";
import "../team-builder.css";

const SPECIES_NAMES_URL = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";

function readSavedTeams() {
  try {
    const raw = localStorage.getItem(TEAM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedTeam).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (error) {
    console.warn("[YPL] 저장된 팀을 읽지 못했습니다.", error);
    return [];
  }
}

function writeSavedTeams(teams) {
  try {
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(teams));
    return true;
  } catch (error) {
    console.error("[YPL] 팀 저장 실패", error);
    return false;
  }
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? normalizeDraft(JSON.parse(raw), REGULATIONS) : null;
  } catch (error) {
    console.warn("[YPL] 임시저장 데이터를 읽지 못했습니다.", error);
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (_) { /* noop */ }
    return null;
  }
}

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
    const lang = line.slice(firstComma + 1, secondComma);
    const name = line.slice(secondComma + 1, thirdComma).replace(/^"|"$/g, "").replace(/""/g, '"');
    if (lang === "9") englishById.set(id, name);
    if (lang === "3") koreanById.set(id, name);
  }
  const result = new Map();
  for (const [id, english] of englishById) {
    const korean = koreanById.get(id);
    if (korean) result.set(english.toLowerCase(), korean);
  }
  return result;
}

function ComboInput({ value, options, display, resolve, onCommit, placeholder, disabled, ariaLabel, meta }) {
  const [text, setText] = useState(value ? display(value) : "");
  const [invalid, setInvalid] = useState(false);
  const listId = useMemo(() => `tb-list-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    setText(value ? display(value) : "");
    setInvalid(false);
  }, [value, display]);

  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      onCommit("");
      setInvalid(false);
      return;
    }
    const match = resolve(raw);
    if (!match) {
      setInvalid(true);
      return;
    }
    onCommit(match);
    setText(display(match));
    setInvalid(false);
  };

  return (
    <div className="tb-combo-wrap">
      <input
        className={"tb-input tb-combo" + (invalid ? " invalid" : "")}
        value={text}
        onChange={event => { setText(event.target.value); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        list={listId}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map(option => <option key={String(option)} value={display(option)} />)}
      </datalist>
      {invalid && <div className="tb-inline-error">목록에서 사용할 수 있는 항목을 선택해 주세요.</div>}
      {meta && <div className="tb-field-meta">{meta}</div>}
    </div>
  );
}

function TypeBadges({ types = [] }) {
  return <div className="tb-types">{types.map(type => <span key={type} className={`tb-type type-${championsData.toID(type)}`}>{TYPE_KO[type] || type}</span>)}</div>;
}

function TeamSlot({ index, member, active, displayName, itemLabel, onSelect, onRemove }) {
  if (!member) {
    return (
      <div className="tb-slot empty">
        <span className="tb-slot-no">{index + 1}</span>
        <div className="tb-slot-empty">포켓몬을 추가하세요</div>
      </div>
    );
  }
  const moveCount = member.moves.filter(Boolean).length;
  return (
    <button type="button" className={"tb-slot" + (active ? " active" : "")} onClick={onSelect}>
      <span className="tb-slot-no">{index + 1}</span>
      <img src={spriteUrl(member.pokemon.name)} alt="" className="tb-slot-sprite" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
      <span className="tb-slot-copy">
        <strong>{displayName}</strong>
        <small>{itemLabel || "도구 없음"} · 기술 {moveCount}/4</small>
      </span>
      <span
        role="button"
        tabIndex={0}
        className="tb-slot-remove"
        aria-label={`${displayName} 제거`}
        onClick={event => { event.stopPropagation(); onRemove(); }}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault(); event.stopPropagation(); onRemove();
          }
        }}
      >×</span>
    </button>
  );
}

function ValidationPanel({ result }) {
  const title = result.status === "valid" ? "Team Valid" : result.status === "invalid" ? "Team Invalid" : "Team Incomplete";
  const message = result.status === "valid"
    ? "현재 설정은 제출 가능한 상태입니다."
    : result.status === "invalid"
      ? `${result.errors.length}개의 규정 위반을 확인했습니다.`
      : "아직 설정이 완료되지 않았습니다.";
  const details = result.status === "invalid" ? result.errors : result.incomplete;
  return (
    <div className={`tb-validation ${result.status}`}>
      <div className="tb-validation-head">
        <span className="tb-validation-icon">{result.status === "valid" ? "✓" : result.status === "invalid" ? "×" : "…"}</span>
        <div><strong>{title}</strong><span>{message}</span></div>
      </div>
      {details.length > 0 && <ul>{details.slice(0, 8).map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>}
      {details.length > 8 && <div className="tb-more">외 {details.length - 8}개</div>}
    </div>
  );
}

export default function TeamBuilderPage() {
  const [regulationId, setRegulationId] = useState("m-b");
  const [cupRuleId, setCupRuleId] = useState("none");
  const [assignedTypeId, setAssignedTypeId] = useState("");
  const [team, setTeam] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [query, setQuery] = useState("");
  const [detailData, setDetailData] = useState(null);
  const [detailStatus, setDetailStatus] = useState("loading");
  const [koreanNames, setKoreanNames] = useState(new Map());
  const [localizationStatus, setLocalizationStatus] = useState("loading");
  const [savedTeams, setSavedTeams] = useState([]);
  const [activeSavedTeamId, setActiveSavedTeamId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [draftStatus, setDraftStatus] = useState("idle");
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const draftTimerRef = useRef(null);

  const regulation = REGULATIONS[regulationId] || Object.values(REGULATIONS)[0];
  const cupRule = CUP_RULES[cupRuleId] || CUP_RULES.none;
  const selectedType = TYPE_OPTIONS.find(type => type.id === assignedTypeId) || null;
  const selectedMember = team.find(member => member.uid === selectedUid) || null;
  const selectedDetails = dexRecord(detailData, selectedMember?.pokemon);
  const legalItems = useMemo(() => detailData ? championsData.legalItems(detailData, regulationId) : [], [detailData, regulationId]);

  const displayPokemon = useCallback(pokemon => localizedPokemonName(pokemon, koreanNames), [koreanNames]);
  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    const existing = readSavedTeams();
    setSavedTeams(existing);
    const draft = readDraft();
    if (draft) {
      const reg = REGULATIONS[draft.regulationId];
      const restored = draft.members.map(member => memberFromSaved(member, reg)).filter(Boolean);
      setRegulationId(draft.regulationId);
      setCupRuleId(draft.cupRuleId);
      setAssignedTypeId(draft.cupRuleSettings.assignedType || "");
      setTeam(restored);
      const selected = restored[Math.min(draft.selectedIndex, Math.max(0, restored.length - 1))];
      setSelectedUid(selected?.uid || restored[0]?.uid || null);
      setActiveSavedTeamId(existing.some(teamItem => teamItem.id === draft.activeSavedTeamId) ? draft.activeSavedTeamId : null);
      setDirty(draft.dirty || (!draft.activeSavedTeamId && restored.length > 0));
      setDraftStatus("saved");
      setDraftSavedAt(draft.savedAt || null);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetailStatus("loading");
    championsData.load().then(data => {
      if (cancelled) return;
      setDetailData(data);
      setDetailStatus("ready");
      setTeam(current => current.map(member => {
        if (member.ability) return member;
        const details = dexRecord(data, member.pokemon);
        return details?.abilities?.length ? { ...member, ability: details.abilities[0] } : member;
      }));
    }).catch(error => {
      console.error("Champions detail data unavailable:", error);
      if (!cancelled) setDetailStatus("error");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(SPECIES_NAMES_URL, { cache: "force-cache" }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    }).then(csv => {
      if (cancelled) return;
      setKoreanNames(parseSpeciesNames(csv));
      setLocalizationStatus("ready");
    }).catch(error => {
      console.warn("Korean species names unavailable:", error);
      if (!cancelled) setLocalizationStatus("error");
    });
    return () => { cancelled = true; };
  }, []);

  const makeDraftSnapshot = useCallback(() => ({
    schemaVersion: DRAFT_SCHEMA_VERSION,
    regulationId,
    cupRuleId,
    cupRuleSettings: { assignedType: cupRule.kind === "monotype" ? assignedTypeId : "" },
    activeSavedTeamId: activeSavedTeamId || null,
    dirty: Boolean(dirty),
    selectedIndex: Math.max(0, team.findIndex(member => member.uid === selectedUid)),
    savedAt: new Date().toISOString(),
    members: serializeMembers(team),
  }), [regulationId, cupRuleId, cupRule.kind, assignedTypeId, activeSavedTeamId, dirty, team, selectedUid]);

  const persistDraftNow = useCallback(() => {
    if (!hydrated) return;
    try {
      if (!team.length && !activeSavedTeamId && !dirty) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        setDraftStatus("idle");
        setDraftSavedAt(null);
        return;
      }
      const snapshot = makeDraftSnapshot();
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
      setDraftStatus("saved");
      setDraftSavedAt(snapshot.savedAt);
    } catch (error) {
      console.error("[YPL] 임시저장 실패", error);
      setDraftStatus("error");
    }
  }, [hydrated, team.length, activeSavedTeamId, dirty, makeDraftSnapshot]);

  useEffect(() => {
    if (!hydrated) return undefined;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setDraftStatus("pending");
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      persistDraftNow();
    }, DRAFT_SAVE_DELAY_MS);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [hydrated, regulationId, cupRuleId, assignedTypeId, team, selectedUid, activeSavedTeamId, dirty, persistDraftNow]);

  useEffect(() => {
    const flush = () => persistDraftNow();
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persistDraftNow]);

  const currentSaved = savedTeams.find(saved => saved.id === activeSavedTeamId) || null;

  const validation = useMemo(() => validateTeam({
    team,
    regulation,
    regulationId,
    cupRuleId,
    assignedTypeId,
    detailData,
    detailStatus,
    legalItems,
  }), [team, regulation, regulationId, cupRuleId, assignedTypeId, detailData, detailStatus, legalItems]);

  const eligiblePool = useMemo(() => {
    const base = regulation?.pokemon || [];
    if (cupRule.kind !== "monotype") return base;
    if (!assignedTypeId || !detailData) return [];
    return base.filter(pokemon => pokemonMatchesCupRule({ pokemon, cupRuleId, assignedTypeId, detailData }));
  }, [regulation, cupRule.kind, assignedTypeId, detailData, cupRuleId]);

  const filteredPool = useMemo(() => eligiblePool.filter(pokemon => matchesLocalizedSearch(displayPokemon(pokemon), pokemon.name, query)), [eligiblePool, displayPokemon, query]);

  const updateMember = useCallback((uid, patch) => {
    setTeam(current => current.map(member => member.uid === uid ? { ...member, ...patch } : member));
    markDirty();
  }, [markDirty]);

  const updateStat = useCallback((member, key, value) => {
    const otherTotal = STAT_KEYS.filter(stat => stat !== key).reduce((sum, stat) => sum + Number(member.statPoints?.[stat] || 0), 0);
    const maxByTotal = Math.max(0, 66 - otherTotal);
    const next = Math.max(0, Math.min(32, maxByTotal, Number(value) || 0));
    updateMember(member.uid, { statPoints: { ...member.statPoints, [key]: next } });
  }, [updateMember]);

  const addPokemon = useCallback(pokemon => {
    if (team.length >= (regulation.maxTeamSize || 6)) return;
    const identity = speciesIdentity(detailData, pokemon);
    if (team.some(member => speciesIdentity(detailData, member.pokemon) === identity)) {
      window.alert("같은 전국도감 번호의 포켓몬은 팀에 중복으로 넣을 수 없습니다.");
      return;
    }
    const member = makeMember(pokemon);
    const details = dexRecord(detailData, pokemon);
    if (details?.abilities?.length) member.ability = details.abilities[0];
    setTeam(current => [...current, member]);
    setSelectedUid(member.uid);
    markDirty();
  }, [team, regulation.maxTeamSize, detailData, markDirty]);

  const removeMember = useCallback(uid => {
    setTeam(current => {
      const next = current.filter(member => member.uid !== uid);
      if (uid === selectedUid) setSelectedUid(next[0]?.uid || null);
      return next;
    });
    markDirty();
  }, [selectedUid, markDirty]);

  const switchRegulation = useCallback(nextId => {
    const next = REGULATIONS[nextId];
    if (!next || nextId === regulationId) return;
    const allowed = new Set(next.pokemon.map(pokemon => pokemon.name));
    const removed = team.filter(member => !allowed.has(member.pokemon.name)).length;
    if (removed && !window.confirm(`새 Regulation에서 사용할 수 없는 포켓몬 ${removed}마리가 팀에서 제거됩니다. 변경할까요?`)) return;
    const nextTeam = team.filter(member => allowed.has(member.pokemon.name));
    setRegulationId(nextId);
    setTeam(nextTeam);
    if (!nextTeam.some(member => member.uid === selectedUid)) setSelectedUid(nextTeam[0]?.uid || null);
    markDirty();
  }, [regulationId, team, selectedUid, markDirty]);

  const switchCupRule = useCallback(nextId => {
    if (!CUP_RULES[nextId] || nextId === cupRuleId) return;
    setCupRuleId(nextId);
    setAssignedTypeId("");
    markDirty();
  }, [cupRuleId, markDirty]);

  const resetTeam = useCallback(() => {
    if (team.length && !window.confirm("현재 팀 구성을 모두 초기화할까요?")) return;
    setTeam([]);
    setSelectedUid(null);
    setActiveSavedTeamId(null);
    setDirty(false);
    setSaveName("");
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (_) { /* noop */ }
    setDraftStatus("idle");
    setDraftSavedAt(null);
  }, [team.length]);

  const defaultTeamName = useCallback(() => {
    const names = team.slice(0, 2).map(member => displayPokemon(member.pokemon)).filter(Boolean);
    return names.length ? names.join(" · ") : `${regulation.shortName} 팀`;
  }, [team, displayPokemon, regulation.shortName]);

  const openLibrary = useCallback((focusSave = false) => {
    setSaveName(currentSaved?.name || defaultTeamName());
    setSaveMessage("");
    setLibraryOpen(true);
    if (focusSave) setTimeout(() => document.querySelector(".tb-team-name")?.focus(), 20);
  }, [currentSaved, defaultTeamName]);

  const saveCurrentTeam = useCallback(() => {
    if (!team.length) {
      setSaveMessage("포켓몬을 1마리 이상 추가한 뒤 저장해 주세요.");
      return;
    }
    const name = saveName.trim().slice(0, 40) || defaultTeamName();
    const now = new Date().toISOString();
    const existing = savedTeams.find(saved => saved.id === activeSavedTeamId) || null;
    const snapshot = {
      schemaVersion: TEAM_SCHEMA_VERSION,
      id: existing?.id || makeUid("saved"),
      name,
      regulationId,
      cupRuleId,
      cupRuleSettings: { assignedType: cupRule.kind === "monotype" ? assignedTypeId : "" },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      members: serializeMembers(team),
    };
    const next = existing
      ? savedTeams.map(saved => saved.id === existing.id ? snapshot : saved)
      : [snapshot, ...savedTeams];
    next.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (!writeSavedTeams(next)) {
      setSaveMessage("브라우저 저장소에 저장하지 못했습니다.");
      return;
    }
    setSavedTeams(next);
    setActiveSavedTeamId(snapshot.id);
    setDirty(false);
    setSaveName(name);
    setSaveMessage(existing ? "팀을 업데이트했습니다." : "새 팀을 저장했습니다.");
  }, [saveName, defaultTeamName, savedTeams, activeSavedTeamId, regulationId, cupRuleId, cupRule.kind, assignedTypeId, team]);

  const loadSavedTeam = useCallback(saved => {
    if (dirty && team.length && !window.confirm("현재 저장하지 않은 변경사항을 버리고 이 팀을 불러올까요?")) return;
    const reg = REGULATIONS[saved.regulationId] || REGULATIONS[regulationId];
    const restored = saved.members.map(member => memberFromSaved(member, reg)).filter(Boolean);
    setRegulationId(reg.id);
    setCupRuleId(CUP_RULES[saved.cupRuleId] ? saved.cupRuleId : "none");
    setAssignedTypeId(saved.cupRuleSettings?.assignedType || "");
    setTeam(restored);
    setSelectedUid(restored[0]?.uid || null);
    setActiveSavedTeamId(saved.id);
    setDirty(false);
    setLibraryOpen(false);
  }, [dirty, team.length, regulationId]);

  const duplicateSavedTeam = useCallback(saved => {
    const now = new Date().toISOString();
    const copy = { ...saved, id: makeUid("saved"), name: `${saved.name} 복사본`.slice(0, 40), createdAt: now, updatedAt: now };
    const next = [copy, ...savedTeams];
    if (writeSavedTeams(next)) setSavedTeams(next);
  }, [savedTeams]);

  const deleteSavedTeam = useCallback(saved => {
    if (!window.confirm(`“${saved.name}” 팀을 삭제할까요?`)) return;
    const next = savedTeams.filter(item => item.id !== saved.id);
    if (!writeSavedTeams(next)) return;
    setSavedTeams(next);
    if (activeSavedTeamId === saved.id) {
      setActiveSavedTeamId(null);
      setDirty(team.length > 0);
    }
  }, [savedTeams, activeSavedTeamId, team.length]);

  useEffect(() => {
    const onKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        openLibrary(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openLibrary]);

  const usedItemsByOthers = useMemo(() => new Set(team.filter(member => member.uid !== selectedUid).map(member => member.item).filter(Boolean)), [team, selectedUid]);
  const itemOptions = useMemo(() => legalItems.filter(item => !usedItemsByOthers.has(item.id) || item.id === selectedMember?.item).map(item => item.id).sort((a, b) => itemName(detailData, a).localeCompare(itemName(detailData, b), "ko")), [legalItems, usedItemsByOthers, selectedMember?.item, detailData]);
  const learnset = useMemo(() => selectedMember ? learnsetFor(detailData, selectedMember.pokemon) : [], [detailData, selectedMember]);

  const resolveFromOptions = useCallback((raw, options, formatter) => {
    const normalized = String(raw || "").trim().toLowerCase();
    const compact = championsData.toID(normalized);
    return options.find(id => {
      const values = [formatter(id), id];
      return values.some(value => String(value).trim().toLowerCase() === normalized || (compact && championsData.toID(value) === compact));
    }) || null;
  }, []);

  const dataStatusText = detailStatus === "ready" ? "상세 데이터 연결됨" : detailStatus === "error" ? "상세 데이터 연결 실패" : "상세 데이터 불러오는 중";
  const localizationText = localizationStatus === "ready" ? "포켓몬 이름 · 한국어" : localizationStatus === "error" ? "포켓몬 이름 · 영문" : "한국어 이름 불러오는 중";
  const draftText = draftStatus === "saved" ? "임시저장 완료" : draftStatus === "pending" ? "임시저장 중" : draftStatus === "error" ? "임시저장 실패" : "새 팀";

  return (
    <section className="tb-page">
      <Reveal className="tb-hero">
        <div>
          <span className="tb-kicker">YPL TOOLS</span>
          <h1>Team Builder</h1>
          <p>Pokémon Champions 규정에 맞춰 엔트리를 구성하고 브라우저에 저장할 수 있습니다.</p>
        </div>
        <div className="tb-hero-actions">
          <button className="btn btn-ghost" onClick={() => openLibrary(false)}>팀 박스 <span className="tb-count-badge">{savedTeams.length}</span></button>
          <button className="btn tb-main-btn" onClick={() => openLibrary(true)}>팀 저장</button>
        </div>
      </Reveal>

      <Reveal className="tb-rule-card" delay={35}>
        <div className="tb-rule-grid">
          <label className="tb-field">
            <span>Regulation</span>
            <select className="tb-select" value={regulationId} onChange={event => switchRegulation(event.target.value)}>
              {Object.values(REGULATIONS).map(reg => <option key={reg.id} value={reg.id}>{reg.name}{reg.status === "current" ? " · CURRENT" : ""}</option>)}
            </select>
          </label>
          <label className="tb-field">
            <span>파이컵 추가 룰</span>
            <select className="tb-select" value={cupRuleId} onChange={event => switchCupRule(event.target.value)}>
              {Object.values(CUP_RULES).map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
          </label>
          {cupRule.kind === "monotype" && <label className="tb-field">
            <span>배정 타입</span>
            <select className="tb-select" value={assignedTypeId} onChange={event => { setAssignedTypeId(event.target.value); markDirty(); }}>
              <option value="">타입을 선택하세요</option>
              {TYPE_OPTIONS.map(type => <option key={type.id} value={type.id}>{type.korean} ({type.english})</option>)}
            </select>
          </label>}
        </div>
        <div className="tb-rule-meta">
          <span className={`tb-status-chip ${regulation.status}`}>{regulation.status === "current" ? "CURRENT" : "PAST"}</span>
          <span>{regulation.period}</span>
          <span>{regulation.description}</span>
          {cupRule.kind !== "none" && <span>{cupRule.description}</span>}
        </div>
      </Reveal>

      <div className="tb-layout">
        <Reveal className="tb-panel tb-pool-panel" delay={55}>
          <div className="tb-panel-head">
            <div><span className="tb-panel-kicker">POKÉMON</span><h2>포켓몬 선택</h2></div>
            <strong className="tb-pool-count">{filteredPool.length}<small> / {eligiblePool.length}</small></strong>
          </div>
          <div className="tb-data-line"><span className={`tb-dot ${detailStatus}`}/>{dataStatusText}<span>·</span>{localizationText}</div>
          <div className="tb-search-row">
            <input className="tb-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="포켓몬 이름 검색 (한글/영문)" />
            {query && <button className="tb-clear" onClick={() => setQuery("")} aria-label="검색어 지우기">×</button>}
          </div>
          {cupRule.kind === "monotype" && !assignedTypeId ? (
            <div className="tb-pool-empty">배정 타입을 선택하면 사용 가능한 포켓몬이 표시됩니다.</div>
          ) : cupRule.kind === "monotype" && detailStatus === "loading" ? (
            <div className="tb-pool-empty">타입 판정을 위해 상세 데이터를 불러오는 중입니다.</div>
          ) : (
            <div className="tb-pokemon-list">
              {filteredPool.map(pokemon => {
                const details = dexRecord(detailData, pokemon);
                const identity = speciesIdentity(detailData, pokemon);
                const already = team.some(member => speciesIdentity(detailData, member.pokemon) === identity);
                const full = team.length >= (regulation.maxTeamSize || 6);
                return (
                  <button key={pokemon.name} className="tb-pokemon-row" onClick={() => addPokemon(pokemon)} disabled={already || full}>
                    <img src={spriteUrl(pokemon.name)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
                    <span className="tb-pokemon-copy"><strong>{displayPokemon(pokemon)}</strong>{displayPokemon(pokemon) !== pokemon.name && <small>{pokemon.name}</small>}</span>
                    <TypeBadges types={details?.types || []} />
                    <span className="tb-add-mark">{already ? "선택됨" : "+"}</span>
                  </button>
                );
              })}
              {!filteredPool.length && <div className="tb-pool-empty">조건에 맞는 포켓몬이 없습니다.</div>}
            </div>
          )}
        </Reveal>

        <div className="tb-main-column">
          <Reveal className="tb-panel" delay={75}>
            <div className="tb-panel-head tb-team-head">
              <div><span className="tb-panel-kicker">TEAM</span><h2>{currentSaved?.name || "현재 팀"}</h2></div>
              <div className="tb-team-meta"><span className={dirty ? "dirty" : ""}>{dirty ? "수정됨" : draftText}</span><strong>{team.length} / {regulation.maxTeamSize || 6}</strong></div>
            </div>
            <div className="tb-team-slots">
              {Array.from({ length: regulation.maxTeamSize || 6 }, (_, index) => {
                const member = team[index];
                return <TeamSlot key={member?.uid || `slot-${index}`} index={index} member={member} active={member?.uid === selectedUid} displayName={member ? displayPokemon(member.pokemon) : ""} itemLabel={member?.item ? itemName(detailData, member.item) : ""} onSelect={() => setSelectedUid(member?.uid || null)} onRemove={() => member && removeMember(member.uid)} />;
              })}
            </div>
            <div className="tb-team-actions">
              <span>{draftSavedAt && draftStatus === "saved" ? `마지막 임시저장 ${new Date(draftSavedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "변경사항은 이 브라우저에 자동 임시저장됩니다."}</span>
              <button className="btn btn-ghost btn-sm" onClick={resetTeam}>초기화</button>
            </div>
          </Reveal>

          <Reveal className="tb-panel tb-editor" delay={95}>
            {!selectedMember ? (
              <div className="tb-editor-empty"><strong>세팅할 포켓몬을 선택하세요.</strong><span>왼쪽 목록에서 추가하거나 위 팀 슬롯을 선택하면 상세 설정을 편집할 수 있습니다.</span></div>
            ) : (
              <>
                <div className="tb-editor-head">
                  <img src={spriteUrl(selectedMember.pokemon.name)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
                  <div className="tb-editor-title">
                    <h2>{displayPokemon(selectedMember.pokemon)}</h2>
                    {displayPokemon(selectedMember.pokemon) !== selectedMember.pokemon.name && <span>{selectedMember.pokemon.name}</span>}
                    <small>{selectedDetails?.num != null ? `National Dex #${String(selectedDetails.num).padStart(4, "0")}` : "National Dex 확인 중"}</small>
                    <TypeBadges types={selectedDetails?.types || []} />
                  </div>
                </div>

                <div className="tb-editor-grid two">
                  <label className="tb-field"><span>특성</span>
                    <select className="tb-select" value={selectedMember.ability || ""} disabled={!selectedDetails?.abilities?.length} onChange={event => updateMember(selectedMember.uid, { ability: event.target.value })}>
                      {!selectedDetails?.abilities?.length && <option value="">{detailStatus === "error" ? "데이터 연결 실패" : "데이터 로딩 중…"}</option>}
                      {(selectedDetails?.abilities || []).map(ability => <option key={ability} value={ability}>{bilingualName(abilityName(ability), ability)}</option>)}
                    </select>
                  </label>
                  <label className="tb-field"><span>성격</span>
                    <select className="tb-select" value={selectedMember.alignment || "serious"} onChange={event => updateMember(selectedMember.uid, { alignment: event.target.value })}>
                      {ALIGNMENTS.map(alignment => <option key={alignment.id} value={alignment.id}>{alignmentDisplay(alignment)}</option>)}
                    </select>
                  </label>
                </div>

                <div className="tb-editor-section">
                  <div className="tb-subhead"><div><strong>Stat Point</strong><span>개별 최대 32 · 총합 최대 66</span></div><b className={STAT_KEYS.reduce((sum, key) => sum + Number(selectedMember.statPoints?.[key] || 0), 0) > 66 ? "over" : ""}>{STAT_KEYS.reduce((sum, key) => sum + Number(selectedMember.statPoints?.[key] || 0), 0)} / 66</b></div>
                  <div className="tb-stats">
                    {STAT_KEYS.map(key => {
                      const nature = alignmentFor(selectedMember);
                      const point = Number(selectedMember.statPoints?.[key] || 0);
                      const base = selectedDetails?.baseStats?.[key];
                      const final = calculatedStat(base, point, key, nature);
                      return (
                        <div className="tb-stat-row" key={key}>
                          <div className="tb-stat-label"><strong>{STAT_LABELS[key]}{nature.plus === key ? " ↑" : nature.minus === key ? " ↓" : ""}</strong><span>Base {base ?? "—"}</span></div>
                          <input type="range" min="0" max="32" step="1" value={point} onChange={event => updateStat(selectedMember, key, event.target.value)} />
                          <input className="tb-stat-number" type="number" min="0" max="32" step="1" value={point} onChange={event => updateStat(selectedMember, key, event.target.value)} aria-label={`${STAT_LABELS[key]} Stat Point`} />
                          <div className="tb-final-stat"><span>최종</span><strong>{final}</strong></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="tb-editor-section">
                  <div className="tb-subhead"><div><strong>도구</strong><span>{regulation.shortName} 사용 가능 · Item Clause 적용</span></div></div>
                  <ComboInput
                    key={`${selectedMember.uid}-item`}
                    value={selectedMember.item}
                    options={itemOptions}
                    display={id => itemDisplay(detailData, id)}
                    resolve={raw => resolveFromOptions(raw, itemOptions, id => itemDisplay(detailData, id))}
                    onCommit={id => updateMember(selectedMember.uid, { item: id })}
                    placeholder={detailStatus === "error" ? "데이터 연결 실패" : "도구 없음 · 검색 또는 선택 (한글/영문)"}
                    disabled={!detailData}
                    ariaLabel="도구"
                  />
                </div>

                <div className="tb-editor-section">
                  <div className="tb-subhead"><div><strong>기술</strong><span>학습 가능한 기술 중 4개 선택</span></div><b>{selectedMember.moves.filter(Boolean).length} / 4</b></div>
                  <div className="tb-moves">
                    {Array.from({ length: 4 }, (_, index) => {
                      const selectedMove = selectedMember.moves[index] || "";
                      const usedElsewhere = new Set(selectedMember.moves.filter((move, moveIndex) => move && moveIndex !== index));
                      const options = [...learnset].filter(moveId => !usedElsewhere.has(moveId) || moveId === selectedMove).sort((a, b) => moveName(detailData, a).localeCompare(moveName(detailData, b), "ko"));
                      return (
                        <label className="tb-field tb-move-field" key={`${selectedMember.uid}-move-${index}`}>
                          <span>기술 {index + 1}</span>
                          <ComboInput
                            value={selectedMove}
                            options={options}
                            display={id => moveDisplay(detailData, id)}
                            resolve={raw => resolveFromOptions(raw, options, id => moveDisplay(detailData, id))}
                            onCommit={moveId => {
                              const moves = [...selectedMember.moves];
                              moves[index] = moveId;
                              updateMember(selectedMember.uid, { moves });
                            }}
                            placeholder={detailStatus === "error" ? "데이터 연결 실패" : learnset.length ? "기술 검색 또는 선택 (한글/영문)" : "학습 기술 데이터 확인 중"}
                            disabled={!detailData}
                            ariaLabel={`기술 ${index + 1}`}
                            meta={selectedMove ? moveMetadata(detailData, selectedMove) : ""}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </Reveal>

          <Reveal delay={115}><ValidationPanel result={validation} /></Reveal>
        </div>
      </div>

      {libraryOpen && <Modal title="Team Box" hint="팀은 이 브라우저의 localStorage에 저장됩니다. 기존 v0.6 저장 데이터와 호환됩니다." onClose={() => setLibraryOpen(false)}>
        <div className="tb-library-save">
          <label className="tb-field"><span>팀 이름</span><input className="tb-input tb-team-name" maxLength={40} value={saveName} onChange={event => setSaveName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") saveCurrentTeam(); }} /></label>
          <div className="tb-library-save-row"><span>{regulation.name} · {cupRule.kind === "monotype" ? `${cupRule.shortName} ${selectedType?.korean || "타입 미선택"}` : "추가 룰 없음"}</span><button className="btn tb-main-btn btn-sm" onClick={saveCurrentTeam}>{currentSaved ? "현재 팀 덮어쓰기" : "새 팀 저장"}</button></div>
          {saveMessage && <div className="tb-save-message">{saveMessage}</div>}
        </div>
        <div className="tb-saved-list">
          {savedTeams.map(saved => {
            const savedReg = REGULATIONS[saved.regulationId];
            const type = TYPE_OPTIONS.find(option => option.id === saved.cupRuleSettings?.assignedType);
            return (
              <div className="tb-saved-team" key={saved.id}>
                <div className="tb-saved-main">
                  <strong>{saved.name}</strong>
                  <span>{savedReg?.shortName || saved.regulationId}{saved.cupRuleId !== "none" ? ` · ${(CUP_RULES[saved.cupRuleId]?.shortName || "룰")}${type ? ` ${type.korean}` : ""}` : ""} · {saved.members.length}/6</span>
                  <div className="tb-saved-icons">{saved.members.map((member, index) => <img key={`${member.pokemonName}-${index}`} src={spriteUrl(member.pokemonName)} alt="" title={member.pokemonName} />)}</div>
                </div>
                <div className="tb-saved-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => loadSavedTeam(saved)}>불러오기</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => duplicateSavedTeam(saved)}>복제</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteSavedTeam(saved)}>삭제</button>
                </div>
              </div>
            );
          })}
          {!savedTeams.length && <div className="tb-library-empty">저장된 팀이 없습니다. 현재 팀을 저장하면 이곳에서 다시 불러올 수 있습니다.</div>}
        </div>
      </Modal>}
    </section>
  );
}
