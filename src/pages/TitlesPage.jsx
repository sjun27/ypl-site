import React from "react";
import { Reveal } from "../components/index.js";

/* ============================== TITLES ============================== */
export default function TitlesPage({ data, admin, setModal }) {
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">Titles</div><h2>칭호</h2>
      <p className="sub">특정 조건을 달성한 트레이너에게 주어지는 명예의 칭호 목록입니다.</p>
    </Reveal>
    {data.titleGroups.map((g,gi)=>(<div className="tgroup" key={g.id}>
      <Reveal className="tgroup-head"><span className="ic">{g.icon}</span><h3>{g.name}</h3><span className="cnt tnum">{g.items.length}</span><span className="gdesc">{g.desc}</span>{admin&&<button className="btn btn-gold btn-sm" onClick={()=>setModal({type:"title",groupKey:g.key})}>+ 추가</button>}</Reveal>
      <div className="grid g3">{g.items.map((it,i)=>{const mon=g.key==="partner";const empty=(it.holders||[]).length===0;return (
        <Reveal key={it.id} delay={(i%3)*60} className={"titem"+(empty&&!mon?" empty":"")}>
          <div className="tn">{it.name}</div>{it.desc&&<div className="td">{it.desc}</div>}
          <div className="hold">{(it.holders||[]).length?it.holders.map((h,j)=><span className={"holder"+(mon?" mon-h":"")} key={j}>{h}</span>):<span className="none">미달성</span>}</div>
          {admin&&<div className="edit-row"><button className="btn btn-ghost btn-sm ed-pencil" onClick={()=>setModal({type:"title",groupKey:g.key,item:it})}>수정</button></div>}
        </Reveal>);})}</div>
    </div>))}
  </section>);
}
