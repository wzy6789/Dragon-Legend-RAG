"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { SendIcon, StopIcon } from "./icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

/** 底部输入区：固定在主内容区底部（不覆盖侧栏），最大阅读宽度 900px */
export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  inputRef,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? localRef;

  // 输入自增高（上限 160px）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, ref]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-4">
      <div className="mx-auto w-full max-w-[900px]">
        <div className="rounded-[14px] border border-white/[0.08] bg-[#15181D] px-3 py-2.5 transition-colors focus-within:border-gold-500/35">
          <div className="flex items-end gap-2">
            <textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if (e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (canSend) onSend();
                }
              }}
              rows={1}
              placeholder="输入你的问题…"
              aria-label="输入问题"
              className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[14.5px] leading-6 text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="停止生成"
                title="停止生成"
                className="mb-0.5 shrink-0 rounded-[10px] border border-white/[0.1] p-2 text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
              >
                <StopIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label="发送"
                title="发送"
                className={
                  "mb-0.5 shrink-0 rounded-[10px] p-2 transition-colors " +
                  (canSend
                    ? "bg-gold-500 text-[#15181D] hover:bg-gold-400"
                    : "cursor-not-allowed bg-white/[0.05] text-ink-faint")
                }
              >
                <SendIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 px-1 text-[11px] text-ink-faint">
          回答基于完整知识库；重要结论建议核对原著。
        </p>
      </div>
    </div>
  );
}
