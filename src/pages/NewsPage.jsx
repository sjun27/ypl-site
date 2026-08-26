import React, { useEffect, useState } from "react";
import { Dropdown, ListSearch, Modal, Pager, Reveal } from "../components/index.js";

function fmtDT(iso){ try{ const d=new Date(iso); const p=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }catch{ return ""; } }

const PAGE_SIZE=10;
export default function NewsPage({ data, admin, setModal, save, submitForm, refresh }) {
  const [q,setQ]=useState(""); const [page,setPage]=useState(1);
  const [fill,setFill]=useState(null); const [respId,setRespId]=useState(null);
  const [open,setOpen]=useState(()=>new Set());
  const [seen,setSeen]=useState("");
  const hasPublic=(data.announcements||[]).some(a=>a.form&&a.form.enabled&&(a.form.fields||[]).some(f=>f.public));
  // 공개 응답이 있는 공지가 있으면 10초마다 자동 갱신(폴링) — 서버 push가 없어 주기적 재조회 방식
  useEffect(()=>{
    if(!hasPublic||!refresh) return;
    const tick=async()=>{ await refresh(); setSeen(new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})); };
    tick();
    const t=setInterval(()=>{ if(!document.hidden) tick(); },10000);
    return ()=>clearInterval(t);
  },[hasPublic,refresh]);
  const doRefresh=async()=>{ if(refresh){ await refresh(); setSeen(new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})); } };
  const toggle=(id)=>setOpen(prev=>{ const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  const href=(u)=>/^https?:\/\//.test(u)?u:"https://"+u;
  const all=[...data.announcements].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(a.date<b.date?1:-1));
  const kw=q.trim().toLowerCase();
  const list=kw?all.filter(a=>[a.title,a.body,a.date].some(t=>String(t||"").toLowerCase().includes(kw))):all;
  const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
  const cur=Math.min(page,pages);
  const shown=list.slice((cur-1)*PAGE_SIZE,cur*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[q]);
  const respAnn=respId?data.announcements.find(a=>a.id===respId):null;
  const fillAnn=fill?data.announcements.find(a=>a.id===fill):null;
  const delResp=(rid)=>{ const announcements=data.announcements.map(a=>a.id!==respId?a:{...a,form:{...(a.form||{}),responses:((a.form||{}).responses||[]).filter(r=>r.id!==rid)}}); save({...data,announcements}); };
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Announcements</div><h2>공지</h2>
      <p className="sub">대회 일정과 리그 운영 소식을 안내합니다. 제목을 누르면 내용이 펼쳐집니다.</p>
      {admin&&<div className="row-actions"><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"ann"})}>+ 공지 작성</button></div>}
    </Reveal>
    <ListSearch q={q} setQ={setQ} placeholder="공지 제목과 내용 검색" count={list.length}/>
    <Reveal className="panel" style={{padding:"4px 22px"}}>
      {list.length===0&&<div style={{padding:"40px 0",textAlign:"center",color:"var(--muted2)",fontSize:14}}>{kw?"검색 결과가 없습니다.":"등록된 공지가 없습니다."}</div>}
      {shown.map(a=>{ const isOpen=open.has(a.id); const hasLink=a.link||a.link2; const hasForm=a.form&&a.form.enabled;
        return (<div className={"nb-item"+(isOpen?" open":"")} key={a.id}>
          <button className="nb-head" onClick={()=>toggle(a.id)}>
            <span className="nb-main">
              <span className="nb-title">{a.title}</span>
              <span className="nb-meta"><span className="nb-date tnum">{a.date}</span>{a.pinned&&<span className="pin">고정</span>}</span>
            </span>
            <span className="nb-chev" aria-hidden="true">▾</span>
          </button>
          {hasLink&&<div className="nb-links">
            {a.link&&<a className="ann-link" href={href(a.link)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{a.linkLabel||"링크 바로가기"} ↗</a>}
            {a.link2&&<a className="ann-link alt" href={href(a.link2)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{a.link2Label||"링크 바로가기"} ↗</a>}
          </div>}
          {hasForm&&<div className="ann-formbtns">
            <button className="ann-apply" onClick={e=>{e.stopPropagation();setFill(a.id);}}>📝 {a.form.buttonLabel||"참가 신청하기"}</button>
            {admin&&<button className="ann-resp" onClick={e=>{e.stopPropagation();setRespId(a.id);}}>응답 보기 <span className="rc">{(a.form.responses||[]).length}</span></button>}
          </div>}
          {hasForm&&(a.form.fields||[]).some(f=>f.public)&&<PublicResponses ann={a} onRefresh={doRefresh} updatedAt={seen}/>}
          {isOpen&&<div className="nb-body swap"><p>{a.body}</p>{admin&&<div className="edit-row"><button className="btn btn-ghost btn-sm" onClick={()=>setModal({type:"ann",item:a})}>수정</button></div>}</div>}
        </div>);})}
    </Reveal>
    <Pager page={cur} pages={pages} onGo={setPage}/>
    {fillAnn&&<FormFillModal ann={fillAnn} onClose={()=>setFill(null)} onSubmit={(answers)=>submitForm(fillAnn.id,answers)}/>}
    {respAnn&&<FormResponsesModal ann={respAnn} onClose={()=>setRespId(null)} onDeleteResp={delResp}/>}
  </section>);
}

/* ===== 공개 응답 목록 (예: 실시간 밴 리스트) ===== */
function PublicResponses({ ann, compact, onRefresh, updatedAt }){
  const form=ann.form||{};
  const fields=(form.fields||[]).filter(f=>f.public);
  const [open,setOpen]=useState(false); // 기본은 접힘 — 응답이 쌓여도 화면이 길어지지 않도록
  if(!fields.length) return null;
  const resp=[...(form.responses||[])].sort((a,b)=>(a.createdAt<b.createdAt?-1:1));
  const val=(r,f)=>{ const v=(r.answers||{})[f.id]; return Array.isArray(v)?v.join(", "):String(v||""); };
  return (<div className={"pr-wrap fold"+(open?" open":"")+(compact?" compact":"")}>
    <button type="button" className="fold-head pr-fold-head" onClick={e=>{e.stopPropagation();setOpen(v=>!v);}}>
      <span className="pr-title">📋 {form.publicTitle||"현재까지 신청 현황"}</span>
      <span className="pr-n">{resp.length}명</span>
      <span className="fold-chev" aria-hidden="true">▾</span>
    </button>
    {open&&<div className="pr-body swap">
      {resp.length===0
        ? <div className="pr-empty">아직 신청자가 없습니다. 첫 신청자가 되어보세요!</div>
        : <div className="pr-list">
            {resp.map((r,i)=>(<div className="pr-row" key={r.id}>
              <span className="pr-name">{i+1}</span>
              <div className="pr-vals">
                {fields.map(f=>{ const v=val(r,f); if(!v) return null;
                  return (<div className="pr-val" key={f.id}>
                    {fields.length>1&&<span className="pr-flabel">{f.label||"응답"}</span>}
                    <span className="pr-vtext">{v}</span>
                  </div>); })}
              </div>
            </div>))}
          </div>}
      <div className="pr-foot">
        {onRefresh&&<button className="pr-refresh" onClick={e=>{e.stopPropagation();onRefresh();}} title="새로고침">↻</button>}
        {updatedAt&&<span>자동 갱신 중, 마지막 확인 {updatedAt}</span>}
      </div>
    </div>}
  </div>);
}

/* ===== 신청서 폼 — 참가자 작성 / 관리자 응답 보기 ===== */
function FormFillModal({ ann, onClose, onSubmit }){
  const form=ann.form||{}; const fields=form.fields||[];
  const [ans,setAns]=useState({}); const [done,setDone]=useState(false); const [busy,setBusy]=useState(false);
  const set=(id,v)=>setAns(a=>({...a,[id]:v}));
  const toggleMulti=(id,opt)=>setAns(a=>{ const cur=Array.isArray(a[id])?a[id]:[]; return {...a,[id]:cur.includes(opt)?cur.filter(x=>x!==opt):[...cur,opt]}; });
  const submit=async()=>{
    for(const f of fields){ if(f.required){ const v=ans[f.id]; const empty=Array.isArray(v)?v.length===0:!String(v||"").trim(); if(empty){ alert(`'${f.label||"질문"}'은(는) 필수 응답입니다.`); return; } } }
    setBusy(true); const ok=await onSubmit(ans); setBusy(false);
    if(ok===false){ alert("신청 저장을 확인하지 못했습니다. 잠시 후 다시 제출해주세요."); return; }
    setDone(true);
  };
  if(done) return (<Modal title={ann.title} onClose={onClose}><div className="ff-done"><div className="ff-ok" aria-hidden="true">✅</div><h4>신청이 접수되었습니다</h4><p>소중한 신청 감사합니다.<br/>결과 및 안내는 공지를 통해 전달됩니다.</p><div className="modal-actions" style={{justifyContent:"center"}}><button className="btn btn-primary" onClick={onClose}>닫기</button></div></div></Modal>);
  return (<Modal title={ann.title} hint="아래 신청서를 작성한 뒤 제출해주세요." onClose={onClose}>
    <div className="swap" key="fill">
      {(fields||[]).some(f=>f.public)&&<PublicResponses ann={ann} compact/>}
      {fields.length===0&&<p style={{color:"var(--muted)",fontSize:14}}>등록된 질문이 없습니다.</p>}
      {fields.map((f,i)=>(<div className="ff-q" key={f.id}>
        <label className="ff-q-label">{f.label||`질문 ${i+1}`}{f.required&&<span className="req">*</span>}</label>
        {f.type==="short"&&<input type="text" value={ans[f.id]||""} onChange={e=>set(f.id,e.target.value)} placeholder="답변을 입력하세요"/>}
        {f.type==="long"&&<textarea value={ans[f.id]||""} onChange={e=>set(f.id,e.target.value)} placeholder="답변을 입력하세요"/>}
        {f.type==="single"&&<div className="ff-choices">{(f.options||[]).map((op,oi)=>(<label className={"ff-choice"+(ans[f.id]===op?" sel":"")} key={oi}><input type="radio" name={f.id} checked={ans[f.id]===op} onChange={()=>set(f.id,op)}/><span>{op}</span></label>))}</div>}
        {f.type==="multi"&&<div className="ff-choices">{(f.options||[]).map((op,oi)=>(<label className={"ff-choice"+((Array.isArray(ans[f.id])&&ans[f.id].includes(op))?" sel":"")} key={oi}><input type="checkbox" checked={Array.isArray(ans[f.id])&&ans[f.id].includes(op)} onChange={()=>toggleMulti(f.id,op)}/><span>{op}</span></label>))}</div>}
        {f.type==="dropdown"&&<Dropdown value={ans[f.id]||""} onChange={v=>set(f.id,v)} options={(f.options||[]).map(o=>({value:o,label:o}))} placeholder="선택하세요"/>}
      </div>))}
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose} disabled={busy}>취소</button><button className="btn btn-primary" onClick={submit} disabled={busy}>{busy?"제출 중… 잠시만요":"제출하기"}</button></div>
    </div>
  </Modal>);
}
function FormResponsesModal({ ann, onClose, onDeleteResp }){
  const form=ann.form||{}; const fields=form.fields||[]; const resp=[...(form.responses||[])].sort((a,b)=>(a.createdAt<b.createdAt?-1:1));
  const cell=(v)=>Array.isArray(v)?v.join(", "):(v==null?"":String(v));
  const csv=()=>{
    const esc=(s)=>{ s=String(s==null?"":s); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
    const header=["번호","제출시각",...fields.map(f=>f.label||"질문")];
    const rows=resp.map((r,i)=>[i+1,fmtDT(r.createdAt),...fields.map(f=>cell(r.answers&&r.answers[f.id]))]);
    const text="\ufeff"+[header,...rows].map(row=>row.map(esc).join(",")).join("\r\n");
    const blob=new Blob([text],{type:"text/csv;charset=utf-8;"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`${String(ann.title||"응답").replace(/[\\/:*?"<>|]/g,"_")}_응답.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  };
  return (<Modal title="신청 응답" hint={ann.title} onClose={onClose}>
    <div className="fr-bar"><span className="fr-tot">총 {resp.length}건</span>{resp.length>0&&<button className="btn btn-ghost btn-sm" onClick={csv}>⬇ CSV(엑셀) 다운로드</button>}</div>
    {resp.length===0?<div className="fr-empty">아직 접수된 신청이 없습니다.</div>:
      <div className="fr-scroll"><table className="fr-tbl">
        <thead><tr><th>#</th><th>제출시각</th>{fields.map(f=>(<th key={f.id}>{f.label||"질문"}</th>))}<th></th></tr></thead>
        <tbody>{resp.map((r,i)=>(<tr key={r.id}>
          <td className="fr-idx">{i+1}</td><td className="fr-dt">{fmtDT(r.createdAt)}</td>
          {fields.map(f=>(<td key={f.id}>{cell(r.answers&&r.answers[f.id])}</td>))}
          <td><button className="fr-del" onClick={()=>{if(confirm("이 응답을 삭제할까요?"))onDeleteResp(r.id);}} title="삭제">🗑</button></td>
        </tr>))}</tbody>
      </table></div>}
    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>닫기</button></div>
  </Modal>);
}
