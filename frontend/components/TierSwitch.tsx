"use client";

import type { Tier } from "@/lib/types";

interface Props {
  value: Tier;
  onChange: (t: Tier) => void;
  disabled?: boolean;
}

const OPTIONS: {
  key: Tier;
  name: string;
  badge: string;
  desc: string;
}[] = [
  { key: "flash", name: "Flash", badge: "RAG1.0", desc: "快速 · 简洁" },
  { key: "pro", name: "Pro", badge: "RAG2.1", desc: "深入 · 证据核验" },
];

export default function TierSwitch({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-2">
      {OPTIONS.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            className={
              "group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 " +
              (active
                ? "border-brass-500/60 bg-brass-500/10 text-brass-300"
                : "border-ink-700 bg-ink-850/60 text-mist-300 hover:border-mist-500/30 hover:text-mist-100")
            }
          >
            <span className="font-medium">{o.name}</span>
            <span
              className={
                "rounded border px-1 text-[10px] leading-4 tracking-wide " +
                (active
                  ? "border-brass-500/40 text-brass-400"
                  : "border-ink-600 text-mist-500")
              }
            >
              {o.badge}
            </span>
            <span className="hidden text-[11px] text-mist-500 sm:inline">{o.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
