import type { CityModel } from "../city.js";
import { daysBetween } from "../dates.js";
import { fuseScores } from "../detectors/bayes.js";
import type { DetectorParams } from "../params.js";
import { HEALTH_SIGNALS, scoreSignal, SignalIndex, type HealthSignal } from "../scoring.js";
import type { Simulation } from "../simulator.js";
import type { DetectionMethod } from "../types.js";
import type { AlertDay } from "./episodes.js";

/*
 * Fast replay of the three detectors for the backtest.
 *
 * Calibration tries hundreds of alert settings per method. Re-running the real
 * detectors hundreds of times over 4 years is too slow, so we do the expensive
 * part once:
 *   1. Score every ward, signal and day with the real scoreSignal, seen on the
 *      day that number was reported (so late data stays late).
 *   2. Record what each detector would compare against its alert setting:
 *        threshold: the highest score reported on the day itself,
 *        Bayes:     the fused probability and how many signals contributed,
 *        CUSUM:     the order in which days get added, and on which day.
 *   3. For any setting, the alerts are then a quick scan.
 * A test checks that this gives exactly the alerts of the real detectors.
 *
 * No future data: everything recorded for day t uses only numbers reported on
 * or before t. alertDays(method, setting, from, to) reads nothing after `to`.
 */

/** The longest reporting lag this replay supports (history is 7+ days old, so it is always in by then). */
const MAX_SUPPORTED_LAG_DAYS = 7;
/** "Never reported" marker for a missing row. */
const NEVER = 2 ** 30;

export interface DetectorTraces {
  dates: string[];
  wardIds: number[];
  /** The health rows the traces were built from (with reporting dates), for the classifier. */
  index: SignalIndex;
  /** Alert-days for one method and alert setting, for days from..to (indexes into dates, both included). */
  alertDays(method: DetectionMethod, setting: number, from: number, to: number): AlertDay[];
}

export function buildTraces(sim: Simulation, city: CityModel, params: DetectorParams): DetectorTraces {
  const dates = sim.dates;
  const dayCount = dates.length;
  const wardIds = city.wardIds();
  const wardIndex = new Map(wardIds.map((id, i) => [id, i]));
  const dayIndex = new Map(dates.map((date, i) => [date, i]));
  const signalCount = HEALTH_SIGNALS.length;
  const cell = (ward: number, signal: number, day: number) => (ward * signalCount + signal) * dayCount + day;

  // 1. Every health score, and the day it became visible.
  const healthRows = [...sim.rows()].filter((row) => row.signalType !== "rain");
  const index = new SignalIndex(healthRows);
  const reportedDay = new Int32Array(wardIds.length * signalCount * dayCount).fill(NEVER);
  for (const row of healthRows) {
    const day = dayIndex.get(row.date) as number;
    const inPeriod = dayIndex.get(row.reportedOn);
    const lag = inPeriod === undefined ? daysBetween(row.date, row.reportedOn) : inPeriod - day;
    if (lag > MAX_SUPPORTED_LAG_DAYS) throw new RangeError(`Reporting lag over ${MAX_SUPPORTED_LAG_DAYS} days is not supported`);
    const reported = inPeriod ?? NEVER; // reported after the simulated period: never seen
    reportedDay[cell(wardIndex.get(row.wardId) as number, HEALTH_SIGNALS.indexOf(row.signalType as HealthSignal), day)] = reported;
  }
  const score = new Float64Array(reportedDay.length).fill(Number.NaN);
  for (let w = 0; w < wardIds.length; w++) {
    for (let s = 0; s < signalCount; s++) {
      for (let d = 0; d < dayCount; d++) {
        const reported = reportedDay[cell(w, s, d)];
        if (reported >= dayCount) continue; // never visible inside the simulated period
        const scored = scoreSignal(index.asOf(dates[reported]), wardIds[w], HEALTH_SIGNALS[s], dates[d], params);
        if (scored) score[cell(w, s, d)] = scored.score;
      }
    }
  }
  const visibleScore = (w: number, s: number, d: number, today: number): number => {
    const c = cell(w, s, d);
    return reportedDay[c] <= today ? score[c] : Number.NaN;
  };

  // 2a. Threshold: highest score reported on the day itself.
  const thresholdMax = new Float64Array(wardIds.length * dayCount).fill(Number.NaN);
  for (let w = 0; w < wardIds.length; w++) {
    for (let t = 0; t < dayCount; t++) {
      let best = Number.NaN;
      for (let s = 0; s < signalCount; s++) {
        const z = visibleScore(w, s, t, t);
        if (!Number.isNaN(z) && (Number.isNaN(best) || z > best)) best = z;
      }
      thresholdMax[w * dayCount + t] = best;
    }
  }

  // 2b. Bayes: fused probability and number of contributing signals, exactly as bayes.detect does it.
  const bayesProbability = new Float64Array(wardIds.length * dayCount);
  const bayesContributing = new Uint8Array(wardIds.length * dayCount);
  const neighbourIndexes = wardIds.map((id) => city.getNeighbours(id).map((n) => wardIndex.get(n) as number));
  const best = new Float64Array(wardIds.length * signalCount);
  const strongest = new Float64Array(wardIds.length);
  for (let t = 0; t < dayCount; t++) {
    best.fill(Number.NaN);
    for (let w = 0; w < wardIds.length; w++) {
      for (let s = 0; s < signalCount; s++) {
        for (let back = 0; back < params.bayesWindowDays && t - back >= 0; back++) {
          const z = visibleScore(w, s, t - back, t);
          const b = best[w * signalCount + s];
          if (!Number.isNaN(z) && (Number.isNaN(b) || z > b)) best[w * signalCount + s] = z;
        }
      }
      let top = Number.NaN;
      for (let s = 0; s < signalCount; s++) {
        const b = best[w * signalCount + s];
        if (!Number.isNaN(b) && (Number.isNaN(top) || b > top)) top = b;
      }
      strongest[w] = top;
    }
    for (let w = 0; w < wardIds.length; w++) {
      const neighbourScores = neighbourIndexes[w].map((n) => strongest[n]).filter((z) => !Number.isNaN(z));
      const neighbourAverage = neighbourScores.length > 0 ? neighbourScores.reduce((sum, z) => sum + z, 0) / neighbourScores.length : null;
      const bestScores: Partial<Record<HealthSignal, number>> = {};
      let contributing = 0;
      HEALTH_SIGNALS.forEach((signal, s) => {
        const b = best[w * signalCount + s];
        if (Number.isNaN(b)) return;
        bestScores[signal] = b;
        if (b > params.bayesContributionScore) contributing++;
      });
      bayesProbability[w * dayCount + t] = fuseScores(bestScores, neighbourAverage, params).probability;
      bayesContributing[w * dayCount + t] = contributing;
    }
  }

  // 2c. CUSUM: which day's score is added on which day, exactly as cusum.detect walks through days.
  const cusumEvents: Array<{ processedOn: Int32Array; z: Float64Array }> = [];
  for (let w = 0; w < wardIds.length; w++) {
    for (let s = 0; s < signalCount; s++) {
      const processedOn: number[] = [];
      const zs: number[] = [];
      let next = 0;
      for (let t = 0; t < dayCount; t++) {
        while (next <= t) {
          const c = cell(w, s, next);
          if (reportedDay[c] <= t) {
            if (!Number.isNaN(score[c])) {
              processedOn.push(t);
              zs.push(score[c]);
            }
          } else if (t - next < params.cusumMaxWaitDays) {
            break; // not reported yet: wait
          }
          next++;
        }
      }
      cusumEvents.push({ processedOn: Int32Array.from(processedOn), z: Float64Array.from(zs) });
    }
  }

  function alertDays(method: DetectionMethod, setting: number, from: number, to: number): AlertDay[] {
    const out: AlertDay[] = [];
    if (method === "threshold") {
      for (let w = 0; w < wardIds.length; w++) {
        for (let t = from; t <= to; t++) if (thresholdMax[w * dayCount + t] > setting) out.push({ wardId: wardIds[w], date: dates[t] });
      }
    } else if (method === "bayes") {
      for (let w = 0; w < wardIds.length; w++) {
        for (let t = from; t <= to; t++) {
          const i = w * dayCount + t;
          if (bayesProbability[i] > setting && bayesContributing[i] >= params.bayesMinSignals) out.push({ wardId: wardIds[w], date: dates[t] });
        }
      }
    } else {
      for (let w = 0; w < wardIds.length; w++) {
        const alarmDays = new Set<number>();
        for (let s = 0; s < signalCount; s++) {
          const { processedOn, z } = cusumEvents[w * signalCount + s];
          let sum = 0;
          for (let e = 0; e < z.length && processedOn[e] <= to; e++) {
            sum = Math.max(0, sum + z[e] - params.cusumSlack);
            if (sum > setting) {
              if (processedOn[e] >= from) alarmDays.add(processedOn[e]);
              sum = 0;
            }
          }
        }
        for (const t of [...alarmDays].sort((a, b) => a - b)) out.push({ wardId: wardIds[w], date: dates[t] });
      }
    }
    return out;
  }

  return { dates, wardIds, index, alertDays };
}
