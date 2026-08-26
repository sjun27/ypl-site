import React, { useEffect, useRef, useState } from "react";

export default function Reveal({ children, delay=0, className="", tag="div", ...rest }) {
  const ref=useRef(null); const [seen,setSeen]=useState(false);
  useEffect(()=>{const el=ref.current;if(!el)return;
    const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setSeen(true);io.disconnect();}},{threshold:.12,rootMargin:"0px 0px -40px 0px"});
    io.observe(el);return()=>io.disconnect();},[]);
  const Tag=tag;
  return <Tag ref={ref} className={`reveal ${seen?"in":""} ${className}`} style={{transitionDelay:delay+"ms"}} {...rest}>{children}</Tag>;
}
