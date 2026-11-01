"use client";

import { memo, useEffect, useState } from "react";
import { Markdown } from "@/lib/markdown";
import type { ChatMessage, InspectorTab } from "@/lib/types";
import { CheckIcon, CopyIcon, TrashIcon } from "./icons";
import { formatMs, evaluationLabel } from "@/lib/workbench";
import RunJourney from "./RunJourney";

function LiveStatus({ message }: { message: ChatMessage }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - message.createdAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [message.createdAt]);
  const text = message.status === "queued"
    ? "排队等待知识库服务"
    : message.status === "reviewing"
      ? message.stage || "正在整理最终答案"
      : message.provisional
        ? "初稿生成中 · 内容仍在核验"
        : message.stage || (message.tier === "flash" ? "正在检索并回答" : "正在分析问题与证据");
  return (
    <div className="flex min-h-7 items-center gap-2 text-[14px] text-ink-muted" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((n) => <span key={n} className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold-500" style={{ animationDelay: `${n * 0.16}s` }} />)}
      </span>
      <span>{text}</span>
      {elapsed >= 2 ? <span className="text-[13px] text-ink-faint">{elapsed}s</span> : null}
    </div>
  );
}

interface Props {
  message: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onInspect?: (messageId: string, tab?: InspectorTab) => void;
  hideHeading?: boolean;
}

function MessageItemImpl({ message, onRegenerate, onDelete, onInspect, hideHeading }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopyError(true); }
  };
  const actions = (
    <div className="mt-3 flex flex-wrap items-center gap-1">
      <button type="button" disabled={!message.content} onClick={() => void copy()} aria-label="复制消息" title={copied ? "已复制" : "复制"} className="message-action disabled:opacity-40">
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        <span className="sr-only">{copied ? "已复制" : "复制"}</span>
      </button>
      {message.role === "assistant" && onRegenerate && message.status !== "streaming" && message.status !== "queued" && message.status !== "running" && message.status !== "reviewing" ? (
        <button type="button" onClick={() => onRegenerate(message.id)} aria-label="重新生成" title="重新生成" className="message-action">
          <span>重新运行</span>
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={() => onDelete(message.id)} aria-label="删除消息" title="删除消息" className="message-action hover:!text-red-300">
          <TrashIcon className="h-3.5 w-3.5" /><span className="sr-only">删除</span>
        </button>
      ) : null}
      {copyError ? <span role="status" className="text-xs text-amber-200">复制失败，请手动选择正文复制</span> : null}
      {message.role === "assistant" && onInspect && <button type="button" className="message-action" onClick={() => onInspect(message.id)}>详情</button>}
    </div>
  );

  if (message.role === "user") {
    return (
      <div className="group"><p className="research-question-text">{message.content}</p>{actions}</div>
    );
  }

  const active = ["queued", "running", "streaming", "reviewing"].includes(message.status ?? "");
  const evaluation = message.experiment?.evaluations?.at(-1);
  return (
    <article className="group animate-fade-in">
      {!hideHeading && <div className="answer-heading"><span>{message.experiment?.system_snapshot?.label || message.experiment?.system_id || message.research?.systemId || message.version || "未记录版本"}</span></div>}
      {!hideHeading && <div className="answer-measurements"><span>服务端首段 <b>{formatMs(message.experiment?.metrics?.ttft_ms)}</b></span><span>完成 <b>{formatMs(message.experiment?.metrics?.e2e_ms)}</b></span><button onClick={()=>onInspect?.(message.id,"score")} disabled={!onInspect}>质量 <b>{evaluationLabel(evaluation)==="已评分" && typeof evaluation?.score === "number" ? `${Number(evaluation.score.toFixed(2))}${evaluation.score_scale ? ` / ${evaluation.score_scale}` : ""}` : evaluationLabel(evaluation)}</b></button></div>}
      {active ? <LiveStatus message={message} /> : null}
      <RunJourney message={message} compact />
      {message.provisional && message.content ? <div className="mb-2 inline-flex rounded-full border border-gold-500/20 bg-gold-500/[0.07] px-2 py-0.5 text-[13px] text-gold-300">待核验草稿</div> : null}
      {message.content ? <div className="relative"><Markdown text={message.content} />{message.status === "streaming" ? <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-gold-400 align-baseline" /> : null}</div> : null}
      {message.status === "stopped" ? <p className="mt-1 text-[14px] text-ink-faint">{message.error || "已停止生成。"}</p> : null}
      {message.status === "interrupted" ? <p className="mt-1 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[14px] leading-5 text-amber-100/80">{message.error || "服务重启导致任务中断，已保留已生成内容。"}</p> : null}
      {message.status === "error" ? <p className="mt-1.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[14px] leading-5 text-red-200/90">{message.error || "生成失败，请重试。"}</p> : null}
      {message.warning ? <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[14px] leading-5 text-amber-100/80">{message.warning}{message.completionStatus && message.completionStatus !== "complete" ? `（${message.completionStatus}）` : ""}</p> : null}
      {actions}
    </article>
  );
}

export default memo(MessageItemImpl, (previous, next) =>
  previous.message === next.message && previous.onRegenerate === next.onRegenerate && previous.onDelete === next.onDelete && previous.onInspect === next.onInspect && previous.hideHeading === next.hideHeading,
);
