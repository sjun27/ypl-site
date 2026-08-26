import React from "react";

export default function Modal({ title, hint, children, onClose }) {
  return <div className="overlay" onClick={onClose}><div className="modal" onClick={(e)=>e.stopPropagation()}><h3>{title}</h3>{hint&&<p className="hint">{hint}</p>}{children}</div></div>;
}
