"use client";

import { useMemo, useState } from "react";
import type { Conversation } from "@/lib/types";
import { filterReportRuns, formatMs, REPORT_METRICS, reportRuns, summarizeReport, type ExportFormat, type ReportFilters } from "@/lib/workbench";

interface Props { conversations: Conversation[]; onExport: (conversation: Conversation, format: ExportFormat) => void; onSelect: (id: string) => void }

export default function LocalHistoryReports(p: Props) {
  const [filters, setFilters] = useState<ReportFilters>({});
  const [excludeQueue, setExcludeQueue] = useState(false);
  const rows = useMemo(() => reportRuns(p.conversations), [p.conversations]);
  const matches = useMemo(() => filterReportRuns(rows, filters), [rows, filters]);
  const summary = useMemo(() => summarizeReport(matches, excludeQueue), [matches, excludeQueue]);
  const countByBatch = new Map<string, number>();
  for (const row of matches) countByBatch.set(row.conversationId, (countByBatch.get(row.conversationId) ?? 0) + 1);
  const hasFilters = Object.values(filters).some(Boolean);
  const batches = p.conversations.filter((conversation) => !hasFilters || countByBatch.has(conversation.id));
  const setFilter = (key: keyof ReportFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const selectors = [{ key: "systemId", label: "系统" }, { key: "version", label: "版本" }, { key: "benchmarkId", label: "题库" }, { key: "status", label: "运行状态" }] as const;
  return <>
    <div className="report-filters" aria-label="本地运行筛选">{selectors.map(({ key, label }) => <label className="stack-label" key={key}>{label}<select value={filters[key] ?? ""} onChange={(event) => setFilter(key, event.target.value)}><option value="">全部{label}</option>{[...new Set(rows.map((row) => row[key]))].sort().map((value) => <option key={value} value={value}>{value === "free" ? "free · 在线诊断" : value}</option>)}</select></label>)}<label className="stack-label">开始日期<input type="date" value={filters.fromDate ?? ""} max={filters.toDate || undefined} onChange={(event) => setFilter("fromDate", event.target.value)} /></label><label className="stack-label">结束日期<input type="date" value={filters.toDate ?? ""} min={filters.fromDate || undefined} onChange={(event) => setFilter("toDate", event.target.value)} /></label><button className="quiet-button" onClick={() => setFilters({})} disabled={!hasFilters}>重置筛选</button></div>
    <section className="report-statistics" aria-label="筛选运行的耗时统计"><div className="comparison-heading"><span>本地运行耗时</span><span>{summary.total} 次运行 · {countByBatch.size} 个批次</span></div><div className="report-counts"><span>成功 <b>{summary.succeeded}</b></span><span>失败 / 停止 / 中断 <b>{summary.failed}</b></span><span>进行中 <b>{summary.active}</b></span><span>状态未记录 <b>{summary.unknown}</b></span></div><label className="report-queue-flag"><input type="checkbox" checked={excludeQueue} onChange={(event) => setExcludeQueue(event.target.checked)} />排除排队（仅端到端 E2E）<span>{excludeQueue ? "已排除：e2e_ms − queue_ms；缺少排队记录的样本不计入" : "未排除：直接使用 e2e_ms，含排队"}</span></label><div className="report-table-scroll"><table className="research-data-table"><thead><tr><th>后端指标</th><th>有效样本</th><th>缺失 / 无效排除</th><th>P50</th><th>P95</th></tr></thead><tbody>{REPORT_METRICS.map(({ key, label }) => { const metric = summary.metrics[key]; return <tr key={key}><td>{label}{key === "e2e_ms" && excludeQueue ? "（扣除排队）" : ""}</td><td>{metric.samples}</td><td>{metric.excluded}</td><td>{formatMs(metric.p50)}</td><td>{formatMs(metric.p95)}</td></tr>; })}</tbody></table></div><p className="muted small">仅统计生成成功且指标为非负有限数值的运行；0 是有效观测。失败和未完成运行另计，不进入分位数。P50 / P95 使用最近秩法；排队开关仅影响端到端指标。日期按运行创建时间与本地自然日筛选，包含起止当天。此处为耗时统计，不汇总评分。</p></section>
    <div className="page-toolbar"><span className="muted">显示 {batches.length} 个会话批次。导出始终包含整批原始记录，筛选仅影响列表与统计。</span></div>
    <div className="batch-list">{batches.map((conversation) => <article className="batch-card" key={conversation.id}><button className="batch-title" onClick={() => p.onSelect(conversation.id)}><h3>{conversation.title}</h3><p>命中 {countByBatch.get(conversation.id) ?? 0} / {conversation.messages.filter((item) => item.role === "assistant").length} 次回答 · {new Date(conversation.updatedAt).toLocaleString("zh-CN")}</p></button><div className="export-actions">{(["json", "md", "csv"] as const).map((format) => <button className="quiet-button" title="导出完整会话批次（包含未匹配记录）" onClick={() => p.onExport(conversation, format)} key={format}>{format.toUpperCase()} ↓</button>)}</div></article>)}{!batches.length && <p className="empty-note">{hasFilters ? "没有符合筛选条件的运行。" : "运行一次实验后，即可按会话批次导出报告。"}</p>}</div>
  </>;
}
