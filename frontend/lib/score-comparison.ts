import { buildScoreVisual, type ScoreMetric } from "./visual-metrics";
import { comparisonSides, type compareResults } from "./workbench";

export interface DimensionComparison {
  key: string;
  label: string;
  left?: ScoreMetric;
  right?: ScoreMetric;
  delta?: number;
  reason?: string;
}

/** Raw dimension deltas, never weighted contributions or a reconstructed total. */
export function buildDimensionComparison(result: ReturnType<typeof compareResults>): DimensionComparison[] {
  const [a, b] = comparisonSides(result.entries);
  const left = a ? buildScoreVisual(a.evaluation).dimensions : [];
  const right = b ? buildScoreVisual(b.evaluation).dimensions : [];
  return [...new Set([...left, ...right].map(row => row.key))].map(key => {
    const l = left.find(row => row.key === key), r = right.find(row => row.key === key);
    let reason: string | undefined;
    if (!result.comparable) reason = "比较条件未满足";
    else if (!l || !r || l.state === "missing" || r.state === "missing") reason = "维度分数未齐全";
    else if (l.state !== "recorded" || r.state !== "recorded" || l.scale !== r.scale) reason = "分值或量尺不可比";
    return { key, label: l?.label ?? r!.label, left: l, right: r,
      ...(reason ? { reason } : { delta: Number((r!.value! - l!.value!).toFixed(6)) }) };
  });
}
