import React, { useEffect, useState } from "react";
import { ListSearch, Modal, Pager, Reveal } from "../components/index.js";

const uid = () => Math.random().toString(36).slice(2, 9);
const PAGE_SIZE = 10;

/* ============================== BOARD (자유게시판) ============================== */
function fmtDT(iso){ try{ const d=new Date(iso); const p=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }catch{ return ""; } }
function initialOf(s){ return (s||"?").trim().charAt(0)||"?"; }

function parseMedia(url){
  if(!url) return null; const u=String(url).trim(); if(!u) return null;
  const yt=u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if(yt) return {type:"youtube",id:yt[1]};
  const full=/^https?:\/\//i.test(u)?u:"https://"+u;
  if(/\.(jpe?g|png|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return {type:"image",url:full};
  return {type:"link",url:full};
}
function MediaEmbed({ url }){
  const m=parseMedia(url); if(!m) return null;
  if(m.type==="youtube") return <div className="bd-yt"><iframe src={"https://www.youtube.com/embed/"+m.id} title="YouTube" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen/></div>;
  if(m.type==="image") return <a className="bd-img" href={m.url} target="_blank" rel="noopener noreferrer"><img src={m.url} alt="첨부 이미지" loading="lazy" decoding="async"/></a>;
  return <a className="ann-link" href={m.url} target="_blank" rel="noopener noreferrer" style={{marginTop:8}}>{m.url} ↗</a>;
}
function mediaIcon(url){ const m=parseMedia(url); return m?(m.type==="youtube"?"🎬":m.type==="image"?"🖼":"🔗"):null; }

function BoardCompose({ onClose, onSubmit }){
  const [nick,setNick]=useState(""); const [title,setTitle]=useState(""); const [body,setBody]=useState(""); const [pin,setPin]=useState(""); const [link,setLink]=useState(""); const [secret,setSecret]=useState(false);
  const submit=()=>{ if(!nick.trim()){alert("닉네임을 입력해주세요.");return;} if(!title.trim()){alert("제목을 입력해주세요.");return;}
    onSubmit({nick:nick.trim().slice(0,20),title:title.trim().slice(0,60),body:body.trim(),pin:pin.trim(),link:link.trim(),secret}); };
  return (<Modal title="새 글 작성" onClose={onClose}>
    <div className="swap" key="compose">
      <div className="bk-grow2">
        <div className="field"><label>닉네임</label><input value={nick} onChange={e=>setNick(e.target.value)} placeholder="예: 지나가던트레이너" maxLength={20}/></div>
        <div className="field"><label>삭제 PIN (선택, 숫자 4자리)</label><input value={pin} onChange={e=>setPin(e.target.value.replace(/[^0-9]/g,"").slice(0,4))} placeholder="예: 1234" inputMode="numeric"/></div>
      </div>
      <div className="field"><label>제목</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="제목을 입력하세요" maxLength={60}/></div>
      <div className="field"><label>내용</label><textarea value={body} onChange={e=>setBody(e.target.value)} rows={6} placeholder="자유롭게 작성해주세요."/></div>
      <div className="field"><label>이미지 또는 유튜브 링크 (선택)</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="이미지 주소 또는 유튜브 링크를 붙여넣으세요"/>
        {link.trim()&&<div className="bd-preview"><div className="bd-preview-h">미리보기</div><MediaEmbed url={link}/></div>}
      </div>
      <label className="bk-check"><input type="checkbox" checked={secret} onChange={e=>setSecret(e.target.checked)}/><span>🔒 관리자에게만 보이기 <i>(건의, 비공개)</i></span></label>
      {secret&&<div className="bk-hint">이 글은 관리자만 볼 수 있습니다. 다른 방문자에게는 목록에도 표시되지 않습니다.</div>}
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>등록</button></div>
    </div>
  </Modal>);
}

function CommentForm({ onSubmit }){
  const [nick,setNick]=useState(""); const [body,setBody]=useState(""); const [pin,setPin]=useState(""); const [link,setLink]=useState("");
  const submit=()=>{ if(!nick.trim()){alert("닉네임을 입력해주세요.");return;} if(!body.trim()&&!link.trim()){alert("댓글이나 링크를 입력해주세요.");return;}
    onSubmit({nick:nick.trim().slice(0,20),body:body.trim(),pin:pin.trim(),link:link.trim()}); setBody(""); setPin(""); setLink(""); };
  return (<div className="bd-cform">
    <div className="bd-cform-row">
      <input className="bd-cform-nick" value={nick} onChange={e=>setNick(e.target.value)} placeholder="닉네임" maxLength={20}/>
      <input className="bd-cform-pin" value={pin} onChange={e=>setPin(e.target.value.replace(/[^0-9]/g,"").slice(0,4))} placeholder="PIN(선택)" inputMode="numeric"/>
    </div>
    <div className="bd-cform-row">
      <input className="bd-cform-body" value={body} onChange={e=>setBody(e.target.value)} placeholder="댓글 달기…" onKeyDown={e=>{if(e.key==="Enter")submit();}}/>
      <button className="btn btn-primary btn-sm" onClick={submit}>등록</button>
    </div>
    <input className="bd-cform-link" value={link} onChange={e=>setLink(e.target.value)} placeholder="이미지 또는 유튜브 링크 (선택)"/>
  </div>);
}

export default function BoardPage({ data, admin, save, flash }){
  const [q,setQ]=useState(""); const [page,setPage]=useState(1);
  const all=[...(data.board||[])].filter(p=>admin||!p.secret).sort((a,b)=>(a.createdAt<b.createdAt?1:-1));
  const kw=q.trim().toLowerCase();
  const list=kw?all.filter(p=>[p.title,p.body,p.nick].some(t=>String(t||"").toLowerCase().includes(kw))):all;
  const pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
  const cur=Math.min(page,pages);
  const shown=list.slice((cur-1)*PAGE_SIZE,cur*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[q]);
  const [open,setOpen]=useState(()=>new Set());
  const [compose,setCompose]=useState(false);
  const toggle=(id)=>setOpen(prev=>{ const s=new Set(prev); s.has(id)?s.delete(id):s.add(id); return s; });
  const addPost=(post)=>{ save({...data,board:[{...post,id:uid(),createdAt:new Date().toISOString(),comments:[]},...(data.board||[])]}); setCompose(false); flash("글 등록 ✓"); };
  const delPost=(p)=>{ if(admin){ if(!confirm("이 글을 삭제할까요?"))return; } else { const pin=prompt("본인 글을 삭제하려면 작성 시 입력한 PIN을 입력하세요."); if(pin===null)return; if(!p.pin||pin!==p.pin){alert("PIN이 일치하지 않습니다.");return;} }
    save({...data,board:(data.board||[]).filter(x=>x.id!==p.id)}); flash("삭제됨"); };
  const addComment=(p,c)=>{ save({...data,board:(data.board||[]).map(x=>x.id===p.id?{...x,comments:[...(x.comments||[]),{...c,id:uid(),createdAt:new Date().toISOString()}]}:x)}); flash("댓글 등록 ✓"); };
  const delComment=(p,c)=>{ if(admin){ if(!confirm("이 댓글을 삭제할까요?"))return; } else { const pin=prompt("본인 댓글을 삭제하려면 PIN을 입력하세요."); if(pin===null)return; if(!c.pin||pin!==c.pin){alert("PIN이 일치하지 않습니다.");return;} }
    save({...data,board:(data.board||[]).map(x=>x.id===p.id?{...x,comments:(x.comments||[]).filter(y=>y.id!==c.id)}:x)}); };
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Community</div><h2>게시판</h2>
      <p className="sub">로그인 없이 닉네임으로 자유롭게 글과 댓글을 남기는 공간입니다.</p>
      <div className="row-actions"><button className="btn btn-primary btn-sm" onClick={()=>setCompose(true)}>✏️ 글쓰기</button></div>
    </Reveal>
    <ListSearch q={q} setQ={setQ} placeholder="제목, 내용, 글쓴이 검색" count={list.length}/>
    <div className="bd-list">
      {list.length===0&&<div className="bd-empty">{kw?"검색 결과가 없습니다.":"아직 글이 없습니다. 첫 글을 남겨보세요!"}</div>}
      {shown.map(p=>{ const isOpen=open.has(p.id); const cc=(p.comments||[]).length;
        return (<div className={"bd-item"+(isOpen?" open":"")+(p.secret?" secret":"")} key={p.id}>
          <button className="bd-head" onClick={()=>toggle(p.id)}>
            <span className="bd-ava">{initialOf(p.nick)}</span>
            <span className="bd-main">
              <span className="bd-title">{p.secret&&<span className="bd-lock">🔒 관리자 전용</span>}{p.title||p.body||"(제목 없음)"}</span>
              <span className="bd-meta"><b className="bd-nick">{p.nick}</b><span className="bd-date tnum">{fmtDT(p.createdAt)}</span></span>
            </span>
            <span className="bd-cc">💬 {cc}</span>
            <span className="nb-chev" aria-hidden="true">▾</span>
          </button>
          {isOpen&&<div className="bd-open swap">
            {p.body&&<div className="bd-body">{p.body}</div>}
            {p.link&&<MediaEmbed url={p.link}/>}
            <div className="bd-tools"><button className="bd-del" onClick={()=>delPost(p)}>삭제</button></div>
            <div className="bd-cmts">
              <div className="bd-cmts-h">댓글 {cc}</div>
              {(p.comments||[]).map(c=>(<div className="bd-cmt" key={c.id}>
                <span className="bd-ava sm">{initialOf(c.nick)}</span>
                <div className="bd-cmt-main"><div className="bd-cmt-top"><b>{c.nick}</b><span className="bd-date tnum">{fmtDT(c.createdAt)}</span><button className="bd-del sm" onClick={()=>delComment(p,c)}>삭제</button></div><div className="bd-cmt-body">{c.body}{c.link&&<MediaEmbed url={c.link}/>}</div></div>
              </div>))}
              <CommentForm onSubmit={(c)=>addComment(p,c)}/>
            </div>
          </div>}
        </div>);})}
    </div>
    <Pager page={cur} pages={pages} onGo={setPage}/>
    {compose&&<BoardCompose onClose={()=>setCompose(false)} onSubmit={addPost}/>}
  </section>);
}
