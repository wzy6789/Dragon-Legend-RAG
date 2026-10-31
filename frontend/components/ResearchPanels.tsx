"use client";

import { useEffect, useState } from "react";
import { asApiError, getArchive, getArchives } from "@/lib/api";
import { Markdown } from "@/lib/markdown";
import type { ArchiveBatch, ArchiveDocument, Benchmark, BenchmarkQuestion, Conversation, ResearchSystem } from "@/lib/types";
import { displayValue, downloadFile, withoutCredentials, type ExportFormat } from "@/lib/workbench";
import LocalHistoryReports from "./LocalHistoryReports";

export function VersionsPanel({ systems, onUse, onRetry, error }: { systems: ResearchSystem[]; onUse: (system: ResearchSystem) => void; onRetry: () => void; error: string }) {
  const [filter, setFilter] = useState("all");
  const visible = systems.filter((system) => filter === "all" || system.status === filter);
  return <div className="research-page"><div className="page-intro"><span className="eyebrow">SYSTEM REGISTRY</span><h2>每次实验，都有明确的版本。</h2><p>Flash 每代保留 1–2 个代表版，Pro 与 Max 每代各一个；2.x 归属 Pro，3.x 归属 Max。选择版本后可直接提问或对比。</p></div><div className="page-toolbar"><label className="stack-label">版本状态<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部状态</option><option value="runnable">可运行</option><option value="pending">待接入</option><option value="archive">历史归档</option></select></label><button className="quiet-button" onClick={onRetry}>刷新注册表</button></div>{error && <p className="inline-error">{error}</p>}<div className="registry-list">{visible.map((system) => <article className="registry-card" key={system.id}><div className="registry-card-heading"><div><span className="eyebrow">{system.family} / {system.version}</span><h3>{system.label}</h3><code>{system.id}</code></div><span className={`status-badge status-${system.status}`}>{({ runnable: "可运行", pending: "待接入", archive: "历史归档" })[system.status]}</span></div><p>{system.notes || "未记录说明"}</p><div className="registry-meta"><span>变体：{system.variant || "未记录"}</span><span>档位：{system.tiers.join(" / ") || "未记录"}</span></div><details className="research-details"><summary>来源、配置与已有结果</summary><dl><dt>来源</dt><dd>{system.source || "未记录"}</dd></dl><pre>{displayValue(withoutCredentials({ config: system.config, results: system.results }))}</pre></details><button className="quiet-button" disabled={system.status !== "runnable" || !system.tiers.some((tier) => ["flash", "pro", "max"].includes(tier))} onClick={() => onUse(system)}>用于新实验 <span aria-hidden="true">↗</span></button></article>)}</div>{!visible.length && <p className="empty-note">{error ? "注册表暂时不可用。请检查连接后刷新。" : "暂无对应版本，等待注册表加载。"}</p>}</div>;
}

export function BenchmarksPanel({ benchmarks, onPick, error }: { benchmarks: Benchmark[]; onPick: (bank: Benchmark, question: BenchmarkQuestion) => void; error: string }) {
  const [bankId, setBankId] = useState("");
  const [query, setQuery] = useState("");
  const bank = benchmarks.find((item) => item.id === bankId) ?? benchmarks[0];
  const questions = bank?.questions.filter((item) => `${item.id} ${item.question} ${item.type ?? ""}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="research-page"><div className="page-intro"><span className="eyebrow">BENCHMARK LIBRARY</span><h2>在同一题目与协议下比较。</h2><p>选择原始题目后运行，题库、题号与评测协议随运行记录保存。</p></div>{error && <p className="inline-error">{error}</p>}<div className="benchmark-tabs">{benchmarks.map((item) => <button key={item.id} className={bank?.id === item.id ? "active" : ""} onClick={() => setBankId(item.id)}>{item.label}<span>{item.questions.length}</span></button>)}</div><div className="page-toolbar"><label className="research-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、题号或类型" aria-label="搜索题库" /></label><span className="muted">协议：{bank?.protocol_id || "未记录"}</span></div><div className="question-list">{questions.map((question) => <article key={question.id} className="question-card"><div className="question-id"><code>{question.id}</code><span>{question.type || "未记录类型"}</span></div><p>{question.question}</p>{question.context != null && <details className="research-details"><summary>题目上下文</summary><pre>{displayValue(question.context)}</pre></details>}{question.runnable === false && <p className="inline-error">{question.reason || "此题暂不可运行"}</p>}<button className="quiet-button" disabled={question.runnable === false} onClick={() => bank && onPick(bank, question)}>载入工作台 <span aria-hidden="true">↗</span></button></article>)}</div>{!questions.length && <p className="empty-note">{benchmarks.length ? "没有匹配的题目。" : "尚未加载题库。"}</p>}</div>;
}

interface ReportsProps { conversations: Conversation[]; onExport: (conversation: Conversation, format: ExportFormat) => void; onSelect: (id: string) => void; accessKey: string; adminToken: string; onLogin: () => void; onAdminExpired: () => void }
export function ReportsPanel(p: ReportsProps) {
  const [tab, setTab] = useState<"local" | "archive">("local");
  return <div className="research-page"><div className="page-intro"><span className="eyebrow">REPORTS & ARCHIVES</span><h2>从一次会话，到可追溯的报告。</h2><p>以会话为批次导出问题、回答、配置、计时和评测记录，凭据不会进入报告。</p></div><div className="benchmark-tabs"><button className={tab === "local" ? "active" : ""} onClick={() => setTab("local")}>当前会话批次 <span>{p.conversations.length}</span></button><button className={tab === "archive" ? "active" : ""} onClick={() => setTab("archive")}>历史研究归档 <span>私有</span></button></div>{tab === "local" ? <LocalHistoryReports conversations={p.conversations} onExport={p.onExport} onSelect={p.onSelect} /> : p.adminToken ? <PrivateArchives key={p.adminToken} accessKey={p.accessKey} adminToken={p.adminToken} onExpired={p.onAdminExpired} /> : <div className="private-archive-prompt"><span className="eyebrow">ADMIN ACCESS</span><h3>历史归档仅对管理员开放</h3><p>登录后读取本机知识库中的完整评测批次。</p><button className="primary-button" onClick={p.onLogin}>管理员登录</button></div>}</div>;
}

function PrivateArchives({ accessKey, adminToken, onExpired }: { accessKey: string; adminToken: string; onExpired: () => void }) {
  const [batches, setBatches] = useState<ArchiveBatch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [document, setDocument] = useState<ArchiveDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!adminToken) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void getArchives(accessKey, adminToken, controller.signal).then((response) => {
      if (!controller.signal.aborted) setBatches(response.batches);
    }).catch((reason) => { if (!controller.signal.aborted) { setError(asApiError(reason).message); if (asApiError(reason).kind === "auth") onExpired(); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accessKey, adminToken, refresh, onExpired]);
  useEffect(() => {
    setDocument(null);
    if (!selectedId || !adminToken) return;
    const controller = new AbortController();
    setError(""); setLoading(true);
    void getArchive(selectedId, accessKey, adminToken, controller.signal).then((response) => { if (!controller.signal.aborted) setDocument(response); }).catch((reason) => { if (!controller.signal.aborted) { setError(asApiError(reason).message); if (asApiError(reason).kind === "auth") onExpired(); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedId, accessKey, adminToken, onExpired]);
  return <div className="archive-content">{error && <p className="inline-error" role="alert">{error}</p>}{loading && <p className="muted" role="status">正在读取私有归档…</p>}{selectedId ? <><button className="quiet-button" onClick={() => setSelectedId("")}>← 返回批次目录</button>{document && <article className="archive-document"><div className="page-toolbar"><div><h3>{document.label}</h3><p className="muted">{document.version} / {document.bank}</p></div><button className="quiet-button" onClick={() => downloadFile(`${document.label}.md`, String(withoutCredentials(document.markdown, [accessKey, adminToken])), "text/markdown")}>下载完整批次 MD ↓</button></div><Markdown text={document.markdown} /></article>}</> : <><div className="page-toolbar"><p className="muted">每个条目对应一个完整评测批次。</p><button className="quiet-button" onClick={() => setRefresh((value) => value + 1)}>刷新归档</button></div><div className="batch-list">{batches.map((batch) => <button key={batch.id} className="batch-card archive-batch" onClick={() => setSelectedId(batch.id)}><div><span className="eyebrow">{batch.version} / {batch.bank}</span><h3>{batch.label}</h3><p>{batch.question_count} 道题 · {batch.scored_questions} 道有评分</p></div><span aria-hidden="true">↗</span></button>)}</div>{!loading && !batches.length && !error && <p className="empty-note">本机暂无可读取的历史批次。</p>}</>}</div>;
}
