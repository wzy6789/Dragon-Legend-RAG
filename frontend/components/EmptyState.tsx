"use client";

export default function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return <div className="research-empty"><div className="empty-grid-mark" aria-hidden="true"><span /><span /><span /><span /></div><span className="eyebrow">A REPRODUCIBLE START</span><h2>让每一次回答，都可检验。</h2><p>选择系统版本，输入问题或载入基准题目。<br />在同一工作区核对答案、证据、评测与耗时。</p><button className="quiet-button" onClick={() => onPick("")}>浏览基准题库 <span aria-hidden="true">↗</span></button><div className="empty-workflow"><span><b>01</b> 确定版本与协议</span><span><b>02</b> 运行或顺序比较</span><span><b>03</b> 核对并导出批次</span></div></div>;
}
