import type { CityModel } from "../city.js";
import {
  ALERT_MATCH_GRACE_DAYS,
  BACKTEST,
  DATA_SPLIT,
  DETECTOR_PARAMS,
  SIMULATION,
  type DetectorParams,
  type DifficultyLevel,
} from "../params.js";
import { simulate, type OutbreakCause } from "../simulator.js";
import { DETECTION_METHODS, type DetectionMethod } from "../types.js";
import { calibrationCurve, chooseSetting, evaluateSplit, splitRange, spread, type Calibration, type CalibrationPoint, type SplitEvaluation } from "./evaluate.js";
import { buildTraces } from "./traces.js";

/*
 * The backtest: for every seed and difficulty, simulate 4 years; for every
 * method and false-alarm budget, calibrate on the tuning years, lock the
 * setting, run it once on the test years; then summarise across seeds.
 * Rules: docs/STATUS.md.
 */

export const DIFFICULTIES: DifficultyLevel[] = ["easy", "realistic", "hard"];
export const OUTBREAK_CAUSES: OutbreakCause[] = ["water", "food", "p2p", "seasonal"];
/** "all" = every outbreak of that cause; "outsideWave" = local outbreaks whose days do not touch the seasonal wave. */
export type OutbreakSubset = "all" | "outsideWave";

export interface MethodRun {
  method: DetectionMethod;
  budget: number;
  calibration: Calibration;
  test: SplitEvaluation;
}

export interface SingleRun {
  seed: number;
  difficulty: DifficultyLevel;
  /** One entry per method and budget. */
  results: MethodRun[];
  /** Tuning curve per method (the same curve serves every budget). */
  curves: Record<DetectionMethod, CalibrationPoint[]>;
}

export type Spread = ReturnType<typeof spread>;

export interface SummaryRow {
  method: DetectionMethod;
  difficulty: DifficultyLevel;
  budget: number;
  cause: OutbreakCause;
  subset: OutbreakSubset;
  /** Share of this cause's test-year outbreaks detected, across seeds. */
  detectionRate: Spread;
  /** Per seed: median delay in days of the detected ones; then spread across seeds. */
  medianDelayDays: Spread;
  outbreaksPerSeed: number;
}

export interface FalseAlarmRow {
  method: DetectionMethod;
  difficulty: DifficultyLevel;
  budget: number;
  /** Test-year false-alarm episodes per ward-year, wave counted as an outbreak. */
  waveCounted: Spread;
  /** Same, with only local outbreaks able to clear an episode. */
  waveExcluded: Spread;
  /** Locked alert setting, across seeds. */
  lockedSetting: Spread;
  /** Seeds where no grid value met the budget on tuning years. */
  budgetMissedSeeds: number;
}

export interface FusionFlag {
  difficulty: DifficultyLevel;
  budget: number;
  cause: OutbreakCause;
  subset: OutbreakSubset;
  simplerMethod: "threshold" | "cusum";
  text: string;
}

/** Chance level for one method, difficulty, budget and outbreak type (added by `npm run add-chance`). */
export interface ChanceRow {
  method: DetectionMethod;
  difficulty: DifficultyLevel;
  budget: number;
  cause: OutbreakCause;
  status: "computed" | "not computed";
  /** Share of phantom (no-outbreak) windows "detected", per seed, then spread across seeds. null = not computed. */
  phantomDetectionRate: Spread;
  phantomsPerSeed: number;
  note: string | null;
}

export interface BacktestResult {
  status: "FINAL" | "PRELIMINARY";
  preliminary: boolean;
  city: string;
  wardCount: number;
  seeds: number[];
  difficulties: DifficultyLevel[];
  rules: {
    matchingRule: string;
    tuningYears: number[];
    testYears: number[];
    falseAlarmBudgets: number[];
    episodeGapDays: number;
    matchGraceDays: number;
    calibratedOn: string;
  };
  summary: SummaryRow[];
  falseAlarms: FalseAlarmRow[];
  fusionDoesNotHelp: FusionFlag[];
  /** Chance level per method, difficulty, budget and outbreak type, same seeds. Added after the run by `npm run add-chance`. */
  chanceCheck?: { method: string; seeds: number[]; rows: ChanceRow[] };
  runs: SingleRun[];
}

const median = (values: number[]) => spread(values)?.median ?? null;

export function runOne(city: CityModel, seed: number, difficulty: DifficultyLevel, params: DetectorParams = DETECTOR_PARAMS): SingleRun {
  const sim = simulate({ city, seed, difficulty });
  const traces = buildTraces(sim, city, params);
  const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
  const test = splitRange(traces.dates, "test", DATA_SPLIT.testYears);
  const tuningOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "tuning");
  const testOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "test");

  const results: MethodRun[] = [];
  const curves = {} as SingleRun["curves"];
  for (const method of DETECTION_METHODS) {
    const curve = calibrationCurve(method, traces, tuning, tuningOutbreaks, city);
    curves[method] = curve;
    for (const budget of BACKTEST.falseAlarmBudgets) {
      const chosen = chooseSetting(curve, budget);
      const calibration: Calibration = {
        method,
        budget,
        setting: chosen.setting,
        tuningFalseAlarmRate: chosen.falseAlarmRate,
        budgetReached: chosen.budgetReached,
        datesUsed: { from: traces.dates[tuning.from], to: traces.dates[tuning.to] },
      };
      // The one and only test-year run for this method and budget, with the locked setting.
      const testEvaluation = evaluateSplit(traces.alertDays(method, chosen.setting, test.from, test.to), testOutbreaks, city, test.years);
      results.push({ method, budget, calibration, test: testEvaluation });
    }
  }
  return { seed, difficulty, results, curves };
}

export function summarise(runs: SingleRun[]): Pick<BacktestResult, "summary" | "falseAlarms" | "fusionDoesNotHelp"> {
  const summary: SummaryRow[] = [];
  const falseAlarms: FalseAlarmRow[] = [];
  for (const difficulty of DIFFICULTIES) {
    const atLevel = runs.filter((r) => r.difficulty === difficulty);
    if (atLevel.length === 0) continue;
    for (const budget of BACKTEST.falseAlarmBudgets) {
      for (const method of DETECTION_METHODS) {
        const methodRuns = atLevel.map((r) => r.results.find((m) => m.method === method && m.budget === budget)!);
        falseAlarms.push({
          method,
          difficulty,
          budget,
          waveCounted: spread(methodRuns.map((m) => m.test.falseAlarmRateWaveCounted)),
          waveExcluded: spread(methodRuns.map((m) => m.test.falseAlarmRateWaveExcluded)),
          lockedSetting: spread(methodRuns.map((m) => m.calibration.setting)),
          budgetMissedSeeds: methodRuns.filter((m) => !m.calibration.budgetReached).length,
        });
        for (const cause of OUTBREAK_CAUSES) {
          const subsets: OutbreakSubset[] = cause === "seasonal" ? ["all"] : ["all", "outsideWave"];
          for (const subset of subsets) {
            const perSeed = methodRuns.map((m) =>
              m.test.outbreaks.filter((o) => o.cause === cause && (subset === "all" || !o.overlapsWave)));
            const withOutbreaks = perSeed.filter((list) => list.length > 0);
            summary.push({
              method,
              difficulty,
              budget,
              cause,
              subset,
              detectionRate: spread(withOutbreaks.map((list) => list.filter((o) => o.detected).length / list.length)),
              medianDelayDays: spread(
                withOutbreaks
                  .map((list) => median(list.flatMap((o) => (o.delayDays === null ? [] : [o.delayDays]))))
                  .filter((d): d is number => d !== null),
              ),
              outbreaksPerSeed: median(perSeed.map((list) => list.length)) ?? 0,
            });
          }
        }
      }
    }
  }
  return { summary, falseAlarms, fusionDoesNotHelp: fusionFlags(summary, falseAlarms) };
}

/** Rule from docs/STATUS.md: a simpler method with detection rate >= Bayes AND delay <= Bayes (or Bayes detects none). */
function fusionFlags(summary: SummaryRow[], falseAlarms: FalseAlarmRow[]): FusionFlag[] {
  const flags: FusionFlag[] = [];
  const fmt = (value: number | undefined | null, digits = 2) => (value === undefined || value === null ? "n/a" : value.toFixed(digits));
  for (const bayes of summary.filter((r) => r.method === "bayes")) {
    if (!bayes.detectionRate) continue;
    const fa = (method: DetectionMethod) =>
      falseAlarms.find((r) => r.method === method && r.difficulty === bayes.difficulty && r.budget === bayes.budget)?.waveCounted?.median;
    for (const simpler of ["threshold", "cusum"] as const) {
      const other = summary.find((r) => r.method === simpler && r.difficulty === bayes.difficulty && r.budget === bayes.budget &&
        r.cause === bayes.cause && r.subset === bayes.subset);
      if (!other?.detectionRate) continue;
      const bayesDelay = bayes.medianDelayDays?.median;
      const otherDelay = other.medianDelayDays?.median;
      const rateOk = other.detectionRate.median >= bayes.detectionRate.median;
      const delayOk = bayesDelay === undefined || (otherDelay !== undefined && otherDelay <= bayesDelay);
      if (!rateOk || !delayOk) continue;
      const scope = bayes.subset === "outsideWave" ? " (outside the wave)" : "";
      flags.push({
        difficulty: bayes.difficulty,
        budget: bayes.budget,
        cause: bayes.cause,
        subset: bayes.subset,
        simplerMethod: simpler,
        text: `fusion does not help here: ${bayes.cause}${scope}, ${bayes.difficulty}, budget ${bayes.budget}: ${simpler} detects ` +
          `${fmt(other.detectionRate.median * 100, 0)}% (median delay ${fmt(otherDelay, 1)} d, false alarms ${fmt(fa(simpler))}/ward-yr) ` +
          `vs bayes ${fmt(bayes.detectionRate.median * 100, 0)}% (median delay ${fmt(bayesDelay, 1)} d, false alarms ${fmt(fa("bayes"))}/ward-yr)`,
      });
    }
  }
  return flags;
}

export interface BacktestOptions {
  city: CityModel;
  cityName: string;
  seedCount: number;
  preliminary: boolean;
  difficulties?: DifficultyLevel[];
  onProgress?: (message: string) => void;
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const seeds = Array.from({ length: options.seedCount }, (_, i) => SIMULATION.randomSeed + i);
  const difficulties = options.difficulties ?? DIFFICULTIES;
  const runs: SingleRun[] = [];
  for (const difficulty of difficulties) {
    for (const seed of seeds) {
      const started = Date.now();
      runs.push(runOne(options.city, seed, difficulty));
      options.onProgress?.(`${difficulty} seed ${seed} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  }
  return {
    status: options.preliminary ? "PRELIMINARY" : "FINAL",
    preliminary: options.preliminary,
    city: options.cityName,
    wardCount: options.city.wardIds().length,
    seeds,
    difficulties,
    rules: {
      matchingRule: "v2: detected at the first alert-day in an affected ward or a neighbour, from true start to true end + grace; " +
        "false alarm = an episode with no matching alert-day",
      tuningYears: DATA_SPLIT.tuningYears,
      testYears: DATA_SPLIT.testYears,
      falseAlarmBudgets: [...BACKTEST.falseAlarmBudgets],
      episodeGapDays: BACKTEST.episodeGapDays,
      matchGraceDays: ALERT_MATCH_GRACE_DAYS,
      calibratedOn: "tuning years only; false alarms with the seasonal wave counted as an outbreak",
    },
    ...summarise(runs),
    runs,
  };
}
