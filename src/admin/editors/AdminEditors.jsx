import React, { useState } from "react";
import { Dropdown, Modal } from "../../components/index.js";
import { verifyAdminCredentials } from "../adminAuth.js";

const uid = () => Math.random().toString(36).slice(2, 9);

export function LoginModal({ onClose, onSuccess }) {
  const [id,setId]=useState(""),[pw,setPw]=useState(""),[err,setErr]=useState("");
  const submit=()=>verifyAdminCredentials(id,pw)?onSuccess():setErr("아이디 또는 비밀번호가 올바르지 않습니다.");
  return (<Modal title="관리자 로그인" hint="운영진 전용. 관리자 계정으로 로그인합니다." onClose={onClose}>
    <div className="field"><label>아이디</label><input value={id} onChange={e=>setId(e.target.value)} placeholder="yplofficial"/></div>
    <div className="field"><label>비밀번호</label><input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
    {err&&<div style={{color:"var(--loss)",fontSize:13,marginTop:-6}}>{err}</div>}
    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>로그인</button></div>
  </Modal>);
}
export function MetaEditor({ meta, onClose, onSave }) {
  const [m,setM]=useState({...meta}); const f=k=>e=>setM({...m,[k]:e.target.value});
  return (<Modal title="메인 정보 수정" onClose={onClose}>
    <div className="field"><label>리그 풀네임</label><input value={m.fullName} onChange={f("fullName")}/></div>
    <div className="field"><label>태그라인</label><input value={m.tagline} onChange={f("tagline")}/></div>
    <div className="field"><label>현 챔피언 대수</label><input value={m.currentChampionGen} onChange={f("currentChampionGen")} placeholder="5대"/></div>
    <div className="field"><label>현 챔피언</label><input value={m.currentChampion} onChange={f("currentChampion")}/></div>
    <div className="field"><label>홈 소개글</label><textarea value={m.intro} onChange={f("intro")}/></div>
    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={()=>onSave(m)}>저장</button></div>
  </Modal>);
}
function compressImg(file, cb){
  const r=new FileReader();
  r.onload=()=>{ const im=new Image(); im.onload=()=>{
    const max=180; const sc=Math.min(1,max/Math.max(im.width,im.height));
    const w=Math.max(1,Math.round(im.width*sc)), h=Math.max(1,Math.round(im.height*sc));
    const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
    cv.getContext("2d").drawImage(im,0,0,w,h);
    let url; try{ url=cv.toDataURL("image/png"); }catch(e){ url=null; }
    cb(url);
  }; im.onerror=()=>cb(null); im.src=r.result; };
  r.onerror=()=>cb(null); r.readAsDataURL(file);
}
export function ChampionEditor({ item, onClose, onSave, onDelete, normTeam }) {
  const [gen,setGen]=useState(item?.gen||""),[season,setSeason]=useState(item?.season||""),[name,setName]=useState(item?.name||""),[slabel,setSlabel]=useState(item?.slabel||"");
  const [mons,setMons]=useState(()=>{ const t=normTeam(item?.team); const a=[]; for(let i=0;i<6;i++)a.push(t[i]||{name:"",img:""}); return a; });
  const setMon=(i,patch)=>setMons(ms=>ms.map((m,j)=>j===i?{...m,...patch}:m));
  const onFile=(i,file)=>{ if(!file)return; if(file.size>8*1024*1024){alert("이미지가 너무 큽니다(8MB 초과). 더 작은 파일을 사용해주세요.");return;} compressImg(file,(url)=>{ if(!url){alert("이미지를 불러오지 못했습니다.");return;} setMon(i,{img:url}); }); };
  const submit=()=>{ if(!name.trim()){alert("챔피언 이름을 입력해주세요.");return;}
    const team=mons.filter(m=>m.name.trim()||m.img).map(m=>({name:m.name.trim(),img:m.img||""}));
    onSave({id:item?.id||uid(),gen:gen.trim(),season:parseInt(season)||0,slabel:slabel.trim()||undefined,name:name.trim(),team}); };
  return (<Modal title={item?"챔피언 수정":"챔피언 추가"} onClose={onClose}>
    <div className="bk-grow2">
      <div className="field"><label>대수</label><input value={gen} onChange={e=>setGen(e.target.value)} placeholder="예: 6대"/></div>
      <div className="field"><label>시즌 번호</label><input value={season} onChange={e=>setSeason(e.target.value)} placeholder="예: 6"/></div>
    </div>
    <div className="field"><label>챔피언 이름</label><input value={name} onChange={e=>setName(e.target.value)}/></div>
    <div className="field"><label>시즌 라벨 (선택)</label><input value={slabel} onChange={e=>setSlabel(e.target.value)} placeholder="예: YPL SEASON 2"/></div>
    <div className="field"><label>우승 엔트리 — 이미지 + 이름</label>
      <div className="ch-grid">{mons.map((m,i)=>(<div className="ch-slot" key={i}>
        <div className="ch-imgwrap">
          <label className="ch-img">{m.img?<img src={m.img} alt="" loading="lazy" decoding="async"/>:<span className="ch-plus"><i className="ch-plus-ico">＋</i>이미지</span>}
            <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{onFile(i,e.target.files&&e.target.files[0]); e.target.value="";}}/>
          </label>
          {m.img&&<button type="button" className="ch-clear" onClick={()=>setMon(i,{img:""})}>✕</button>}
        </div>
        <input className="ch-name" value={m.name} onChange={e=>setMon(i,{name:e.target.value})} placeholder={`이름 ${i+1}`}/>
      </div>))}</div>
      <div className="bk-hint">각 칸을 눌러 이미지를 올리고 이름을 입력하세요. 이미지는 자동으로 작게 압축돼 저장됩니다. (투명 배경 PNG 권장)</div>
    </div>
    <div className="modal-actions">{onDelete&&<button className="btn btn-danger" onClick={onDelete} style={{marginRight:"auto"}}>삭제</button>}<button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>저장</button></div>
  </Modal>);
}

export function TitleItemEditor({ groupKey, item, onClose, onSave, onDelete }) {
  const partner=groupKey==="partner";
  const [name,setName]=useState(item?.name||""),[desc,setDesc]=useState(item?.desc||""),[raw,setRaw]=useState((item?.holders||[]).join(", "));
  const submit=()=>onSave({id:item?.id||uid(),name:name.trim(),desc:desc.trim()||undefined,holders:raw.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)});
  return (<Modal title={item?"칭호 수정":"칭호 추가"} hint={partner?"이름=트레이너, 아래엔 파트너 포켓몬을 쉼표(,)로 구분해 입력하세요.":"해당자를 쉼표(,)로 구분해 입력하세요. (예: 정두호, 이제빈)"} onClose={onClose}>
    <div className="field"><label>{partner?"트레이너":"칭호 이름"}</label><input value={name} onChange={e=>setName(e.target.value)}/></div>
    {!partner&&<div className="field"><label>설명 (선택)</label><input value={desc} onChange={e=>setDesc(e.target.value)}/></div>}
    <div className="field"><label>{partner?"파트너 포켓몬":"해당자"}</label><textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder="쉼표(,)로 구분"/></div>
    <div className="modal-actions">{onDelete&&<button className="btn btn-danger" onClick={onDelete} style={{marginRight:"auto"}}>삭제</button>}<button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>저장</button></div>
  </Modal>);
}
const Q_TYPES=[
  {value:"short",label:"단답형"},
  {value:"long",label:"장문형"},
  {value:"single",label:"객관식 (한 개 선택)"},
  {value:"multi",label:"체크박스 (여러 개 선택)"},
  {value:"dropdown",label:"드롭다운"},
];
const isChoice=(t)=>t==="single"||t==="multi"||t==="dropdown";
function FormBuilder({ form, setForm }){
  const enabled=!!(form&&form.enabled);
  const fields=(form&&form.fields)||[];
  const patchForm=(p)=>setForm({buttonLabel:"참가 신청하기",fields:[],responses:[],...(form||{}),...p});
  const setFields=(next)=>patchForm({fields:next});
  const addField=()=>setFields([...fields,{id:uid(),type:"short",label:"",required:false,options:[]}]);
  const patch=(id,p)=>setFields(fields.map(f=>f.id===id?{...f,...p}:f));
  const del=(id)=>setFields(fields.filter(f=>f.id!==id));
  const move=(i,d)=>{ const j=i+d; if(j<0||j>=fields.length)return; const a=[...fields]; [a[i],a[j]]=[a[j],a[i]]; setFields(a); };
  const changeType=(f,v)=>patch(f.id,{type:v,options:isChoice(v)?((f.options&&f.options.length)?f.options:["옵션 1"]):[]});
  return (<div className="fb-wrap">
    <label className="bk-check" style={{marginBottom:enabled?15:0}}>
      <input type="checkbox" checked={enabled} onChange={e=>patchForm({enabled:e.target.checked})}/>
      <span>📝 신청서 첨부 <i>(사이트에서 바로 신청받기)</i></span>
    </label>
    {enabled&&<>
      <div className="field"><label>신청 버튼 문구</label><input value={(form&&form.buttonLabel)||""} onChange={e=>patchForm({buttonLabel:e.target.value})} placeholder="참가 신청하기"/></div>
      {fields.some(f=>f.public)&&<div className="field fb-reveal"><label>공개 목록 제목</label><input value={(form&&form.publicTitle)||""} onChange={e=>patchForm({publicTitle:e.target.value})} placeholder="예: 현재까지 밴 리스트"/></div>}
      {fields.map((f,i)=>(<div className="fb-q" key={f.id}>
        <div className="fb-q-top">
          <span className="fb-qn">{i+1}</span>
          <Dropdown value={f.type} onChange={v=>changeType(f,v)} options={Q_TYPES}/>
          <div className="fb-q-move">
            <button type="button" className="fb-ic" onClick={()=>move(i,-1)} disabled={i===0} title="위로">↑</button>
            <button type="button" className="fb-ic" onClick={()=>move(i,1)} disabled={i===fields.length-1} title="아래로">↓</button>
            <button type="button" className="fb-ic del" onClick={()=>del(f.id)} title="질문 삭제">✕</button>
          </div>
        </div>
        <input className="fb-label" value={f.label} onChange={e=>patch(f.id,{label:e.target.value})} placeholder={`질문 ${i+1} (예: 참가자 이름)`}/>
        {isChoice(f.type)&&<div className="fb-opts">
          {(f.options||[]).map((op,oi)=>(<div className="fb-opt" key={oi}>
            <span className="fb-dot">{f.type==="multi"?"☐":f.type==="dropdown"?`${oi+1}.`:"○"}</span>
            <input value={op} onChange={e=>patch(f.id,{options:f.options.map((x,k)=>k===oi?e.target.value:x)})} placeholder={`옵션 ${oi+1}`}/>
            <button type="button" className="fb-ic del" onClick={()=>patch(f.id,{options:f.options.filter((_,k)=>k!==oi)})} disabled={(f.options||[]).length<=1} title="옵션 삭제">✕</button>
          </div>))}
          <button type="button" className="fb-addopt" onClick={()=>patch(f.id,{options:[...(f.options||[]),""]})}>+ 옵션 추가</button>
        </div>}
        <div className="fb-q-foot">
          <label className="fb-req"><input type="checkbox" checked={!!f.required} onChange={e=>patch(f.id,{required:e.target.checked})}/> 필수 응답</label>
          <label className="fb-req"><input type="checkbox" checked={!!f.public} onChange={e=>patch(f.id,{public:e.target.checked})}/> 답변 공개 <span className="fb-note">(모두에게 실시간 표시)</span></label>
        </div>
      </div>))}
      <button type="button" className="fb-addq" onClick={addField}>+ 질문 추가</button>
    </>}
  </div>);
}
export function AnnEditor({ item, onClose, onSave, onDelete }) {
  const [date,setDate]=useState(item?.date||new Date().toISOString().slice(0,10)),[title,setTitle]=useState(item?.title||""),[body,setBody]=useState(item?.body||""),[pinned,setPinned]=useState(item?.pinned||false),[link,setLink]=useState(item?.link||""),[linkLabel,setLinkLabel]=useState(item?.linkLabel||""),[link2,setLink2]=useState(item?.link2||""),[link2Label,setLink2Label]=useState(item?.link2Label||"");
  const [form,setForm]=useState(item?.form||{enabled:false,buttonLabel:"참가 신청하기",fields:[],responses:[]});
  const [linkOpen,setLinkOpen]=useState(!!(item?.link||item?.link2)); // 이미 링크가 있으면 펼친 상태로 시작
  return (<Modal title={item?"공지 수정":"공지 작성"} onClose={onClose}>
    <div className="field"><label>날짜</label><input value={date} onChange={e=>setDate(e.target.value)} placeholder="2024-05-26"/></div>
    <div className="field"><label>제목</label><input value={title} onChange={e=>setTitle(e.target.value)}/></div>
    <div className="field"><label>내용</label><textarea value={body} onChange={e=>setBody(e.target.value)} style={{minHeight:120}}/></div>
    <FormBuilder form={form} setForm={setForm}/>
    <div className={"fold"+(linkOpen?" open":"")}>
      <button type="button" className="fold-head" onClick={()=>setLinkOpen(v=>!v)}>
        <span className="fold-title">🔗 링크 첨부 <span className="fold-note">(구글폼 등 외부 링크, 선택)</span></span>
        {(link||link2)&&!linkOpen&&<span className="fold-badge">{[link,link2].filter(Boolean).length}</span>}
        <span className="fold-chev" aria-hidden="true">▾</span>
      </button>
      {linkOpen&&<div className="fold-body swap">
        <div className="field"><label>링크 1 (선택) — 누르면 새 탭으로 이동</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://forms.gle/..."/></div>
        <div className="field"><label>링크 1 버튼 문구 (선택)</label><input value={linkLabel} onChange={e=>setLinkLabel(e.target.value)} placeholder="참가 신청하기"/></div>
        <div className="field"><label>링크 2 (선택) — 추가 링크</label><input value={link2} onChange={e=>setLink2(e.target.value)} placeholder="https://..."/></div>
        <div className="field" style={{marginBottom:0}}><label>링크 2 버튼 문구 (선택)</label><input value={link2Label} onChange={e=>setLink2Label(e.target.value)} placeholder="랜덤 파트너 추첨"/></div>
      </div>}
    </div>
    <div className="field" style={{display:"flex",alignItems:"center",gap:10}}><input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} style={{width:"auto"}} id="pin"/><label htmlFor="pin" style={{margin:0}}>상단 고정</label></div>
    <div className="modal-actions">{onDelete&&<button className="btn btn-danger" onClick={onDelete} style={{marginRight:"auto"}}>삭제</button>}<button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={()=>onSave({id:item?.id||uid(),date,title:title.trim()||"(제목 없음)",body,pinned,link:link.trim(),linkLabel:linkLabel.trim(),link2:link2.trim(),link2Label:link2Label.trim(),form})}>저장</button></div>
  </Modal>);
}
export function StandingsEditor({ title, rows, onClose, onSave }) {
  const [list,setList]=useState(rows.map(r=>({...r})));
  const upd=(i,k,v)=>setList(list.map((r,j)=>j===i?{...r,[k]:v}:r));
  const del=(i)=>setList(list.filter((_,j)=>j!==i));
  const add=()=>setList([...list,{name:"",win:0,ru:0,top4:0,points:0}]);
  const submit=()=>onSave(list.filter(r=>r.name&&r.name.trim()).map(r=>({name:r.name.trim(),win:+r.win||0,ru:+r.ru||0,top4:+r.top4||0,points:+r.points||0,...(r.note?{note:r.note}:{})})));
  return (<Modal title={`${title} 수정`} hint="이름과 성적을 입력하세요. 표시는 포인트 순으로 자동 정렬됩니다." onClose={onClose}>
    <div className="ed-grid ed-head"><span>트레이너</span><span>우승</span><span>준우승</span><span>4강</span><span>포인트</span><span/></div>
    <div className="ed-scroll">{list.map((r,i)=>(<div className="ed-grid" key={i}>
      <input value={r.name} onChange={e=>upd(i,"name",e.target.value)} placeholder="이름"/>
      <input type="number" value={r.win} onChange={e=>upd(i,"win",e.target.value)}/>
      <input type="number" value={r.ru} onChange={e=>upd(i,"ru",e.target.value)}/>
      <input type="number" value={r.top4} onChange={e=>upd(i,"top4",e.target.value)}/>
      <input type="number" value={r.points} onChange={e=>upd(i,"points",e.target.value)}/>
      <button className="ed-del" onClick={()=>del(i)} title="삭제">✕</button>
    </div>))}</div>
    <button className="btn btn-ghost btn-sm" style={{marginTop:12}} onClick={add}>+ 트레이너 추가</button>
    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>저장</button></div>
  </Modal>);
}
export function RoundsEditor({ title, rounds, onClose, onSave, seasons }) {
  const splitL=(s)=>String(s||"").split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
  const dkey=(d)=>{const m=String(d||"").match(/\d+/g)||[];return (+(m[0]||0))*1e8+(+(m[1]||0))*1e6+(+(m[2]||0))*1e4;};
  const rkey=(rd)=>{const n=parseInt(String(rd||""),10);return isNaN(n)?999999:n;};
  const sortRows=(arr)=>arr.map((r,i)=>({r,i})).sort((a,b)=>(dkey(a.r.date)-dkey(b.r.date))||(rkey(a.r.round)-rkey(b.r.round))||(a.i-b.i)).map(x=>x.r);
  const init=(r)=>({
    id:r.id||uid(), recordMeta:r.recordMeta||null,
    team:!!r.team, champ:!!r.champ, date:r.date||"", round:r.round||"", rule:r.rule||"", season:r.season||"",
    win:r.win||"", ru:r.ru||"",
    winM:(r.winMembers||[]).join(", "), ruM:(r.ruMembers||[]).join(", "),
    sfText:r.team?"":(r.sf||[]).join(", "),
    sfTeams:r.team?(r.sf||[]).map((nm,i)=>({name:nm,mem:((r.sfMembers||[])[i]||[]).join(", ")})):[],
  });
  const [list,setList]=useState(rounds.map(init));
  const [autoSort,setAutoSort]=useState(true);
  const upd=(i,k,v)=>setList(list.map((r,j)=>j===i?{...r,[k]:v}:r));
  const del=(i)=>setList(list.filter((_,j)=>j!==i));
  const add=()=>setList([...list,init({})]);
  const moveUp=(i)=>{if(i<=0)return;setAutoSort(false);setList(arr=>{const a=[...arr];[a[i-1],a[i]]=[a[i],a[i-1]];return a;});};
  const moveDown=(i)=>{setAutoSort(false);setList(arr=>{if(i>=arr.length-1)return arr;const a=[...arr];[a[i],a[i+1]]=[a[i+1],a[i]];return a;});};
  const sortNow=()=>{setAutoSort(true);setList(arr=>sortRows(arr));};
  const sfUpd=(i,k,key,v)=>setList(list.map((r,j)=>j!==i?r:{...r,sfTeams:r.sfTeams.map((t,m)=>m===k?{...t,[key]:v}:t)}));
  const sfAdd=(i)=>setList(list.map((r,j)=>j===i?{...r,sfTeams:[...r.sfTeams,{name:"",mem:""}]}:r));
  const sfDel=(i,k)=>setList(list.map((r,j)=>j===i?{...r,sfTeams:r.sfTeams.filter((_,m)=>m!==k)}:r));
  const submit=()=>{
    let out=list.filter(r=>r.team?(String(r.win).trim()||splitL(r.winM).length>0):String(r.win).trim()).map(r=>{
      const base={id:r.id||uid(),date:String(r.date).trim(),round:String(r.round).trim(),rule:String(r.rule).trim(),win:String(r.win).trim(),ru:String(r.ru).trim(),...(String(r.season).trim()?{season:String(r.season).trim()}:{}),...(r.recordMeta?{recordMeta:r.recordMeta}:{})};
      const champ=r.champ?{champ:true}:{};
      if(r.team){
        const sfT=r.sfTeams.filter(t=>String(t.name).trim()||splitL(t.mem).length>0);
        return {...base,...champ,team:true,winMembers:splitL(r.winM),ruMembers:splitL(r.ruM),sf:sfT.map(t=>t.name.trim()),sfMembers:sfT.map(t=>splitL(t.mem))};
      }
      return {...base,...champ,team:false,sf:splitL(r.sfText)};
    });
    if(autoSort) out=sortRows(out);
    onSave(out);
  };
  return (<Modal title={`${title} 회차 수정`} hint="개인전과 팀전, 일반과 챔피언스 시리즈를 고르고 결과를 입력하세요. 저장 시 날짜순으로 자동 정렬됩니다(▲▼로 직접 순서 변경 가능)." onClose={onClose}>
    <div className="pts-note" style={{marginBottom:14}}>포인트 기준 — 우승 <b>60</b>, 준우승 <b>40</b>, 4강 <b>20</b>점 (팀전 여부와 팀원 수, 대회 사정에 따라 변동될 수 있어, 누적 포인트는 랭킹 편집에서 직접 입력합니다.)</div>
    <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:14}}>
      <button className="btn btn-ghost btn-sm" onClick={add}>+ 회차 추가 (맨 아래)</button>
      <button className="btn btn-ghost btn-sm" onClick={sortNow}>↕ 날짜순 정렬</button>
      <label className="ed-auto"><input type="checkbox" checked={autoSort} onChange={e=>setAutoSort(e.target.checked)}/> 저장 시 자동 날짜정렬</label>
    </div>
    <div className="ed-scroll">{list.map((r,i)=>(<div className="ed-round" key={i}>
      <div className="ed-rtop"><input className="ed-w" value={r.date} onChange={e=>upd(i,"date",e.target.value)} placeholder="날짜 (2025.06)"/><input className="ed-w" value={r.round} onChange={e=>upd(i,"round",e.target.value)} placeholder="회차"/><button className="ed-mv" onClick={()=>moveUp(i)} disabled={i===0} title="위로">▲</button><button className="ed-mv" onClick={()=>moveDown(i)} disabled={i===list.length-1} title="아래로">▼</button><button className="ed-del" onClick={()=>del(i)} title="삭제">✕</button></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <div className="ed-seg"><button type="button" className={!r.team?"on":""} onClick={()=>upd(i,"team",false)}>개인전</button><button type="button" className={r.team?"on":""} onClick={()=>upd(i,"team",true)}>팀전</button></div>
        <div className="ed-seg"><button type="button" className={!r.champ?"on":""} onClick={()=>upd(i,"champ",false)}>일반</button><button type="button" className={r.champ?"on":""} onClick={()=>upd(i,"champ",true)}>챔피언스 시리즈</button></div>
      </div>
      {!r.team?<>
        <div className="ed-r2"><input value={r.win} onChange={e=>upd(i,"win",e.target.value)} placeholder="🏆 우승"/><input value={r.ru} onChange={e=>upd(i,"ru",e.target.value)} placeholder="준우승"/></div>
        <input value={r.sfText} onChange={e=>upd(i,"sfText",e.target.value)} placeholder="4강 (쉼표 구분)"/>
      </>:<>
        <div className="ed-team"><span className="ed-rk gold">🏆 우승 팀</span>
          <input value={r.win} onChange={e=>upd(i,"win",e.target.value)} placeholder="팀 이름 (선택)"/>
          <input value={r.winM} onChange={e=>upd(i,"winM",e.target.value)} placeholder="팀원 (쉼표 구분, 인원 제한 없음)"/></div>
        <div className="ed-team"><span className="ed-rk">준우승 팀</span>
          <input value={r.ru} onChange={e=>upd(i,"ru",e.target.value)} placeholder="팀 이름 (선택)"/>
          <input value={r.ruM} onChange={e=>upd(i,"ruM",e.target.value)} placeholder="팀원 (쉼표 구분)"/></div>
        {r.sfTeams.map((t,k)=>(<div className="ed-team" key={k}><span className="ed-rk">4강 팀 {k+1} <button className="ed-x" onClick={()=>sfDel(i,k)}>✕</button></span>
          <input value={t.name} onChange={e=>sfUpd(i,k,"name",e.target.value)} placeholder="팀 이름 (선택)"/>
          <input value={t.mem} onChange={e=>sfUpd(i,k,"mem",e.target.value)} placeholder="팀원 (쉼표 구분)"/></div>))}
        <button className="btn btn-ghost btn-sm" onClick={()=>sfAdd(i)} style={{alignSelf:"flex-start"}}>+ 4강 팀 추가</button>
      </>}
      <div className="ed-r2"><Dropdown value={r.season||""} onChange={v=>upd(i,"season",v)} options={[{value:"",label:"(시즌 미지정)"},...((seasons||[]).map(n=>({value:n,label:n}))),...((r.season&&!(seasons||[]).includes(r.season))?[{value:r.season,label:r.season+" (기존)"}]:[])]}/><input value={r.rule} onChange={e=>upd(i,"rule",e.target.value)} placeholder="룰 (예: 모노타입 / 6세대 63 팀전)"/></div>
    </div>))}</div>
    <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={submit}>저장</button></div>
  </Modal>);
}
