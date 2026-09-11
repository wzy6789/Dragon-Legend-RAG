"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Tier } from "@/lib/types";
import { InfoIcon, SendIcon, StopIcon } from "./icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  tier: Tier;
  onTierChange: (t: Tier) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

const TIER_HINT: Record<Tier, string> = {
  flash: "快速、简洁，适合事实类问题。",
  pro: "v2.1 深度考据：Ewe 证据工作记忆与多轮校验。",
  max: "v2.2 全力考据：在 Pro 基础上加入章节对齐与认证图谱证据回链。",
};

export default function Composer({
  value,
  onChange,
  tier,
  onTierChange,
  onSend,
  onStop,
  busy,
  inputRef,
}: Props) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef ?? localRef;
  const [showHint, setShowHint] = useState(false);

  // 输入自增高（上限 160px）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value, ref]);

  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="mx-auto w-full max-w-composer px-4 pb-3 sm:px-6 sm:pb-4">
      {/* 输入框 */}
      <div className="rounded-[18px] border border-white/[0.08] bg-panel px-3 py-2.5 shadow-lg shadow-black/20 transition-colors focus-within:border-gold-500/40">
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
              className="mb-0.5 shrink-0 rounded-xl border border-white/[0.1] p-2 text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
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
                "mb-0.5 shrink-0 rounded-xl p-2 transition-colors " +
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

      {/* 模式分段 + 提示 */}
      <div className="mt-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-1.5">
          <div
            className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5"
            role="group"
            aria-label="回答模式"
          >
            <TierButton
              active={tier === "flash"}
              label="Flash"
              sub="快速回答"
              onClick={() => onTierChange("flash")}
            />
            <TierButton
              active={tier === "pro"}
              label="Pro"
              sub="v2.1 深度考据"
              onClick={() => onTierChange("pro")}
            />
            <TierButton
              active={tier === "max"}
              label="Max"
              sub="v2.2 图谱考据"
              onClick={() => onTierChange("max")}
            />
          </div>
          <div className="relative">
            <button
              type="button"
              aria-label="模式说明"
              onClick={() => setShowHint((v) => !v)}
              onMouseEnter={() => setShowHint(true)}
              onMouseLeave={() => setShowHint(false)}
              className="rounded-md p-1 text-ink-faint transition-colors hover:text-ink-muted"
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
            {showHint ? (
              <div className="absolute bottom-7 left-0 z-30 w-[228px] animate-fade-in rounded-xl border border-white/[0.08] bg-panel px-3 py-2 text-[11.5px] leading-5 text-ink-muted shadow-xl shadow-black/40">
                <p>
                  <span className="text-gold-400">Flash</span>：{TIER_HINT.flash}
                </p>
                <p className="mt-1">
                  <span className="text-gold-400">Pro</span>：{TIER_HINT.pro}
                </p>
                <p className="mt-1">
                  <span className="text-gold-400">Max</span>：{TIER_HINT.max}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <p className="hidden text-[11px] text-ink-faint sm:block">
          回答基于本地知识库，重要内容请核对原著。
        </p>
      </div>
    </div>
  );
}

function TierButton({
  active,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={sub}
      className={
        "rounded-[6px] px-2.5 py-1 text-[12px] transition-colors " +
        (active
          ? "bg-gold-500/[0.14] text-gold-400"
          : "text-ink-muted hover:text-ink-soft")
      }
    >
      <span className="font-medium">{label}</span>
      <span className="ml-1.5 hidden text-[11px] opacity-80 sm:inline">{sub}</span>
    </button>
  );
}
