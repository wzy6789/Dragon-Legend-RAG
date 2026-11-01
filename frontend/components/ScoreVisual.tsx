import type { Evaluation } from "../lib/types";
import { buildScoreVisual, formatScoreValue, type ScoreMetric } from "../lib/visual-metrics";

const STATUS: Record<string, string> = {
  done: "评测完成", queued: "等待评测", running: "评测中", judging: "评测中", pending_generation: "等待回答完成",
  completed: "评测完成", complete: "评测完成", success: "评测完成", succeeded: "评测完成", scoring: "评测中",
  not_authorized: "尚未授权评测", unavailable: "评测不可用", blocked: "评测受阻",
  error: "评测失败", failed: "评测失败", interrupted: "评测中断", unverified_gold: "标准答案待核验",
  canceled: "评测已取消", cancelled: "评测已取消", skipped: "未发起评测",
};

function Scale({ row }: { row: ScoreMetric }) {
  return <span className="sv-scale">{row.scale === null ? "量纲未知" : `/ ${row.scale}`}{row.state === "out-of-range" ? " · 超出量纲" : ""}</span>;
}

export default function ScoreVisual({ evaluation, compact = false }: { evaluation?: Evaluation; compact?: boolean }) {
  const visual = buildScoreVisual(evaluation);
  return <section className={`sv-visual${compact ? " sv-compact" : ""}`} aria-label="评分与维度">
    <div className="sv-header">
      <div className="sv-total" data-state={visual.total.state}><span className="sv-label">总分</span><strong className="sv-value">{formatScoreValue(visual.total)}</strong><Scale row={visual.total} /></div>
      <span className="sv-status">{evaluation ? STATUS[evaluation.status] ?? evaluation.status : "未记录评测"}</span>
    </div>
    {visual.dimensions.some(row => row.value !== null) ? <div className="sv-dimensions">{visual.dimensions.map(row => <div className="sv-dimension" key={row.key} data-state={row.state}>
      <div className="sv-dimension-heading"><span className="sv-label">{row.label}</span>{row.weightPercent != null && <span className="sv-weight">权重 {Number(row.weightPercent.toFixed(3))}%</span>}<span><strong className="sv-value">{formatScoreValue(row)}</strong> <Scale row={row} /></span></div>
      {row.percent !== null ? <div className="sv-track" role="meter" aria-label={row.label} aria-valuemin={0} aria-valuemax={row.scale!} aria-valuenow={row.value!} aria-valuetext={`${row.value} / ${row.scale}`}><span className="sv-fill" style={{ width: `${row.percent}%` }} /></div> : <div className="sv-track" aria-hidden="true" />}
    </div>)}</div> : <p className="sv-empty">尚无有效维度分数，评测完成后显示。</p>}
    {visual.notes.length > 0 && <p className="sv-note">{visual.notes.join(" ")}</p>}
  </section>;
}
