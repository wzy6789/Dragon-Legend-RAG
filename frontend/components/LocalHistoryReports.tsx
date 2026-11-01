"use client";
import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/types";
import { comparisonRunStatus, evaluationLabel, systemLabel, filterReportRuns, formatMs, REPORT_METRICS, reportRuns, summarizeReport, type ExportFormat, type ReportFilters } from "@/lib/workbench";
import { buildReportAnalysis } from "@/lib/report-analysis";
import { buildScoreVisual, formatScoreValue } from "@/lib/visual-metrics";
import QualityLatencyChart from "./QualityLatencyChart";

interface Props { conversations:Conversation[];onExport:(conversation:Conversation,format:ExportFormat)=>void;onSelect:(id:string)=>void;onInspect:(conversationId:string,messageId:string)=>void }
const BANKS:Record<string,string>={free:"自由问题",new49:"新 49 题",legacy50:"老 50 题",flashbench:"FlashBench"};
const STATES:Record<string,string>={done:"生成结束",queued:"排队中",running:"执行中",streaming:"输出中",reviewing:"核验中",error:"失败",stopped:"已停止",interrupted:"已中断"};

export default function LocalHistoryReports(p:Props) {
  const [filters,setFilters]=useState<ReportFilters>({});const [query,setQuery]=useState("");const [excludeQueue,setExcludeQueue]=useState(false);const [tab,setTab]=useState<"runs"|"batches">("runs");
  const rows=useMemo(()=>reportRuns(p.conversations),[p.conversations]);
  const matches=useMemo(()=>filterReportRuns(rows,filters).filter(r=>[r.systemId,r.version,r.message.research?.question,r.message.content,p.conversations.find(c=>c.id===r.conversationId)?.title].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[rows,filters,query,p.conversations]);
  const summary=useMemo(()=>summarizeReport(matches,excludeQueue),[matches,excludeQueue]);
  const analysis=useMemo(()=>buildReportAnalysis(matches),[matches]);
  const countByBatch=new Map<string,number>();for(const row of matches)countByBatch.set(row.conversationId,(countByBatch.get(row.conversationId)??0)+1);
  const hasFilters=Object.values(filters).some(Boolean)||!!query;
  const batches=p.conversations.filter(c=>!hasFilters||countByBatch.has(c.id));
  const setFilter=(key:keyof ReportFilters,value:string)=>setFilters(current=>({...current,[key]:value}));
  const reset=()=>{setFilters({});setQuery("")};
  return <div className="report-analysis">
    <div className="analysis-filterbar"><label className="catalog-search"><span className="sr-only">搜索运行记录</span><input aria-label="搜索运行记录" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索问题、回答或版本" /></label>
      <select aria-label="报告系统筛选" value={filters.systemId??""} onChange={e=>setFilter("systemId",e.target.value)}><option value="">全部系统</option>{[...new Set(rows.map(r=>r.systemId))].map(id=><option key={id} value={id}>{systemLabel(rows.find(r=>r.systemId===id)!.message)}</option>)}</select>
      <select aria-label="报告题库筛选" value={filters.benchmarkId??""} onChange={e=>setFilter("benchmarkId",e.target.value)}><option value="">全部题库</option>{[...new Set(rows.map(r=>r.benchmarkId))].map(id=><option key={id} value={id}>{BANKS[id]??id}</option>)}</select>
      <button className="quiet-button" onClick={reset} disabled={!hasFilters}>重置筛选</button>
    </div>
    <details className="research-details analysis-advanced"><summary>日期、版本和运行状态筛选</summary><div className="analysis-advanced-grid">
      <label className="stack-label">开始日期<input type="date" value={filters.fromDate??""} max={filters.toDate||undefined} onChange={e=>setFilter("fromDate",e.target.value)} /></label><label className="stack-label">结束日期<input type="date" value={filters.toDate??""} min={filters.fromDate||undefined} onChange={e=>setFilter("toDate",e.target.value)} /></label>
      <label className="stack-label">版本<select value={filters.version??""} onChange={e=>setFilter("version",e.target.value)}><option value="">全部版本</option>{[...new Set(rows.map(r=>r.version))].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
      <label className="stack-label">运行状态<select value={filters.status??""} onChange={e=>setFilter("status",e.target.value)}><option value="">全部状态</option>{[...new Set(rows.map(r=>r.status))].map(v=><option key={v} value={v}>{STATES[v]??v}</option>)}</select></label>
    </div></details>
    <div className="analysis-scope" role="status">当前范围：{matches.length} 次运行 · {countByBatch.size} 个会话{hasFilters?" · 已筛选":""}</div>
    <div className="analysis-stats">{[["运行记录",summary.total],["生成结束",summary.succeeded],["进行中",summary.active],["失败 / 停止 / 中断",summary.failed]] .map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    {summary.unknown>0&&<p className="analysis-footnote">另有 {summary.unknown} 条运行状态未记录。</p>}
    <QualityLatencyChart groups={analysis.groups} onInspect={p.onInspect}/>
    {matches.length>0&&<details className="research-details analysis-exclusions"><summary>绘图数据覆盖：{analysis.eligible} / {matches.length} 条符合条件</summary><dl><dt>作答未完整结束</dt><dd>{analysis.excluded.incomplete}</dd><dt>尚无成功评分</dt><dd>{analysis.excluded.unscored}</dd><dt>评分身份或量尺不完整</dt><dd>{analysis.excluded.unverified}</dd><dt>执行耗时缺失或无效</dt><dd>{analysis.excluded.timing}</dd></dl><p>以上依次检查，每条未入图记录只归入一类。原始记录仍可在下方查看。</p></details>}
    <details className="research-details analysis-latency"><summary>耗时统计与 P50 / P95</summary><label className="report-queue-flag"><input type="checkbox" checked={excludeQueue} onChange={e=>setExcludeQueue(e.target.checked)}/>排除排队（仅端到端统计）</label><div className="report-table-scroll"><table className="research-data-table"><thead><tr><th>后端指标</th><th>有效样本</th><th>缺失 / 无效</th><th>P50</th><th>P95</th></tr></thead><tbody>{REPORT_METRICS.map(({key,label})=>{const metric=summary.metrics[key];return <tr key={key}><td>{label}{key==="e2e_ms"&&excludeQueue?"（扣除排队）":""}</td><td>{metric.samples}</td><td>{metric.excluded}</td><td>{formatMs(metric.p50)}</td><td>{formatMs(metric.p95)}</td></tr>})}</tbody></table></div><p>沿用现有统计：仅生成状态为 done 且计时为非负有限数值的记录参与分位数。0 是有效观测，缺失不补零；P50/P95 使用最近秩法。此开关不改变散点图的执行耗时。</p></details>
    <div className="analysis-list-tabs" role="group" aria-label="报告记录视图"><button aria-pressed={tab==="runs"} onClick={()=>setTab("runs")}>逐次运行 <span>{matches.length}</span></button><button aria-pressed={tab==="batches"} onClick={()=>setTab("batches")}>会话与导出 <span>{batches.length}</span></button></div>
    {tab==="runs"?<div className="analysis-run-list">{[...matches].sort((a,b)=>b.message.createdAt-a.message.createdAt).map(row=>{const m=row.message,e=m.experiment?.evaluations?.at(-1),score=buildScoreVisual(e).total;return <article className="analysis-run" key={JSON.stringify([row.conversationId,m.id])}><div className="analysis-run-main"><h4>{m.research?.question??(m.experiment?.question_id?`题目 ${m.experiment.question_id}`:p.conversations.find(c=>c.id===row.conversationId)?.title??"问题未记录")}</h4><p>{systemLabel(m)} · {BANKS[row.benchmarkId]??row.benchmarkId}</p><span>{comparisonRunStatus(m)}</span></div><div className="analysis-run-values"><div><span>原始评分</span><strong>{evaluationLabel(e)==="已评分"?`${formatScoreValue(score)}${score.scale!==null?` / ${score.scale}`:""}`:evaluationLabel(e)}</strong></div><div><span>执行耗时</span><strong>{formatMs(m.experiment?.metrics?.execution_ms)}</strong></div></div><button className="quiet-button" onClick={()=>p.onInspect(row.conversationId,m.id)}>查看回答</button></article>})}{!matches.length&&<div className="analysis-empty"><h3>{rows.length?"没有符合筛选条件的运行":"还没有实验记录"}</h3><p>{rows.length?"可以调整筛选条件。":"运行一次问答后，可在这里分析结果并追溯答案。"}</p></div>}</div>:<><p className="analysis-footnote">筛选只影响列表与统计；导出保留整个会话批次的原始记录。</p><div className="batch-list">{batches.map(c=><article className="batch-card" key={c.id}><button className="batch-title" onClick={()=>p.onSelect(c.id)}><h3>{c.title}</h3><p>命中 {countByBatch.get(c.id)??0} / {c.messages.filter(m=>m.role==="assistant").length} 次回答 · {new Date(c.updatedAt).toLocaleString("zh-CN")}</p></button><div className="export-actions">{(["json","md","csv"] as const).map(format=><button key={format} className="quiet-button" onClick={()=>p.onExport(c,format)}>{format.toUpperCase()}</button>)}</div></article>)}</div></>}
  </div>;
}
