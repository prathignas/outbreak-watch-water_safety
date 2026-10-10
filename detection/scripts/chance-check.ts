import { mkdirSync, writeFileSync } from "node:fs";
import { calibrationCurve, chooseSetting, evaluateSplit, splitRange, spread } from "../src/backtest/evaluate.js";
import { buildTraces } from "../src/backtest/traces.js";
import { DIFFICULTIES } from "../src/backtest/run.js";
import { GridCity, RealCity, type CityModel } from "../src/city.js";
import { BACKTEST, DATA_SPLIT, DETECTOR_PARAMS, SIMULATION } from "../src/params.js";
import { simulate } from "../src/simulator.js";
import { DETECTION_METHODS } from "../src/types.js";
import { phantoms } from "../src/backtest/chance.js";

/*
 * Chance check (a diagnostic added 2026-10-06; it does NOT change any rule or result).
 *
 * Question: how often would the matching rule "detect" an outbreak that is NOT there?
 * For each test-year local outbreak we make a PHANTOM: the same wards and the same
 * length, moved in time to a window where no real outbreak (including the seasonal
 * wave) touches any of its match wards (affected wards and their neighbours). We then
 * score the locked detectors' test-year alerts against the phantoms with the same
 * matching rule. A phantom "detection" can only be chance: noise or harmless surges.
 *   npx tsx scripts/chance-check.ts --city real --seeds 5
 * Phantom shifts are tried in steps of CHANCE_SHIFT_STEP_DAYS, nearest first.
 */

function argOf(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

try {
  const cityName = argOf("city") ?? "real";
  const seedCount = Number(argOf("seeds") ?? 5);
  const city: CityModel = cityName === "real" ? RealCity.fromFile() : new GridCity();
  const rows: Array<Record<string, unknown>> = [];
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < seedCount; i++) {
      const seed = SIMULATION.randomSeed + i;
      const sim = simulate({ city, seed, difficulty });
      const traces = buildTraces(sim, city, DETECTOR_PARAMS);
      const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
      const test = splitRange(traces.dates, "test", DATA_SPLIT.testYears);
      const testOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "test");
      const fake = phantoms(testOutbreaks, city, traces.dates[test.from], traces.dates[test.to]);
      for (const method of DETECTION_METHODS) {
        const curve = calibrationCurve(method, traces, tuning, sim.answerKey.outbreaks.filter((o) => o.split === "tuning"), city);
        for (const budget of BACKTEST.falseAlarmBudgets) {
          const { setting } = chooseSetting(curve, budget);
          const alerts = traces.alertDays(method, setting, test.from, test.to);
          const realEval = evaluateSplit(alerts, testOutbreaks, city, test.years).outbreaks.filter((o) => o.cause !== "seasonal");
          const fakeEval = evaluateSplit(alerts, fake, city, test.years).outbreaks;
          rows.push({
            difficulty, seed, method, budget,
            realDetected: realEval.filter((o) => o.detected).length / realEval.length,
            realDetectedByDay1: realEval.filter((o) => o.delayDays !== null && o.delayDays <= 1).length / realEval.length,
            phantoms: fake.length,
            phantomDetected: fake.length > 0 ? fakeEval.filter((o) => o.detected).length / fake.length : null,
          });
        }
      }
      console.error(`  ${difficulty} seed ${seed}: ${fake.length} phantoms`);
    }
  }
  console.log(`CHANCE CHECK (diagnostic): ${cityName} city, ${seedCount} seeds, test years, locked settings, same matching rule`);
  console.log("share of LOCAL outbreaks detected: real outbreaks vs phantom (no-outbreak) windows of the same size; median across seeds");
  console.log("  budget  difficulty  method      real detected  real by day 1  phantom 'detected' (chance)");
  const summary: Array<Record<string, unknown>> = [];
  for (const budget of BACKTEST.falseAlarmBudgets) {
    for (const difficulty of DIFFICULTIES) {
      for (const method of DETECTION_METHODS) {
        const group = rows.filter((r) => r.budget === budget && r.difficulty === difficulty && r.method === method);
        const med = (key: string) => spread(group.map((r) => r[key]).filter((v): v is number => typeof v === "number"))?.median ?? null;
        const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
        const line = { budget, difficulty, method, realDetected: med("realDetected"), realDetectedByDay1: med("realDetectedByDay1"), phantomDetected: med("phantomDetected") };
        summary.push(line);
        console.log(`  ${String(budget).padEnd(7)} ${difficulty.padEnd(11)} ${method.padEnd(10)} ${pct(line.realDetected).padStart(13)} ${pct(line.realDetectedByDay1).padStart(14)} ${pct(line.phantomDetected).padStart(28)}`);
      }
    }
  }
  mkdirSync("results", { recursive: true });
  writeFileSync("results/chance.json", JSON.stringify({ status: "DIAGNOSTIC", city: cityName, seeds: seedCount, summary, rows }, null, 1) + "\n");
  console.log("\nwrote results/chance.json");
} catch (error) {
  console.error(`chance-check failed: ${String(error)}`);
  process.exit(1);
}
