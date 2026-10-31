"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { displayValue, formatMs, withoutCredentials } from "@/lib/workbench";

const TABS = [{ id: "overview", label: "概览" }, { id: "score", label: "评分" }, { id: "evidence", label: "证据" }, { id: "timeline", label: "时间线" }] as const;
function Field({ label, value }: { label: string; value: unknown }) { return <div className="inspector-field"><dt>{label}</dt><dd>{displayValue(value)}</dd></div>; }

interface Props {
  messages: ChatMessage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  message?: ChatMessage;
  admin: boolean;
  onLogin: () => void;
  onEvaluate: () => void;
  evaluating: boolean;
  error: string;
}

export default function ExperimentInspector(p: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const [evaluationId, setEvaluationId] = useState("");
  const e = p.message?.experiment;
  const evaluations = e?.evaluations ?? [];
  const evaluation = evaluations.find((item) => item.id === evaluationId) ?? evaluations.at(-1);
  return <>
    <div className="inspector-heading"><h2>实验详情</h2></div>
    <div className="inspector-run-select"><label htmlFor="inspect-run">查看回答</label><select id="inspect-run" value={p.selectedId ?? ""} onChange={(event) => p.onSelect(event.target.value)} disabled={!p.messages.length}>{!p.messages.length && <option value="">尚无运行记录</option>}{p.messages.map((message, index) => <option key={message.id} value={message.id}>#{index + 1} · {message.experiment?.system_id ?? message.research?.systemId ?? message.version ?? "未记录版本"} · {message.status ?? "未记录"}</option>)}</select></div>
    <div className="inspector-tabs" role="tablist" aria-label="实验信息">{TABS.map((item) => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls="inspector-content" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className="inspector-body" id="inspector-content" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {p.error && <p className="inline-error" role="status">{p.error}</p>}
      {!p.message ? <div className="inspector-empty"><h3>选择一条回答查看详情</h3></div> : <>
        {tab === "overview" && <>
          <div className="inspector-section"><h3>运行信息</h3><dl><Field label="运行 ID" value={p.message.runId} /><Field label="状态" value={p.message.status} /><Field label="系统版本" value={e?.system_id ?? p.message.research?.systemId} /><Field label="生成模型" value={e?.generation_model} /><Field label="题库" value={e?.benchmark_id === "free" || p.message.research?.benchmarkId === "free" ? "自由问题 · 在线诊断" : e?.benchmark_id ?? p.message.research?.benchmarkId} /><Field label="题目 ID" value={e?.question_id ?? p.message.research?.questionId} /><Field label="评测协议" value={e?.protocol_id ?? p.message.research?.protocolId} /><Field label="答案哈希" value={e?.answer_hash} /></dl></div>
          <div className="inspector-section"><h3>后端计时</h3><div className="metrics-grid">{([['排队', e?.metrics?.queue_ms], ['执行（不含排队）', e?.metrics?.execution_ms], ['首字（含排队）', e?.metrics?.ttft_ms], ['草稿首字（含排队）', e?.metrics?.draft_ttft_ms], ['端到端', e?.metrics?.e2e_ms], ['检索', e?.metrics?.retrieval_ms]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatMs(value)}</strong></div>)}</div><p className="muted small">首字与草稿首字从提交开始计时，均包含排队；执行耗时不含排队。</p><dl><Field label="交付模式" value={e?.metrics?.delivery_mode} /></dl></div>
          <div className="inspector-section"><h3>浏览器交付观测</h3><p className="muted">从本次提交或重新连接开始观测，不替代后端计时。</p><dl><Field label="观测起点" value={p.message.browserDelivery ? p.message.browserDelivery.observedFrom === "submission" ? "本次提交" : "重新连接" : undefined} /><Field label="首段内容" value={formatMs(p.message.browserDelivery?.firstContentMs)} /><Field label="完成可见" value={formatMs(p.message.browserDelivery?.completedMs)} /></dl></div>
          <div className="inspector-section"><h3>冻结上下文</h3><dl><Field label="上下文哈希" value={e?.context_hash ?? (!Array.isArray(e?.context_snapshot) ? e?.context_snapshot?.messages_hash : undefined)} /><Field label="父运行 ID" value={p.message.research?.comparisonParentRunId} /></dl><details className="research-details"><summary>上下文快照</summary><pre>{displayValue(withoutCredentials(e?.context_snapshot))}</pre></details></div>
          <details className="research-details"><summary>系统配置快照</summary><pre>{displayValue(withoutCredentials(e?.system_snapshot))}</pre></details>
        </>}
        {tab === "score" && <>
          <div className="score-summary"><span className="eyebrow">{e?.benchmark_id === "free" || p.message.research?.benchmarkId === "free" ? "在线诊断" : "协议评测"}</span><strong>{displayValue(evaluation?.score)}</strong><span className="status-badge">{evaluation?.status ?? "未记录"}</span></div>
          <p className="muted">评分来自独立评审模型。自由问题的在线诊断不计入基准成绩。</p>
          {evaluations.length > 0 && <label className="stack-label">评测记录<select value={evaluation?.id ?? ""} onChange={(event) => setEvaluationId(event.target.value)}>{evaluations.map((item, index) => <option key={item.id} value={item.id}>第 {index + 1} 次 · {item.status}</option>)}</select></label>}
          <dl><Field label="评审模型" value={evaluation?.judge_model} /><Field label="协议" value={evaluation?.protocol_id} /><Field label="评分器指纹" value={evaluation?.scorer_fingerprint} /><Field label="创建时间" value={evaluation?.created_at} /><Field label="完成时间" value={evaluation?.finished_at} /></dl>
          <details className="research-details"><summary>冻结评分器身份</summary><pre>{displayValue(withoutCredentials(evaluation?.scorer_identity))}</pre></details>
          {evaluation?.error && <p className="inline-error">{evaluation.error}</p>}
          <div className="inspector-section"><h3>维度与权重</h3><dl>{Object.entries(evaluation?.dimensions ?? {}).map(([key, value]) => <Field key={key} label={key} value={value} />)}</dl>{!Object.keys(evaluation?.dimensions ?? {}).length && <p className="muted">未记录</p>}<details className="research-details"><summary>评分权重</summary><pre>{displayValue(evaluation?.weights)}</pre></details></div>
          <div className="inspector-section"><h3>评分理由</h3><pre className="wrap-text">{displayValue(evaluation?.reasons)}</pre></div>
          <button className="primary-button full-width" disabled={p.admin && (p.evaluating || p.message.status !== "done" || !p.message.runId)} onClick={p.admin ? p.onEvaluate : p.onLogin}>{!p.admin ? "管理员登录后评测" : p.evaluating ? "正在提交评测…" : "发起独立评测 / 重评"}</button><p className="muted small">仅管理员可主动发起付费评测，每次重评保留独立记录。</p>
          <details className="research-details"><summary>评测原始记录</summary><pre>{displayValue(withoutCredentials(evaluation?.raw))}</pre></details>
        </>}
        {tab === "evidence" && <div className="inspector-section"><h3>原文证据 <span className="count-label">{p.message.sources?.length ?? 0}</span></h3><p className="muted">检索命中供核对，不代表已经证明回答充分。</p>{p.message.sources?.length ? p.message.sources.map((source, index) => <article className="source-card" key={`${index}-${source.chapter}`}><span className="eyebrow">SOURCE {String(index + 1).padStart(2, "0")}</span><h4>{source.chapter || source.title || "未记录章节"}</h4>{source.title && source.chapter !== source.title && <p className="muted">{source.title}</p>}<p>{source.snippet || "未记录"}</p></article>) : <p className="muted">未记录</p>}</div>}
        {tab === "timeline" && <div className="inspector-section"><h3>后端事件时间线</h3><p className="muted">时间来自后端 at_ms，单位 ms；不推算事件间耗时。</p>{e?.timeline?.length ? <ol className="run-timeline">{e.timeline.map((item, index) => <li key={`${index}-${item.event}`}><span className="timeline-dot" /><div><strong>{item.event}</strong>{item.stage && <p>{item.stage}</p>}<time>{displayValue(item.at_ms)} ms</time></div></li>)}</ol> : <p className="muted">未记录</p>}</div>}
      </>}
    </div>
  </>;
}
