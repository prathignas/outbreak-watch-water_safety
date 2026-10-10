import { mkdirSync, writeFileSync } from "node:fs";
import { runBacktest, DIFFICULTIES, OUTBREAK_CAUSES, type BacktestResult, type Spread } from "../src/backtest/run.js";
import { GridCity, RealCity, type CityModel } from "../src/city.js";
import { BACKTEST } from "../src/params.js";
import { DETECTION_METHODS } from "../src/types.js";

/*
 * npm run backtest -- --city real|grid --seeds 20 [--quick]
 * --quick = BACKTEST.quickSeeds seeds, for testing the pipeline. Results are
 * marked preliminary unless it is a full run on the full seed count.
 */

function parseArgs(argv: string[]) {
  const value = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const quick = argv.includes("--quick");
  const city = value("city") ?? "grid";
  if (city !== "grid" && city !== "real") throw new Error(`--city must be grid or real, got ${city}`);
  const seeds = quick ? BACKTEST.quickSeeds : Number(value("seeds") ?? BACKTEST.seeds);
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error(`--seeds must be a whole number above 0`);
  return { city, seeds, quick };
}

const pct = (s: Spread) => (s ? `${(s.median * 100).toFixed(0)}% [${(s.p10 * 100).toFixed(0)}-${(s.p90 * 100).toFixed(0)}]` : "n/a");
const num = (s: Spread, digits = 1) => (s ? `${s.median.toFixed(digits)} [${s.p10.toFixed(digits)}-${s.p90.toFixed(digits)}]` : "n/a");

function printTable(result: BacktestResult): string[] {
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);
  out(`${result.status} BACKTEST: ${result.city} city (${result.wardCount} wards), ${result.seeds.length} seeds (${result.seeds[0]}-${result.seeds.at(-1)})`);
  out(`test years ${result.rules.testYears.join("-")}, settings locked on ${result.rules.tuningYears.join("-")} only, ` +
    `budgets ${result.rules.falseAlarmBudgets.join(" and ")} false-alarm episodes per ward-year`);
  out(`matching rule ${result.rules.matchingRule}`);
  out("values: median [10th-90th percentile] across seeds; 'outside wave' = local outbreaks not touching the seasonal wave");
  for (const budget of result.rules.falseAlarmBudgets) {
    for (const difficulty of DIFFICULTIES) {
      if (!result.difficulties.includes(difficulty)) continue;
      out();
      out(`=== BUDGET ${budget} / ${difficulty.toUpperCase()} ===`);
      out("  method     locked setting          false alarms/ward-yr     false alarms/ward-yr");
      out("                                     (wave = outbreak)        (wave excluded)");
      for (const method of DETECTION_METHODS) {
        const fa = result.falseAlarms.find((r) => r.method === method && r.difficulty === difficulty && r.budget === budget)!;
        const missed = fa.budgetMissedSeeds > 0 ? `  (budget not reached in ${fa.budgetMissedSeeds} seed(s))` : "";
        out(`  ${method.padEnd(10)} ${num(fa.lockedSetting, 3).padEnd(23)} ${num(fa.waveCounted, 2).padEnd(24)} ${num(fa.waveExcluded, 2)}${missed}`);
      }
      out("  cause               method     n/seed  detected            median delay (days)");
      for (const cause of OUTBREAK_CAUSES) {
        for (const subset of cause === "seasonal" ? (["all"] as const) : (["all", "outsideWave"] as const)) {
          for (const method of DETECTION_METHODS) {
            const row = result.summary.find((r) => r.method === method && r.difficulty === difficulty && r.budget === budget &&
              r.cause === cause && r.subset === subset)!;
            const label = cause === "seasonal" ? "seasonal wave*" : subset === "all" ? `${cause} (all)` : `${cause} (outside wave)`;
            out(`  ${label.padEnd(19)} ${method.padEnd(10)} ${String(row.outbreaksPerSeed).padStart(6)}  ${pct(row.detectionRate).padEnd(19)} ${num(row.medianDelayDays)}`);
          }
        }
      }
    }
  }
  out();
  out("* seasonal wave = the city-wide wave, reported separately.");
  out();
  out(result.fusionDoesNotHelp.length === 0 ? "No case where a simpler method beats or equals Bayes." : `WHERE FUSION DOES NOT HELP (${result.fusionDoesNotHelp.length}):`);
  for (const flag of result.fusionDoesNotHelp) out(`  - ${flag.text}`);
  return lines;
}

function toCsv(result: BacktestResult): string {
  const s = (v: Spread, key: "median" | "p10" | "p90") => (v ? String(Number(v[key].toFixed(4))) : "");
  const header = [
    "status", "city", "budget", "method", "difficulty", "cause", "subset", "outbreaks_per_seed",
    "detection_median", "detection_p10", "detection_p90", "delay_median", "delay_p10", "delay_p90",
    "fa_wave_counted_median", "fa_wave_counted_p10", "fa_wave_counted_p90",
    "fa_wave_excluded_median", "fa_wave_excluded_p10", "fa_wave_excluded_p90",
    "locked_setting_median", "budget_missed_seeds", "fusion_does_not_help",
  ];
  const rows = result.summary.map((row) => {
    const fa = result.falseAlarms.find((r) => r.method === row.method && r.difficulty === row.difficulty && r.budget === row.budget)!;
    const flagged = row.method !== "bayes" && result.fusionDoesNotHelp.some((f) => f.simplerMethod === row.method &&
      f.difficulty === row.difficulty && f.budget === row.budget && f.cause === row.cause && f.subset === row.subset);
    return [
      result.status, result.city, row.budget, row.method, row.difficulty, row.cause, row.subset, row.outbreaksPerSeed,
      s(row.detectionRate, "median"), s(row.detectionRate, "p10"), s(row.detectionRate, "p90"),
      s(row.medianDelayDays, "median"), s(row.medianDelayDays, "p10"), s(row.medianDelayDays, "p90"),
      s(fa.waveCounted, "median"), s(fa.waveCounted, "p10"), s(fa.waveCounted, "p90"),
      s(fa.waveExcluded, "median"), s(fa.waveExcluded, "p10"), s(fa.waveExcluded, "p90"),
      s(fa.lockedSetting, "median"), fa.budgetMissedSeeds, flagged,
    ].join(",");
  });
  return [header.join(","), ...rows].join("\n") + "\n";
}

try {
  const args = parseArgs(process.argv.slice(2));
  const city: CityModel = args.city === "real" ? RealCity.fromFile() : new GridCity();
  const started = Date.now();
  const result = runBacktest({
    city,
    cityName: args.city,
    seedCount: args.seeds,
    preliminary: args.quick || args.seeds < BACKTEST.seeds,
    onProgress: (message) => console.error(`  ${message}`),
  });
  mkdirSync("results", { recursive: true });
  writeFileSync("results/backtest.json", JSON.stringify(result, null, 1) + "\n");
  writeFileSync("results/backtest.csv", toCsv(result));
  const lines = printTable(result);
  writeFileSync("results/backtest.txt", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\nwrote results/backtest.json, results/backtest.csv, results/backtest.txt (${((Date.now() - started) / 1000).toFixed(0)} s)`);
} catch (error) {
  console.error(`backtest failed: ${String(error)}`);
  process.exit(1);
}
