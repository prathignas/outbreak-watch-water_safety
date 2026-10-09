// Used by CDK bundling: copies P1's backtest results without the per-seed "runs" next to the
// API Lambda bundle. If the file does not exist, nothing is written and GET /backtest answers 503.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [from, to] = process.argv.slice(2);
if (!existsSync(from)) {
  console.warn(`[slim-backtest] ${from} not found: GET /backtest will answer 503 "backtest not run yet".`);
  process.exit(0);
}
const { runs, ...rest } = JSON.parse(readFileSync(from, "utf8"));
// Keep only the found/total tally of the per-seed "detected" flags (same as backend/src/api/backtest.ts).
const counts = new Map();
for (const run of runs ?? []) {
  for (const res of run.results) {
    for (const o of res.test.outbreaks) {
      const key = `${res.method}|${run.difficulty}|${res.budget}|${o.cause}`;
      const c = counts.get(key) ?? { method: res.method, difficulty: run.difficulty, budget: res.budget, cause: o.cause, found: 0, total: 0 };
      c.total++;
      if (o.detected) c.found++;
      counts.set(key, c);
    }
  }
}
writeFileSync(to, JSON.stringify({ ...rest, counts: [...counts.values()] }));
