import type { StoredSignal } from "../db/repository.js";

/**
 * P1's SignalIndex keys rows by (ward, signal, date) only, so two rows that differ only in
 * source tag (e.g. today's simulated complaints and a real form complaint, both "complaint")
 * would overwrite each other, and which one survived would depend on row order.
 * Before calling runDetector or wardRisk, add them up: the day's total is the sum over sources.
 * reportedOn is the latest of the parts, so the total is never seen before all of it arrived.
 * P1's code is unchanged.
 */
export function combineSources(rows: readonly StoredSignal[]): StoredSignal[] {
  const byKey = new Map<string, StoredSignal>();
  for (const row of rows) {
    const key = `${row.wardId}|${row.signalType}|${row.date}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...row });
      continue;
    }
    seen.count += row.count;
    if (row.reportedOn > seen.reportedOn) seen.reportedOn = row.reportedOn;
    // sourceTag keeps the first part's tag: P1's index does not read it, and these combined
    // rows are only passed to runDetector/wardRisk, never stored or shown.
  }
  return [...byKey.values()];
}
