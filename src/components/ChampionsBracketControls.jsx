import React, { useEffect, useMemo, useState } from "react";
import {
  cancelChampionshipAdvancement,
  completeChampionshipQualifier,
  createChampionshipAdvancement,
  getChampionshipManagementSnapshot,
} from "../services/index.js";

export function ChampionsBracketControls({ eventId, placement = "qualifier", onChanged }) {
  const [snapshot, setSnapshot] = useState(null);
  const [selected, setSelected] = useState([]);
  const [playerId, setPlayerId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const next = await getChampionshipManagementSnapshot();
      setSnapshot(next);
      setMessage("");
      return next;
    } catch (error) {
      setMessage(error?.message || "Champions 운영 정보를 불러오지 못했습니다.");
      return null;
    }
  };
  useEffect(() => { void load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const event = snapshot?.events.find(row => row.id === eventId) || null;
  const final = event?.championship_phase === "qualifier"
    ? snapshot?.events.find(row => row.id === event.championship_final_event_id) || null
    : event;
  const finalRegistrations = (snapshot?.registrations || []).filter(row => row.event_id === final?.id);
  const advancementByRegistration = new Map((snapshot?.advancements || []).map(row => [row.final_registration_id, row]));
  const finalAdvancements = finalRegistrations.map(registration => ({ registration, advancement: advancementByRegistration.get(registration.id) })).filter(row => row.advancement);
  const playerName = id => snapshot?.players.find(row => row.id === id)?.display_name || "알 수 없는 선수";
  const qualifierEntries = useMemo(() => (snapshot?.entries || [])
    .filter(entry => entry.event_id === eventId && entry.entry_type === "individual" && entry.status === "active")
    .map(entry => ({ ...entry, participant: (snapshot?.entryParticipants || []).find(row => row.entry_id === entry.id && row.event_id === eventId) }))
    .filter(entry => entry.participant?.player_id), [snapshot, eventId]);
  const advancedPlayerIds = new Set(finalAdvancements.map(row => row.registration.player_id));
  const remainingSlots = Math.max(0, Number(event?.qualification_slots || 0) - finalAdvancements.filter(row => row.advancement.advancement_type === "qualifier").length);

  if (!event || (placement === "qualifier" && event.championship_phase !== "qualifier") || (placement === "final" && event.championship_phase !== "final")) return null;

  const confirmQualifier = async () => {
    if (!final || selected.length !== remainingSlots) { setMessage(`남은 ${remainingSlots}명의 진출자를 선택해 주세요.`); return; }
    setBusy(true); setMessage("");
    try {
      for (const entryId of selected) {
        const entry = qualifierEntries.find(row => row.id === entryId);
        await createChampionshipAdvancement({ finalEventId: final.id, playerId: entry.participant.player_id, advancementType: "qualifier", sourceEntryId: entry.id });
      }
      setSelected([]); await load(); await onChanged?.(); setMessage("선택한 선수를 본선 진출자로 확정했습니다.");
    } catch (error) { setMessage(error?.message || "본선 진출자 확정에 실패했습니다.");
    } finally { setBusy(false); }
  };
  const completeQualifier = async () => {
    setBusy(true); setMessage("");
    try { await completeChampionshipQualifier(event.id); await load(); await onChanged?.(); setMessage("선발전을 종료했습니다. 대진과 승자 기록은 보존됩니다.");
    } catch (error) { setMessage(error?.message || "선발전 종료 조건을 확인해 주세요.");
    } finally { setBusy(false); }
  };
  const addFinalPlayer = async (type) => {
    if (!playerId) { setMessage("추가할 선수를 선택해 주세요."); return; }
    setBusy(true); setMessage("");
    try {
      await createChampionshipAdvancement({ finalEventId: event.id, playerId, advancementType: type, reason: String(reason || "").trim() });
      setPlayerId(""); setReason(""); await load(); await onChanged?.();
      setMessage(type === "ranking" ? "본선 직행자를 추가했습니다." : "운영 대체 선수를 추가했습니다.");
    } catch (error) { setMessage(error?.message || "본선 참가자 추가에 실패했습니다.");
    } finally { setBusy(false); }
  };
  const cancelFinalPlayer = async (advancementId) => {
    if (!window.confirm("아직 본선 대진이 만들어지지 않은 경우에만 이 선수를 불참 처리합니다. 계속할까요?")) return;
    setBusy(true); setMessage("");
    try { await cancelChampionshipAdvancement(advancementId); await load(); await onChanged?.(); setMessage("본선 불참자를 제외했습니다.");
    } catch (error) { setMessage(error?.message || "불참 처리에 실패했습니다.");
    } finally { setBusy(false); }
  };

  if (placement === "qualifier") return <section className="bk-submission" aria-label="본선 진출자 확정">
    <div className="records-block-head"><div><h4 style={{margin:0}}>본선 진출자 확정</h4><span>{finalAdvancements.filter(row => row.advancement.advancement_type === "qualifier").length}/{event.qualification_slots}명 · 선발전 우승 확정은 필요하지 않습니다.</span></div><button className="btn btn-ghost btn-sm" onClick={()=>void load()} disabled={busy}>새로고침</button></div>
    {message&&<div className="bk-hint" role="alert" style={{color:"var(--loss)",marginTop:8}}>{message}</div>}
    {event.status !== "completed" && remainingSlots > 0 && <div className="bk-fill" style={{marginTop:10}}>{qualifierEntries.map(entry => {
      const already = advancedPlayerIds.has(entry.participant.player_id); const checked = selected.includes(entry.id);
      return <label className="bk-pin" key={entry.id} style={{cursor:already?"default":"pointer"}}><input type="checkbox" checked={already || checked} disabled={already || busy || (!checked && selected.length >= remainingSlots)} onChange={()=>setSelected(previous=>checked ? previous.filter(id=>id!==entry.id) : [...previous,entry.id])} style={{width:"auto"}}/><span style={{fontWeight:700}}>{entry.display_name || playerName(entry.participant.player_id)}</span>{already&&<span className="bk-hint">이미 진출 확정</span>}</label>;
    })}</div>}
    <div className="row-actions" style={{justifyContent:"flex-end",marginTop:10}}>{event.status !== "completed" && remainingSlots > 0 && <button className="btn btn-primary btn-sm" disabled={busy || selected.length !== remainingSlots} onClick={()=>void confirmQualifier()}>선택 선수 본선 진출 확정</button>}{event.status !== "completed" && remainingSlots === 0 && <button className="btn btn-gold btn-sm" disabled={busy} onClick={()=>void completeQualifier()}>선발전 종료</button>}</div>
  </section>;

  const candidates = (snapshot?.players || []).filter(player => player.status !== "inactive" && !advancedPlayerIds.has(player.id));
  return <section className="bk-submission" aria-label="본선 참가자 추가">
    <div className="records-block-head"><div><h4 style={{margin:0}}>본선 참가자</h4><span>직행자나 대체자가 필요할 때만 여기서 추가합니다.</span></div><button className="btn btn-ghost btn-sm" onClick={()=>void load()} disabled={busy}>새로고침</button></div>
    {message&&<div className="bk-hint" role="alert" style={{color:"var(--loss)",marginTop:8}}>{message}</div>}
    <div className="bk-grow2" style={{marginTop:10}}><div className="field"><label>선수</label><select value={playerId} onChange={e=>setPlayerId(e.target.value)}><option value="">선택</option>{candidates.map(player=><option key={player.id} value={player.id}>{player.display_name}</option>)}</select></div><div className="field"><label>대체 사유 (선택)</label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 불참 대체"/></div></div>
    <div className="row-actions" style={{justifyContent:"flex-end"}}><button className="btn btn-ghost btn-sm" disabled={busy||!playerId} onClick={()=>void addFinalPlayer("ranking")}>직행자 추가</button><button className="btn btn-primary btn-sm" disabled={busy||!playerId} onClick={()=>void addFinalPlayer("manual")}>운영 대체 추가</button></div>
    <div className="bk-fill" style={{marginTop:10}}>{finalAdvancements.map(({registration, advancement})=><div className="bk-pin" key={advancement.id}><span style={{fontWeight:700,flex:1}}>{playerName(registration.player_id)}</span><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void cancelFinalPlayer(advancement.id)}>불참 처리</button></div>)}</div>
  </section>;
}
