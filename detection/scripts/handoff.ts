import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { RealCity } from "../src/city.js";
import { addDays, dateRange, daysBetween } from "../src/dates.js";
import { describeInjection, generateHistory, generateLiveDay } from "../src/live.js";
import { LIVE, RUN_DETECTOR } from "../src/params.live.js";
import { emptyDetectorState, runDetector, RUN_DETECTOR_PARAMS, type DetectorState } from "../src/runDetector.js";
import { SignalIndex } from "../src/scoring.js";

/*
 * npm run handoff: writes the handoff pack for Person 2 and P3 into handoff/.
 * Every sample is SYNTHETIC (generateLiveDay), on the real Bengaluru city.
 */

const SEED = 2026;
const DAY = "2026-07-06"; // a Monday in the monsoon
const DAYS_AFTER = 8;

try {
  mkdirSync("handoff", { recursive: true });
  copyFileSync("data/city.json", "handoff/city.json");
  copyFileSync("docs/contract-v2.md", "handoff/contract-v2.md");
  const city = RealCity.fromFile();

  // Water outbreak in a ward that has a water zone with several wards, so the zone hint can show.
  const ward = city.data.wards.find((w) => w.zoneId !== null && city.getWardsInZone(w.zoneId).length >= 6 && !w.isFoodVenueWard)!;
  const inject = { injectOutbreak: "water" as const, wardId: ward.id, startDate: DAY, city };
  const injection = describeInjection(DAY, SEED, inject)!;

  const normalDay = generateLiveDay(DAY, SEED, { city });
  const injectedDay = generateLiveDay(addDays(DAY, 3), SEED, inject);
  writeFileSync("handoff/sample-live-day-normal.json", JSON.stringify({
    note: "SYNTHETIC. generateLiveDay(date, seed, { city: RealCity }): one normal day, every ward x complaint/pharmacy/hospital.",
    date: DAY, seed: SEED, rows: normalDay,
  }, null, 1) + "\n");
  writeFileSync("handoff/sample-live-day-injected.json", JSON.stringify({
    note: "SYNTHETIC. Day 3 of an injected water outbreak: generateLiveDay(date, seed, { injectOutbreak: 'water', wardId, startDate, city }).",
    date: addDays(DAY, 3), seed: SEED, injection, rows: injectedDay,
  }, null, 1) + "\n");

  // Run day by day like the Lambda, from 3 days before the outbreak.
  const days = dateRange(addDays(DAY, -3), addDays(DAY, DAYS_AFTER));
  const index = new SignalIndex([
    ...generateHistory(DAY, LIVE.recommendedHistoryDays, SEED, { city }),
    ...dateRange(DAY, days.at(-1)!).flatMap((d) => generateLiveDay(d, SEED, inject)),
  ]);
  const affected = new Set(injection.affectedWards.map((w) => w.wardId));
  let state: DetectorState = emptyDetectorState();
  const log: Array<{ today: string; alertsSent: number; inOutbreakZone: number; heldBack: number }> = [];
  let sample: { today: string; output: ReturnType<typeof runDetector> } | null = null;
  for (const today of days) {
    const output = runDetector(index, today, city, RUN_DETECTOR_PARAMS, state);
    state = output.state;
    const inZone = output.alerts.filter((a) => affected.has(a.wardId)).length;
    log.push({ today, alertsSent: output.alerts.length, inOutbreakZone: inZone, heldBack: output.heldBack.length });
    if (!sample && inZone > 0) sample = { today, output };
  }
  writeFileSync("handoff/sample-run-detector.json", JSON.stringify({
    note: "SYNTHETIC. runDetector(rows, today, RealCity, RUN_DETECTOR_PARAMS, state) run day by day over an injected water outbreak. " +
      "'firstDetection' is the output of the first day that sent an alert inside the outbreak's zone.",
    params: { method: RUN_DETECTOR.method, bayesAlertProbability: RUN_DETECTOR.bayesAlertProbability, cooldownDays: RUN_DETECTOR.cooldownDays },
    injection,
    dayByDay: log,
    firstDetection: sample
      ? { today: sample.today, daysAfterStart: daysBetween(DAY, sample.today), ...sample.output }
      : null,
  }, null, 1) + "\n");
  console.log(`wrote handoff/: city.json, contract-v2.md, sample-live-day-normal.json (${normalDay.length} rows), ` +
    `sample-live-day-injected.json, sample-run-detector.json`);
  console.log(`injected water outbreak at ward ${ward.id} ${ward.name}, zone ${injection.zoneId} (${injection.affectedWards.length} wards), from ${DAY}`);
  for (const day of log) console.log(`  ${day.today}: ${day.alertsSent} alerts sent (${day.inOutbreakZone} in the outbreak zone), ${day.heldBack} held back`);
  console.log(sample ? `first alert in the outbreak zone: ${sample.today} (${daysBetween(DAY, sample.today)} days after start)` : "NO alert in the outbreak zone");
} catch (error) {
  console.error(`handoff failed: ${String(error)}`);
  process.exit(1);
}
