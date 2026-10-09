import type { CityModel } from "../city.js";
import { addDays, daysBetween } from "../dates.js";
import { ALERT_MATCH_GRACE_DAYS, BACKTEST } from "../params.js";
import type { OutbreakAnswer } from "../simulator.js";
import type { DetectionMethod } from "../types.js";
import { groupEpisodes, type AlertDay } from "./episodes.js";
import type { DetectorTraces } from "./traces.js";

/*
 * MATCHING RULE, version 2 (2026-10-06, after the preliminary look; see
 * docs/STATUS.md, "Changes after preliminary look". Version 1 needed an
 * EPISODE to start after the outbreak, so an outbreak inside a long earlier
 * episode, such as the seasonal wave, was wrongly counted as missed.)
 *
 * An alert-day MATCHES an outbreak if
 *   1. its date is on or after the outbreak's true start and on or before its
 *      true end + ALERT_MATCH_GRACE_DAYS, and
 *   2. its ward is an affected ward of the outbreak or a neighbour of one.
 * Detected = at least one matching alert-day. Delay = the FIRST matching
 * alert-day - true start. Episode start times no longer matter for detection.
 * False alarm = an EPISODE containing no alert-day that matches any outbreak.
 * It is counted twice: with the seasonal wave counted as an outbreak, and with
 * the wave excluded (then only local outbreaks can clear an episode).
 * Local outbreaks are also reported for only those NOT overlapping the wave
 * (their true start..end does not touch the wave's true start..end).
 */

export interface OutbreakOutcome {
  id: string;
  cause: OutbreakAnswer["cause"];
  detected: boolean;
  /** Days from true start to the first matching alert-day; null if not detected. */
  delayDays: number | null;
  /** First matching alert-day, if any. */
  firstAlert: AlertDay | null;
  /** True if this local outbreak's days touch the seasonal wave's days. Always false for the wave itself. */
  overlapsWave: boolean;
}

export interface SplitEvaluation {
  episodes: number;
  /** False-alarm episodes when the seasonal wave counts as an outbreak. */
  falseAlarmsWaveCounted: number;
  /** False-alarm episodes when only local outbreaks count (the wave does not clear an episode). */
  falseAlarmsWaveExcluded: number;
  /** Per ward per year. */
  falseAlarmRateWaveCounted: number;
  falseAlarmRateWaveExcluded: number;
  outbreaks: OutbreakOutcome[];
}

/** One split's days, as indexes into the trace dates. */
export interface SplitRange {
  name: "tuning" | "test";
  from: number;
  to: number;
  years: number;
}

export function splitRange(dates: string[], name: "tuning" | "test", years: number[]): SplitRange {
  const inSplit = dates.map((date, i) => [date, i] as const).filter(([date]) => years.includes(Number(date.slice(0, 4))));
  if (inSplit.length === 0) throw new RangeError(`No dates in the ${name} years ${years.join(", ")}`);
  return { name, from: inSplit[0][1], to: inSplit.at(-1)![1], years: years.length };
}

/** Last day an alert can match this outbreak. */
const lastMatchDate = (outbreak: OutbreakAnswer) => addDays(outbreak.endDate, ALERT_MATCH_GRACE_DAYS);

/** For each ward: the outbreaks an alert in that ward could match (affected ward or neighbour of one). */
function windowsByWard(outbreaks: readonly OutbreakAnswer[], city: CityModel) {
  const byWard = new Map<number, Array<{ index: number; from: string; to: string; local: boolean }>>();
  outbreaks.forEach((outbreak, index) => {
    const wards = new Set<number>();
    for (const { wardId } of outbreak.affectedWards) {
      wards.add(wardId);
      for (const neighbour of city.getNeighbours(wardId)) wards.add(neighbour);
    }
    const window = { index, from: outbreak.startDate, to: lastMatchDate(outbreak), local: outbreak.cause !== "seasonal" };
    for (const ward of wards) {
      const list = byWard.get(ward);
      if (list) list.push(window);
      else byWard.set(ward, [window]);
    }
  });
  return byWard;
}

/** Does this alert-day match this outbreak? (The rule above, for one pair; used by tests and docs.) */
export function alertMatches(alert: AlertDay, outbreak: OutbreakAnswer, city: CityModel): boolean {
  const near = outbreak.affectedWards.some(({ wardId }) => wardId === alert.wardId || city.getNeighbours(wardId).includes(alert.wardId));
  return near && alert.date >= outbreak.startDate && alert.date <= lastMatchDate(outbreak);
}

/** True if a local outbreak's true days touch any seasonal wave's true days. */
export function overlapsWave(outbreak: OutbreakAnswer, all: readonly OutbreakAnswer[]): boolean {
  if (outbreak.cause === "seasonal") return false;
  return all.some((w) => w.cause === "seasonal" && outbreak.startDate <= w.endDate && outbreak.endDate >= w.startDate);
}

/** Scores one split. `outbreaks` must already be only this split's outbreaks. */
export function evaluateSplit(
  alerts: readonly AlertDay[],
  outbreaks: readonly OutbreakAnswer[],
  city: CityModel,
  years: number,
): SplitEvaluation {
  const groups = groupEpisodes(alerts, city, BACKTEST.episodeGapDays);
  const byWard = windowsByWard(outbreaks, city);
  const first: Array<AlertDay | null> = outbreaks.map(() => null);

  let falseAlarmsWaveCounted = 0;
  let falseAlarmsWaveExcluded = 0;
  for (const group of groups) {
    let matchesAny = false;
    let matchesLocal = false;
    for (const alert of group) {
      for (const window of byWard.get(alert.wardId) ?? []) {
        if (alert.date < window.from || alert.date > window.to) continue;
        matchesAny = true;
        if (window.local) matchesLocal = true;
        const current = first[window.index];
        if (!current || alert.date < current.date || (alert.date === current.date && alert.wardId < current.wardId)) {
          first[window.index] = alert;
        }
      }
    }
    if (!matchesAny) falseAlarmsWaveCounted++;
    if (!matchesLocal) falseAlarmsWaveExcluded++;
  }

  const wardYears = city.wardIds().length * years;
  return {
    episodes: groups.length,
    falseAlarmsWaveCounted,
    falseAlarmsWaveExcluded,
    falseAlarmRateWaveCounted: falseAlarmsWaveCounted / wardYears,
    falseAlarmRateWaveExcluded: falseAlarmsWaveExcluded / wardYears,
    outbreaks: outbreaks.map((o, i) => ({
      id: o.id,
      cause: o.cause,
      detected: first[i] !== null,
      delayDays: first[i] ? daysBetween(o.startDate, first[i]!.date) : null,
      firstAlert: first[i],
      overlapsWave: overlapsWave(o, outbreaks),
    })),
  };
}

export interface CalibrationPoint {
  setting: number;
  falseAlarmRate: number;
}

export interface Calibration {
  method: DetectionMethod;
  /** The false-alarm budget this setting was chosen for. */
  budget: number;
  /** The locked alert setting. */
  setting: number;
  /** Tuning-year false alarms per ward-year at that setting (wave counted as an outbreak). */
  tuningFalseAlarmRate: number;
  /** False if no grid value got under budget (then the strictest value is used). */
  budgetReached: boolean;
  /** First and last date calibration looked at. Both are in the tuning years. */
  datesUsed: { from: string; to: string };
}

/**
 * Tuning-year false-alarm rate (wave counted as an outbreak) for every grid value.
 * Reads only alerts inside `tuning` and only the tuning outbreaks it is given.
 */
export function calibrationCurve(
  method: DetectionMethod,
  traces: DetectorTraces,
  tuning: SplitRange,
  tuningOutbreaks: readonly OutbreakAnswer[],
  city: CityModel,
  grid: readonly number[] = BACKTEST.grids[method],
): CalibrationPoint[] {
  if (tuningOutbreaks.some((o) => o.split !== "tuning")) throw new Error("Calibration was given a test-year outbreak");
  return [...grid].sort((a, b) => a - b).map((setting) => ({
    setting,
    falseAlarmRate: evaluateSplit(traces.alertDays(method, setting, tuning.from, tuning.to), tuningOutbreaks, city, tuning.years)
      .falseAlarmRateWaveCounted,
  }));
}

/**
 * Picks the setting whose tuning false-alarm rate is closest to the budget without
 * going over (ties: the more sensitive, i.e. lower, setting). If none is under
 * budget, the strictest setting, flagged budgetReached: false.
 */
export function chooseSetting(curve: readonly CalibrationPoint[], budget: number): { setting: number; falseAlarmRate: number; budgetReached: boolean } {
  const underBudget = curve.filter((point) => point.falseAlarmRate <= budget);
  const chosen = underBudget.length > 0
    ? underBudget.reduce((best, point) => (point.falseAlarmRate > best.falseAlarmRate ? point : best))
    : curve.at(-1)!;
  return { setting: chosen.setting, falseAlarmRate: chosen.falseAlarmRate, budgetReached: underBudget.length > 0 };
}

/** Curve + choice for one budget. */
export function calibrate(
  method: DetectionMethod,
  traces: DetectorTraces,
  tuning: SplitRange,
  tuningOutbreaks: readonly OutbreakAnswer[],
  city: CityModel,
  budget: number,
  grid: readonly number[] = BACKTEST.grids[method],
): Calibration & { curve: CalibrationPoint[] } {
  const curve = calibrationCurve(method, traces, tuning, tuningOutbreaks, city, grid);
  const chosen = chooseSetting(curve, budget);
  return {
    method,
    budget,
    setting: chosen.setting,
    tuningFalseAlarmRate: chosen.falseAlarmRate,
    budgetReached: chosen.budgetReached,
    datesUsed: { from: traces.dates[tuning.from], to: traces.dates[tuning.to] },
    curve,
  };
}

/** Median and 10th / 90th percentiles (linear interpolation). null for an empty list. */
export function spread(values: readonly number[]): { median: number; p10: number; p90: number; n: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    const pos = q * (sorted.length - 1);
    const low = Math.floor(pos);
    const high = Math.ceil(pos);
    return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
  };
  return { median: at(0.5), p10: at(0.1), p90: at(0.9), n: values.length };
}
