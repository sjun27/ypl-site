import React from "react";

export const NAV_ITEMS = [["about","소개"],["news","공지"],["board","게시판"],["records","기록"],["bracket","대진표"],["builder","팀빌더"],["titles","칭호"],["champions","명예의 전당"]];

export function DesktopNavigation({ view, onNavigate }) {
  return <div className="nav-links">{NAV_ITEMS.map(([k,l])=><button key={k} className={"nlink"+(view===k?" on":"")} onClick={()=>onNavigate(k)}>{l}</button>)}</div>;
}

export function MobileNavigation({ view, onNavigate, open }) {
  return <div className={"nav-drawer"+(open?" open":"")} aria-hidden={!open}>{NAV_ITEMS.map(([k,l],di)=><button key={k} className={"nav-ditem"+(view===k?" on":"")} tabIndex={open?0:-1} style={{transitionDelay:(open?di*32:0)+"ms"}} onClick={()=>onNavigate(k)}>{l}</button>)}</div>;
}
