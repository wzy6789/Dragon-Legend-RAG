import type { ChatMessage, ComparisonTask, Conversation, Evaluation, Tier } from "./types";
import { GENERATION_ACTIVE } from "./workbench";

export type HistoryExperimentState = "idle" | "queued" | "running" | "judging" | "done" | "error" | "partial";

export interface HistoryExperimentSummary {
  label: string;
  title: string;
  status: string;
  state: HistoryExperimentState;
}

type Status = Pick<HistoryExperimentSummary, "status" | "state">;
const TIERS: Record<Tier, string> = { flash: "Flash", pro: "Pro", max: "Max" };
const SCORING_ACTIVE = new Set(["pending_generation", "queued", "running", "scoring", "judging"]);

// The service returns evaluations in creation order. Old attempts must not
// override the latest attempt, including a failed retry after an earlier score.
function latestEvaluation(message: ChatMessage): Evaluation | undefined {
  return message.experiment?.evaluations?.at(-1);
}

function identity(message: ChatMessage): { label: string; title: string } {
  const snapshot = message.experiment?.system_snapshot;
  const version = snapshot?.label || snapshot?.version || message.version ||
    message.experiment?.system_id || message.research?.systemId || "未记录版本";
  const label = message.tier ? `${version} · ${TIERS[message.tier]}` : version;
  const details = [
    label,
    snapshot?.version && `快照版本：${snapshot.version}`,
    message.version && `运行版本：${message.version}`,
    message.experiment?.system_id && `系统：${message.experiment.system_id}`,
    message.research?.systemId && `请求版本：${message.research.systemId}`,
  ].filter(Boolean);
  return { label, title: details.join("；") };
}

function scoringStatus(evaluation?: Evaluation): Status {
  switch (evaluation?.status) {
    case undefined:
    case "": return { status: "已生成 · 未评分", state: "idle" };
    case "pending_generation":
    case "queued": return { status: "等待评分", state: "queued" };
    case "running":
    case "scoring":
    case "judging": return { status: "评分中", state: "judging" };
    case "done":
    case "complete":
    case "completed":
    case "success":
    case "succeeded": return { status: "已评分", state: "done" };
    case "not_authorized": return { status: "未授权评分", state: "idle" };
    case "failed":
    case "error": return { status: "评分失败", state: "error" };
    case "unavailable": return { status: "评分不可用", state: "error" };
    case "blocked": return { status: "评分受阻", state: "error" };
    case "canceled":
    case "cancelled": return { status: "评分已取消", state: "partial" };
    case "interrupted": return { status: "评分已中断", state: "partial" };
    case "unverified_gold": return { status: "标准答案未核验", state: "partial" };
    default: return { status: "评分未完成", state: "partial" };
  }
}

function runStatus(messages: ChatMessage[], pending: boolean, comparison: boolean): Status {
  const active = [...messages].reverse().find(message => GENERATION_ACTIVE.has(message.status ?? ""));
  if (active) {
    if (active.status === "queued") return { status: "排队中", state: "queued" };
    return { status: active.status === "reviewing" ? "核验中" : "生成中", state: "running" };
  }

  if (messages.some(message => message.status === "error")) return { status: "生成失败", state: "error" };
  if (messages.some(message => message.status === "interrupted")) return { status: "已中断", state: "partial" };
  if (messages.some(message => message.status === "stopped")) return { status: "已停止", state: "partial" };
  if (messages.some(message => message.provisional ||
    message.status === "done" && message.completionStatus && message.completionStatus !== "complete")) {
    return { status: "部分完成", state: "partial" };
  }
  if (messages.some(message => message.status !== "done")) return { status: "状态未记录", state: "idle" };
  if (pending) return { status: "等待对比", state: "queued" };
  if (comparison && messages.length !== 2) return { status: "对比未完成", state: "partial" };

  const scores = messages.map(message => scoringStatus(latestEvaluation(message)));
  for (const state of ["judging", "queued", "error", "partial"] as const) {
    const current = scores.find(score => score.state === state);
    if (current) return current;
  }
  if (scores.every(score => score.state === "done")) return { status: "已评分", state: "done" };
  if (scores.some(score => score.state === "done")) return { status: "部分已评分", state: "partial" };
  return scores.find(score => score.status === "未授权评分") ?? { status: "已生成 · 未评分", state: "idle" };
}

/** A focused activity/status summary, never a cross-run numeric score. */
export function summarizeExperimentHistory(conversation: Conversation): HistoryExperimentSummary {
  const answers = conversation.messages.filter(message => message.role === "assistant");
  const newestFirst = [...answers].reverse();
  if (!answers.length) {
    return { label: TIERS[conversation.tier], title: "尚无运行记录", status: "未开始", state: "idle" };
  }

  const pendingTasks = (conversation.compareQueue ?? []).filter(task => {
    if (!task.comparisonId) return false;
    const members = answers.filter(message => message.research?.comparisonId === task.comparisonId);
    return members.length < 2 && members.some(message => message.id === task.afterMessageId);
  });
  const pendingAnchor = newestFirst.find(message => message.status === "done" &&
    pendingTasks.some(task => task.afterMessageId === message.id));
  // Generation anywhere in the conversation takes priority over judging.
  // Otherwise show pending work, then the latest run (or its A/B group), so
  // unrelated historical failures cannot poison the current result.
  const focus = newestFirst.find(message => GENERATION_ACTIVE.has(message.status ?? "")) ?? pendingAnchor ??
    newestFirst.find(message => message.status === "done" && SCORING_ACTIVE.has(latestEvaluation(message)?.status ?? "")) ??
    newestFirst[0];
  const comparisonId = focus.research?.comparisonId;
  const members = comparisonId ? answers.filter(message => message.research?.comparisonId === comparisonId) : [focus];
  const pending = comparisonId ? pendingTasks.find(task => task.comparisonId === comparisonId) : undefined;
  const status = runStatus(members, Boolean(pending), Boolean(comparisonId));
  if (!comparisonId) return { ...identity(focus), ...status };

  // A deleted A must not relabel the surviving B, and a queued B already has
  // a recorded requested identity even before its first assistant message.
  const a = members.find(message => !message.research?.comparisonParentRunId);
  const b = members.find(message => message.id !== a?.id);
  const queuedIdentity = (task: ComparisonTask) => `${task.systemId} · ${TIERS[task.tier]}（待运行）`;
  const title = `A：${a ? identity(a).title : "未记录"}\nB：${b ? identity(b).title : pending ? queuedIdentity(pending) : "未记录"}`;
  return { label: "A/B 对比", title, ...status };
}
