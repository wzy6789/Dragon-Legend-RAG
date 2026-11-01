"use client";

import { useId, useRef } from "react";
import type { ChatMessage, InspectorTab } from "@/lib/types";
import { comparisonRunStatus, evaluationLabel, systemLabel, displayValue, formatMs, withoutCredentials } from "@/lib/workbench";
import ScoreVisual from "./ScoreVisual";
import RunJourney from "./RunJourney";

const TABS = [{ id: "overview", label: "概览" }, { id: "score", label: "评分" }, { id: "evidence", label: "证据" }, { id: "timeline", label: "过程" }] as const;
function Field({ label, value }: { label: string; value: unknown }) {
  return <div className="inspector-field"><dt>{label}</dt><dd>{displayValue(value)}</dd></div>;
}

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
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  evaluationId: string;
  onEvaluationChange: (id: string) => void;
}

export default function ExperimentInspector(p: Props) {
  const { tab, onTabChange: setTab } = p;
  const { evaluationId, onEvaluationChange: setEvaluationId } = p;
  const instanceId = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const message = p.message;
  const e = message?.experiment;
  const evaluations = e?.evaluations ?? [];
  const evaluation = evaluations.find(item => item.id === evaluationId) ?? evaluations.at(-1);
  const free = e?.benchmark_id === "free" || message?.research?.benchmarkId === "free";
  const metrics = e?.metrics;
  return <>
    <div className="inspector-heading"><h2>实验详情</h2></div>
    <div className="inspector-run-select"><label htmlFor={instanceId + "-run"}>查看回答</label><select id={instanceId + "-run"} value={p.selectedId ?? ""} onChange={event => p.onSelect(event.target.value)} disabled={!p.messages.length}>
      {!p.messages.length && <option value="">尚无运行记录</option>}
      {p.messages.map((item, index) => <option key={item.id} value={item.id}>#{index + 1} · {systemLabel(item)} · {comparisonRunStatus(item)}</option>)}
    </select></div>
    <div className="inspector-tabs" role="tablist" aria-label="实验信息">{TABS.map((item, index) => <button key={item.id} type="button" role="tab" ref={node => { tabButtons.current[index] = node; }} id={instanceId + "-" + item.id} aria-controls={instanceId + "-content"} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
      const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      setTab(TABS[next].id);
      tabButtons.current[next]?.focus();
    }}>{item.label}</button>)}</div>
    <div className="inspector-body" id={instanceId + "-content"} role="tabpanel" aria-labelledby={instanceId + "-" + tab} tabIndex={0}>
      {p.error && <p className="inline-error" role="status">{p.error}</p>}
      {!message ? <div className="inspector-empty"><h3>选择一条回答查看详情</h3></div> : <>
        {tab === "overview" && <>
          <section className="inspector-primary" aria-label="关键速度指标"><h3>这次回答有多快</h3><div className="inspector-primary-grid">
            {([['端到端', metrics?.e2e_ms], ['执行（不含排队）', metrics?.execution_ms], ['服务端首段（含排队）', metrics?.ttft_ms], ['检索', metrics?.retrieval_ms]] as const).map(([label, value]) => <div className="inspector-primary-stat" key={label}><span>{label}</span><strong>{formatMs(value)}</strong></div>)}
          </div><p className="inspector-primary-note">首段时间包含排队和初始化；未记录的耗时不作估算。</p></section>
          {message.error && <p className="inline-error">{message.error}</p>}
          {message.warning && <p className="muted">{message.warning}</p>}
          <div className="inspector-section"><h3>运行信息</h3><dl>
            <Field label="状态" value={message.status} /><Field label="系统版本" value={e?.system_id ?? message.research?.systemId ?? message.version} /><Field label="生成模型" value={e?.generation_model} />
            <Field label="题库" value={free ? "自由问题 · 在线诊断" : e?.benchmark_id ?? message.research?.benchmarkId} /><Field label="题目 ID" value={e?.question_id ?? message.research?.questionId} />
          </dl></div>
          <div className="inspector-section"><h3>评分概况</h3><ScoreVisual evaluation={evaluation} compact /></div>
          <RunJourney message={message} compact />
          <details className="research-details inspector-provenance"><summary>完整计时与浏览器交付观测</summary>
            <div className="metrics-grid">{([['排队', metrics?.queue_ms], ['草稿首字（含排队）', metrics?.draft_ttft_ms], ['版本初始化', metrics?.initialization_ms], ['客户端准备', metrics?.client_prepare_ms], ['内核首字', metrics?.engine_first_token_ms], ['模型首字等待', metrics?.model_first_token_ms]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatMs(value)}</strong></div>)}</div>
            <p className="muted small">内核首字从开始检索计时，模型首字等待从发起生成计时。浏览器观测从提交或重新连接开始，不替代后端计时。</p>
            <dl><Field label="交付模式" value={metrics?.delivery_mode} /><Field label="浏览器观测起点" value={message.browserDelivery ? message.browserDelivery.observedFrom === "submission" ? "本次提交" : "重新连接" : undefined} /><Field label="浏览器首段内容" value={formatMs(message.browserDelivery?.firstContentMs)} /><Field label="浏览器完成可见" value={formatMs(message.browserDelivery?.completedMs)} /></dl>
          </details>
          <details className="research-details inspector-provenance"><summary>运行标识与冻结上下文</summary><dl>
            <Field label="运行 ID" value={message.runId} /><Field label="评测协议" value={e?.protocol_id ?? message.research?.protocolId} /><Field label="答案哈希" value={e?.answer_hash} />
            <Field label="上下文哈希" value={e?.context_hash ?? (!Array.isArray(e?.context_snapshot) ? e?.context_snapshot?.messages_hash : undefined)} /><Field label="父运行 ID" value={message.research?.comparisonParentRunId} />
          </dl><h4>上下文快照</h4><pre>{displayValue(withoutCredentials(e?.context_snapshot))}</pre></details>
          <details className="research-details inspector-provenance"><summary>系统配置快照</summary><pre>{displayValue(withoutCredentials(e?.system_snapshot))}</pre></details>
        </>}
        {tab === "score" && <>
          <span className="eyebrow">{free ? "在线诊断" : "协议评测"}</span>
          {evaluations.length > 0 && <label className="stack-label">评测记录<select value={evaluation?.id ?? ""} onChange={event => setEvaluationId(event.target.value)}>{evaluations.map((item, index) => <option key={item.id} value={item.id}>第 {index + 1} 次 · {evaluationLabel(item)}</option>)}</select></label>}
          <ScoreVisual evaluation={evaluation} />
          <p className="muted">评分来自独立评审模型。自由问题的在线诊断不计入基准成绩。</p>
          {evaluation?.error && <p className="inline-error">{evaluation.error}</p>}
          <button type="button" className="primary-button full-width" disabled={p.admin && (p.evaluating || message.status !== "done" || !message.runId)} onClick={p.admin ? p.onEvaluate : p.onLogin}>{!p.admin ? "管理员登录后评测" : p.evaluating ? "正在提交评测…" : "发起独立评测 / 重评"}</button>
          <p className="muted small">仅管理员可主动发起付费评测，每次重评保留独立记录。</p>
          <div className="inspector-section"><h3>评分理由</h3><pre className="wrap-text">{displayValue(evaluation?.reasons)}</pre></div>
          <dl><Field label="评审模型" value={evaluation?.judge_model} /><Field label="协议" value={evaluation?.protocol_id} /><Field label="题型" value={evaluation?.type} /><Field label="创建时间" value={evaluation?.created_at} /><Field label="完成时间" value={evaluation?.finished_at} /></dl>
          <details className="research-details inspector-provenance"><summary>冻结评分器身份与指纹</summary><dl><Field label="评分器指纹" value={evaluation?.scorer_fingerprint} /></dl><pre>{displayValue(withoutCredentials(evaluation?.scorer_identity))}</pre></details>
          <details className="research-details inspector-provenance"><summary>原始维度与评分权重</summary><h4>维度</h4><pre>{displayValue(withoutCredentials(evaluation?.dimensions))}</pre><h4>权重</h4><pre>{displayValue(withoutCredentials(evaluation?.weights))}</pre></details>
          <details className="research-details inspector-provenance"><summary>评测原始记录</summary><pre>{displayValue(withoutCredentials(evaluation?.raw))}</pre></details>
        </>}
        {tab === "evidence" && <div className="inspector-section"><h3>原文证据 <span className="count-label">{message.sources?.length ?? 0}</span></h3><p className="muted">检索命中供核对，不代表已经证明回答充分。</p>{message.sources?.length ? message.sources.map((source, index) => <article className="source-card" key={index + "-" + source.chapter}>
          <span className="eyebrow">证据 {String(index + 1).padStart(2, "0")}</span><h4>{source.chapter || source.title || "未记录章节"}</h4>{source.title && source.chapter !== source.title && <p className="muted">{source.title}</p>}<p>{source.snippet || "未记录"}</p>
        </article>) : <p className="muted">证据未记录</p>}</div>}
        {tab === "timeline" && <RunJourney message={message} />}
      </>}
    </div>
  </>;
}
