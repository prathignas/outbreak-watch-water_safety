import { mkdirSync, writeFileSync } from "node:fs";
import { evaluateClassifier, TIMINGS, type ClassifierResult } from "../src/backtest/classifierEval.js";
import { DIFFICULTIES, OUTBREAK_CAUSES } from "../src/backtest/run.js";
import { GridCity, RealCity, type CityModel } from "../src/city.js";
import { BACKTEST } from "../src/params.js";

/*
 * npm run eval-classifier -- --city real|grid --seeds 20 [--quick]
 * Cause accuracy of the triage hint at the first alert and 3 days later, Bayes
 * detector, test years only (rules in src/backtest/classifierEval.ts).
 * Writes results/classifier.json and results/classifier.txt.
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
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error("--seeds must be a whole number above 0");
  return { city, seeds, quick };
}

function printTable(result: ClassifierResult): string[] {
  const lines: string[] = [];
  const out = (line = "") => lines.push(line);
  out(`${result.status} CAUSE CLASSIFIER EVALUATION (triage hint): ${result.city} city, ${result.seeds.length} seeds, Bayes detector`);
  out(result.rules);
  out("cell = correct / classified (pooled over seeds) = %, [10th-90th percentile of per-seed accuracy]; missed = detector never found it");
  for (const budget of result.budgets) {
    for (const difficulty of DIFFICULTIES) {
      out();
      out(`=== BUDGET ${budget} / ${difficulty.toUpperCase()} ===`);
      out("  cause      " + TIMINGS.map((t) => (t === "firstAlert" ? "at first alert" : "3 days after first alert").padEnd(34)).join("") + "missed");
      for (const cause of [...OUTBREAK_CAUSES, "all"] as const) {
        const cells = TIMINGS.map((timing) => {
          const row = result.rows.find((r) => r.difficulty === difficulty && r.budget === budget && r.timing === timing && r.cause === cause)!;
          const pct = row.pooledAccuracy === null ? "n/a" : `${(row.pooledAccuracy * 100).toFixed(0)}%`;
          const s = row.accuracyAcrossSeeds;
          const band = s ? ` [${(s.p10 * 100).toFixed(0)}-${(s.p90 * 100).toFixed(0)}]` : "";
          return `${row.correct}/${row.classified} = ${pct}${band}`.padEnd(34);
        });
        const missed = result.rows.find((r) => r.difficulty === difficulty && r.budget === budget && r.cause === cause)!.missed;
        out(`  ${cause.padEnd(10)} ${cells.join("")}${missed}`);
      }
      const zone = TIMINGS.map((timing) => {
        const row = result.rows.find((r) => r.difficulty === difficulty && r.budget === budget && r.timing === timing && r.cause === "water")!;
        return row.zoneNamedShare === null ? "n/a" : `${(row.zoneNamedShare * 100).toFixed(0)}%`;
      });
      out(`  water outbreaks whose true zone was named: ${zone[0]} at first alert, ${zone[1]} 3 days later`);
      const conf = result.confusion.find((c) => c.difficulty === difficulty && c.budget === budget && c.timing === "firstAlert")!;
      out("  confusion at first alert (true \\ predicted):    water   food    p2p  seasonal unknown  missed");
      for (const cause of OUTBREAK_CAUSES) {
        const r = conf.table[cause];
        out(`    ${cause.padEnd(44)} ${[r.water, r.food, r.p2p, r.seasonal, r.unknown, r.missed].map((v) => String(v).padStart(7)).join("")}`);
      }
    }
  }
  return lines;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const city: CityModel = args.city === "real" ? RealCity.fromFile() : new GridCity();
  const started = Date.now();
  const result = evaluateClassifier({
    city,
    cityName: args.city,
    seedCount: args.seeds,
    preliminary: args.quick || args.seeds < BACKTEST.seeds,
    onProgress: (message) => console.error(`  ${message}`),
  });
  mkdirSync("results", { recursive: true });
  writeFileSync("results/classifier.json", JSON.stringify(result, null, 1) + "\n");
  const lines = printTable(result);
  writeFileSync("results/classifier.txt", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  console.log(`\nwrote results/classifier.json, results/classifier.txt (${((Date.now() - started) / 1000).toFixed(0)} s)`);
} catch (error) {
  console.error(`eval-classifier failed: ${String(error)}`);
  process.exit(1);
}
