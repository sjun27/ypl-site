import React, { useEffect, useState } from "react";
import { Reveal } from "../components/index.js";

/* ============================== CHAMPIONS ============================== */
export default function ChampionsPage({ data, admin, setModal, normTeam }) {
  const champs=[...data.champions].sort((a,b)=>a.season-b.season);
  const [pop,setPop]=useState(null);
  useEffect(()=>{ if(!pop) return;
    const f=(e)=>{ if(e.key==="Escape") setPop(null); };
    window.addEventListener("keydown",f); return()=>window.removeEventListener("keydown",f); },[pop]);
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Hall of Fame</div><h2>명예의 전당</h2>
      <p className="sub">챔피언스 시리즈를 제패한 역대 챔피언입니다. 전당을 누르면 우승 엔트리를 볼 수 있습니다.</p>
      {admin&&<div className="row-actions"><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"champion"})}>+ 챔피언 추가</button></div>}
    </Reveal>
    <div className="hof-grid">{champs.map((c,i)=>(
      <Reveal key={c.id} delay={(i%2)*70} className="hof-tile">
        <button className="hof-btn" onClick={()=>setPop(c)} aria-label={c.name+" 우승 엔트리 보기"}>
          <span className="hof-crown">👑</span>
          <span className="hof-gen">{c.gen} 챔피언</span>
          <span className="hof-nm">{c.name}</span>
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
