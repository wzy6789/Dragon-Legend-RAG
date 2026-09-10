"use client";

const SUGGESTIONS = [
  "唐舞麟在东海学院的成长经历",
  "古月娜与娜儿之间的关系",
  "血神军团为何镇守深渊通道？",
  "舞长空为何采用高压训练？",
];

export default function WelcomeScreen({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-thread flex-col items-center px-4 pb-6 pt-14 text-center sm:pt-20">
      <h1 className="font-serif text-[26px] leading-snug tracking-wide text-ink sm:text-[30px]">
        想了解《龙王传说》的什么？
      </h1>
      <p className="mt-3 max-w-[520px] text-[13.5px] leading-6 text-ink-muted">
        基于完整知识库回答人物、剧情、设定与关系问题，并提供参考来源。
      </p>

      <div className="mt-8 grid w-full max-w-[620px] grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-4 py-3 text-left text-[13px] leading-6 text-ink-soft transition-colors hover:border-gold-500/35 hover:bg-white/[0.035] hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
