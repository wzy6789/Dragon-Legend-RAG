"use client";

import type { SourceItem } from "@/lib/types";
import { CloseIcon } from "./icons";

export default function EvidencePanel({ sources, onClose }: { sources: SourceItem[]; onClose: () => void }) {
  return (
    <aside className="evidence-panel">
      <div className="flex h-[62px] shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div>
          <h2 className="text-[12.5px] font-medium text-ink">原文证据</h2>
          <p className="mt-0.5 text-[10.5px] text-ink-faint">当前对话最近一次回答</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭证据栏" title="关闭" className="topbar-icon">
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {sources.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.09] px-3 py-4 text-[11.5px] leading-5 text-ink-faint">回答完成后，引用章节和原文片段会显示在这里。</p>
        ) : (
          <ol className="space-y-2.5">
            {sources.map((source, index) => (
              <li key={`${source.chapter_index ?? "x"}-${source.title}-${index}`} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gold-500/[0.1] text-[10px] font-medium text-gold-300">{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="text-[11.5px] font-medium leading-5 text-ink-soft">{source.chapter || source.title || `原文片段 ${index + 1}`}</h3>
                    {source.title && source.title !== source.chapter ? <p className="mt-0.5 text-[10px] text-ink-faint">{source.title}</p> : null}
                  </div>
                </div>
                {source.snippet ? <p className="mt-2 border-l border-gold-500/25 pl-2.5 text-[11px] leading-[1.7] text-ink-muted">{source.snippet}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
