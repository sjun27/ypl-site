import React, { useEffect, useMemo, useState } from "react";
import { Reveal } from "../components/index.js";
import {
  CHAMPIONS_ADVANCEMENT_TYPES,
  championshipFinalCapacity,
  championshipGeneration,
  championshipSettings,
  championsOperationsEnabled,
  completeChampionshipQualifier,
  createChampionshipAdvancement,
  fetchNormalizedChampionsHallOfFame,
  getChampionshipManagementSnapshot,
  cancelChampionshipAdvancement,
  saveChampionshipEventRelation,
} from "../services/index.js";

const SOURCE_LABELS = { ranking: "ranking · 시즌 직행", qualifier: "qualifier · 선발전", manual: "manual · 운영 예외" };
const FORMAT_LABELS = { singles: "Singles Champion", doubles: "Doubles Champion" };

/* ============================== CHAMPIONS ============================== */
export default function ChampionsPage({ data, admin, setModal, normTeam, go }) {
  const [normalizedChamps, setNormalizedChamps] = useState(null);
  const normalizedEnabled = championsOperationsEnabled();
  useEffect(() => {
    let cancelled = false;
    if (!normalizedEnabled) return undefined;
    fetchNormalizedChampionsHallOfFame()
      .then(rows => { if (!cancelled) setNormalizedChamps(rows); })
      .catch(error => { console.warn("normalized Champions read failed", error); if (!cancelled) setNormalizedChamps([]); });
    return () => { cancelled = true; };
  }, [normalizedEnabled]);
  const legacyChamps = Array.isArray(data.champions) ? data.champions : [];
  const champs=[...(normalizedChamps?.length ? normalizedChamps : legacyChamps)].sort((a,b)=>Number(a.season||a.generation_number||0)-Number(b.season||b.generation_number||0));
  const [pop,setPop]=useState(null);
  useEffect(()=>{ if(!pop) return;
    const f=(e)=>{ if(e.key==="Escape") setPop(null); };
    window.addEventListener("keydown",f); return()=>window.removeEventListener("keydown",f); },[pop]);
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Hall of Fame</div><h2>명예의 전당</h2>
      <p className="sub">챔피언스 시리즈를 제패한 역대 챔피언입니다. 전당을 누르면 우승 엔트리를 볼 수 있습니다.</p>
      {admin&&<div className="row-actions"><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"champion"})}>+ 레거시 챔피언 추가</button></div>}
    </Reveal>
    {admin && <ChampionsOperationsPanel enabled={normalizedEnabled} go={go} />}
    <div className="hof-grid">{champs.map((c,i)=>(
      <Reveal key={c.id} delay={(i%2)*70} className="hof-tile">
        <button className="hof-btn" onClick={()=>setPop(c)} aria-label={c.name+" 우승 엔트리 보기"}>
          <span className="hof-crown">👑</span>
          <span className="hof-gen">{c.gen} 챔피언</span>
          <span className="hof-nm">{c.name}</span>
          {c.format&&<span className="hof-season">{FORMAT_LABELS[c.format]||c.format}</span>}
          <span className="hof-season">{c.slabel||("SEASON "+c.season)}</span>
          <span className="hof-cta">우승 엔트리 보기 →</span>
        </button>
        {admin&&<div className="edit-row"><button className="btn btn-ghost btn-sm ed-pencil" onClick={()=>setModal({type:"champion",item:c})}>수정</button></div>}
      </Reveal>))}</div>

    {pop&&<div className="overlay" onClick={()=>setPop(null)}>
      <div className="modal hof-modal" onClick={(e)=>e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="hofm-top">
          <div className="hofm-congrat">전당등록을 축하합니다!</div>
          <div className="hofm-gen">{pop.slabel||("SEASON "+pop.season)}</div>
          <div className="hofm-nm">{pop.name}</div>
        </div>
        <div className="hofm-team">{normTeam(pop.team).filter(m=>m.name||m.img).map((m,j)=>{const img=m.img;return (
          <div className={"hofm-poke"+(img?"":" noimg")} key={j} style={{animationDelay:(j*70)+"ms"}}>
            <div className="hofm-sp">{img?<img src={img} alt={m.name} loading="lazy" decoding="async"/>:<span className="hofm-ph">{(m.name||"").slice(0,2)}</span>}</div>
            <div className="hofm-pn">{m.name}</div>
          </div>);})}</div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={()=>setPop(null)}>닫기</button></div>
      </div>
    </div>}
  </section>);
}

function ChampionsOperationsPanel({ enabled, go }) {
  const [snapshot, setSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [qualifierId, setQualifierId] = useState("");
  const [finalId, setFinalId] = useState("");
  const [generation, setGeneration] = useState("");
  const [battleFormat, setBattleFormat] = useState("singles");
  const [competitionFormat, setCompetitionFormat] = useState("single_elimination");
  const [capacity, setCapacity] = useState("8");
  const [slots, setSlots] = useState("4");
  const [playerId, setPlayerId] = useState("");
  const [source, setSource] = useState("ranking");
  const [sourceEntryId, setSourceEntryId] = useState("");
  const [reason, setReason] = useState("");

  const load = async () => {
    if (!enabled) return;
    try {
      const next = await getChampionshipManagementSnapshot();
      setSnapshot(next);
      const linkedQualifier = next.events.find(event => event.championship_phase === "qualifier" && event.championship_final_event_id);
      const nextQualifier = linkedQualifier || next.events.find(event => event.championship_phase === "qualifier") || next.events[0];
      const nextFinal = nextQualifier?.championship_final_event_id
        ? next.events.find(event => event.id === nextQualifier.championship_final_event_id)
        : next.events.find(event => event.championship_phase === "final") || next.events.find(event => event.id !== nextQualifier?.id);
      if (nextQualifier && !qualifierId) setQualifierId(nextQualifier.id);
      if (nextFinal && !finalId) setFinalId(nextFinal.id);
      if (nextFinal) {
        setGeneration(String(championshipGeneration(nextFinal) || ""));
        setCapacity(String(championshipFinalCapacity(nextFinal) || 8));
        setBattleFormat(nextFinal.battle_format || nextQualifier?.battle_format || "singles");
        setCompetitionFormat(nextFinal.competition_format || "single_elimination");
      }
      if (nextQualifier) setSlots(String(nextQualifier.qualification_slots || 4));
      setMessage("");
    } catch (error) { setMessage(error?.message || "Champions 운영 정보를 불러오지 못했습니다."); }
  };

  useEffect(() => { void load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const qualifier = snapshot?.events.find(event => event.id === qualifierId) || null;
  const final = snapshot?.events.find(event => event.id === finalId) || null;
  const finalRegistrations = useMemo(() => (snapshot?.registrations || []).filter(row => row.event_id === finalId), [snapshot, finalId]);
  const advancementByRegistration = useMemo(() => new Map((snapshot?.advancements || []).map(row => [row.final_registration_id, row])), [snapshot]);
  const finalAdvancements = finalRegistrations.map(registration => ({ registration, advancement: advancementByRegistration.get(registration.id) })).filter(row => row.advancement);
  const sourceEntries = (snapshot?.entries || []).filter(entry => entry.event_id === qualifierId && entry.entry_type === "individual" && entry.status === "active");
  const participantForEntry = entry => (snapshot?.entryParticipants || []).find(row => row.entry_id === entry.id);
  const playerName = id => snapshot?.players.find(player => player.id === id)?.display_name || "알 수 없는 선수";
  const submissionCount = registrationId => (snapshot?.submissions || []).filter(row => row.registration_id === registrationId).length;

  if (!enabled) return <div className="panel" style={{margin:"10px 0 24px",padding:18}}>Champions normalized 운영은 Test Supabase 환경에서만 열립니다.</div>;
  return <Reveal className="panel" style={{margin:"10px 0 24px",padding:20}}>
    <div className="records-block-head"><div><h4 style={{margin:0}}>Champions 운영</h4><span>자동 선발 없이 운영자가 실제 참가자를 직접 확정합니다.</span></div><button className="btn btn-ghost btn-sm" onClick={()=>void load()} disabled={busy}>새로고침</button></div>
    {message&&<div className="bk-hint" style={{color:"var(--loss)",marginTop:12}} role="alert">{message}</div>}
    <div className="bk-grow2" style={{marginTop:14}}>
      <div className="field"><label>Qualifier Event</label><select value={qualifierId} onChange={e=>setQualifierId(e.target.value)}><option value="">선택</option>{(snapshot?.events||[]).map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
      <div className="field"><label>Final Event</label><select value={finalId} onChange={e=>setFinalId(e.target.value)}><option value="">선택</option>{(snapshot?.events||[]).map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
    </div>
    <div className="bk-grow2">
      <div className="field"><label>Champions generation</label><input type="number" min="1" value={generation} onChange={e=>setGeneration(e.target.value)}/></div>
      <div className="field"><label>battle format</label><select value={battleFormat} onChange={e=>setBattleFormat(e.target.value)}><option value="singles">singles</option><option value="doubles">doubles</option></select></div>
      <div className="field"><label>competition format</label><select value={competitionFormat} onChange={e=>setCompetitionFormat(e.target.value)}><option value="single_elimination">single elimination</option><option value="double_elimination">double elimination</option></select></div>
      <div className="field"><label>final capacity</label><input type="number" min="1" value={capacity} onChange={e=>setCapacity(e.target.value)}/></div>
      <div className="field"><label>qualification slots</label><input type="number" min="1" value={slots} onChange={e=>setSlots(e.target.value)}/></div>
    </div>
    <div className="row-actions" style={{justifyContent:"flex-end"}}><button className="btn btn-primary btn-sm" disabled={busy||!qualifierId||!finalId} onClick={async()=>{setBusy(true);setMessage("");try{await saveChampionshipEventRelation({qualifierEventId:qualifierId,finalEventId:finalId,generationNumber:generation,battleFormat,competitionFormat,finalCapacity:capacity,qualificationSlots:slots});await load();setMessage("qualifier / final Event 관계를 저장했습니다.");}catch(error){setMessage(error?.message||"Event 관계 저장에 실패했습니다.");}finally{setBusy(false);}}}>관계 저장</button></div>

    {final&&<>
      <div className="records-block-head" style={{marginTop:22}}><div><h4 style={{margin:0}}>본선 advancement</h4><span>{finalAdvancements.length}/{capacity || "-"}명 · ranking/qualifier/manual 수동 확정</span></div></div>
      <div className="bk-grow2" style={{marginTop:12}}>
        <div className="field"><label>Player</label><select value={playerId} onChange={e=>setPlayerId(e.target.value)}><option value="">선택</option>{(snapshot?.players||[]).filter(player=>player.status !== "inactive").map(player=><option key={player.id} value={player.id}>{player.display_name}</option>)}</select></div>
        <div className="field"><label>advancement source</label><select value={source} onChange={e=>{setSource(e.target.value);if(e.target.value!=="qualifier")setSourceEntryId("");}}>{CHAMPIONS_ADVANCEMENT_TYPES.map(value=><option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}</select></div>
        {source==="qualifier"&&<div className="field"><label>source qualifier Entry</label><select value={sourceEntryId} onChange={e=>setSourceEntryId(e.target.value)}><option value="">선택</option>{sourceEntries.map(entry=><option key={entry.id} value={entry.id}>{entry.display_name || playerName(participantForEntry(entry)?.player_id)} · {playerName(participantForEntry(entry)?.player_id)}</option>)}</select></div>}
        <div className="field"><label>reason (선택)</label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 기존 직행자 불참 대체"/></div>
      </div>
      <div className="row-actions" style={{justifyContent:"flex-end"}}><button className="btn btn-primary btn-sm" disabled={busy||!playerId||!finalId} onClick={async()=>{setBusy(true);setMessage("");try{await createChampionshipAdvancement({finalEventId:finalId,playerId,advancementType:source,sourceEntryId:sourceEntryId||null,reason});setPlayerId("");setSourceEntryId("");setReason("");await load();setMessage("본선 advancement와 Final Registration을 생성했습니다.");}catch(error){setMessage(error?.message||"advancement 생성에 실패했습니다.");}finally{setBusy(false);}}}>본선 진출 확정</button></div>
      <div className="bk-fill" style={{marginTop:12}}>{finalAdvancements.length===0&&<div className="bk-hint">아직 수동 확정된 본선 참가자가 없습니다.</div>}{finalAdvancements.map(({registration,advancement})=><div className="bk-pin" key={advancement.id}><span className="bk-pin-no">{playerName(registration.player_id)}</span><div style={{flex:1}}><b>{SOURCE_LABELS[advancement.advancement_type]}</b><div className="bk-hint" style={{marginTop:3}}>Final Registration · {submissionCount(registration.id)>0?`파티 제출 ${submissionCount(registration.id)}건` : "파티 미제출"}{advancement.reason?` · ${advancement.reason}`:""}</div></div>{final.status!=="completed"&&<button className="btn btn-danger btn-sm" disabled={busy} onClick={async()=>{if(!window.confirm("후속 competition data가 없을 때만 advancement와 runtime-owned Registration을 취소합니다. 계속할까요?"))return;setBusy(true);setMessage("");try{await cancelChampionshipAdvancement(advancement.id);await load();setMessage("advancement와 Final Registration을 취소했습니다.");}catch(error){setMessage(error?.message||"후속 사실이 있어 취소를 중단했습니다.");}finally{setBusy(false);}}}>확정 취소</button>}</div>)}</div>
      <div className="row-actions" style={{justifyContent:"flex-end",marginTop:12}}>{go&&<button className="btn btn-ghost btn-sm" onClick={()=>go("bracket",{eventId:final.id})}>Final bracket 열기 →</button>}</div>
    </>}
    {qualifier&&<div className="row-actions" style={{justifyContent:"space-between",marginTop:16}}><span className="bk-hint">qualifier 진출 {finalAdvancements.filter(({advancement})=>advancement.advancement_type==="qualifier").length}/{qualifier.qualification_slots||slots}명</span><button className="btn btn-ghost btn-sm" disabled={busy||qualifier.status==="completed"} onClick={async()=>{setBusy(true);setMessage("");try{await completeChampionshipQualifier(qualifier.id);await load();setMessage("qualifier 선발 과정을 종료했습니다. Placement Result/Award/HOF는 생성하지 않았습니다.");}catch(error){setMessage(error?.message||"qualifier 종료 조건을 확인해 주세요.");}finally{setBusy(false);}}}>qualifier 종료</button></div>}
  </Reveal>;
}
