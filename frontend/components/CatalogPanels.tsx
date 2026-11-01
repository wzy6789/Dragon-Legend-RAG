"use client";
import { useState } from "react";
import type { Benchmark, BenchmarkQuestion, ResearchSystem } from "@/lib/types";
import { filterQuestions, filterSystems } from "@/lib/catalog-navigation";
import { displayValue, withoutCredentials } from "@/lib/workbench";

export function VersionsPanel({systems,onUse,onRetry,error}:{systems:ResearchSystem[];onUse:(s:ResearchSystem)=>void;onRetry:()=>void;error:string}) {
  const [query,setQuery]=useState("");const [tier,setTier]=useState("all");const [status,setStatus]=useState("all");
  const visible=filterSystems(systems,query,tier,status);
  const reset=()=>{setQuery("");setTier("all");setStatus("all")};
  const runnable=systems.filter(s=>s.status==="runnable").length;
  return <div className="research-page catalog-page"><div className="catalog-heading"><div><span className="lab-index">SYSTEMS</span><h2>版本目录</h2><p>找到具体实现，再开始一次可追溯的实验。</p></div><div className="catalog-inventory"><strong>{runnable}</strong><span>可运行版本</span><small>目录共 {systems.length} 项</small></div></div>
    <div className="catalog-toolbar"><label className="catalog-search"><span className="sr-only">搜索版本</span><input aria-label="搜索版本" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索名称、代号或机制" /></label><label><span className="sr-only">版本档位</span><select aria-label="版本档位" value={tier} onChange={e=>setTier(e.target.value)}><option value="all">全部档位</option><option value="flash">Flash</option><option value="pro">Pro</option><option value="max">Max</option></select></label><label><span className="sr-only">版本状态</span><select aria-label="版本状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="runnable">可运行</option><option value="pending">待接入</option><option value="archive">历史归档</option></select></label><button className="quiet-button" onClick={onRetry}>刷新目录</button></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="catalog-count" role="status"><span>显示 {visible.length} / {systems.length} 个版本</span>{(query||tier!=="all"||status!=="all")&&<button onClick={reset}>清除筛选</button>}</div>
    <div className="catalog-rows">{visible.map(system=><article className="catalog-row" key={system.id}>
      <div className="catalog-row-main"><div className="catalog-version"><span>{system.family}</span><span>{system.version}</span></div><h3>{system.label}</h3><p>{system.notes||"未记录说明"}</p><div className="catalog-tags"><span className={`catalog-state state-${system.status}`}>{({runnable:"可运行",pending:"待接入",archive:"历史归档"})[system.status]}</span>{system.tiers.map(t=><span key={t}>{t.toUpperCase()}</span>)}</div></div>
      <div className="catalog-row-action"><button className={system.status==="runnable"?"primary-button":"quiet-button"} disabled={system.status!=="runnable"||!system.tiers.some(t=>["flash","pro","max"].includes(t))} onClick={()=>onUse(system)}>{system.status==="runnable"?"选择版本":"暂不可运行"}</button></div>
      <details className="research-details catalog-source"><summary>查看身份与配置</summary><dl><dt>系统代号</dt><dd>{system.id}</dd><dt>源码来源</dt><dd>{system.source||"未记录"}</dd><dt>变体</dt><dd>{system.variant||"未记录"}</dd></dl><pre>{displayValue(withoutCredentials({config:system.config,results:system.results}))}</pre></details>
    </article>)}</div>{!visible.length&&<div className="catalog-empty"><h3>{error?"目录暂时不可用":systems.length?"没有匹配的版本":"尚未载入版本目录"}</h3><p>{error?"可以刷新目录后重试。":"尝试其他名称、档位或状态。"}</p>{systems.length>0&&<button className="quiet-button" onClick={reset}>显示全部版本</button>}</div>}
  </div>;
}

export function BenchmarksPanel({benchmarks,onPick,error}:{benchmarks:Benchmark[];onPick:(b:Benchmark,q:BenchmarkQuestion)=>void;error:string}) {
  const [bankId,setBankId]=useState("");const [query,setQuery]=useState("");const [type,setType]=useState("all");const [available,setAvailable]=useState(false);
  const banks=benchmarks.filter(b=>b.id!=="free");const bank=banks.find(b=>b.id===bankId)??banks.find(b=>b.questions.length>0)??banks[0];
  const questions=filterQuestions(bank?.questions??[],query,type,available);
  const types=[...new Set((bank?.questions??[]).map(q=>q.type).filter((v):v is string=>!!v))];
  const reset=()=>{setQuery("");setType("all");setAvailable(false)};
  return <div className="research-page catalog-page"><div className="catalog-heading"><div><span className="lab-index">BENCHMARKS</span><h2>标准题库</h2><p>题面、上下文与评分协议一起载入实验台。</p></div></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="benchmark-tabs catalog-bank-tabs" role="group" aria-label="标准题库">{banks.map(b=><button key={b.id} className={b.id===bank?.id?"active":""} aria-pressed={b.id===bank?.id} onClick={()=>{setBankId(b.id);reset()}}>{b.label}<span>{b.questions.length}</span></button>)}</div>
    <div className="catalog-toolbar"><label className="catalog-search"><span className="sr-only">搜索题库</span><input aria-label="搜索题库" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入题号（如 Q31）或问题关键词" /></label><label><span className="sr-only">题型筛选</span><select aria-label="题型筛选" value={type} onChange={e=>setType(e.target.value)}><option value="all">全部题型</option>{types.map(t=><option key={t} value={t}>{t}</option>)}</select></label><label className="catalog-available"><input type="checkbox" checked={available} onChange={e=>setAvailable(e.target.checked)} />仅可运行</label></div>
    <div className="catalog-count" role="status"><span>显示 {questions.length} / {bank?.questions.length??0} 道题</span>{(query||type!=="all"||available)&&<button onClick={reset}>清除筛选</button>}</div>
    {bank&&<details className="research-details catalog-protocol"><summary>本题库评分协议</summary><code>{bank.protocol_id||"未记录"}</code><p>正式题目按绑定协议评测，自由提问使用在线诊断。</p></details>}
    <div className="catalog-questions">{questions.map(q=><article className="catalog-question" key={q.id}><div className="catalog-question-id"><code>{q.id}</code><span>{q.type||"题型未记录"}</span></div><div className="catalog-question-body"><p>{q.question}</p>{q.context!=null&&<details className="research-details"><summary>规定上下文</summary><pre>{displayValue(q.context)}</pre></details>}{q.runnable===false&&<p className="catalog-blocked">{q.reason||"此题暂不可运行"}</p>}</div><button className="quiet-button" disabled={q.runnable===false} onClick={()=>bank&&onPick(bank,q)}>载入题目</button></article>)}</div>
    {!questions.length&&<div className="catalog-empty"><h3>{banks.length?"没有匹配的题目":"尚未载入标准题库"}</h3><p>可以调整题型、题号或可运行状态。</p>{banks.length>0&&<button className="quiet-button" onClick={reset}>清除筛选</button>}</div>}
  </div>;
}
