"use client";

export default function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return <div className="research-empty lab-empty"><span className="lab-index">RAG / EXPERIMENTS</span><h2>让回答有据可查，<br/>让差异清晰可见。</h2><p>选择版本，提出问题。答案、证据与评测记录留在同一次实验中。</p><div className="lab-start-options"><div><span className="lab-step">01</span><h3>自由探索</h3><p>在下方输入问题，查看回答与运行过程。</p></div><button onClick={() => onPick("")}><span className="lab-step">02</span><h3>标准题库</h3><p>选定题目与协议，进行可复核的版本对照。</p><span className="lab-start-action">选择题目</span></button></div></div>;
}
