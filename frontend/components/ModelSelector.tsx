"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Tier } from "@/lib/types";
import { CheckIcon, ChevronDownIcon } from "./icons";

const OPTIONS: { key: Tier; label: string; desc: string }[] = [
  {
    key: "flash",
    label: "Flash",
    desc: "快速查找人物、武魂与剧情事实，适合日常问答。",
  },
  {
    key: "pro",
    label: "Pro",
    desc: "深入分析人物关系与事件原因，提供详细解释与原文依据。",
  },
  {
    key: "max",
    label: "Max",
    desc: "适合复杂考据与多线索推理，核验冲突信息，明确标注推测。",
  },
];

/** 输入框内的模型选择器（向上弹出，参考 ChatGPT / Codex 的写法） */
export default function ModelSelector({
  value,
  onChange,
}: {
  value: Tier;
  onChange: (t: Tier) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`回答模式：${current.label}`}
        title={current.desc}
        className="flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-white/[0.08] hover:text-ink"
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${value === "flash" ? "bg-emerald-400" : value === "pro" ? "bg-sky-400" : "bg-violet-400"}`} />
        <span className="font-medium">{current.label}</span>
        <ChevronDownIcon className={"h-3 w-3 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div
          role="menu"
          id={menuId}
          aria-label="选择回答能力"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            let next = index;
            if (event.key === "ArrowDown") next = (index + 1) % items.length;
            else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = items.length - 1;
            else return;
            event.preventDefault();
            items[next]?.focus();
          }}
          className="absolute bottom-[calc(100%+12px)] left-0 z-30 w-[320px] max-w-[calc(100vw-56px)] animate-fade-in overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1A1E24] p-1.5 shadow-2xl shadow-black/50"
        >
          <p className="px-3 py-2 text-[11px] text-ink-muted">选择适合这次问题的回答能力</p>
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
                  triggerRef.current?.focus();
                }}
                className={
                  "flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors " +
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
