import { buildScoreVisual } from "./visual-metrics";
import { systemLabel, type ReportRun } from "./workbench";

export interface ReportPoint {
  key: string;
  conversationId: string;
  messageId: string;
  systemId: string;
  systemLabel: string;
  question: string;
  score: number;
  executionMs: number;
  ttftMs: number | null;
  createdAt: number;
  generationModel: string;
}

export interface ScoreGroup {
  id: string;
  label: string;
  benchmarkId: string;
  protocolId: string;
  judgeModel: string;
  scorerFingerprint: string;
  questionType: string;
  scale: number;
  points: ReportPoint[];
}

function recordedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() !== "未记录";
}

function finiteTiming(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function newestFirst(a: ReportPoint, b: ReportPoint): number {
  const left = Number.isFinite(a.createdAt) ? a.createdAt : -Infinity;
  const right = Number.isFinite(b.createdAt) ? b.createdAt : -Infinity;
  return left === right ? 0 : left > right ? -1 : 1;
}

function groupLabel(group: ScoreGroup, fingerprint = group.scorerFingerprint.slice(0, 8)): string {
  return `${group.benchmarkId} · ${group.questionType} · ${group.judgeModel} · ${group.protocolId} · 指纹 ${fingerprint} · 满分 ${group.scale}`;
}

/** Single-run observations only; each rejected row belongs to its first failing gate. */
export function buildReportAnalysis(rows: ReportRun[]): {
  groups: ScoreGroup[];
  excluded: { incomplete: number; unscored: number; unverified: number; timing: number };
  eligible: number;
} {
  const byIdentity = new Map<string, ScoreGroup>();
  const occurrences = new Map<string, number>();
  const excluded = { incomplete: 0, unscored: 0, unverified: 0, timing: 0 };
  let eligible = 0;

  for (const row of rows) {
    const { message, benchmarkId } = row;
    if (row.status !== "done" || message.status !== "done" ||
      message.completionStatus !== undefined && message.completionStatus !== "complete") {
      excluded.incomplete++;
      continue;
    }

    const experiment = message.experiment;
    // Creation order is authoritative: a failed retry must hide the old score.
    const evaluation = experiment?.evaluations?.at(-1);
    if (!evaluation || !["done", "completed", "complete", "success", "succeeded"].includes(evaluation.status)) {
      excluded.unscored++;
      continue;
    }

    const protocolId = evaluation.protocol_id;
    const judgeModel = evaluation.judge_model;
    const scorerFingerprint = evaluation.scorer_fingerprint;
    const questionType = evaluation.type;
    const total = buildScoreVisual(evaluation).total;
    // Trimming validates presence only; the raw identities below remain exact.
    if (!recordedText(benchmarkId) || !recordedText(protocolId) || protocolId !== experiment?.protocol_id ||
      !recordedText(judgeModel) || !recordedText(scorerFingerprint) || !recordedText(questionType) ||
      total.state !== "recorded" || total.value === null || total.scale === null) {
      excluded.unverified++;
      continue;
    }

    const executionMs = experiment?.metrics?.execution_ms;
    if (!finiteTiming(executionMs)) {
      excluded.timing++;
      continue;
    }

    // JSON tuples avoid delimiter collisions and never truncate scorer identity.
    const id = JSON.stringify([benchmarkId, protocolId, judgeModel, scorerFingerprint, questionType, total.scale]);
    let group = byIdentity.get(id);
    if (!group) {
      group = { id, label: "", benchmarkId, protocolId, judgeModel, scorerFingerprint, questionType, scale: total.scale, points: [] };
      group.label = groupLabel(group);
      byIdentity.set(id, group);
    }

    const sourceKey = JSON.stringify([row.conversationId, message.id]);
    const occurrence = occurrences.get(sourceKey) ?? 0;
    occurrences.set(sourceKey, occurrence + 1);
    const question = message.research?.question;
    const questionId = experiment?.question_id;
    const ttftMs = experiment?.metrics?.ttft_ms;
    const generationModel = experiment?.generation_model;
    group.points.push({
      key: JSON.stringify([row.conversationId, message.id, occurrence]),
      conversationId: row.conversationId, messageId: message.id,
      systemId: row.systemId, systemLabel: systemLabel(message),
      question: recordedText(question) ? question : recordedText(questionId) ? questionId : "题目未记录",
      score: total.value, executionMs, ttftMs: finiteTiming(ttftMs) ? ttftMs : null,
      createdAt: message.createdAt, generationModel: recordedText(generationModel) ? generationModel : "未记录",
    });
    eligible++;
  }

  const groups = [...byIdentity.values()];
  const labelCounts = new Map<string, number>();
  for (const group of groups) {
    // Stable sort retains input order for equal or missing timestamps.
    group.points.sort(newestFirst);
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }
  for (const group of groups) {
    // Expand colliding prefixes so distinct rubrics stay recognizable in selectors.
    if (labelCounts.get(group.label)! > 1) group.label = groupLabel(group, group.scorerFingerprint);
  }
  groups.sort((a, b) => newestFirst(a.points[0], b.points[0]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { groups, excluded, eligible };
}
