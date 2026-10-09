import type { BacktestResult } from "@/api/types";
import type { DetectionMethod } from "@/contract/types";
import { pct } from "@/lib/format";

const NAMES: Array<[DetectionMethod, string]> = [["bayes", "Bayes"], ["cusum", "CUSUM"], ["threshold", "Threshold"]];

/** The headline numbers (realistic, budget 0.25, water), straight from P1's results file. */
export function headlineWater(d: BacktestResult) {
  return NAMES.flatMap(([id, name]) => {
    const r = d.summary.find((x) => x.method === id && x.difficulty === "realistic" && x.budget === 0.25 && x.cause === "water" && x.subset === "all");
    const c = d.counts?.find((x) => x.method === id && x.difficulty === "realistic" && x.budget === 0.25 && x.cause === "water");
    if (!r?.detectionRate || !r.medianDelayDays) return [];
    return [{ id, name, found: c ? `${c.found} of ${c.total}` : pct(r.detectionRate.median), days: r.medianDelayDays.median.toFixed(1) }];
  });
}
