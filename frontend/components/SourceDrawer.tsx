"use client";

import { useState } from "react";
import type { SourceItem } from "@/lib/types";
import { ChevronDownIcon } from "./icons";

/** 参考来源：默认收起，点击展开；只展示章节、标题与短摘录 */
export default function SourceDrawer({ sources }: { sources: SourceItem[] }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-lg py-0.5 text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
      >
        <ChevronDownIcon
          className={"h-3.5 w-3.5 transition-transform " + (open ? "rotate-180" : "")}
        />
        <span>参考来源（{sources.length}）</span>
      </button>

      {open && (
        <ul className="mt-2 animate-fade-in space-y-2.5 border-l border-white/[0.08] pl-3">
          {sources.map((s, i) => (
            <li key={i} className="text-[12.5px] leading-5">
              <div className="text-ink-soft">{s.chapter || s.title || `片段 ${i + 1}`}</div>
              {s.title && s.title !== s.chapter ? (
                <div className="text-[11.5px] text-ink-faint">{s.title}</div>
              ) : null}
              {s.snippet ? <p className="mt-0.5 text-ink-muted">{s.snippet}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
