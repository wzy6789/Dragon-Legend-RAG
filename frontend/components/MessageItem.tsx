"use client";

import { memo, useEffect, useState } from "react";
import { Markdown } from "@/lib/markdown";
import type { ChatMessage, Tier } from "@/lib/types";
import SourceDrawer from "./SourceDrawer";
import { CheckIcon, CopyIcon, RefreshIcon, TrashIcon } from "./icons";

const TIER_LABEL: Record<Tier, string> = {
  flash: "Flash · v1.9 sem_select",
  pro: "Pro · v2.5 Pro",
  max: "Max · v3.0 MAX",
};

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
    <div className="flex min-h-7 items-center gap-2 text-[12.5px] text-ink-muted" aria-live="polite">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((n) => <span key={n} className="h-1.5 w-1.5 animate-dot-pulse rounded-full bg-gold-500" style={{ animationDelay: `${n * 0.16}s` }} />)}
      </span>
      <span>{text}</span>
      {elapsed >= 2 ? <span className="text-[11px] text-ink-faint">{elapsed}s</span> : null}
    </div>
  );
}

interface Props {
  message: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

function MessageItemImpl({ message, onRegenerate, onDelete }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* Clipboard can be unavailable in insecure browser contexts. */ }
  };
  const actions = (
    <div className="mt-2 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 group-hover:opacity-100 focus-within:opacity-100">
      <button type="button" onClick={() => void copy()} aria-label="复制消息" title={copied ? "已复制" : "复制"} className="message-action">
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      {message.role === "assistant" && onRegenerate && message.status !== "streaming" && message.status !== "queued" && message.status !== "running" && message.status !== "reviewing" ? (
        <button type="button" onClick={() => onRegenerate(message.id)} aria-label="重新生成" title="重新生成" className="message-action">
          <RefreshIcon className="h-3.5 w-3.5" /><span>重新生成</span>
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={() => onDelete(message.id)} aria-label="删除消息" title="删除消息" className="message-action hover:!text-red-300">
          <TrashIcon className="h-3.5 w-3.5" /><span>删除</span>
        </button>
      ) : null}
    </div>
  );

  if (message.role === "user") {
    return (
      <div className="group animate-fade-in">
        <div className="flex justify-end">
          <div className="max-w-[82%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-white/[0.06] bg-[#20242B] px-4 py-3 text-[14px] leading-6 text-ink sm:max-w-[76%]">
            {message.content}
          </div>
        </div>
        <div className="flex justify-end">{actions}</div>
      </div>
    );
  }

  const active = ["queued", "running", "streaming", "reviewing"].includes(message.status ?? "");
  return (
    <article className="group animate-fade-in">
      {message.tier ? <div className="mb-1.5 text-[10.5px] font-medium tracking-wide text-gold-500/80">{message.version || TIER_LABEL[message.tier]}</div> : null}
      {active ? <LiveStatus message={message} /> : null}
      {message.provisional && message.content ? <div className="mb-2 inline-flex rounded-full border border-gold-500/20 bg-gold-500/[0.07] px-2 py-0.5 text-[10.5px] text-gold-300">待核验草稿</div> : null}
      {message.content ? <div className="relative"><Markdown text={message.content} />{message.status === "streaming" ? <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-gold-400 align-baseline" /> : null}</div> : null}
      {message.status === "stopped" ? <p className="mt-1 text-[12px] text-ink-faint">{message.error || "已停止生成。"}</p> : null}
      {message.status === "interrupted" ? <p className="mt-1 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-5 text-amber-100/80">{message.error || "服务重启导致任务中断，已保留已生成内容。"}</p> : null}
      {message.status === "error" ? <p className="mt-1.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[12px] leading-5 text-red-200/90">{message.error || "生成失败，请重试。"}</p> : null}
      {message.warning ? <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[12px] leading-5 text-amber-100/80">{message.warning}{message.completionStatus && message.completionStatus !== "complete" ? `（${message.completionStatus}）` : ""}</p> : null}
      {!active ? actions : null}
      {!active && message.sources?.length ? <SourceDrawer sources={message.sources} /> : null}
    </article>
  );
}

export default memo(MessageItemImpl, (previous, next) =>
  previous.message === next.message && previous.onRegenerate === next.onRegenerate && previous.onDelete === next.onDelete,
);
