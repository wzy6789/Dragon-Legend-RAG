"use client";

export default function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return <div className="research-empty"><h2>开始一次问答</h2><p>输入问题，或从题库选择。</p><button className="quiet-button" onClick={() => onPick("")}>选择题库</button></div>;
}
