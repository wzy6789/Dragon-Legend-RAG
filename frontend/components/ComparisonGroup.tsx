"use client";

import { useLayoutEffect, useRef, useState, type UIEvent } from "react";
import type { ChatMessage } from "@/lib/types";
import { compareResults, comparisonSides, comparisonRunStatus, formatMs, systemLabel } from "@/lib/workbench";
import ComparisonResults from "./ComparisonResults";
import MessageItem from "./MessageItem";
import ScoreVisual from "./ScoreVisual";
import RunJourney from "./RunJourney";

interface Props {
  messages: ChatMessage[];
  comparisonId: string;
  pendingLabel?: string;
  busy: boolean;
  selectedId?: string;
  onInspect: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ComparisonGroup(p: Props) {
  const [sync, setSync] = useState(false);
  const [view, setView] = useState<"answers" | "scores" | "journey">("answers");
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const syncTargets = useRef(new Map<number, number>());
  const result = compareResults(p.messages,p.comparisonId);
  const sides = comparisonSides(result.entries);
  const follow = useRef([true,true]);
  const lengths = useRef(sides.map(entry=>entry?.message.content.length ?? 0));
  useLayoutEffect(()=>{
    sides.forEach((entry,index)=>{
      const size=entry?.message.content.length ?? 0,pane=panes.current[index];
      if(size!==lengths.current[index] && follow.current[index] && pane) pane.scrollTop=pane.scrollHeight;
      lengths.current[index]=size;
    });
  });
  const active = result.entries.some(({message})=>["queued","running","streaming","reviewing"].includes(message.status ?? ""));
  const onScroll = (index: number, event: UIEvent<HTMLDivElement>) => {
    const pane=event.currentTarget;
    follow.current[index]=pane.scrollHeight-pane.clientHeight-pane.scrollTop<40;
    const expected=syncTargets.current.get(index);
    if (expected !== undefined) {
      syncTargets.current.delete(index);
      if (Math.abs(pane.scrollTop-expected)<2) return;
    }
    if (!sync) return;
    const other=panes.current[1-index];
    if (!other || pane.scrollHeight<=pane.clientHeight) return;
    const top=pane.scrollTop/(pane.scrollHeight-pane.clientHeight)*Math.max(0,other.scrollHeight-other.clientHeight);
    if (Math.abs(other.scrollTop-top)<1) return;
    syncTargets.current.set(1-index,top);
    other.scrollTop=top;
  };
  return <section className="comparison-group side-by-side" data-comparison-id={p.comparisonId} data-view={view} aria-label="A/B 答案对比">
    <div className="comparison-toolbar">
      <div><h2>同题对比</h2><p>{active || p.pendingLabel ? "先运行 A，再运行 B" : "两份回答，一组可追溯的实验"}</p></div>
      <div className="comparison-reading-controls">
        <label className="comparison-sync" title="按两份答案各自的阅读进度同步"><input type="checkbox" checked={sync} onChange={e=>{syncTargets.current.clear();setSync(e.target.checked);}} />同步滚动</label>
      </div>
    </div>
    <div className="compare-identity-legend">{sides.map((e,i)=><div key={i} className={`series-${i}`}><span className="series-key">{i?"B":"A"}</span><span>{e?systemLabel(e.message):p.pendingLabel || "等待回答"}</span></div>)}</div>
    <ComparisonResults result={result} />
    <div className="compare-view-tabs" role="group" aria-label="对比内容">{([{id:"answers",label:"完整回答"},{id:"scores",label:"评分维度"},{id:"journey",label:"执行过程"}] as const).map(item=><button key={item.id} aria-pressed={view===item.id} onClick={()=>setView(item.id)}>{item.label}</button>)}</div>
    {view !== "answers" && <div className="comparison-columns" role="region" aria-label="左右评分与过程对照" tabIndex={0}><div className="comparison-grid comparison-analytics">{sides.map((e,i)=><section className={`compare-analysis-panel series-${i}`} key={i}><h3><span className="series-key">{i?"B":"A"}</span>{e?systemLabel(e.message):"等待回答"}</h3>{e ? view === "scores" ? <ScoreVisual evaluation={e.evaluation} /> : <RunJourney message={e.message} /> : <p className="muted">本组尚无对应记录</p>}</section>)}</div></div>}
    <div className="comparison-columns" hidden={view !== "answers"} role="region" aria-label="左右答案对照" tabIndex={0}>
    <div className="comparison-grid">
      {sides.map((entry,index)=>{
        const letter=index===0?"A":"B";
        if (!entry) return <div className="comparison-waiting" key={letter}><span className="comparison-letter">{letter}</span><h3>{index===1 && p.pendingLabel ? p.pendingLabel : `系统 ${letter}`}</h3><p>{index===1 && p.pendingLabel ? "等待 A 结束后开始" : "本组尚无对应回答记录"}</p></div>;
        const message=entry.message;
        return <div key={message.id} data-message-id={message.id} className={`answer-card comparison-answer series-${index}${p.selectedId===message.id?" is-selected":""}`}>
          <header className="comparison-answer-heading"><div><span className="comparison-letter">{letter}</span><h3>{systemLabel(message)}</h3></div><div className="comparison-answer-actions"><span className="status-badge">{comparisonRunStatus(message)}</span><span>服务端首段 {formatMs(message.experiment?.metrics?.ttft_ms)}</span><button type="button" onClick={()=>p.onInspect(message.id)}>查看证据与详情</button></div></header>
          <div className="comparison-answer-scroll" ref={el=>{panes.current[index]=el;}} onScroll={e=>onScroll(index,e)} tabIndex={0} role="region" aria-label={`${letter} 的回答`}>
            <MessageItem message={message} hideHeading onRegenerate={p.busy?undefined:p.onRegenerate} onDelete={p.onDelete} />
          </div>
        </div>;
      })}
    </div>
    </div>
  </section>;
}
