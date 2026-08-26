import React from "react";
import { DesktopNavigation, MobileNavigation } from "./Navigation.jsx";

const ICON_SOLROCK="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAACEklEQVR42u2ZL3TCMBDGP/YQ2MnKyMoiK5HYykrkJEgkEuQksrJIZGXlKpGRlbNzTKRXXm7JCDwqmvYcacKfX758dzmAF0cURdcoiq7oKN7Qs5i+kiwAlHkMAIgTXAGgqqrJSLiL6Iq0v4RJo5wU1y7FpZKjSzgRJoLHbQAAWO3MmjydFNFQNIS7ATwAl7CR3gPaTuyzGi7uYMuKtnX+E+batLkEUD/lLnFS+qVh5+xDRDap0qislR2sRaEmLBcAgMMn9HEid5wZzwLFauem+f4Sdj2trfZWPw990EGqHVh/6JkwjISmXf8I80xGLkAZi7TVVmFEttGsPKjnIrxo89IiBABki4uR9DKWD2nXPw0T8XMpjKeeR0t0r5/+dFMbSZNrPFon++PDnPhd7Tbj1jgXmobzwpzRvHMJay3Bf2l8bPx3aZ5PPpoH7wCApP5WOyDUGdgFSuOY6Xc+fkOhKtD2PfyrJbiWs1gYfbcNpmXS+h9XKSX+839bBvTPJTiBvJw1mjSv2zZA6Tm9notAcwcidq8P13sNT13JkrZkpgZSqWuagpMnslQ7AK07PNUR8seHiSzdfm2aShtSyUKR+5JqvpREVDaEA60ezouB9CXuuoRrX+HeHY3fknnvbZ6cJ8PSsCtZTszWU6P3o37xrYNUj701J2K36ks6reNV2UjYNVxvwc/+5zE8wlzLXUfvCP8CeyUqiP0zL40AAAAASUVORK5CYII=";
const ICON_LUNATONE="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACYAAAAmCAYAAACoPemuAAABcElEQVR42uWYIXPCQBSENx0EsjiQJyODrIwsEomsLDKSnxDZSmRkZSsjkURGRlJHZRyI44l7zXHXDJ3hXlYmmWPysbdvcxF6KkmSU9f1qqoi3EAPuFON+hIqiqfO51YrnG5B8G6JRb6kbIS4DtURADBLJheCu17kwvMYJ0Ukyv236amX+OoP5Jm+n+Xae77kwvcYJ0Aigpwc99pmcwAANE3j5blwidkI+pL7nXO7sImN/mth8hTpdTkeWPKTntOJ4aViWwMA0vnU8FrdPBrrxOrHeC7L66teCz/5rbuMkSNSb2OlibQtAGCr4wvpXOqspP+e+pVSyrGU6alFXQIAPuNUX2ilN1hbwtvEdyORIo/J7/zkMepRPMd4bvHdub60CJ5jwFR48vvmG58A7x9t56x0Jf5w28Vf24QcYq4vcO4tV77J7WNEinLLJhcp3/4lr8H6zkxO7Ks8yjq78H4L1xc5ibzEZ66YHOt9XjrYM9gzKUu2yuI5WkIAAAAASUVORK5CYII=";

export default function SiteHeader({
  view,
  onNavigate,
  dark,
  onToggleTheme,
  scrolled,
  menuOpen,
  onToggleMenu,
  admin,
  onAdminClick,
}) {
  return (
    <nav className={"nav"+(scrolled?" scrolled":"")}><div className="nav-in">
      <div className="brand" onClick={()=>onNavigate("home")}><div><span className="disp">YPL</span><small>POKÉMON CENTER YONSEI</small></div></div>
      <DesktopNavigation view={view} onNavigate={onNavigate}/>
      <div className="nav-right">
        <button className="nav-theme" onClick={onToggleTheme} aria-label={dark?"밝은 모드로 전환":"어두운 모드로 전환"} title={dark?"밝은 모드":"어두운 모드"}><img className="theme-ico" src={dark?ICON_LUNATONE:ICON_SOLROCK} alt="" width="26" height="26" decoding="async"/></button><button className="nlink admin" onClick={onAdminClick}>{admin?"로그아웃":"관리자"}</button>
        <a className="nav-discord" href="https://discord.gg/T7UZHhGvUh" target="_blank" rel="noopener noreferrer" title="YPL 공식 디스코드 참여"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg><span className="dc-tx">디스코드</span></a>
        <button className={"nav-burger"+(menuOpen?" open":"")} onClick={onToggleMenu} aria-label={menuOpen?"메뉴 닫기":"메뉴 열기"} aria-expanded={menuOpen}><span className="bg-ico" aria-hidden="true"><i/><i/><i/></span></button>
      </div>
      <MobileNavigation view={view} onNavigate={onNavigate} open={menuOpen}/>
    </div></nav>
  );
}
