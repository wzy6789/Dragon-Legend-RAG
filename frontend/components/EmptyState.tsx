"use client";

const SUGGESTIONS = [
  { tag: "人物关系", text: "唐舞麟与古月娜的关系如何一步步变化？" },
  { tag: "事件脉络", text: "史莱克学院遭袭后，幸存者如何重建学院？" },
  { tag: "组织设定", text: "血神军团镇守深渊通道的职责是什么？" },
  { tag: "深入分析", text: "舞长空的高压训练如何影响零班成员的成长？" },
];

export default function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-5 py-12 sm:px-8">
      <div className="w-full max-w-[760px] -translate-y-5 text-center">
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-gold-500/20 bg-gold-500/[0.07] text-gold-300 shadow-[0_0_55px_rgba(201,162,39,0.08)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M12 2.8 14.8 9l6.4 3-6.4 2.8L12 21l-2.8-6.2L2.8 12l6.4-3L12 2.8Z" />
            <path d="m18.5 2 .8 1.8 1.9.8-1.9.8-.8 1.9-.8-1.9-1.8-.8 1.8-.8.8-1.8Z" />
          </svg>
        </div>
        <p className="mb-2 text-[10px] font-medium tracking-[0.28em] text-gold-500/80">DRAGON LEGEND · RESEARCH ASSISTANT</p>
        <h1 className="font-serif text-[25px] leading-snug tracking-wide text-ink sm:text-[31px]">
          一起回到《龙王传说》的故事里
        </h1>
        <p className="mx-auto mt-3 max-w-[540px] text-[13px] leading-6 text-ink-muted">
          提问人物、剧情、设定与关系。系统会检索原文，并在回答中提供可查看的章节证据。
        </p>

        <div className="mx-auto mt-9 grid w-full grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.tag}
              type="button"
              onClick={() => onPick(suggestion.text)}
              className="group rounded-2xl border border-white/[0.075] bg-white/[0.018] px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-gold-500/25 hover:bg-white/[0.035]"
            >
              <span className="mb-1.5 block text-[10px] font-medium tracking-wide text-gold-500/75">{suggestion.tag}</span>
              <span className="block text-[12.5px] leading-5 text-ink-soft transition-colors group-hover:text-ink">{suggestion.text}</span>
            </button>
          ))}
        </div>
        <p className="mt-5 text-[10.5px] text-ink-faint">在下方选择 Flash、Pro 或 Max，按问题复杂度切换回答能力。</p>
      </div>
    </div>
  );
}
