"use client";
import type { Evaluation } from "@/lib/types";
import { buildScoreVisual } from "@/lib/visual-metrics";
import { comparisonFeedback, compareResults, comparisonSides, compareExecution, displayValue, evaluationLabel, formatMs, systemLabel } from "@/lib/workbench";

function value(e?: Evaluation) {
  if (evaluationLabel(e)!=="已评分") return evaluationLabel(e);
  if (typeof e?.score !== "number" || !Number.isFinite(e.score)) return "分数未记录";
  return `${Number(e.score.toFixed(2))}${typeof e.score_scale === "number" ? ` / ${e.score_scale}` : ""}`;
}
function valid(n: unknown): n is number { return typeof n === "number" && Number.isFinite(n) && n >= 0; }
export default function ComparisonResults({ result }: { result: ReturnType<typeof compareResults> }) {
  const timing = compareExecution(result.entries);
  const entries = comparisonSides(result.entries);
  const maxTime = Math.max(...entries.map(e => e?.message.experiment?.metrics?.execution_ms).filter(valid), 1);
  const feedback = comparisonFeedback(result);
  const quality = feedback.quality;
  return <section className="comparison-results comparison-summary" aria-label="质量与速度对照"><div className="comparison-overview">
    <div className="compare-metric"><div className="compare-metric-title"><span>回答质量</span><span className="metric-tag">{result.entries[0]?.message.experiment?.benchmark_id === "free" ? "在线诊断" : "协议评测"}</span></div><h3>{quality}</h3>
      <div className="paired-meters">{entries.map((entry,i)=>{const e=entry?.evaluation,total=buildScoreVisual(e).total;return <div className={`paired-meter series-${i}`} key={i}><span className="series-key">{i?"B":"A"}</span><div className="meter-track" aria-hidden="true">{total.percent!==null&&<span style={{width:`${total.percent}%`}}/>}</div><strong>{value(e)}</strong></div>;})}</div><p>{result.comparable ? "相同题目、上下文、裁判与评分标准" : "评分完成且口径一致后显示分差"}</p>
    </div>
    <div className="compare-metric"><div className="compare-metric-title"><span>回答速度</span><span className="metric-tag">不含排队</span></div><h3>{timing.delta===undefined?feedback.timing:timing.delta===0?"本次耗时相同":`${timing.delta<0?"B":"A"} 少用 ${formatMs(Math.abs(timing.delta))}`}</h3>
      <div className="paired-meters">{entries.map((entry,i)=>{const time=entry?.message.experiment?.metrics?.execution_ms;return <div className={`paired-meter series-${i}`} key={i}><span className="series-key">{i?"B":"A"}</span><div className="meter-track" aria-hidden="true">{valid(time)&&<span style={{width:`${time/maxTime*100}%`}}/>}</div><strong>{formatMs(time)}</strong></div>;})}</div><p>柱长代表本次执行耗时，越短越快</p>
    </div></div>
    <details className="comparison-numbers"><summary>查看原始数据与比较条件</summary><div className="report-table-scroll"><table className="research-data-table comparison-matrix"><caption className="sr-only">两个版本的原始数据</caption><thead><tr><th>指标</th>{entries.map((e,i)=><th key={i}><span className={`series-key series-${i}`}>{i?"B":"A"}</span> {e?systemLabel(e.message):"等待记录"}</th>)}</tr></thead><tbody>
      {([["服务端首段 · 含排队","ttft_ms"],["执行 · 不含排队","execution_ms"],["排队","queue_ms"],["总耗时 · 含排队","e2e_ms"]] as const).map(([label,key])=><tr key={key}><th scope="row">{label}</th>{entries.map((e,i)=><td key={i}>{formatMs(e?.message.experiment?.metrics?.[key])}</td>)}</tr>)}<tr><th scope="row">原始评分</th>{entries.map((e,i)=><td key={i}>{value(e?.evaluation)}</td>)}</tr></tbody></table></div>
      {!result.comparable&&<ul className="comparison-reasons">{result.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}{timing.reason&&<p className="muted">{timing.reason}</p>}
      <div className="comparison-protocols">{entries.map((e,i)=>e&&<dl key={e.message.id}><dt>{i?"B":"A"} 的评测口径</dt><dd>协议：{displayValue(e.evaluation?.protocol_id)}</dd><dd>裁判：{displayValue(e.evaluation?.judge_model)}</dd><dd>题型：{displayValue(e.evaluation?.type)}</dd></dl>)}</div>
    </details>
  </section>;
}
