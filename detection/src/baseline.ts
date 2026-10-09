import { MIN_HISTORY } from "./params.js";

export { MIN_HISTORY };

/** Scales MAD so it matches the standard deviation for normally distributed data. */
const MAD_SCALE = 1.4826;

export type BaselineResult =
  | { ok: true; baseline: number; spread: number; score: number }
  | { ok: false; reason: "insufficient_history" | "invalid_input" };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isValidCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Scores how unusual today's count is compared with recent history.
 *
 * Why median: a single past spike (e.g. a previous outbreak day) would drag a
 * mean upward and hide today's spike. The median ignores a few extreme days.
 *
 * Why a floor on spread: if history is flat or nearly flat, MAD is ~0 and any
 * tiny change would score as huge. Counts behave roughly like Poisson data,
 * whose natural noise is about sqrt(mean), so we never let spread drop below
 * sqrt(baseline), and never below 1 so a baseline of 0 cannot divide by zero.
 */
export function computeBaseline(history: number[], today: number): BaselineResult {
  if (history.length === 0 || !history.every(isValidCount) || !isValidCount(today)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (history.length < MIN_HISTORY) {
    return { ok: false, reason: "insufficient_history" };
  }

  const baseline = median(history);
  const rawSpread = MAD_SCALE * median(history.map((count) => Math.abs(count - baseline)));
  const spread = Math.max(rawSpread, Math.sqrt(baseline), 1);
  const score = (today - baseline) / spread;

  return { ok: true, baseline, spread, score };
}
