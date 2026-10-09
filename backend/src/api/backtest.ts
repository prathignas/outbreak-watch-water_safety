import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BacktestResult } from "@outbreak/detection";

/*
 * GET /backtest serves P1's results file (detection/results/backtest.json) as it is,
 * without the per-seed "runs" (contract-v2 section 5). Nothing here computes a number.
 * The file already carries chanceCheck (the chance levels, added by P1's `npm run add-chance`).
 */
/** Found / total outbreaks over all seeds: a plain tally of the per-seed "detected" flags. */
export interface BacktestCount {
  method: string;
  difficulty: string;
  budget: number;
  cause: string;
  found: number;
  total: number;
}
export type BacktestResponse = Omit<BacktestResult, "runs"> & { counts: BacktestCount[] };

type Run = { difficulty: string; results: Array<{ method: string; budget: number; test: { outbreaks: Array<{ cause: string; detected: boolean }> } }> };

function tally(runs: Run[] | undefined): BacktestCount[] {
  const counts = new Map<string, BacktestCount>();
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
  return [...counts.values()];
}

let cached: { path: string; value: BacktestResponse } | null = null;

function findBacktestFile(): string | null {
  // An explicit BACKTEST_PATH is the only place looked at (the Lambda sets it).
  if (process.env.BACKTEST_PATH) return existsSync(process.env.BACKTEST_PATH) ? process.env.BACKTEST_PATH : null;
  const candidates = [
    // Next to the Lambda bundle (CDK copies it there, already without "runs").
    fileURLToPath(new URL("./backtest.json", import.meta.url)),
    // The source tree: backend/src/api -> detection/results.
    fileURLToPath(new URL("../../../detection/results/backtest.json", import.meta.url)),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** P1's backtest results without "runs", or null if the file is not there. */
export function loadBacktest(): BacktestResponse | null {
  const path = findBacktestFile();
  if (!path) return null;
  if (cached?.path === path) return cached.value;
  const { runs, ...rest } = JSON.parse(readFileSync(path, "utf8")) as BacktestResult;
  // The Lambda's copy has no "runs"; it carries the counts already.
  const counts = (rest as Partial<BacktestResponse>).counts ?? tally(runs as unknown as Run[]);
  const value: BacktestResponse = { ...rest, counts };
  console.log(
    `[backtest] serving ${path}: city=${value.city}, ${value.seeds.length} seeds, difficulties=${value.difficulties.join("/")}, budgets=${value.rules.falseAlarmBudgets.join("/")}, status=${value.status}`
  );
  cached = { path, value };
  return value;
}
