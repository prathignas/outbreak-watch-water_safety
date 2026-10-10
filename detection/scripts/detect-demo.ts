import { addDays, dateRange, yearOf } from "../src/dates.js";
import * as bayes from "../src/detectors/bayes.js";
import * as cusum from "../src/detectors/cusum.js";
import * as threshold from "../src/detectors/threshold.js";
import { GridCity, RealCity, type CityModel } from "../src/city.js";
import { ALERT_MATCH_GRACE_DAYS, DETECTOR_PARAMS, FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR } from "../src/params.js";
import { SignalIndex } from "../src/scoring.js";
import { simulate, type OutbreakAnswer } from "../src/simulator.js";
import type { Alert, DetectionMethod } from "../src/types.js";

/*
 * Sanity check only, NOT a result: one simulated year (2022, a tuning year) on the
 * grid city at "realistic" difficulty, all three detectors run day by day with
 * default params. Each day a detector only sees rows already reported by then.
 * Choose the city with --city=grid (default) or --city=real (data/city.json).
 */

const YEAR = 2022;

function matches(alert: Alert, outbreak: OutbreakAnswer): boolean {
  const inWard = outbreak.affectedWards.some((w) => w.wardId === alert.wardId && w.weight > 0);
  return inWard && alert.date >= outbreak.startDate && alert.date <= addDays(outbreak.endDate, ALERT_MATCH_GRACE_DAYS);
}

try {
  const cityArg = process.argv.find((arg) => arg.startsWith("--city="))?.slice("--city=".length) ?? "grid";
  if (cityArg !== "grid" && cityArg !== "real") throw new Error(`--city must be grid or real, got ${cityArg}`);
  const city: CityModel = cityArg === "real" ? RealCity.fromFile() : new GridCity();
  const sim = simulate({ difficulty: "realistic", city });
  const index = new SignalIndex([...sim.rows()].filter((row) => yearOf(row.date) === YEAR));
  const days = sim.dates.filter((date) => yearOf(date) === YEAR);
  const outbreaks = sim.answerKey.outbreaks.filter((o) => yearOf(o.startDate) === YEAR);
  const surgeDays = new Set(
    sim.answerKey.harmlessSurges.flatMap((s) => s.effects.flatMap((e) => dateRange(e.startDate, e.endDate))),
  );

  const alerts: Record<DetectionMethod, Alert[]> = { threshold: [], cusum: [], bayes: [] };
  let cusumState = cusum.emptyCusumState();
  for (const today of days) {
    alerts.threshold.push(...threshold.detect(index, today, city, DETECTOR_PARAMS).alerts);
    const cusumResult = cusum.detect(index, today, city, DETECTOR_PARAMS, cusumState);
    alerts.cusum.push(...cusumResult.alerts);
    cusumState = cusumResult.state;
    alerts.bayes.push(...bayes.detect(index, today, city, DETECTOR_PARAMS).alerts);
  }

  const local = outbreaks.filter((o) => o.cause !== "seasonal");
  console.log(`DETECTOR DEMO - sanity check only, not a result`);
  console.log(`  city: ${cityArg === "real" ? "real Bengaluru (data/city.json)" : "grid"}`);
  console.log(`  ${YEAR}, realistic difficulty, ${city.wardIds().length} wards, ${days.length} days, default params`);
  console.log(`  answer key: ${local.length} local outbreaks (${local.map((o) => o.cause).join(", ")}) + ` +
    `${outbreaks.length - local.length} city-wide seasonal wave`);
  console.log(`  an alert "matches" if it is in an affected ward from the outbreak's start to ${ALERT_MATCH_GRACE_DAYS} days after its end`);
  console.log(`  alerts are counted per ward per day (no cooldown yet), so one outbreak can give many\n`);
  console.log("  method      alerts   match local   match seasonal   no match (on surge days)   " +
    "local outbreaks found   no-match per ward-year");
  for (const method of ["threshold", "cusum", "bayes"] as const) {
    const list = alerts[method];
    const matchLocal = list.filter((a) => local.some((o) => matches(a, o)));
    const matchSeasonal = list.filter((a) => !matchLocal.includes(a) && outbreaks.some((o) => o.cause === "seasonal" && matches(a, o)));
    const noMatch = list.filter((a) => !outbreaks.some((o) => matches(a, o)));
    const onSurge = noMatch.filter((a) => surgeDays.has(a.date)).length;
    const found = local.filter((o) => list.some((a) => matches(a, o))).length;
    const perWardYear = noMatch.length / city.wardIds().length;
    console.log(`  ${method.padEnd(10)} ${String(list.length).padStart(7)} ${String(matchLocal.length).padStart(13)} ` +
      `${String(matchSeasonal.length).padStart(16)} ${`${noMatch.length} (${onSurge})`.padStart(26)} ` +
      `${`${found} / ${local.length}`.padStart(23)} ${perWardYear.toFixed(2).padStart(24)}`);
  }
  console.log(`\n  false-alarm budget (params): ${FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR} per ward per year`);

  const example = alerts.bayes.find((a) => local.some((o) => matches(a, o)));
  if (example) {
    const name = city instanceof RealCity ? ` ${city.wardName(example.wardId)}` : "";
    console.log(`\n  first Bayes alert that matched an outbreak: ward ${example.wardId}${name} on ${example.date}`);
    for (const line of example.evidence) console.log(`    - ${line}`);
  }
} catch (error) {
  console.error(`detect-demo failed: ${String(error)}`);
  process.exit(1);
}
