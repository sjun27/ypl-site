import React, { useEffect, useState } from "react";
import { Reveal } from "../components/index.js";
import { championsOperationsEnabled, fetchNormalizedChampionsHallOfFame } from "../services/index.js";
import {
  generationNumberFromLegacyLabel,
  legacyChampionLabel,
  loadHallOfFameArtworkLookup,
  resolveHallOfFameArtwork,
} from "../services/hallOfFamePresentation.js";

/* ============================== CHAMPIONS ============================== */
export default function ChampionsPage({ data, admin, setModal, normTeam, go }) {
  const [normalizedChamps, setNormalizedChamps] = useState(null);
  const [artworkLookup, setArtworkLookup] = useState(null);
  const normalizedEnabled = championsOperationsEnabled();
  useEffect(() => {
    let cancelled = false;
    if (!normalizedEnabled) return undefined;
    fetchNormalizedChampionsHallOfFame()
      .then(rows => { if (!cancelled) setNormalizedChamps(rows); })
      .catch(error => { console.warn("normalized Champions read failed", error); if (!cancelled) setNormalizedChamps([]); });
    return () => { cancelled = true; };
  }, [normalizedEnabled]);
  useEffect(() => {
    let cancelled = false;
    loadHallOfFameArtworkLookup()
      .then(lookup => { if (!cancelled) setArtworkLookup(lookup); })
      .catch(() => { if (!cancelled) setArtworkLookup(new Map()); });
    return () => { cancelled = true; };
  }, []);
  const legacyChamps = Array.isArray(data.champions) ? data.champions : [];
  const remoteRows = Array.isArray(normalizedChamps) ? normalizedChamps : [];
  const legacyByGeneration = new Map();
  for (const row of remoteRows.filter(row => row.kind === "legacy")) legacyByGeneration.set(row.generationNumber, row);
  for (const row of legacyChamps) {
    legacyByGeneration.set(generationNumberFromLegacyLabel(row.gen), {
      ...row,
      kind: "legacy",
      generationNumber: generationNumberFromLegacyLabel(row.gen),
    });
  }
  const champs=[
    ...legacyByGeneration.values(),
    ...remoteRows.filter(row => row.kind === "normalized"),
  ].sort((a,b) => Number(a.generationNumber || 0) - Number(b.generationNumber || 0)
    || String(a.format || "").localeCompare(String(b.format || "")));
  const [pop,setPop]=useState(null);
  useEffect(()=>{ if(!pop) return;
    const f=(e)=>{ if(e.key==="Escape") setPop(null); };
    window.addEventListener("keydown",f); return()=>window.removeEventListener("keydown",f); },[pop]);
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Hall of Fame</div><h2>명예의 전당</h2>
      <p className="sub">챔피언스 시리즈를 제패한 역대 챔피언입니다. 전당을 누르면 우승 엔트리를 볼 수 있습니다.</p>
      {admin&&<div className="row-actions"><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"champion"})}>+ 레거시 챔피언 추가</button></div>}
    </Reveal>
    <div className="hof-grid">{champs.map((c,i)=>(
      <Reveal key={c.id} delay={(i%2)*70} className="hof-tile">
        <button className="hof-btn" onClick={()=>setPop(c)} aria-label={c.name+" 우승 엔트리 보기"}>
          <span className="hof-crown">👑</span>
          <span className="hof-gen">{c.kind === "normalized" ? c.gen : legacyChampionLabel(c.gen)}</span>
          <span className="hof-nm">{c.name}</span>
          <span className="hof-season">{c.slabel||("SEASON "+c.season)}</span>
          <span className="hof-cta">우승 엔트리 보기 →</span>
        </button>
        {admin&&c.kind !== "normalized"&&<div className="edit-row"><button className="btn btn-ghost btn-sm ed-pencil" onClick={()=>setModal({type:"champion",item:c})}>수정</button></div>}
      </Reveal>))}</div>

    {pop&&<div className="overlay" onClick={()=>setPop(null)}>
      <div className="modal hof-modal" onClick={(e)=>e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="hofm-top">
          <div className="hofm-congrat">전당등록을 축하합니다!</div>
          <div className="hofm-gen">{pop.slabel||("SEASON "+pop.season)}</div>
          <div className="hofm-nm">{pop.name}</div>
        </div>
        <div className="hofm-team">{normTeam(pop.team).filter(m=>m.name||m.img||m.pokemonId).map((m,j)=>{const fallback=resolveHallOfFameArtwork(m, artworkLookup);const img=m.img||fallback;return (
          <div className={"hofm-poke"+(img?"":" noimg")} key={j} style={{animationDelay:(j*70)+"ms"}}>
            <div className="hofm-sp">{img?<img src={img} alt={m.name} loading="lazy" decoding="async" onError={event=>{if(fallback&&event.currentTarget.src!==fallback) event.currentTarget.src=fallback;}}/>:<span className="hofm-ph">{(m.name||"").slice(0,2)}</span>}</div>
            <div className="hofm-pn">{m.name}</div>
          </div>);})}</div>
        <div className="modal-actions"><button className="btn btn-primary" onClick={()=>setPop(null)}>닫기</button></div>
      </div>
    </div>}
  </section>);
}
