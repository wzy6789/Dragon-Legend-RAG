"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Tier } from "@/lib/types";
import ModelSelector from "./ModelSelector";
import { SendIcon, StopIcon } from "./icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  tier: Tier;
  onTierChange: (tier: Tier) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export default function Composer({ value, onChange, onSend, onStop, busy, tier, onTierChange, inputRef }: Props) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? localRef;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 176)}px`;
  }, [value, ref]);

  const canSend = value.trim().length > 0 && !busy;
  return (
    <div className="shrink-0 px-3 pb-3 sm:px-7 sm:pb-5">
      <div className="mx-auto w-full max-w-[980px]">
        <div className="composer-surface">
          <textarea
            ref={ref}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            rows={1}
            placeholder="向龙王传说考据助手提问…"
            aria-label="输入问题"
            className="max-h-44 min-h-8 w-full resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-6 text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <ModelSelector value={tier} onChange={onTierChange} />
              <span className="hidden text-[11px] text-ink-faint sm:inline">Enter 发送 · Shift + Enter 换行</span>
            </div>
            {busy ? (
              <button type="button" onClick={onStop} aria-label="停止当前回答" title="停止当前回答" className="composer-stop">
                <StopIcon className="h-4 w-4" /><span className="hidden sm:inline">停止</span>
              </button>
            ) : (
              <button type="button" onClick={onSend} disabled={!canSend} aria-label="发送" title="发送" className={"composer-send " + (canSend ? "composer-send-ready" : "composer-send-disabled")}>
                <SendIcon className="h-4 w-4" /><span className="hidden sm:inline">发送</span>
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[10.5px] text-ink-faint">回答会优先依据原文证据；涉及重要设定时请查看引用片段。</p>
      </div>
    </div>
  );
}
