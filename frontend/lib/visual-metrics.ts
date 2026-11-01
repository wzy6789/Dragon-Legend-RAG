import type { ChatMessage, Evaluation } from "./types";

export type ScoreState = "recorded" | "missing" | "invalid" | "unknown-scale" | "out-of-range";
export interface ScoreMetric {
  key: string;
  label: string;
  value: number | null;
  scale: number | null;
  percent: number | null;
  state: ScoreState;
  weightPercent?: number | null;
}

const DIMENSIONS = [
  ["rel", "检索相关度"], ["fact", "事实准确"], ["reas", "推理严密"],
  ["comp", "覆盖完整"], ["lang", "表达自然"], ["tone", "语气适配"], ["cite", "引用规范"],
] as const;

// Exact contracts: local_bridge/experiment_service.py PROTOCOLS and _judge;
// src/evaluate_7d49.py score/TYPE_WEIGHTS; src/scoring_weights.py weighted_score.
// Total and dimension scales are independent. FlashBench has no verified scoring contract.
const PROTOCOL_SCALES: Record<string, { total: number; dimension: number; weightUnit: number }> = {
  ONLINE_DIAGNOSTIC_7D_V1: { total: 10, dimension: 10, weightUnit: 1 },
  SCORING_STANDARD_7D49_R2: { total: 100, dimension: 10, weightUnit: 100 },
  "SCORING_STANDARD_8.86_老50题": { total: 10, dimension: 10, weightUnit: 1 },
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function metric(key: string, label: string, value: unknown, scale: number | null): ScoreMetric {
  if (value === undefined || value === null || value === "") return { key, label, value: null, scale, percent: null, state: "missing" };
  if (!finite(value)) return { key, label, value: null, scale, percent: null, state: "invalid" };
  const state = value < 0 || (scale !== null && value > scale) ? "out-of-range" : scale === null ? "unknown-scale" : "recorded";
  return { key, label, value, scale, percent: state === "recorded" ? value / scale! * 100 : null, state };
}

/** Safe chart values for either comparison side. Never recomputes or rescales a scorer's result. */
export function buildScoreVisual(evaluation?: Evaluation): { total: ScoreMetric; dimensions: ScoreMetric[]; notes: string[] } {
  const finalized = ["done", "completed", "complete", "success", "succeeded"].includes(evaluation?.status ?? "");
  const protocolId = evaluation?.protocol_id ?? "";
  const protocol = Object.hasOwn(PROTOCOL_SCALES, protocolId) ? PROTOCOL_SCALES[protocolId] : undefined;
  const recordedScale = evaluation?.score_scale;
  const hasScale = recordedScale !== undefined && recordedScale !== null;
  const validScale = finite(recordedScale) && recordedScale > 0;
  const conflict = Boolean(protocol && hasScale && recordedScale !== protocol.total);
  const totalScale = hasScale ? validScale && !conflict ? recordedScale : null : protocol?.total ?? null;
  const total = metric("total", "总分", finalized ? evaluation?.score : undefined, totalScale);
  const entries = finalized && evaluation?.dimensions && typeof evaluation.dimensions === "object" && !Array.isArray(evaluation.dimensions) ? evaluation.dimensions : {};
  const names: Record<string, string> = Object.fromEntries(DIMENSIONS);
  const keys = protocol ? [...DIMENSIONS.map(([key]) => key), ...Object.keys(entries).filter(key => !Object.hasOwn(names, key))] : Object.keys(entries);
  const dimensions = keys.map(key => {
    const knownDimension = Boolean(protocol && Object.hasOwn(names, key));
    const label = key === "comp" && protocolId === "ONLINE_DIAGNOSTIC_7D_V1" ? "估计完整度" : Object.hasOwn(names, key) ? names[key] : key;
    const row = metric(key, label, entries[key], knownDimension ? protocol!.dimension : null);
    const weight = evaluation?.weights?.[key];
    row.weightPercent = knownDimension && finite(weight) && weight >= 0 && weight <= protocol!.weightUnit ? weight / protocol!.weightUnit * 100 : null;
    return row;
  });
  const notes: string[] = [];
  if (evaluation && !finalized) notes.push("评测尚未成功完成，暂不展示有效分数。");
  if (conflict) notes.push("总分量纲与协议冲突，暂不绘制总分比例。");
  else if (hasScale && !validScale) notes.push("总分量纲无效，暂不绘制总分比例。");
  if (totalScale === null && !hasScale && evaluation) notes.push("总分量纲未记录，仅展示原始分值。");
  if (dimensions.some(row => row.scale === null)) notes.push("部分维度量纲未知，仅展示原始分值。");
  if ([total, ...dimensions].some(row => row.state === "missing")) notes.push("未记录不等于零分。");
  if ([total, ...dimensions].some(row => row.state === "invalid" || row.state === "out-of-range")) notes.push("存在无效或超出量纲的分值，未绘制比例。");
  if (protocolId === "ONLINE_DIAGNOSTIC_7D_V1") notes.push("在线诊断；完整度为估计值，不计入基准成绩。");
  if (protocolId === "SCORING_STANDARD_7D49_R2") notes.push("总分满分100，七维各10分；总分保留协议封顶结果。");
  return { total, dimensions, notes };
}

export function formatScoreValue(row: ScoreMetric): string {
  return row.state === "missing" ? "未记录" : row.value === null ? "格式异常" : String(row.value);
}

export interface JourneyEvent {
  event: string;
  stage?: string;
  atMs: number | null;
  label: string;
}
export interface JourneyGroup {
  phase: string;
  label: string;
  noisy: boolean;
  events: JourneyEvent[];
}

const STAGES: Record<string, [string, string]> = {
  "拆解问题": ["planning", "整理问题要求"],
  "规划要点并整理证据": ["planning", "规划要点与证据"],
  "证据义务编译": ["planning", "整理证据要求"],
  "槽位规划": ["planning", "规划证据槽位"],
  "编译证据反射检索": ["retrieval", "检索原文"],
  "极速检索": ["retrieval", "检索原文"],
  "检索资料": ["retrieval", "检索原文"],
  "检索章节": ["retrieval", "检索原文"],
  "检索原文": ["retrieval", "检索原文"],
  "分析问题并检索原文证据": ["retrieval", "分析问题与检索原文"],
  "拆解问题并检索原著证据": ["retrieval", "分析问题与检索原文"],
  "核验证据": ["evidence", "核验证据"],
  "图谱证据回链": ["evidence", "关联图谱证据"],
  "生成待核验初稿": ["generation", "生成待核验初稿"],
  "依据原文生成回答": ["generation", "依据原文生成回答"],
  "组织回答": ["generation", "组织回答"],
  "核验证据并修订答案": ["revision", "核验证据与修订答案"],
};

const EVENTS: Record<string, [string, string, string?]> = {
  queued: ["queued", "等待执行", "进入队列"],
  started: ["execution", "开始执行"],
  retrieval_start: ["retrieval", "检索原文", "检索开始"],
  retrieval_end: ["retrieval", "检索原文", "检索结束"],
  sources: ["evidence", "返回检索证据"],
  first_token: ["output", "文字交付记录", "首次答案片段"],
  first_draft_token: ["output", "文字交付记录", "首次草稿片段"],
  token: ["output", "文字交付记录", "答案片段"],
  draft_token: ["output", "文字交付记录", "草稿片段"],
  draft_reset: ["output", "文字交付记录", "草稿重置"],
  final: ["delivery", "最终答案交付"],
  done: ["completed", "运行完成"],
  error: ["error", "运行失败"],
  cancelled: ["cancelled", "运行已停止"],
  interrupted: ["interrupted", "运行中断"],
};

/** Only public event metadata is projected. Never copy tokens, drafts or reasoning payloads. */
export function groupTimeline(message: ChatMessage): JourneyGroup[] {
  const groups: JourneyGroup[] = [];
  for (const item of message.experiment?.timeline ?? []) {
    const stage = typeof item.stage === "string" && item.stage ? item.stage : undefined;
    const definition = item.event === "stage" && stage && Object.hasOwn(STAGES, stage)
      ? STAGES[stage] : Object.hasOwn(EVENTS, item.event) ? EVENTS[item.event] : ["event", "阶段记录"];
    const [phase, label, eventLabel] = definition;
    const event: JourneyEvent = {
      event: item.event, ...(stage ? { stage } : {}),
      atMs: finite(item.at_ms) && item.at_ms >= 0 ? item.at_ms : null,
      label: eventLabel ?? label,
    };
    const noisy = phase === "output";
    const previous = groups.at(-1);
    // Group adjacent observations only; preserve repeated retrieval/revision cycles and original order.
    if (previous?.phase === phase && previous.label === label && phase !== "event") previous.events.push(event);
    else groups.push({ phase, label, noisy, events: [event] });
  }
  return groups;
}
