import type { ChatMessage, ComparisonTask, Conversation, Evaluation, Experiment, ResearchSystem, Tier } from "./types";

export const DEFAULT_SYSTEMS: Record<Tier, string> = {
  flash: "flash-v19-sem_select", pro: "pro-v25", max: "max-v31",
};

export function restoreExperimentSetup(conversation: Conversation, defaults: Record<Tier, string> = DEFAULT_SYSTEMS) {
  const answers = conversation.messages.filter(m => m.role === "assistant");
  const latest = answers.at(-1);
  const group = latest?.research?.comparisonId;
  const peers = group ? answers.filter(m => m.research?.comparisonId === group) : [];
  const primary = peers.find(m => !m.research?.comparisonParentRunId) ?? latest;
  const secondary = peers.find(m => m.id !== primary?.id);
  const pending = conversation.compareQueue?.find(task => task.comparisonId === group);
  const tier = primary?.tier ?? conversation.tier;
  return {tier, systemId:primary?.research?.systemId ?? primary?.experiment?.system_id ?? defaults[tier], compare:!!secondary || !!pending, compareSystemId:secondary?.research?.systemId ?? secondary?.experiment?.system_id ?? pending?.systemId ?? ""};
}
export const GENERATION_ACTIVE = new Set(["queued", "running", "streaming", "reviewing"]);
const GENERATION_TERMINAL = new Set(["done", "error", "stopped", "interrupted"]);
const EVALUATION_TERMINAL = new Set(["done", "completed", "complete", "success", "succeeded", "failed", "error", "cancelled", "canceled", "skipped", "not_authorized", "unavailable", "blocked", "interrupted", "unverified_gold"]);

export function canRunSystem(system: Pick<ResearchSystem, "status" | "tiers"> | undefined, tier: Tier): boolean {
  return system?.status === "runnable" && system.tiers.includes(tier);
}

export function inspectionTargets(messages: ChatMessage[], selectedId?: string): ChatMessage[] {
  const selected = messages.find(message => message.id === selectedId);
  if (!selected) return [];
  const group = selected.research?.comparisonId;
  return messages.filter(message => message.role === "assistant" && message.runId && (message.id === selected.id || !!group && message.research?.comparisonId === group));
}

export function shouldPollExperiment(status: string | undefined, experiment: Experiment | undefined): boolean {
  if (!GENERATION_TERMINAL.has(status ?? "")) return true;
  const evaluations = experiment?.evaluations;
  // The service registers evaluation synchronously before generation completes;
  // historical snapshots without experiment metadata must remain "未记录".
  return Boolean(evaluations?.some((entry) => !EVALUATION_TERMINAL.has(entry.status)));
}

export function nextComparisonTask(conversation: Conversation): ComparisonTask | undefined {
  const task = conversation.compareQueue?.[0];
  if (!task || conversation.messages.some((message) => GENERATION_ACTIVE.has(message.status ?? ""))) return;
  const previous = conversation.messages.find((message) => message.id === task.afterMessageId);
  return previous && GENERATION_TERMINAL.has(previous.status ?? "") ? { ...task, comparisonParentRunId: previous.runId ?? task.comparisonParentRunId } : undefined;
}

export function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "未记录";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "未记录";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

function finiteTiming(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Nearest rank: ceil(p / 100 * N); missing values never become zero. */
export function percentile(values: unknown[], percent: number): number | undefined {
  const sorted = values.filter(finiteTiming).sort((a, b) => a - b);
  if (!sorted.length || !Number.isFinite(percent) || percent < 0 || percent > 100) return;
  return sorted[Math.max(0, Math.ceil(percent / 100 * sorted.length) - 1)];
}

export interface ReportRun { conversationId: string; message: ChatMessage; systemId: string; version: string; benchmarkId: string; status: string }
export interface ReportFilters { systemId?: string; version?: string; benchmarkId?: string; status?: string; fromDate?: string; toDate?: string }
export function reportRuns(conversations: Conversation[]): ReportRun[] {
  return conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role === "assistant").map((message) => ({
    conversationId: conversation.id, message,
    systemId: message.experiment?.system_id || message.research?.systemId || "未记录",
    version: message.experiment?.system_snapshot?.version || message.version || "未记录",
    benchmarkId: message.experiment?.benchmark_id || message.research?.benchmarkId || "未记录",
    status: message.status || "未记录",
  })));
}

export function filterReportRuns(rows: ReportRun[], filters: ReportFilters): ReportRun[] {
  return rows.filter((row) => {
    for (const key of ["systemId", "version", "benchmarkId", "status"] as const) {
      if (filters[key] && filters[key] !== row[key]) return false;
    }
    if (filters.fromDate || filters.toDate) {
      if (!Number.isFinite(row.message.createdAt)) return false;
      const date = new Date(row.message.createdAt);
      if (!Number.isFinite(date.getTime())) return false;
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (filters.fromDate && day < filters.fromDate || filters.toDate && day > filters.toDate) return false;
    }
    return true;
  });
}

export const REPORT_METRICS = [
  { key: "e2e_ms", label: "端到端" }, { key: "execution_ms", label: "执行（不含排队）" },
  { key: "ttft_ms", label: "首字（含排队）" }, { key: "draft_ttft_ms", label: "草稿首字（含排队）" }, { key: "retrieval_ms", label: "检索" },
] as const;

export function summarizeReport(rows: ReportRun[], excludeQueue: boolean) {
  const successful = rows.filter((row) => row.status === "done");
  const failed = rows.filter((row) => ["error", "stopped", "interrupted"].includes(row.status)).length;
  const active = rows.filter((row) => GENERATION_ACTIVE.has(row.status)).length;
  const metrics = Object.fromEntries(REPORT_METRICS.map(({ key }) => {
    const values = successful.map(({ message }) => {
      const metrics = message.experiment?.metrics;
      const value = metrics?.[key];
      if (!finiteTiming(value)) return undefined;
      if (key !== "e2e_ms" || !excludeQueue) return value;
      return finiteTiming(metrics?.queue_ms) && metrics.queue_ms <= value ? value - metrics.queue_ms : undefined;
    }).filter(finiteTiming);
    return [key, { samples: values.length, excluded: successful.length - values.length, p50: percentile(values, 50), p95: percentile(values, 95) }];
  })) as Record<(typeof REPORT_METRICS)[number]["key"], { samples: number; excluded: number; p50: number | undefined; p95: number | undefined }>;
  return { total: rows.length, succeeded: successful.length, failed, active, unknown: rows.length - successful.length - failed - active, metrics };
}

export interface ComparisonEntry { message: ChatMessage; question: string | null; evaluation?: Evaluation }
export function systemLabel(message: ChatMessage): string {
  return message.experiment?.system_snapshot?.label || message.experiment?.system_id || message.research?.systemId || message.version || "未记录版本";
}

export function comparisonSides(entries: ComparisonEntry[]): [ComparisonEntry | undefined, ComparisonEntry | undefined] {
  // If A was deleted, retain B's original role instead of relabeling it A.
  return entries.length === 1 && entries[0].message.research?.comparisonParentRunId
    ? [undefined, entries[0]] : [entries[0], entries[1]];
}

export function comparisonRunStatus(message: ChatMessage): string {
  if (message.status === "done" && message.completionStatus && message.completionStatus !== "complete") return "部分完成";
  return message.status ? ({ queued: "排队中", running: "运行中", streaming: "回答中", reviewing: "核验中", done: "已完成", error: "失败", stopped: "已停止", interrupted: "已中断" })[message.status] ?? "未记录" : "未记录";
}

/** Observed execution delta only; score comparability remains independent. */
export function compareExecution(entries: ComparisonEntry[]): { delta?: number; reason?: string } {
  if (entries.length !== 2) return { reason: "等待两份完整回答" };
  const [a,b]=entries;
  if (!entries.every(({message:m})=>m.status === "done" && (!m.completionStatus || m.completionStatus === "complete"))) return { reason: "两次回答尚未完整完成" };
  if (!a.question || a.question !== b.question) return { reason: "问题未确认一致" };
  const ea=a.message.experiment, eb=b.message.experiment;
  if (!ea?.context_hash?.trim() || ea.context_hash !== eb?.context_hash) return { reason: "上下文未确认一致" };
  if (!ea?.benchmark_id || ea.benchmark_id !== eb?.benchmark_id || (ea.benchmark_id !== "free" && (!ea.question_id || ea.question_id !== eb?.question_id))) return { reason: "题目口径未确认一致" };
  const left=ea.metrics?.execution_ms, right=eb?.metrics?.execution_ms;
  return finiteTiming(left) && finiteTiming(right) ? { delta: right-left } : { reason: "执行耗时未记录完整" };
}

export function evaluationLabel(evaluation?: Evaluation): string {
  const status=evaluation?.status;
  if (!status || status === "not_authorized") return "未评分";
  if (["pending_generation","queued"].includes(status)) return "等待评分";
  if (["running","scoring","judging"].includes(status)) return "评分中";
  if (["done","completed","complete","success","succeeded"].includes(status)) return "已评分";
  if (["error","failed"].includes(status)) return "评分失败";
  if (["blocked","unavailable","unverified_gold"].includes(status)) return "评测暂不可用";
  if (["interrupted","cancelled","canceled"].includes(status)) return "评分已中断";
  return "评分未完成";
}

export function comparisonFeedback(result: ReturnType<typeof compareResults>) {
  const entries = result.entries;
  const incomplete = entries.some(({message:m})=>["error","stopped","interrupted"].includes(m.status??"") || m.status==="done" && !!m.completionStatus && m.completionStatus!=="complete");
  const active = entries.some(({message})=>GENERATION_ACTIVE.has(message.status??""));
  const labels = entries.map(e=>evaluationLabel(e.evaluation));
  let quality = "暂不可比较";
  if (result.comparable) quality = result.delta===0 ? "本题质量评分相同" : `${result.delta!>0?"B":"A"} 高 ${Number(Math.abs(result.delta!).toFixed(2))} 分`;
  else if (incomplete) quality = "回答未完整完成";
  else if (active) quality = "等待回答完成";
  else if (entries.length<2) quality = "等待另一份回答";
  else if (labels.includes("评分失败")) quality = "评分失败，查看详情";
  else if (labels.includes("评测暂不可用")) quality = "评测暂不可用";
  else if (labels.includes("评分已中断")) quality = "评分已中断";
  else if (labels.includes("评分中")) quality = "正在独立评分";
  else if (labels.includes("等待评分")) quality = "等待评分队列";
  else if (labels.every(s=>s==="未评分")) quality = "尚未评分";
  else if (labels.every(s=>s==="已评分")) quality = "评分条件不一致";
  else if (labels.includes("未评分")) quality = "另一份回答尚未评分";
  return {quality,timing:incomplete?"本次运行未完成":active?"等待完整耗时":entries.length<2?"等待另一份回答":"仅展示原始耗时"};
}

export function compareResults(messages: ChatMessage[], comparisonId: string): { entries: ComparisonEntry[]; comparable: boolean; reasons: string[]; delta?: number } {
  let question: string | null = null;
  const entries: ComparisonEntry[] = [];
  for (const message of messages) {
    if (message.role === "user") question = message.content;
    if (message.role === "assistant" && message.research?.comparisonId === comparisonId) entries.push({ message, question: message.research.question ?? question, evaluation: message.experiment?.evaluations?.at(-1) });
  }
  const reasons: string[] = [];
  if (!comparisonId || entries.length !== 2) return { entries, comparable: false, reasons: ["等待同一比较组的两次回答完整记录。"] };
  const [a, b] = entries;
  const [ea, eb] = entries.map((entry) => entry.message.experiment);
  const [ja, jb] = entries.map((entry) => entry.evaluation);
  if (!a.question || a.question !== b.question) reasons.push("问题原文缺失或不完全相同。");
  if (!ea?.context_hash?.trim() || ea.context_hash !== eb?.context_hash) reasons.push("冻结上下文哈希缺失或不一致。");
  if (!ea?.benchmark_id || ea.benchmark_id !== eb?.benchmark_id) reasons.push("题库缺失或不同；自由诊断与正式评测不可混算。");
  if (ea?.benchmark_id !== "free" && (!ea?.question_id || ea.question_id !== eb?.question_id)) reasons.push("正式题目 ID 缺失或不同。");
  if (!ea?.protocol_id?.trim() || ea.protocol_id !== eb?.protocol_id || ja?.protocol_id !== ea.protocol_id || jb?.protocol_id !== ea.protocol_id) reasons.push("非空评测协议未冻结一致。");
  if (!ja?.scorer_fingerprint?.trim() || !jb?.scorer_fingerprint?.trim()) reasons.push("评分器身份未记录：缺少非空 scorer_fingerprint，无法确认同一冻结评分器。");
  else if (ja.scorer_fingerprint !== jb.scorer_fingerprint) reasons.push("评分器身份不一致：scorer_fingerprint 不同。");
  if (!ja?.judge_model?.trim() || ja.judge_model !== jb?.judge_model) reasons.push("评审模型缺失或不同。");
  if (!ja?.type?.trim() || ja.type !== jb?.type) reasons.push("冻结评分题型未记录或不一致。");
  if (typeof ja?.score_scale === "number" && typeof jb?.score_scale === "number" && ja.score_scale !== jb.score_scale) reasons.push("原始评分量程不同。");
  const scoreA = ja?.score, scoreB = jb?.score;
  if (typeof scoreA !== "number" || !Number.isFinite(scoreA) || typeof scoreB !== "number" || !Number.isFinite(scoreB)) reasons.push("两条有效原始分数尚未齐全。");
  if (![a, b].every((entry) => entry.message.status === "done" && ["done", "completed", "complete", "success", "succeeded"].includes(entry.evaluation?.status ?? ""))) reasons.push("生成或评测尚未成功完成。");
  return { entries, comparable: !reasons.length, reasons, ...(reasons.length ? {} : { delta: (scoreB as number) - (scoreA as number) }) };
}

/** Allowlisted outer objects, recursive credential scrubbing for backend metadata. */
export function withoutCredentials(value: unknown, secrets: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutCredentials(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !/(api[_-]?key|access[_-]?key|admin[_-]?token|password|secret|authorization|credential|headers|^token$)/i.test(key),
    ).map(([key, item]) => [key, withoutCredentials(item, secrets)]));
  }
  if (typeof value === "string") return secrets.filter(Boolean).reduce((text, secret) => text.split(secret).join("[已移除凭据]"), value);
  return value;
}

function reportMessage(message: ChatMessage) {
  return {
    id: message.id, role: message.role, content: message.content, created_at: message.createdAt,
    tier: message.tier, version: message.version, status: message.status, run_id: message.runId,
    research: message.research, experiment: message.experiment, browser_delivery: message.browserDelivery,
    sources: message.sources, error: message.error, warning: message.warning,
  };
}

export type ExportFormat = "json" | "md" | "csv";
export function exportBatch(conversation: Conversation, format: ExportFormat, secrets: string[] = []): { content: string; mime: string } {
  const batch = withoutCredentials({
    schema: "research-workbench.batch.v1", id: conversation.id, title: conversation.title,
    created_at: conversation.createdAt, updated_at: conversation.updatedAt,
    messages: conversation.messages.map(reportMessage),
  }, secrets) as { id: string; title: string; messages: ReturnType<typeof reportMessage>[] };
  if (format === "json") return { content: JSON.stringify(batch, null, 2), mime: "application/json" };
  if (format === "md") return {
    mime: "text/markdown", content: [
      `# ${batch.title}`, "", `会话批次：${batch.id}`, "", "自由问题仅用于在线诊断；浏览器交付时间与后端计时分开记录。", "",
      ...batch.messages.flatMap((message) => [
        `## ${message.role === "user" ? "问题" : "回答"}${message.experiment?.system_id ? ` · ${message.experiment.system_id}` : ""}`,
        "", message.content || "未记录", "", "```json", JSON.stringify({ ...message, content: undefined }, null, 2), "```", "",
      ]),
    ].join("\n"),
  };
  const columns = ["batch_id", "question", "run_id", "system_id", "benchmark_id", "question_id", "protocol_id", "generation_model", "answer_hash", "status", "answer", "score", "judge_model", "queue_ms", "execution_ms", "ttft_ms", "draft_ttft_ms", "e2e_ms", "retrieval_ms", "delivery_mode", "browser_first_content_ms", "browser_completed_ms", "browser_observed_from", "experiment_json", "sources_json"];
  let question = "";
  const rows = batch.messages.flatMap((message) => {
    if (message.role === "user") { question = message.content; return []; }
    const e = message.experiment;
    const evaluation = e?.evaluations?.at(-1);
    return [[batch.id, question, message.run_id, e?.system_id ?? message.research?.systemId, e?.benchmark_id ?? message.research?.benchmarkId, e?.question_id ?? message.research?.questionId,
      e?.protocol_id ?? message.research?.protocolId, e?.generation_model, e?.answer_hash, message.status, message.content, evaluation?.score, evaluation?.judge_model,
      e?.metrics?.queue_ms, e?.metrics?.execution_ms, e?.metrics?.ttft_ms, e?.metrics?.draft_ttft_ms, e?.metrics?.e2e_ms, e?.metrics?.retrieval_ms, e?.metrics?.delivery_mode,
      message.browser_delivery?.firstContentMs, message.browser_delivery?.completedMs, message.browser_delivery?.observedFrom, JSON.stringify(e), JSON.stringify(message.sources)]];
  });
  const cell = (value: unknown) => {
    let text = displayValue(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return { mime: "text/csv", content: "\uFEFF" + [columns, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") };
}

export function downloadFile(name: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 140);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
