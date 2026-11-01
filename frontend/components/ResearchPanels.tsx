"use client";

import { useEffect, useState } from "react";
import { asApiError, getArchive, getArchives } from "@/lib/api";
import { Markdown } from "@/lib/markdown";
import type { ArchiveBatch, ArchiveDocument, Conversation } from "@/lib/types";
import { displayValue, downloadFile, withoutCredentials, type ExportFormat } from "@/lib/workbench";
import LocalHistoryReports from "./LocalHistoryReports";

export { VersionsPanel, BenchmarksPanel } from "./CatalogPanels";

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
  return <div className="archive-content">{error && <p className="inline-error" role="alert">{error}</p>}{loading && <p className="muted" role="status">正在读取私有归档…</p>}{selectedId ? <><button className="quiet-button" onClick={() => setSelectedId("")}>返回批次目录</button>{document && <article className="archive-document"><div className="page-toolbar"><div><h3>{document.label}</h3><p className="muted">{document.version} / {document.bank}</p></div><button className="quiet-button" onClick={() => downloadFile(`${document.label}.md`, String(withoutCredentials(document.markdown, [accessKey, adminToken])), "text/markdown")}>下载完整批次 MD</button></div><Markdown text={document.markdown} /></article>}</> : <><div className="page-toolbar"><p className="muted">每个条目对应一个完整评测批次。</p><button className="quiet-button" onClick={() => setRefresh((value) => value + 1)}>刷新归档</button></div><div className="batch-list">{batches.map((batch) => <button key={batch.id} className="batch-card archive-batch" onClick={() => setSelectedId(batch.id)}><div><span className="eyebrow">{batch.version} / {batch.bank}</span><h3>{batch.label}</h3><p>{batch.question_count} 道题 · {batch.scored_questions} 道有评分</p></div></button>)}</div>{!loading && !batches.length && !error && <p className="empty-note">本机暂无可读取的历史批次。</p>}</>}</div>;
}
