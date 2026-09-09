"use client";

import type { SourceItem } from "@/lib/types";

export default function SourceList({ sources }: { sources: SourceItem[] }) {
  if (!sources || sources.length === 0) {
    return (
      <p className="text-xs text-mist-500">本轮未提供可核验的检索来源。</p>
    );
  }
  return (
    <ul className="space-y-2">
      {sources.map((s, i) => (
        <li key={i} className="rounded-md border border-ink-700/70 bg-ink-850/50 px-3 py-2">
          <div className="mb-0.5 flex items-baseline gap-2 text-xs">
            <span className="text-brass-400">{s.chapter || s.title || `片段 ${i + 1}`}</span>
            {s.chapter_index != null && (
              <span className="text-mist-500">· 章节 {s.chapter_index}</span>
            )}
          </div>
          <p className="text-[12px] leading-5 text-mist-300">{s.snippet}</p>
        </li>
      ))}
    </ul>
  );
}
