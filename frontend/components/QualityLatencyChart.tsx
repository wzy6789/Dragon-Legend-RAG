"use client";
import { useState } from "react";
import type { ScoreGroup, ReportPoint } from "@/lib/report-analysis";
import { formatMs } from "@/lib/workbench";

const COLORS=["#81aaff","#6cdbb5","#d6a0ef","#e7c17f","#ed9da9","#7bd5e0","#c3cf83","#b1b8e8"];
export default function QualityLatencyChart({groups,onInspect}:{groups:ScoreGroup[];onInspect:(conversationId:string,messageId:string)=>void}) {
  const [groupId,setGroupId]=useState("");
  const [hidden,setHidden]=useState<Record<string,string[]>>({});
  const [selection,setSelection]=useState<{group:string;position:string}|null>(null);
  const group=groups.find(g=>g.id===groupId)??groups[0];
  if(!group)return <div className="analysis-empty"><h3>还没有可绘图的记录</h3><p>完整作答、成功评分，并保存评分身份与执行耗时后即可显示。</p></div>;
  const systems=[...new Set(group.points.map(p=>p.systemId))].sort();
  const allSystems=[...new Set(groups.flatMap(g=>g.points.map(p=>p.systemId)))].sort();
  const color=(id:string)=>COLORS[allSystems.indexOf(id)%COLORS.length];
  const invisible=hidden[group.id]??[];
  const visible=group.points.filter(p=>!invisible.includes(p.systemId));
  // Keep axis limits stable while toggling a series, so the picture cannot imply a change in latency.
  const maxMs=Math.max(1000,Math.ceil(Math.max(...group.points.map(p=>p.executionMs),0)/1000)*1000);
  const buckets=new Map<string,ReportPoint[]>();
  for(const p of visible){const key=JSON.stringify([p.executionMs,p.score]);buckets.set(key,[...(buckets.get(key)??[]),p]);}
  const selected=selection?.group===group.id?buckets.get(selection.position):undefined;
  const toggle=(id:string)=>setHidden(current=>({...current,[group.id]:invisible.includes(id)?invisible.filter(s=>s!==id):[...invisible,id]}));
  return <section className="quality-latency" aria-label="质量与耗时分布">
    <div className="analysis-chart-heading"><div><h3>质量与耗时</h3><p>单次回答的分布，不代表版本排名；点击可回到原始记录。</p></div><label><span className="sr-only">评分口径</span><select aria-label="评分口径" value={group.id} onChange={e=>{setGroupId(e.target.value);setSelection(null)}}>{groups.map(g=><option key={g.id} value={g.id}>{g.label} · {g.points.length} 条</option>)}</select></label></div>
    <div className="analysis-group-info"><span>{group.judgeModel}</span><span>{group.questionType}</span><span>满分 {group.scale}</span><span>{visible.length} / {group.points.length} 条可见</span></div>
    <div className="analysis-legend" role="group" aria-label="显示的版本">{systems.map(id=><button key={id} aria-pressed={!invisible.includes(id)} onClick={()=>toggle(id)}><i style={{background:color(id)}} aria-hidden="true"/>{group.points.find(p=>p.systemId===id)?.systemLabel??id}</button>)}{invisible.length>0&&<button className="analysis-show-all" onClick={()=>setHidden(c=>({...c,[group.id]:[]}))}>显示全部</button>}</div>
    <div className="analysis-chart-scroll"><div className="analysis-plot"><span className="analysis-axis-y">原始评分</span><div className="analysis-field">
      {[0,.25,.5,.75,1].map(f=><div className="analysis-gridline" key={f} style={{top:`${(1-f)*100}%`}}><span>{Number((group.scale*f).toFixed(2))}</span></div>)}
      {[0,.25,.5,.75,1].map(f=><span className="analysis-x-tick" data-fraction={f} key={f} style={{left:`${f*100}%`}}>{formatMs(maxMs*f)}</span>)}
      {[...buckets].map(([position,points])=>{const p=points[0];const multi=points.length>1;const title=multi?`${points.length} 次重叠记录 · ${p.score} 分 · ${formatMs(p.executionMs)}`:`${p.systemLabel} · ${p.score} 分 · ${formatMs(p.executionMs)}`;return <button key={position} className={`analysis-point${multi?" is-cluster":""}${selection?.group===group.id&&selection.position===position?" is-selected":""}`} style={{left:`${p.executionMs/maxMs*100}%`,top:`${(1-p.score/group.scale)*100}%`}} title={title} aria-label={title} onClick={()=>setSelection({group:group.id,position})} onFocus={()=>setSelection({group:group.id,position})}><span style={{background:multi?"#d9e1ee":color(p.systemId)}}>{multi?points.length:""}</span></button>})}
    </div><span className="analysis-axis-x">执行耗时 · 不含排队</span></div></div>
    {!visible.length&&<p className="analysis-empty-series">所有版本已隐藏，可以点击“显示全部”。</p>}
    {selected?<div className="analysis-point-details">{selected.map(p=><div key={p.key}><div><strong>{p.systemLabel}</strong><p>{p.question}</p><span>{p.score} / {group.scale} · 执行 {formatMs(p.executionMs)} · {p.generationModel}</span></div><button className="quiet-button" onClick={()=>onInspect(p.conversationId,p.messageId)}>查看回答</button></div>)}</div>:<p className="analysis-chart-hint">选择一个数据点查看问题、版本和原始回答。同分、同耗时的记录会合并展示。</p>}
    <details className="research-details analysis-method"><summary>图表口径与边界</summary><p>仅展示同题库、协议、题型、裁判、评分器指纹和量尺的记录。题目及生成模型可能不同，这张图描述单次运行，不给版本排名。</p><dl><dt>协议</dt><dd>{group.protocolId}</dd><dt>评分器指纹</dt><dd>{group.scorerFingerprint}</dd></dl></details>
  </section>;
}
