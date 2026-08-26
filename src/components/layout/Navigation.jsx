import React, { useEffect, useRef, useState } from "react";
import "./navigation-tools.css";

export const NAV_ITEMS_BEFORE_TOOLS = [["about","소개"],["news","공지"],["board","게시판"],["records","기록"],["bracket","대진표"]];
export const TOOL_ITEMS = [["builder","팀빌더"]];
export const NAV_ITEMS_AFTER_TOOLS = [["titles","칭호"],["champions","명예의 전당"]];
export const NAV_ITEMS = [...NAV_ITEMS_BEFORE_TOOLS, ...TOOL_ITEMS, ...NAV_ITEMS_AFTER_TOOLS];

function useOutsideClose(ref, close) {
  useEffect(() => {
    const onPointerDown = event => {
      if (ref.current && !ref.current.contains(event.target)) close();
    };
    const onKeyDown = event => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, close]);
}

function NavButtons({ items, view, onNavigate }) {
  return items.map(([key, label]) => (
    <button key={key} className={"nlink" + (view === key ? " on" : "")} onClick={() => onNavigate(key)}>{label}</button>
  ));
}

export function DesktopNavigation({ view, onNavigate }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  const toolsActive = TOOL_ITEMS.some(([key]) => view === key);
  useOutsideClose(toolsRef, () => setToolsOpen(false));

  const navigateTool = key => {
    setToolsOpen(false);
    onNavigate(key);
  };

  return (
    <div className="nav-links">
      <NavButtons items={NAV_ITEMS_BEFORE_TOOLS} view={view} onNavigate={onNavigate} />
      <div className={"nav-tools" + (toolsOpen ? " open" : "")} ref={toolsRef}>
        <button
          className={"nlink nav-tools-trigger" + (toolsActive ? " on" : "")}
          onClick={() => setToolsOpen(open => !open)}
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
        >
          <span>YPL Tools</span><span className="nav-tools-chevron" aria-hidden="true">⌄</span>
        </button>
        <div className="nav-tools-menu" role="menu" aria-hidden={!toolsOpen}>
          {TOOL_ITEMS.map(([key, label]) => (
            <button key={key} role="menuitem" className={"nav-tools-item" + (view === key ? " on" : "")} onClick={() => navigateTool(key)}>{label}</button>
          ))}
        </div>
      </div>
      <NavButtons items={NAV_ITEMS_AFTER_TOOLS} view={view} onNavigate={onNavigate} />
    </div>
  );
}

export function MobileNavigation({ view, onNavigate, open }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsActive = TOOL_ITEMS.some(([key]) => view === key);

  useEffect(() => {
    if (!open) setToolsOpen(false);
  }, [open]);

  const navigate = key => {
    setToolsOpen(false);
    onNavigate(key);
  };

  let delayIndex = 0;
  const buttonStyle = () => ({ transitionDelay: (open ? delayIndex++ * 32 : 0) + "ms" });

  return (
    <div className={"nav-drawer" + (open ? " open" : "")} aria-hidden={!open}>
      {NAV_ITEMS_BEFORE_TOOLS.map(([key, label]) => (
        <button key={key} className={"nav-ditem" + (view === key ? " on" : "")} tabIndex={open ? 0 : -1} style={buttonStyle()} onClick={() => onNavigate(key)}>{label}</button>
      ))}
      <button
        className={"nav-ditem nav-tools-mobile-trigger" + (toolsActive ? " on" : "")}
        tabIndex={open ? 0 : -1}
        style={buttonStyle()}
        onClick={() => setToolsOpen(value => !value)}
        aria-expanded={toolsOpen}
      >
        <span>YPL Tools</span><span className="nav-tools-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className={"nav-tools-mobile-menu" + (toolsOpen ? " open" : "")}>
        {TOOL_ITEMS.map(([key, label]) => (
          <button key={key} className={"nav-ditem nav-tools-mobile-item" + (view === key ? " on" : "")} tabIndex={open && toolsOpen ? 0 : -1} onClick={() => navigate(key)}>{label}</button>
        ))}
      </div>
      {NAV_ITEMS_AFTER_TOOLS.map(([key, label]) => (
        <button key={key} className={"nav-ditem" + (view === key ? " on" : "")} tabIndex={open ? 0 : -1} style={buttonStyle()} onClick={() => onNavigate(key)}>{label}</button>
      ))}
    </div>
  );
}
