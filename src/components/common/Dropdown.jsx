import React, { useEffect, useRef, useState } from "react";

export default function Dropdown({ value, onChange, options, placeholder, className }){
  const [open,setOpen]=useState(false); const ref=useRef(null);
  useEffect(()=>{ if(!open)return; const h=(e)=>{ if(ref.current&&!ref.current.contains(e.target))setOpen(false); }; const k=(e)=>{ if(e.key==="Escape")setOpen(false); };
    document.addEventListener("mousedown",h); document.addEventListener("keydown",k); return ()=>{document.removeEventListener("mousedown",h);document.removeEventListener("keydown",k);}; },[open]);
  const sel=options.find(o=>o.value===value);
  return (<div className={"dd"+(open?" open":"")+(className?" "+className:"")} ref={ref}>
    <button type="button" className={"dd-btn"+(sel?"":" ph")} onClick={()=>setOpen(o=>!o)}>
      <span>{sel?sel.label:(placeholder||"선택")}</span>
      <svg className="dd-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
    {open&&<div className="dd-menu">{options.length===0&&<div className="dd-none">항목 없음</div>}
      {options.map(o=>(<button type="button" key={o.value} className={"dd-opt"+(o.value===value?" sel":"")} onClick={()=>{onChange(o.value);setOpen(false);}}>{o.label}{o.value===value&&<span className="dd-tick">✓</span>}</button>))}
    </div>}
  </div>);
}
