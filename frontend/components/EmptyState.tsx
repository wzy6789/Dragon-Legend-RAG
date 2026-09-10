"use client";

const SUGGESTIONS = [
  "唐舞麟在东海学院的成长经历",
  "古月娜与娜儿的关系",
  "血神军团为什么镇守深渊？",
  "舞长空为何采用高压训练？",
];

export default function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-[720px] text-center">
        <h1 className="font-serif text-[24px] leading-snug tracking-wide text-ink sm:text-[27px]">
          今天想了解《龙王传说》的什么？
        </h1>
        <p className="mx-auto mt-3 max-w-[520px] text-[13px] leading-6 text-ink-muted">
          基于完整知识库回答人物、剧情、设定与关系问题，并提供参考来源。
        </p>

        <div className="mx-auto mt-8 grid w-full max-w-[620px] grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-[12px] border border-white/[0.08] px-3.5 py-2.5 text-left text-[12.5px] leading-5 text-ink-soft transition-colors hover:border-gold-500/30 hover:bg-white/[0.04] hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
