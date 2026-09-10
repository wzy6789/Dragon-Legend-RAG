"use client";

import { useEffect, useRef, useState } from "react";
import type { Tier } from "@/lib/types";
import { CheckIcon, ChevronDownIcon } from "./icons";

const OPTIONS: { key: Tier; label: string; desc: string }[] = [
  {
    key: "flash",
    label: "Flash",
    desc: "快速回答，适合人物、设定与单点事实问题。",
  },
  {
    key: "pro",
    label: "Pro",
    desc: "深度考据，适合复杂剧情、关系、因果分析。",
  },
];

/** 输入框内的模型选择器（向上弹出，参考 ChatGPT / Codex 的写法） */
export default function ModelSelector({
  value,
  onChange,
  disabled,
}: {
  value: Tier;
  onChange: (t: Tier) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`回答模式：${current.label}`}
        title={current.desc}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-40"
      >
        <span className="font-medium">{current.label}</span>
        <ChevronDownIcon className={"h-3 w-3 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[304px] animate-fade-in overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#1A1E24] shadow-2xl shadow-black/50"
        >
          {OPTIONS.map((o) => {
            const active = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors " +
                  (active ? "bg-white/[0.05]" : "hover:bg-white/[0.04]")
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        "text-[12.5px] font-medium " + (active ? "text-ink" : "text-ink-soft")
                      }
                    >
                      {o.label}
                    </span>
                    {active && <span className="text-[10.5px] text-gold-500">当前使用中</span>}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-muted">
                    {o.desc}
                  </span>
                </span>
                {active && <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
