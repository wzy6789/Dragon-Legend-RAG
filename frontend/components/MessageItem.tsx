"use client";

import { Markdown } from "@/lib/markdown";
import type { ChatMessage } from "@/lib/types";
import SourceDrawer from "./SourceDrawer";

function StatusText({ tier }: { tier?: "flash" | "pro" | "max" }) {
  const label = tier === "max"
    ? "正在回链图谱与原文证据…"
    : tier === "pro"
      ? "正在检索与核验证据…"
      : "正在回答…";
  return (
    <div className="flex items-center gap-2 py-1 text-[13px] text-ink-muted">
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 animate-dot-pulse rounded-full bg-gold-500"
            style={{ animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

export default function MessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex animate-fade-in justify-end">
        <div className="max-w-[72%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-panelAlt px-4 py-2.5 text-[14px] leading-6 text-ink">
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const hasContent = message.content.trim().length > 0;

  return (
    <div className="animate-fade-in">
      {streaming && !hasContent ? <StatusText tier={message.tier} /> : null}

      {hasContent ? (
        <div className="relative">
          <Markdown text={message.content} />
          {streaming ? (
            <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-gold-400 align-baseline" />
          ) : null}
        </div>
      ) : null}

      {message.status === "stopped" ? (
        <p className="mt-1 text-[12px] text-ink-faint">已停止生成。</p>
      ) : null}

      {message.status === "error" ? (
        <p className="mt-1 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-[12.5px] leading-5 text-red-200/90">
          {message.error || "生成失败，请重试。"}
        </p>
      ) : null}

      {!streaming && message.sources && message.sources.length > 0 ? (
        <SourceDrawer sources={message.sources} />
      ) : null}
    </div>
  );
}
