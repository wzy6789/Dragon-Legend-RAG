"use client";

import { useState } from "react";
import type { SourceItem } from "@/lib/types";
import { ChevronIcon } from "./icons";

/** 参考来源：默认收起，点击后在当前回答下方展开 */
export default function SourceDrawer({ sources }: { sources: SourceItem[] }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex items-center gap-1.5 rounded-lg py-1 text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
      >
        <ChevronIcon
          className={
            "h-3.5 w-3.5 transition-transform duration-200 " + (open ? "rotate-180" : "")
          }
        />
        <span>参考来源 · {sources.length}</span>
      </button>

      {open && (
        <div className="mt-1.5 animate-fade-in rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
          <ul className="space-y-2.5">
            {sources.map((s, i) => (
              <li key={i} className="text-[12.5px] leading-5">
                <div className="text-gold-400/90">{s.chapter || s.title || `片段 ${i + 1}`}</div>
                {s.snippet ? (
                  <p className="mt-0.5 text-ink-muted">{s.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
