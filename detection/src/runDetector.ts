import type { CityModel } from "./city.js";
import { classifyAlertsDetailed, type RainPoint } from "./classifier.js";
import { addDays, daysBetween } from "./dates.js";
import * as bayes from "./detectors/bayes.js";
import { makeAlert } from "./detectors/common.js";
import * as cusum from "./detectors/cusum.js";
import * as threshold from "./detectors/threshold.js";
import { DETECTOR_PARAMS, type DetectorParams } from "./params.js";
import { CLASSIFIER_PARAMS, type ClassifierParams } from "./params.classifier.js";
import { RUN_DETECTOR } from "./params.live.js";
import { viewAsOf, type SignalInput } from "./scoring.js";
import type { Alert, DetectionMethod } from "./types.js";

/*
 * runDetector: the one function the daily Lambda calls.
 *
 *   rows (the last ~70 days from the database, with reportedOn), today, city
 *     -> detector (default Bayes)       same detect() code the backtest replay is tested against
 *     -> cause classifier               fills causeProbs, suspectedZoneId; its reasons go to causeEvidence
 *     -> cooldown                       a ward that already alerted in the last cooldownDays days
 *                                       does not alert again (it is still "active" on the map)
 *     -> { alerts to send, state to save for tomorrow }
 *
 * No future data: everything reads through a view fixed to `today`, which throws
 * on any later date, and rows reported after today stay invisible.
 * Deterministic: the same rows, date, params and state always give the same output.
 *
 * Cooldown and the backtest: the backtest counts an outbreak as found at the first
 * alert-day in or next to an affected ward. Live, that alert-day is SENT unless the
 * same ward already alerted in the previous cooldownDays days; then the ward is
 * already flagged and the alert is held back (so the officer is not emailed daily).
 */

export interface RunDetectorParams {
  method: DetectionMethod;
  detector: DetectorParams;
  classifier: ClassifierParams;
  /** A ward that alerted this many days ago or fewer does not alert again. */
  cooldownDays: number;
}

export const RUN_DETECTOR_PARAMS: RunDetectorParams = {
  method: RUN_DETECTOR.method,
  detector: { ...DETECTOR_PARAMS, bayesAlertProbability: RUN_DETECTOR.bayesAlertProbability },
  classifier: CLASSIFIER_PARAMS,
  cooldownDays: RUN_DETECTOR.cooldownDays,
};

/**
 * Everything runDetector remembers between days. Plain JSON: store it as is.
 * cusum has ONE record per ward and signal ("wardId:signal" -> { sum, nextDate }).
 */
export interface DetectorState {
  version: 1;
  method: DetectionMethod;
  /** The last day runDetector ran for. */
  lastRunDate: string | null;
  /** CUSUM running sums, only when method is "cusum". */
  cusum: cusum.CusumState | null;
  /** Last day each ward had a raw (detector) alert, sent or held back. Key: ward id. */
  lastAlertDate: Record<string, string>;
  /** Raw alert-days from the classifier's look-back window, used as its context. */
  recentAlerts: Array<{ wardId: number; date: string }>;
}

export function emptyDetectorState(method: DetectionMethod = RUN_DETECTOR_PARAMS.method): DetectorState {
  return { version: 1, method, lastRunDate: null, cusum: method === "cusum" ? cusum.emptyCusumState() : null, lastAlertDate: {}, recentAlerts: [] };
}

export interface RunDetectorResult {
  /** Alerts to send today, classified. evidence = the detector's reasons only. */
  alerts: Alert[];
  /** The classifier's reasons per sent alert, keyed by ward id (one alert per ward per day). -> AlertRecord.causeEvidence */
  causeEvidence: Record<string, string[]>;
  state: DetectorState;
  /** Wards that alerted today but were held back by the cooldown. */
  heldBack: number[];
}

/** Real rain is city-wide (the same value on every ward), so read it from one ward's rain rows. */
function rainUpTo(rows: SignalInput, today: string, city: CityModel, days: number): RainPoint[] {
  const view = viewAsOf(rows, today);
  const ward = city.wardIds()[0];
  const out: RainPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = addDays(today, -back);
    const mm = view.count(ward, "rain", date);
    if (mm !== undefined) out.push({ date, mm });
  }
  return out;
}

export function runDetector(
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: RunDetectorParams = RUN_DETECTOR_PARAMS,
  state: DetectorState = emptyDetectorState(params.method),
): RunDetectorResult {
  if (state.method !== params.method) throw new Error(`State is for ${state.method}, params ask for ${params.method}`);
  if (state.lastRunDate !== null && today <= state.lastRunDate) {
    throw new Error(`Already ran for ${state.lastRunDate}; runDetector must move forward one day at a time (got ${today})`);
  }
  const view = viewAsOf(rows, today);

  // 1. Detector.
  let raw: Alert[];
  let cusumState = state.cusum;
  if (params.method === "cusum") {
    const result = cusum.detect(view, today, city, params.detector, state.cusum ?? cusum.emptyCusumState());
    raw = result.alerts;
    cusumState = result.state;
  } else {
    raw = (params.method === "bayes" ? bayes.detect : threshold.detect)(view, today, city, params.detector).alerts;
  }

  // 2. Classifier, with the last two weeks of raw alerts as context.
  const contextFrom = addDays(today, -params.classifier.spreadWindowDays);
  const recent = state.recentAlerts.filter((a) => a.date >= contextFrom && a.date < today);
  const classified = classifyAlertsDetailed(raw, {
    city,
    rows: view,
    rain: rainUpTo(view, today, city, params.classifier.rainLookbackDays),
    recentAlerts: recent.map((a) => makeAlert({ ...a, method: params.method, score: 0, contributingSignals: [], evidence: [] })),
    params: params.classifier,
    detectorParams: params.detector,
  });

  // 3. Cooldown: hold back a ward that already alerted within cooldownDays days.
  const lastAlertDate = { ...state.lastAlertDate };
  const alerts: Alert[] = [];
  const causeEvidence: Record<string, string[]> = {};
  const heldBack: number[] = [];
  for (const { alert, causeEvidence: reasons } of classified) {
    const last = lastAlertDate[String(alert.wardId)];
    if (last !== undefined && daysBetween(last, today) <= params.cooldownDays) {
      heldBack.push(alert.wardId);
    } else {
      alerts.push(alert);
      causeEvidence[String(alert.wardId)] = reasons;
    }
    lastAlertDate[String(alert.wardId)] = today;
  }
  // Forget wards whose cooldown has passed, so the state stays small.
  for (const [ward, date] of Object.entries(lastAlertDate)) {
    if (daysBetween(date, today) > params.cooldownDays) delete lastAlertDate[ward];
  }

  return {
    alerts,
    causeEvidence,
    heldBack,
    state: {
      version: 1,
      method: params.method,
      lastRunDate: today,
      cusum: cusumState,
      lastAlertDate,
      recentAlerts: [...recent, ...raw.map((a) => ({ wardId: a.wardId, date: a.date }))],
    },
  };
}

/** One ward's current relative risk (GET /risk). */
export interface WardRisk {
  wardId: number;
  /** The fused Bayes chance of an outbreak (simulated health data). */
  probability: number;
  contributingSignals: Array<"complaint" | "pharmacy" | "hospital">;
}

/**
 * The Bayes chance of an outbreak for EVERY ward on `today` (for the map), using
 * exactly the same code path as runDetector's Bayes detector (bayes.assessWards;
 * no copy). It applies no alert line, no 2-signal rule and no cooldown, so it is
 * "relative risk", not an alert. Always the Bayes detector, whatever params.method is.
 * No future data: reads through a view fixed to `today`.
 */
export function wardRisk(
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: RunDetectorParams = RUN_DETECTOR_PARAMS,
): WardRisk[] {
  return bayes.assessWards(viewAsOf(rows, today), today, city, params.detector)
    .map(({ wardId, probability, contributingSignals }) => ({ wardId, probability, contributingSignals }));
}
