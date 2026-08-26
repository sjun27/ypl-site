import React from "react";

export default function StandTable({ rows, showNote }) {
  const sorted=[...rows].sort((a,b)=>(b.points||0)-(a.points||0));
  return (<table className="tbl tnum"><thead><tr>
    <th style={{width:56}}>순위</th><th>트레이너</th><th className="c" style={{width:62}}>우승</th><th className="c" style={{width:66}}>준우승</th><th className="c" style={{width:54}}>4강</th><th className="c" style={{width:72}}>포인트</th>{showNote&&<th style={{width:96}}>비고</th>}
  </tr></thead><tbody>{sorted.map((r,i)=>(<tr key={i}>
    <td><span className={"rankb "+(i<3?"r"+(i+1):"")}>{i+1}</span></td>
    <td style={{fontWeight:700,fontVariantNumeric:"normal"}}>{r.name}</td>
    <td className="c">{r.win||0}</td><td className="c">{r.ru||0}</td><td className="c">{r.top4||0}</td>
    <td className="c pts">{r.points||0}</td>{showNote&&<td style={{color:"var(--muted)",fontSize:12.5}}>{r.note||""}</td>}
  </tr>))}</tbody></table>);
}
