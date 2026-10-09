import type { CityModel } from "../city.js";
import type { DetectorParams } from "../params.js";
import { describeScore, HEALTH_SIGNALS, scoreSignal, viewAsOf, type SignalInput, type SignalScore } from "../scoring.js";
import type { Alert } from "../types.js";
import { makeAlert, severity, type DetectResult } from "./common.js";

/*
 * Detector 1: THRESHOLD. The simplest rule.
 * Alert for a ward if any one of complaints, pharmacy or hospital is more than
 * `thresholdScore` spreads above normal TODAY. No memory, no neighbours.
 * It only sees today's numbers, so a signal that arrives late (hospital) is
 * missed if it is not in yet.
 */
export function detect(
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: DetectorParams,
  _state?: null,
): DetectResult<null> {
  const view = viewAsOf(rows, today);
  const alerts: Alert[] = [];

  for (const wardId of city.wardIds()) {
    const high: SignalScore[] = [];
    for (const signal of HEALTH_SIGNALS) {
      const scored = scoreSignal(view, wardId, signal, today, params);
      if (scored && scored.score > params.thresholdScore) high.push(scored);
    }
    if (high.length === 0) continue;

    const top = Math.max(...high.map((s) => s.score));
    alerts.push(
      makeAlert({
        wardId,
        date: today,
        method: "threshold",
        score: severity(top, params.thresholdScore),
        contributingSignals: high.map((s) => s.signal),
        evidence: high.map((s) => `${describeScore(s)}: ${s.score.toFixed(1)} spreads above normal, line is ${params.thresholdScore}`),
      }),
    );
  }
  return { alerts, state: null };
}
