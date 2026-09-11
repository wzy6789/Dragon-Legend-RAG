"use client";

import { memo, useEffect, useState } from "react";
import { Markdown } from "@/lib/markdown";
import type { ChatMessage, Tier } from "@/lib/types";
import SourceDrawer from "./SourceDrawer";
import { CheckIcon, CopyIcon, RefreshIcon } from "./icons";

const TIER_LABEL: Record<Tier, string> = { flash: "Flash", pro: "Pro · v2.1", max: "Max · v2.2" };
function StatusText({ tier, startedAt }: { tier?: Tier; startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [startedAt]);
  const label = tier === "max" ? "正在回链图谱与原文证据…" : tier === "pro" ? "正在检索、核验并组织证据…" : "正在回答…";
  return <div className="flex items-center gap-2 py-0.5 text-[13px] text-ink-muted"><span className="flex items-center gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-dot-pulse rounded-full bg-gold-500" style={{ animationDelay: `${i * 0.16}s` }} />)}</span><span>{label}</span>{elapsed >= 2 ? <span className="text-[11.5px] text-ink-faint">{elapsed}s</span> : null}</div>;
}
interface Props { message: ChatMessage; onRegenerate?: (messageId: string) => void; }
function MessageItemImpl({ message, onRegenerate }: Props) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") return <div className="flex animate-fade-in justify-end"><div className="max-w-[70%] whitespace-pre-wrap rounded-[14px] rounded-br-md bg-[#1C2027] px-3.5 py-2.5 text-[14px] leading-6 text-ink">{message.content}</div></div>;
  const streaming = message.status === "streaming";
  const hasContent = message.content.trim().length > 0;
  const copy = async () => { try { await navigator.clipboard.writeText(message.content); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ } };
  return <div className="group animate-fade-in">{message.tier ? <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-faint">{TIER_LABEL[message.tier]}</div> : null}{streaming && !hasContent ? <StatusText tier={message.tier} startedAt={message.createdAt} /> : null}{hasContent ? <div className="relative"><Markdown text={message.content} />{streaming ? <span className="ml-0.5 inline-block h-[15px] w-[2px] translate-y-[2px] animate-pulse bg-gold-400 align-baseline" /> : null}</div> : null}{message.status === "stopped" ? <p className="mt-1 text-[12px] text-ink-faint">已停止生成。</p> : null}{message.status === "error" ? <p className="mt-1.5 rounded-[10px] border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[12.5px] leading-5 text-red-200/90">{message.error || "生成失败，请重试。"}</p> : null}{!streaming && hasContent ? <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><button type="button" onClick={() => void copy()} aria-label="复制回答" title={copied ? "已复制" : "复制"} className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink-soft">{copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}<span>{copied ? "已复制" : "复制"}</span></button>{onRegenerate ? <button type="button" onClick={() => onRegenerate(message.id)} aria-label="重新生成" title="重新生成" className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink-soft"><RefreshIcon className="h-3.5 w-3.5" /><span>重新生成</span></button> : null}</div> : null}{!streaming && message.sources && message.sources.length > 0 ? <SourceDrawer sources={message.sources} /> : null}</div>;
}
export default memo(MessageItemImpl, (prev, next) => prev.message === next.message && prev.onRegenerate === next.onRegenerate);
