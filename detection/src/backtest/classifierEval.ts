import type { CityModel } from "../city.js";
import { classifyAlert } from "../classifier.js";
import { addDays } from "../dates.js";
import { makeAlert } from "../detectors/common.js";
import { BACKTEST, DATA_SPLIT, DETECTOR_PARAMS, SIMULATION, type DifficultyLevel } from "../params.js";
import { CLASSIFIER_PARAMS } from "../params.classifier.js";
import { simulate, type OutbreakAnswer, type OutbreakCause } from "../simulator.js";
import { CAUSE_TYPES, type Alert, type CauseType } from "../types.js";
import { calibrationCurve, chooseSetting, evaluateSplit, splitRange, spread } from "./evaluate.js";
import type { AlertDay } from "./episodes.js";
import { buildTraces, type DetectorTraces } from "./traces.js";
import { DIFFICULTIES, OUTBREAK_CAUSES, type Spread } from "./run.js";

/*
 * Cause classifier evaluation (decision 2 of 2026-10-06, docs/STATUS.md).
 *
 * For each seed and difficulty:
 *   1. Simulate 4 years. Calibrate the Bayes alert setting on the TUNING years
 *      only (same calibration as the backtest), for each false-alarm budget.
 *   2. Run Bayes on the TEST years with that locked setting.
 *   3. For every test-year outbreak, take its first matching alert-day (backtest
 *      matching rule v2) and classify it: "at first alert".
 *   4. Classify the same ward again 3 days later (CLASSIFY_AGAIN_AFTER_DAYS), with
 *      the alerts and rows known by then: "3 days after first alert".
 *   Correct = the top cause equals the true cause. Undetected outbreaks are "missed".
 * Classifier settings (CLASSIFIER_PARAMS) are not chosen here at all; they were
 * fixed beforehand. The only setting chosen is the detector's, on tuning years.
 * Context alerts never include anything after the day being classified.
 */

/** The second look. Team decision (2026-10-06): 3 days after the first alert. */
export const CLASSIFY_AGAIN_AFTER_DAYS = 3;
export type Timing = "firstAlert" | "plus3Days";
export const TIMINGS: Timing[] = ["firstAlert", "plus3Days"];

type Confusion = Record<OutbreakCause, Record<CauseType | "missed" | "pastEnd", number>>;

export interface ClassifierSeedResult {
  seed: number;
  difficulty: DifficultyLevel;
  budget: number;
  lockedSetting: number;
  outcomes: Array<{
    id: string;
    cause: OutbreakCause;
    detected: boolean;
    firstAlert: AlertDay | null;
    /** Top cause at each timing; null when missed (or when +3 days falls after the simulation). */
    predicted: Record<Timing, CauseType | null>;
    /** Water only: did the hint name the outbreak's true zone? */
    zoneRight: Record<Timing, boolean | null>;
  }>;
}

export interface ClassifierRow {
  difficulty: DifficultyLevel;
  budget: number;
  timing: Timing;
  cause: OutbreakCause | "all";
  /** Correct / classified, pooled over all seeds. */
  correct: number;
  classified: number;
  missed: number;
  pooledAccuracy: number | null;
  /** Accuracy per seed, then median and 10th-90th percentile across seeds. */
  accuracyAcrossSeeds: Spread;
  /** Water only: share of classified water outbreaks whose true zone was named. */
  zoneNamedShare: number | null;
}

export interface ClassifierResult {
  status: "FINAL" | "PRELIMINARY";
  city: string;
  seeds: number[];
  detector: "bayes";
  budgets: number[];
  classifyAgainAfterDays: number;
  rules: string;
  rows: ClassifierRow[];
  /** Pooled confusion (true cause -> predicted), per difficulty, budget and timing. */
  confusion: Array<{ difficulty: DifficultyLevel; budget: number; timing: Timing; table: Confusion }>;
  runs: ClassifierSeedResult[];
}

const topCause = (p: Record<CauseType, number>): CauseType => CAUSE_TYPES.reduce((b, c) => (p[c] > p[b] ? c : b));

function asAlert(day: AlertDay): Alert {
  return makeAlert({ wardId: day.wardId, date: day.date, method: "bayes", score: 0, contributingSignals: [], evidence: [] });
}

function classifyOn(
  wardId: number,
  date: string,
  outbreak: OutbreakAnswer,
  testAlerts: readonly AlertDay[],
  traces: DetectorTraces,
  city: CityModel,
  rain: Array<{ date: string; mm: number }>,
) {
  // Only alerts up to `date` (never later), in the classifier's look-back.
  const from = addDays(date, -CLASSIFIER_PARAMS.spreadWindowDays);
  const recent = testAlerts.filter((a) => a.date >= from && a.date <= date).map(asAlert);
  const hint = classifyAlert(asAlert({ wardId, date }), { city, rows: traces.index, rain, recentAlerts: recent });
  return { top: topCause(hint.causeProbs), zoneRight: outbreak.cause === "water" ? hint.suspectedZoneId === outbreak.zoneId : null };
}

export function evaluateClassifierOnce(city: CityModel, seed: number, difficulty: DifficultyLevel): ClassifierSeedResult[] {
  const sim = simulate({ city, seed, difficulty });
  const traces = buildTraces(sim, city, DETECTOR_PARAMS);
  const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
  const test = splitRange(traces.dates, "test", DATA_SPLIT.testYears);
  const curve = calibrationCurve("bayes", traces, tuning, sim.answerKey.outbreaks.filter((o) => o.split === "tuning"), city);
  const testOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "test");
  const lastDate = traces.dates[test.to];

  return BACKTEST.falseAlarmBudgets.map((budget) => {
    const { setting } = chooseSetting(curve, budget);
    const testAlerts = traces.alertDays("bayes", setting, test.from, test.to);
    const evaluation = evaluateSplit(testAlerts, testOutbreaks, city, test.years);
    const outcomes = evaluation.outbreaks.map((o) => {
      const outbreak = testOutbreaks.find((x) => x.id === o.id)!;
      const predicted: Record<Timing, CauseType | null> = { firstAlert: null, plus3Days: null };
      const zoneRight: Record<Timing, boolean | null> = { firstAlert: null, plus3Days: null };
      if (o.firstAlert) {
        const first = classifyOn(o.firstAlert.wardId, o.firstAlert.date, outbreak, testAlerts, traces, city, sim.rain);
        predicted.firstAlert = first.top;
        zoneRight.firstAlert = first.zoneRight;
        const later = addDays(o.firstAlert.date, CLASSIFY_AGAIN_AFTER_DAYS);
        if (later <= lastDate) {
          const again = classifyOn(o.firstAlert.wardId, later, outbreak, testAlerts, traces, city, sim.rain);
          predicted.plus3Days = again.top;
          zoneRight.plus3Days = again.zoneRight;
        }
      }
      return { id: o.id, cause: o.cause, detected: o.detected, firstAlert: o.firstAlert, predicted, zoneRight };
    });
    return { seed, difficulty, budget, lockedSetting: setting, outcomes };
  });
}

function emptyConfusion(): Confusion {
  return Object.fromEntries(OUTBREAK_CAUSES.map((c) => [c, { water: 0, food: 0, p2p: 0, seasonal: 0, unknown: 0, missed: 0, pastEnd: 0 }])) as Confusion;
}

export function summariseClassifier(runs: ClassifierSeedResult[]): Pick<ClassifierResult, "rows" | "confusion"> {
  const rows: ClassifierRow[] = [];
  const confusion: ClassifierResult["confusion"] = [];
  for (const difficulty of DIFFICULTIES) {
    for (const budget of BACKTEST.falseAlarmBudgets) {
      const group = runs.filter((r) => r.difficulty === difficulty && r.budget === budget);
      if (group.length === 0) continue;
      for (const timing of TIMINGS) {
        const table = emptyConfusion();
        for (const run of group) {
          for (const o of run.outcomes) {
            if (!o.detected) table[o.cause].missed++;
            else if (o.predicted[timing] === null) table[o.cause].pastEnd++;
            else table[o.cause][o.predicted[timing]!]++;
          }
        }
        confusion.push({ difficulty, budget, timing, table });
        for (const cause of [...OUTBREAK_CAUSES, "all"] as const) {
          const pick = (run: ClassifierSeedResult) =>
            run.outcomes.filter((o) => (cause === "all" || o.cause === cause) && o.predicted[timing] !== null);
          const perSeed = group.map(pick).filter((list) => list.length > 0)
            .map((list) => list.filter((o) => o.predicted[timing] === o.cause).length / list.length);
          const classified = group.flatMap(pick);
          const correct = classified.filter((o) => o.predicted[timing] === o.cause).length;
          const water = classified.filter((o) => o.cause === "water");
          rows.push({
            difficulty,
            budget,
            timing,
            cause,
            correct,
            classified: classified.length,
            missed: group.flatMap((r) => r.outcomes.filter((o) => (cause === "all" || o.cause === cause) && !o.detected)).length,
            pooledAccuracy: classified.length > 0 ? correct / classified.length : null,
            accuracyAcrossSeeds: spread(perSeed),
            zoneNamedShare: (cause === "water" || cause === "all") && water.length > 0
              ? water.filter((o) => o.zoneRight[timing]).length / water.length
              : null,
          });
        }
      }
    }
  }
  return { rows, confusion };
}

export function evaluateClassifier(options: {
  city: CityModel;
  cityName: string;
  seedCount: number;
  preliminary: boolean;
  difficulties?: DifficultyLevel[];
  onProgress?: (message: string) => void;
}): ClassifierResult {
  const seeds = Array.from({ length: options.seedCount }, (_, i) => SIMULATION.randomSeed + i);
  const runs: ClassifierSeedResult[] = [];
  for (const difficulty of options.difficulties ?? DIFFICULTIES) {
    for (const seed of seeds) {
      const started = Date.now();
      runs.push(...evaluateClassifierOnce(options.city, seed, difficulty));
      options.onProgress?.(`${difficulty} seed ${seed} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }
  return {
    status: options.preliminary ? "PRELIMINARY" : "FINAL",
    city: options.cityName,
    seeds,
    detector: "bayes",
    budgets: [...BACKTEST.falseAlarmBudgets],
    classifyAgainAfterDays: CLASSIFY_AGAIN_AFTER_DAYS,
    rules: "Bayes setting calibrated on tuning years 2022-2023 only (per budget); test years 2024-2025 only; " +
      "first matching alert-day per outbreak (backtest rule v2); classifier settings fixed beforehand",
    ...summariseClassifier(runs),
    runs,
  };
}
