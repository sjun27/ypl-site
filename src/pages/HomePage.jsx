import React, { useMemo } from "react";
import { Reveal } from "../components/index.js";

/* ============================== HOME ============================== */
export default function HomePage({ data, go, admin }) {
  const eras=data.rankings||[];
  const ypl=eras.find(e=>e.key==="era2")||eras[0];
  const top3=ypl?[...ypl.rows].sort((a,b)=>(b.points||0)-(a.points||0)).slice(0,3):[];
  const champs=[...data.champions].sort((a,b)=>b.season-a.season);
  const cur=champs[0];
  const titleCount=data.titleGroups.reduce((n,g)=>n+g.items.length,0);
  const roundCount=useMemo(()=>(data.tournaments||[]).reduce((n,t)=>n+(t.rounds||[]).filter(r=>r&&(String(r.win||"").trim()||(r.winMembers||[]).length>0)).length,0),[data.tournaments]);
  const news=[...data.announcements].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||(a.date<b.date?1:-1))[0];
  const posts=[...(data.board||[])].filter(p=>admin||!p.secret).sort((a,b)=>(a.createdAt<b.createdAt?1:-1)).slice(0,3);
  const quick=[["about","소개"],["board","게시판"],["bracket","대진표"],["titles","칭호"]];
  return (<section className="home">
    <Reveal className="home-hero">
      <h1 className="disp mark">YPL</h1>
      <p className="home-tag">{data.meta.tagline}</p>
      {cur&&<button className="home-champ" onClick={()=>go("champions")}>
        <span className="hch-k">현 챔피언</span>
        <span className="hch-n">{cur.name}</span>
        <span className="hch-g">{cur.gen}</span>
      </button>}
    </Reveal>

    <Reveal className="home-stats" delay={40}>
      <button className="hs" onClick={()=>go("records")}><b className="tnum">{roundCount}</b><span>누적 대회 회차</span></button>
      <button className="hs" onClick={()=>go("champions")}><b className="tnum">{champs.length}</b><span>역대 챔피언</span></button>
      <button className="hs" onClick={()=>go("titles")}><b className="tnum">{titleCount}</b><span>칭호</span></button>
    </Reveal>

    <div className="home-grid">
      <Reveal tag="button" className="hcard wide" delay={60} onClick={()=>go("news")}>
        <div className="hcard-head"><span className="hc-kick">최신 공지</span><span className="hc-go">→</span></div>
        {news?<div className="hc-news"><div className="hc-ndate tnum">{news.date}</div><div className="hc-ntitle">{news.title}</div></div>:<div className="hc-empty">새 공지가 없습니다.</div>}
      </Reveal>

      <Reveal tag="button" className="hcard" delay={90} onClick={()=>go("board")}>
        <div className="hcard-head"><span className="hc-kick">게시판</span><span className="hc-go">→</span></div>
        {posts.length?<div className="hc-posts">{posts.map(p=>(
          <div className="hc-prow" key={p.id}>{p.secret&&<span className="hc-lock">🔒</span>}<span className="hc-ptitle">{p.title||p.body||"(제목 없음)"}</span><span className="hc-pmeta">{p.nick}</span></div>))}
        </div>:<div className="hc-empty">아직 글이 없습니다.</div>}
      </Reveal>

      <Reveal tag="button" className="hcard" delay={120} onClick={()=>go("records")}>
        <div className="hcard-head"><span className="hc-kick">YPL 랭킹</span><span className="hc-go">→</span></div>
        <div className="hc-rank">{top3.map((r,i)=>(
          <div className="hc-rrow" key={i}><span className={"rankb r"+(i+1)}>{i+1}</span><span className="hc-rname">{r.name}</span><span className="hc-rpts tnum">{r.points}</span></div>))}
          {top3.length===0&&<div className="hc-empty">데이터 없음</div>}</div>
      </Reveal>

    </div>

    <Reveal className="home-quick" delay={150}>
      {quick.map(([k,l])=><button key={k} className="hq" onClick={()=>go(k)}><span>{l}</span><i>→</i></button>)}
    </Reveal>
  </section>);
}
