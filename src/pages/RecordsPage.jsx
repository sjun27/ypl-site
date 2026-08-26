import React, { useState } from "react";

const uid = () => Math.random().toString(36).slice(2, 9);

/* ============================== RECORDS ============================== */
export default function RecordsPage({ data, admin, setModal, save, Reveal, StandTable }) {
  const [tab,setTab]=useState("rank");
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Records &amp; Stats</div><h2>기록</h2>
      <p className="sub">YPL의 모든 전적입니다.</p>
    </Reveal>
    <Reveal className="subtabs">{[["rank","누적 랭킹"],["season","시즌별 성적"],["tour","대회 회차"]].map(([k,l])=>
      <button key={k} className={"subtab"+(tab===k?" on":"")} onClick={()=>setTab(k)}>{l}</button>)}
    </Reveal>
    <Reveal tag="p" className="pts-note" style={{margin:"0 0 16px"}}>우승 <b>60</b>점, 준우승 <b>40</b>점, 4강 <b>20</b>점이 기본 포인트 기준입니다. 팀전 여부, 팀원 수, 대회 사정에 따라 변동될 수 있습니다.</Reveal>
    <div className="swap" key={tab}>
      {tab==="rank"&&<RankView data={data} admin={admin} setModal={setModal} save={save} StandTable={StandTable}/>}
      {tab==="season"&&<SeasonView data={data} admin={admin} setModal={setModal} save={save} StandTable={StandTable}/>}
      {tab==="tour"&&<TourView data={data} admin={admin} setModal={setModal}/>}
    </div>
  </section>);
}
function RankView({ data, admin, setModal, save, StandTable }) {
  const eras=data.rankings||[]; const [sel,setSel]=useState(eras[0]?.key);
  const era=eras.find(e=>e.key===sel)||eras[0];
  const addEra=()=>{ const name=(prompt("새 누적 랭킹 탭 이름 (예: 클래식)")||"").trim(); if(!name)return; const key="r_"+uid(); save({...data,rankings:[...eras,{key,label:name,rows:[]}]}); setSel(key); };
  if(!era) return (<>{admin&&<div style={{padding:"4px 0"}}><button className="btn btn-gold btn-sm" onClick={addEra}>+ 랭킹 탭 추가</button></div>}<div className="panel none" style={{padding:24}}>데이터 없음</div></>);
  return (<>
    <div className="subtabs">{eras.map(e=><button key={e.key} className={"subtab"+(e.key===sel?" on":"")} onClick={()=>setSel(e.key)}>{e.label}</button>)}{admin&&<button className="subtab add" onClick={addEra}>+ 추가</button>}</div>
    <div className="panel swap" key={sel}>
      {admin&&<div style={{padding:"12px 0 2px"}}><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"standings",title:era.label+" 랭킹",rows:era.rows,build:(rows)=>({...data,rankings:eras.map(x=>x.key===era.key?{...x,rows}:x)})})}>이 시기 랭킹 수정</button></div>}
      <StandTable rows={era.rows}/>
    </div>
  </>);
}
function SeasonView({ data, admin, setModal, save, StandTable }) {
  const seasons=data.seasons||[]; const [sel,setSel]=useState(Math.max(0,seasons.length-1));
  const addSeason=()=>{ const name=(prompt("새 시즌 이름 (예: YPL 시즌 3)")||"").trim(); if(!name)return; save({...data,seasons:[...seasons,{name,rows:[]}]}); setSel(seasons.length); };
  const s=seasons[sel];
  if(!s) return (<>{admin&&<div style={{padding:"4px 0"}}><button className="btn btn-gold btn-sm" onClick={addSeason}>+ 시즌 추가</button></div>}<div className="panel none" style={{padding:24}}>데이터 없음</div></>);
  const hasNote=s.rows.some(r=>r.note);
  const ordered=[...seasons.map((x,i)=>({x,i}))].reverse();
  return (<>
    <div className="subtabs">{ordered.map(({x,i})=><button key={i} className={"subtab"+(i===sel?" on":"")} onClick={()=>setSel(i)}>{x.name}</button>)}{admin&&<button className="subtab add" onClick={addSeason}>+ 추가</button>}</div>
    <div className="panel swap" key={sel}>
      {admin&&<div style={{padding:"12px 0 2px"}}><button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"standings",title:s.name,rows:s.rows,build:(rows)=>({...data,seasons:seasons.map((x,i)=>i===sel?{...x,rows}:x)})})}>{s.name} 성적 수정</button></div>}
      <StandTable rows={s.rows} showNote={hasNote}/>
    </div>
  </>);
}
function NameChips({ list, kind }) {
  return <>{list.map((n,i)=><span key={i} className={"r2-name "+(kind||"")}>{n}</span>)}</>;
}
function TourView({ data, admin, setModal }) {
  const tours=data.tournaments||[];
  const rank=(t)=>{ const l=t.label||""; return l.includes("마스터")?0:l.includes("루키")?1:l.includes("라이트")?2:l.includes("클래식")?3:4; };
  const otours=[...tours].sort((a,b)=>rank(a)-rank(b));
  const [sel,setSel]=useState(otours[0]?.key);
  const t=tours.find(x=>x.key===sel)||otours[0];
  if(!t) return <div className="panel none" style={{padding:24}}>데이터 없음</div>;
  const split=(s)=>String(s||"").split("/").map(x=>x.trim()).filter(Boolean);
  const rounds=[...(t.rounds||[])].sort((a,b)=>{
    if((a.date||"")!==(b.date||"")) return (a.date||"")<(b.date||"")?1:-1;
    const ca=a.champ?1:0, cb=b.champ?1:0; if(ca!==cb) return cb-ca;
    return (parseInt(b.round)||0)-(parseInt(a.round)||0);
  });
  return (<>
    <div className="subtabs">{otours.map(x=><button key={x.key} className={"subtab"+(x.key===sel?" on":"")} onClick={()=>setSel(x.key)}>{x.label}</button>)}</div>
    <div className="panel swap" key={sel} style={{paddingBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,margin:"14px 2px 4px",flexWrap:"wrap"}}>
        <span style={{width:11,height:11,borderRadius:4,background:t.color}}/>
        <h3 style={{margin:0,fontSize:18,fontWeight:800,color:"var(--navy)"}}>{t.label}</h3>
        <span style={{fontSize:12.5,color:"var(--muted)",fontWeight:600}} className="tnum">{(t.rounds||[]).length}회</span>
        {admin&&<button className="btn btn-gold btn-sm ed-pencil" onClick={()=>setModal({type:"rounds",title:t.label,rounds:t.rounds,seasons:(data.seasons||[]).map(s=>s.name),build:(rounds)=>({...data,tournaments:tours.map(x=>x.key===t.key?{...x,rounds}:x)})})}>회차 편집</button>}
      </div>
      {rounds.map((r,i)=>{
        const rl=r.round?(/^\d+$/.test(String(r.round))?String(r.round)+"회":r.round):"";
        return (
        <div className={"round2"+(r.champ?" champ":"")} key={i}>
          <div className="r2-date tnum">{r.date}</div>
          <div className="r2-main">
            {(rl||r.rule||r.team||r.champ||r.season)&&<div className="r2-head">
              {rl&&<span className="r2-round">{rl}</span>}
              {r.season&&<span className="r2-season">{r.season}</span>}
              {r.champ&&<span className="r2-champ">챔피언스 시리즈</span>}
              {r.team&&<span className="r2-mode">팀전</span>}
              {r.rule&&<span className="r2-rule">{r.rule}</span>}
            </div>}
            <div className="r2-res">
              <span className="r2-rk gold">우승</span>
              {r.win&&<span className="r2-name win">{r.win}</span>}
              {r.winMembers&&r.winMembers.length>0&&<NameChips list={r.winMembers} kind="mem"/>}
              {(r.ru||(r.ruMembers&&r.ruMembers.length>0))&&<><span className="r2-rk">준우승</span>{r.team?(r.ru&&<span className="r2-name">{r.ru}</span>):<NameChips list={split(r.ru)}/>}
                {r.ruMembers&&r.ruMembers.length>0&&<NameChips list={r.ruMembers} kind="mem"/>}</>}
              {(r.sf||[]).length>0&&<><span className="r2-rk">4강</span>{r.team
                ?r.sf.map((nm,k)=>(<React.Fragment key={k}>{nm&&<span className="r2-name">{nm}</span>}{(r.sfMembers||[])[k]&&(r.sfMembers[k].length>0)&&<NameChips list={r.sfMembers[k]} kind="mem"/>}</React.Fragment>))
                :<NameChips list={r.sf}/>}</>}
            </div>
          </div>
        </div>);
      })}
    </div>
  </>);
}
