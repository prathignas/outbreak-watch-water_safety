import type { CityModel } from "../city.js";
import type { DetectorParams } from "../params.js";
import type { SignalInput } from "../scoring.js";
import type { Alert, CauseType, DetectionMethod, SignalType } from "../types.js";

/** What every detector returns: today's alerts, plus the state to pass in tomorrow. */
export interface DetectResult<State> {
  alerts: Alert[];
  state: State;
}

/** The one signature all three detectors share. */
export type Detector<State> = (
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: DetectorParams,
  state?: State,
) => DetectResult<State>;

/** The cause classifier fills this in later. Until then: all "unknown". */
export function unknownCause(): Record<CauseType, number> {
  return { water: 0, food: 0, p2p: 0, seasonal: 0, unknown: 1 };
}

/**
 * Turns "how far past the line" into 0..1 for threshold and CUSUM, which have no
 * probability of their own: exactly at the line gives 0.5, twice the line 0.67, and
 * it climbs toward 1. Only the Bayes score is a real probability.
 */
export function severity(value: number, limit: number): number {
  if (value <= 0) return 0;
  return value / (value + limit);
}

export function makeAlert(fields: {
  wardId: number;
  date: string;
  method: DetectionMethod;
  score: number;
  contributingSignals: SignalType[];
  evidence: string[];
}): Alert {
  return { ...fields, causeProbs: unknownCause(), suspectedZoneId: null };
}
