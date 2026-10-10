import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { phantoms, CHANCE_SHIFT_STEP_DAYS } from "../src/backtest/chance.js";
import { calibrationCurve, chooseSetting, evaluateSplit, splitRange, spread } from "../src/backtest/evaluate.js";
import { DIFFICULTIES, OUTBREAK_CAUSES, type BacktestResult, type ChanceRow } from "../src/backtest/run.js";
import { buildTraces } from "../src/backtest/traces.js";
import { GridCity, RealCity, type CityModel } from "../src/city.js";
import { BACKTEST, DATA_SPLIT, DETECTOR_PARAMS } from "../src/params.js";
import { simulate } from "../src/simulator.js";
import { DETECTION_METHODS } from "../src/types.js";

/*
 * npm run add-chance: adds the chance level per method, difficulty, outbreak type
 * and budget to results/backtest.json, using the SAME seeds as that file (decision
 * of 2026-10-06). It changes nothing else:
 *   - for every seed it recomputes the locked setting and every real test-year
 *     outcome and STOPS if any differs from what results/backtest.json holds;
 *   - it writes the file only if, with chanceCheck removed, the new file equals the old.
 */

const PATH = "results/backtest.json";
const old = JSON.parse(readFileSync(PATH, "utf8")) as BacktestResult & { chanceCheck?: unknown };
const { chanceCheck: _previous, ...oldWithout } = old;
const city: CityModel = old.city === "real" ? RealCity.fromFile() : new GridCity();

type PerSeed = { difficulty: string; seed: number; method: string; budget: number; cause: string; phantoms: number; detected: number };
const perSeed: PerSeed[] = [];
let checked = 0;

for (const difficulty of old.difficulties) {
  for (const seed of old.seeds) {
    const started = Date.now();
    const sim = simulate({ city, seed, difficulty });
    const traces = buildTraces(sim, city, DETECTOR_PARAMS);
    const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
    const test = splitRange(traces.dates, "test", DATA_SPLIT.testYears);
    const testOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "test");
    const fake = phantoms(testOutbreaks, city, traces.dates[test.from], traces.dates[test.to]);
    const stored = old.runs.find((r) => r.seed === seed && r.difficulty === difficulty);
    if (!stored) throw new Error(`No stored run for ${difficulty} seed ${seed}`);
    for (const method of DETECTION_METHODS) {
      const curve = calibrationCurve(method, traces, tuning, sim.answerKey.outbreaks.filter((o) => o.split === "tuning"), city);
      for (const budget of BACKTEST.falseAlarmBudgets) {
        const { setting } = chooseSetting(curve, budget);
        const alerts = traces.alertDays(method, setting, test.from, test.to);
        // Identity check against the stored FINAL run.
        const storedRun = stored.results.find((m) => m.method === method && m.budget === budget)!;
        const real = evaluateSplit(alerts, testOutbreaks, city, test.years);
        if (storedRun.calibration.setting !== setting || !isDeepStrictEqual(JSON.parse(JSON.stringify(real)), storedRun.test)) {
          throw new Error(`Recomputed result differs from ${PATH}: ${difficulty} seed ${seed} ${method} budget ${budget}. Not writing.`);
        }
        checked++;
        const fakeEval = evaluateSplit(alerts, fake, city, test.years).outbreaks;
        for (const cause of OUTBREAK_CAUSES) {
          const ofCause = fakeEval.filter((o) => o.cause === cause);
          perSeed.push({ difficulty, seed, method, budget, cause, phantoms: ofCause.length, detected: ofCause.filter((o) => o.detected).length });
        }
      }
    }
    console.error(`  ${difficulty} seed ${seed}: identical to stored run; ${fake.length} phantoms (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

const rows: ChanceRow[] = [];
for (const difficulty of DIFFICULTIES) {
  for (const budget of BACKTEST.falseAlarmBudgets) {
    for (const method of DETECTION_METHODS) {
      for (const cause of OUTBREAK_CAUSES) {
        const group = perSeed.filter((r) => r.difficulty === difficulty && r.budget === budget && r.method === method && r.cause === cause);
        const withPhantoms = group.filter((r) => r.phantoms > 0);
        const rate = spread(withPhantoms.map((r) => r.detected / r.phantoms));
        rows.push({
          method, difficulty, budget, cause,
          status: rate ? "computed" : "not computed",
          phantomDetectionRate: rate,
          phantomsPerSeed: spread(group.map((r) => r.phantoms))?.median ?? 0,
          note: cause === "seasonal" ? "not computed: the seasonal wave touches every ward, so it has no place where nothing happens" : null,
        });
      }
    }
  }
}

const updated = { ...oldWithout, chanceCheck: {
  method: "Phantom outbreaks: each test-year local outbreak is moved in time (steps of " + CHANCE_SHIFT_STEP_DAYS +
    " days, nearest first) to a window where no real outbreak or the seasonal wave touches its wards; the locked test-year alerts " +
    "are scored against the phantoms with the unchanged matching rule. A phantom 'detection' is chance.",
  seeds: old.seeds,
  rows,
} };
// Everything except chanceCheck must be exactly the same as before.
const { chanceCheck: _added, ...newWithout } = updated;
if (!isDeepStrictEqual(newWithout, oldWithout)) throw new Error("Something other than chanceCheck changed. Not writing.");
writeFileSync(PATH, JSON.stringify(updated, null, 1) + "\n");

const lines = ["CHANCE LEVEL PER OUTBREAK TYPE (phantom detection rate, median [10th-90th] over " + old.seeds.length + " seeds)",
  "budget  difficulty  method      water              food               p2p                seasonal"];
const fmt = (r: ChanceRow) => (r.phantomDetectionRate
  ? `${(r.phantomDetectionRate.median * 100).toFixed(0)}% [${(r.phantomDetectionRate.p10 * 100).toFixed(0)}-${(r.phantomDetectionRate.p90 * 100).toFixed(0)}]`
  : "not computed");
for (const budget of BACKTEST.falseAlarmBudgets) for (const difficulty of DIFFICULTIES) for (const method of DETECTION_METHODS) {
  const cell = (cause: string) => fmt(rows.find((r) => r.budget === budget && r.difficulty === difficulty && r.method === method && r.cause === cause)!).padEnd(18);
  lines.push(`${String(budget).padEnd(7)} ${difficulty.padEnd(11)} ${method.padEnd(10)}  ${OUTBREAK_CAUSES.map(cell).join(" ")}`);
}
writeFileSync("results/chance-by-type.txt", lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nverified ${checked} method/budget runs identical to the stored FINAL results; added chanceCheck to ${PATH}; wrote results/chance-by-type.txt`);
