import React from "react";
import { Reveal } from "../components/index.js";

const ACC={cyan:"var(--cyan)",mint:"var(--mint)",gold:"var(--gold)"};
const ACC_BG={cyan:"rgba(59,182,236,.13)",mint:"rgba(84,207,177,.13)",gold:"rgba(236,193,92,.13)"};
const TIMELINE = [
  { date:"2023.05", title:"파이컵 탄생", body:"연세대학교 포켓몬스터 동아리 '포켓몬 센터 연세점(포센연)' 내에서 자체적으로 치러진 대회, 파이컵이 처음 개최되었습니다." },
  { date:"2023 – 2025", title:"매월의 도전", body:"파이컵이 매월 정규 대회로 자리 잡으며 수많은 트레이너의 성적과 칭호가 쌓여 갔습니다." },
  { date:"2025.06", title:"YPL 체제 확립", body:"2025년 6월 마스터 리그와 루키 리그로의 양분화라는 대격변을 맞이하며, 비로소 YPL (Yonsei Pokémon League) 체제가 확립되었습니다." },
];
const COMPS = [
  { tag:"매월 정규 대회", name:"파이컵", en:"", accent:"cyan", desc:"매월 펼쳐지는 정규 대회입니다. 이곳에서 획득한 포인트로 챔피언스 시리즈 출전권을 노릴 수 있습니다." },
  { tag:"번개 이벤트", name:"파이컵 라이트", en:"", accent:"mint", desc:"포인트 없이 자유롭게 즐기는 번개 형식의 대회입니다. 자체적인 상품을 걸고 가볍게 진행됩니다." },
  { tag:"최고 권위", name:"챔피언스 시리즈", en:"", accent:"gold", desc:"한 학기 동아리의 챔피언을 결정짓는 최고 권위의 대회입니다." },
];
const LEAGUES2 = [
  { tier:"상위 정규 리그", name:"마스터 리그", en:"Master League", accent:"cyan", logo:"master", desc:"리그 양분화로 신설된 상위 정규 리그입니다. YPL 시즌의 중심입니다." },
  { tier:"입문 정규 리그", name:"루키 리그", en:"Rookie League", accent:"mint", logo:"rookie", desc:"신입과 초보 트레이너를 위한 입문 리그입니다. 우승하면 마스터 리그로 승급하며 '슈퍼루키' 칭호를 얻습니다." },
];

/* ============================== ABOUT ============================== */
export default function AboutPage() {
  return (<section className="sec">
    <Reveal className="sec-head"><div className="kick">About</div><h2>우리들의 이야기</h2>
      <p className="sub">연세대학교 포켓몬스터 동아리인 포켓몬 센터 연세점, 일명 포센연에서 시작된 배틀 리그의 발자취입니다.</p>
    </Reveal>
    <Reveal tag="h3"><span className="kick-line" style={{margin:"46px 0 16px"}}>시즌은 이렇게 흘러갑니다</span></Reveal>
    <div className="flow">
      <Reveal className="flow-step"><span className="flow-n">1</span>
        <div className="flow-t">매월 파이컵</div><div className="flow-d">정규 대회에 출전합니다</div></Reveal>
      <div className="flow-arw" aria-hidden="true">→</div>
      <Reveal className="flow-step" delay={70}><span className="flow-n">2</span>
        <div className="flow-t">포인트 누적</div><div className="flow-d">성적이 랭킹으로 쌓입니다</div></Reveal>
      <div className="flow-arw" aria-hidden="true">→</div>
      <Reveal className="flow-step" delay={140}><span className="flow-n">3</span>
        <div className="flow-t">챔피언스 시리즈</div><div className="flow-d">학기말 최고 권위의 대회</div></Reveal>
      <div className="flow-arw" aria-hidden="true">→</div>
      <Reveal className="flow-step last" delay={210}><span className="flow-n">4</span>
        <div className="flow-t">시즌 챔피언</div><div className="flow-d">그 시즌의 주인공이 됩니다</div></Reveal>
    </div>

    <Reveal tag="h3"><span className="kick-line" style={{margin:"48px 0 18px"}}>YPL이 기록하는 것</span></Reveal>
    <div className="rec-grid">
      <Reveal className="rec-card"><div className="rec-ico" aria-hidden="true">⚔️</div>
        <div className="rec-t">전적</div><div className="rec-d">모든 대회의 경기 결과</div></Reveal>
      <Reveal className="rec-card" delay={80}><div className="rec-ico" aria-hidden="true">👑</div>
        <div className="rec-t">챔피언</div><div className="rec-d">역대 시즌의 주인공</div></Reveal>
      <Reveal className="rec-card" delay={160}><div className="rec-ico" aria-hidden="true">🎖️</div>
        <div className="rec-t">칭호</div><div className="rec-d">트레이너가 획득한 기록</div></Reveal>
    </div>

    <Reveal tag="h3" className="" delay={0}><span className="kick-line" style={{margin:"40px 0 18px"}}>연혁</span></Reveal>
    <div className="timeline">{TIMELINE.map((t,i)=>(
      <Reveal key={i} className="tl-item" delay={i*90}>
        <div className="tl-date">{t.date}</div><div className="tl-title">{t.title}</div><div className="tl-body">{t.body}</div>
      </Reveal>))}</div>

    <Reveal tag="h3"><span className="kick-line" style={{margin:"44px 0 18px"}}>대회</span></Reveal>
    <div className="grid g3">{COMPS.map((c,i)=>(
      <Reveal key={i} className="card hover comp" delay={i*70}>
        <div className="glow" style={{background:ACC[c.accent]}}/>
        <div className="comp-top"><span className="ribbon" style={{background:ACC_BG[c.accent],color:ACC[c.accent]}}>{c.tag}</span></div>
        <h3>{c.name}</h3>{c.en&&<div className="en">{c.en}</div>}<p>{c.desc}</p>
      </Reveal>))}</div>

    <Reveal tag="h3"><span className="kick-line" style={{margin:"48px 0 8px"}}>정규 리그</span></Reveal>
    <Reveal tag="p" className="sub" style={{margin:"0 0 20px"}}>2025년 6월 양분화 이후, YPL은 두 개의 정규 리그 체제로 운영됩니다.</Reveal>
    <div className="grid g2">{LEAGUES2.map((lg,i)=>(
      <Reveal key={i} className={"lg2 "+lg.logo} delay={i*90}>
        <div className="lg2-glow"/>
        <span className="lg2-tier">{lg.tier}</span>
        <h3>{lg.name}</h3>{lg.en&&<div className="en">{lg.en}</div>}<p>{lg.desc}</p>
      </Reveal>))}</div>
  </section>);
}
