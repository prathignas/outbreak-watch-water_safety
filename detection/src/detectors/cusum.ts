import type { CityModel } from "../city.js";
import { addDays, daysBetween } from "../dates.js";
import type { DetectorParams } from "../params.js";
import { describeScore, HEALTH_SIGNALS, scoreSignal, viewAsOf, type SignalInput, type SignalScore } from "../scoring.js";
import type { Alert } from "../types.js";
import { makeAlert, severity, type DetectResult } from "./common.js";

/*
 * Detector 2: CUSUM (cumulative sum). Catches a small rise that keeps going.
 * For each ward and signal, every day:
 *     sum = max(0, sum + score - k)
 * k ("slack") soaks up normal noise. If the sum passes h ("limit"), alert and
 * reset the sum to 0. One mildly high day adds a little and fades; several in a
 * row add up and cross the line.
 *
 * Late data: each ward+signal remembers the next day it still has to add. A day
 * that is not reported yet is waited for (up to cusumMaxWaitDays), so a late
 * hospital count is still added in order instead of being skipped.
 */

export interface CusumCell {
  /** The running sum. */
  sum: number;
  /** The next day this ward+signal still needs to add. */
  nextDate: string;
}

/** Plain JSON, so the Lambda can save it between runs. Key: "wardId:signal". */
export interface CusumState {
  cells: Record<string, CusumCell>;
}

export function emptyCusumState(): CusumState {
  return { cells: {} };
}

export function detect(
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: DetectorParams,
  state: CusumState = emptyCusumState(),
): DetectResult<CusumState> {
  const view = viewAsOf(rows, today);
  const cells: Record<string, CusumCell> = { ...state.cells };
  const alerts: Alert[] = [];

  for (const wardId of city.wardIds()) {
    const alarms: Array<{ scored: SignalScore; sum: number }> = [];

    for (const signal of HEALTH_SIGNALS) {
      const key = `${wardId}:${signal}`;
      let { sum, nextDate } = cells[key] ?? { sum: 0, nextDate: today };

      while (nextDate <= today) {
        const scored = scoreSignal(view, wardId, signal, nextDate, params);
        if (!scored) {
          const stillWaiting = view.count(wardId, signal, nextDate) === undefined
            && daysBetween(nextDate, today) < params.cusumMaxWaitDays;
          if (stillWaiting) break; // not reported yet: try again tomorrow
          nextDate = addDays(nextDate, 1); // no baseline, or gave up waiting: skip this day
          continue;
        }
        sum = Math.max(0, sum + scored.score - params.cusumSlack);
        if (sum > params.cusumLimit) {
          alarms.push({ scored, sum });
          sum = 0; // reset after an alarm
        }
        nextDate = addDays(nextDate, 1);
      }
      cells[key] = { sum, nextDate };
    }

    if (alarms.length === 0) continue;
    const top = Math.max(...alarms.map((a) => a.sum));
    alerts.push(
      makeAlert({
        wardId,
        date: today,
        method: "cusum",
        score: severity(top, params.cusumLimit),
        contributingSignals: [...new Set(alarms.map((a) => a.scored.signal))],
        evidence: alarms.map(
          (a) => `${describeScore(a.scored)}: running excess ${a.sum.toFixed(1)} passed the limit ${params.cusumLimit}`,
        ),
      }),
    );
  }
  return { alerts, state: { cells } };
}
