"use client";

import { useState } from "react";
import { buildDimensionComparison } from "@/lib/score-comparison";
import { comparisonSides, evaluationLabel, systemLabel, type compareResults } from "@/lib/workbench";
import { formatScoreValue, type ScoreMetric } from "@/lib/visual-metrics";

function ScoreCell({ row, side }: { row?: ScoreMetric; side: number }) {
  return <td className={`dimension-value series-${side}`}>
    <div><strong>{row ? formatScoreValue(row) : "未记录"}</strong>{row?.scale != null && <span> / {row.scale}</span>}</div>
    {row?.percent != null && <div className="dimension-track" role="meter" aria-label={`${side ? "B" : "A"} ${row.label}`} aria-valuemin={0} aria-valuemax={row.scale!} aria-valuenow={row.value!}><span style={{ width: `${row.percent}%` }} /></div>}
    {row?.weightPercent != null && <small>权重 {Number(row.weightPercent.toFixed(3))}%</small>}
  </td>;
}

export default function ScoreComparison({ result, onInspect }: {
  result: ReturnType<typeof compareResults>;
  onInspect: (id: string) => void;
}) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [sort, setSort] = useState("protocol");
  const sides = comparisonSides(result.entries);
  const allRows = buildDimensionComparison(result);
  const rows = allRows.filter(row => !differencesOnly || row.delta !== 0);
  if (sort === "gap") rows.sort((a, b) => (b.delta === undefined ? -1 : Math.abs(b.delta)) - (a.delta === undefined ? -1 : Math.abs(a.delta)));
  const missing = allRows.filter(row => row.delta === undefined).length;
  return <section className="dimension-comparison" aria-label="逐维评分对照">
    <header className="dimension-toolbar"><div><h3>差距具体在哪一项</h3><p>同一维度左右对齐，分差保留原始量尺。</p></div><div className="dimension-controls">
      <label><input type="checkbox" checked={differencesOnly} onChange={e => setDifferencesOnly(e.target.checked)} />仅看差异</label>
      <select aria-label="评分维度排序" value={sort} onChange={e => setSort(e.target.value)}><option value="protocol">协议顺序</option><option value="gap">分差从大到小</option></select>
    </div></header>
    {allRows.length ? <>
      <div className="dimension-table-scroll" role="region" aria-label="左右维度评分表" tabIndex={0}><table className="dimension-table">
        <caption className="sr-only">同一问题的逐维原始评分与差值，A 固定在左，B 固定在右</caption>
        <thead><tr><th scope="col">维度</th>{sides.map((entry, i) => <th scope="col" className={`series-${i}`} key={i}><span className="series-key">{i ? "B" : "A"}</span><span>{entry ? systemLabel(entry.message) : "等待记录"}</span></th>)}<th scope="col">本题分差</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key} data-dimension={row.key}><th scope="row">{row.label}</th><ScoreCell row={row.left} side={0} /><ScoreCell row={row.right} side={1} /><td className={`dimension-delta${row.delta ? ` series-${row.delta > 0 ? 1 : 0}` : ""}`}>
          {row.delta === undefined ? <span title={row.reason}>暂不可比</span> : row.delta === 0 ? <span>相同</span> : <strong>{row.delta > 0 ? "B" : "A"} 高 {Number(Math.abs(row.delta).toFixed(3))}</strong>}
        </td></tr>)}</tbody>
      </table></div>
      {!rows.length && <p className="dimension-empty">已记录的可比维度分数相同。</p>}
    </> : <div className="dimension-empty"><p>尚无可展示的维度分数。</p>{sides.map((entry,i)=><p key={i}>{i ? "B" : "A"} · {entry ? evaluationLabel(entry.evaluation) : "等待回答记录"}</p>)}</div>}
    <footer className="dimension-footer"><p>{result.comparable ? `${allRows.length - missing} 项可比${missing ? `，${missing} 项资料不足` : ""}。维度分差不等于加权总分贡献。` : "仅展示原始评分；比较条件未满足，不计算分差。"}</p>
      <div>{sides.map((entry, i) => entry && <button key={i} className={`series-${i}`} type="button" onClick={() => onInspect(entry.message.id)}>查看 {i ? "B" : "A"} 评分依据</button>)}</div>
    </footer>
  </section>;
}
