import { describe, it, expect } from "vitest";
import { GridCity } from "../src/city.js";
import { addDays, dateRange, daysBetween } from "../src/dates.js";
import { describeInjection, generateHistory, generateLiveDay, type LiveSignalRow } from "../src/live.js";
import { DIFFICULTY_LEVELS, OUTBREAK_PROFILES, SIGNAL_DELAY_DAYS } from "../src/params.js";
import { LIVE } from "../src/params.live.js";
import { emptyDetectorState, runDetector, RUN_DETECTOR_PARAMS, wardRisk, type DetectorState } from "../src/runDetector.js";
import { SignalIndex, type IndexedRow } from "../src/scoring.js";

const city = new GridCity();
const SEED = 2026;
const START = "2026-07-06"; // a Monday in the monsoon
const ward = city.wardIds().find((w) => city.getNeighbours(w).length === 4 && !city.isFoodVenueWard(w))!;
const inject = { injectOutbreak: "water" as const, wardId: ward, startDate: START };
// Same derived bound as tests/live.test.ts: pharmacy delay + pharmacy reporting lag + water ramp = 2 + 1 + 3.
const EXPECTED_WITHIN = SIGNAL_DELAY_DAYS.pharmacy.max + DIFFICULTY_LEVELS.realistic.reportingLagDays.pharmacy.max +
  OUTBREAK_PROFILES.water.rampDays;

/** History before START, then live days START..lastDay, with or without the injected outbreak. */
function feed(lastDay: string, withOutbreak: boolean): LiveSignalRow[] {
  return [
    ...generateHistory(START, LIVE.recommendedHistoryDays, SEED),
    ...dateRange(START, lastDay).flatMap((d) => generateLiveDay(d, SEED, withOutbreak ? inject : {})),
  ];
}

/** Runs day by day, carrying the state, like the daily Lambda. */
function runDays(rows: IndexedRow[] | SignalIndex, days: string[]) {
  let state: DetectorState = emptyDetectorState();
  return days.map((today) => {
    const result = runDetector(rows, today, city, RUN_DETECTOR_PARAMS, state);
    state = result.state;
    return { today, ...result };
  });
}

describe("runDetector", () => {
  const days = dateRange(addDays(START, -3), addDays(START, EXPECTED_WITHIN + 2));
  const rows = feed(days.at(-1)!, true);
  const index = new SignalIndex(rows);

  it("gives the same output for the same input", () => {
    const first = runDays(index, days);
    expect(runDays(index, days)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first.at(-1)!.state))).toEqual(first.at(-1)!.state); // state is plain JSON
  }, 60_000);

  it(`alerts on an injected water outbreak (generateHistory + generateLiveDay) within ${EXPECTED_WITHIN} days`, () => {
    const affected = new Set(describeInjection(START, SEED, { ...inject, city })!.affectedWards.map((w) => w.wardId));
    const runs = runDays(index, days);
    const hit = runs.find((r) => r.today >= START && r.alerts.some((a) => affected.has(a.wardId)));
    expect(hit, "no alert in the affected zone").toBeDefined();
    expect(daysBetween(START, hit!.today)).toBeLessThanOrEqual(EXPECTED_WITHIN);
    // Before the start, nothing in the zone.
    expect(runs.filter((r) => r.today < START).flatMap((r) => r.alerts).some((a) => affected.has(a.wardId))).toBe(false);
    // The alert carries a triage hint and the classifier's reasons.
    const alert = hit!.alerts.find((a) => affected.has(a.wardId))!;
    expect(Object.values(alert.causeProbs).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    // Detector reasons stay in evidence; the classifier's reasons come separately (AlertRecord.causeEvidence).
    expect(alert.evidence.some((e) => e.includes("triage hint"))).toBe(false);
    expect(hit!.causeEvidence[String(alert.wardId)].at(-1)).toContain("triage hint, not a diagnosis");
  }, 60_000);

  it("does not re-alert the same ward within the cooldown", () => {
    const runs = runDays(index, days);
    const sentDays = new Map<number, string[]>();
    for (const r of runs) for (const a of r.alerts) sentDays.set(a.wardId, [...(sentDays.get(a.wardId) ?? []), r.today]);
    for (const [wardId, dates] of sentDays) {
      for (let i = 1; i < dates.length; i++) {
        expect(daysBetween(dates[i - 1], dates[i]), `ward ${wardId}`).toBeGreaterThan(RUN_DETECTOR_PARAMS.cooldownDays);
      }
    }
    expect(runs.some((r) => r.heldBack.length > 0), "an ongoing outbreak should be held back at least once").toBe(true);
  }, 60_000);

  it("never reads rows dated after today", () => {
    const today = addDays(START, EXPECTED_WITHIN);
    const poisoned: IndexedRow[] = rows.map((row) =>
      row.date <= today ? row : { ...row, get count(): number { throw new Error(`read future row ${row.date}`); } });
    const clean = rows.filter((r) => r.date <= today);
    const state = emptyDetectorState();
    expect(() => runDetector(poisoned, today, city, RUN_DETECTOR_PARAMS, state)).not.toThrow();
    expect(runDetector(poisoned, today, city, RUN_DETECTOR_PARAMS, state)).toEqual(runDetector(clean, today, city, RUN_DETECTOR_PARAMS, state));
  }, 60_000);

  it("refuses to run the same day twice with a moved-on state", () => {
    const first = runDetector(index, START, city, RUN_DETECTOR_PARAMS, emptyDetectorState());
    expect(() => runDetector(index, START, city, RUN_DETECTOR_PARAMS, first.state)).toThrow(/forward/);
  });

  it("wardRisk covers every ward and agrees with runDetector for wards above the alert line", () => {
    let state: DetectorState = emptyDetectorState();
    let checkedAbove = 0;
    for (const today of days) {
      const out = runDetector(index, today, city, RUN_DETECTOR_PARAMS, state);
      state = out.state;
      const risk = wardRisk(index, today, city);
      expect(risk.map((r) => r.wardId).sort((a, b) => a - b)).toEqual(city.wardIds().sort((a, b) => a - b));
      // Wards the Bayes rule fires on (above the line AND 2+ signals) = sent alerts + held back.
      const firing = risk.filter((r) => r.probability > RUN_DETECTOR_PARAMS.detector.bayesAlertProbability &&
        r.contributingSignals.length >= RUN_DETECTOR_PARAMS.detector.bayesMinSignals).map((r) => r.wardId).sort((a, b) => a - b);
      expect(firing).toEqual([...out.alerts.map((a) => a.wardId), ...out.heldBack].sort((a, b) => a - b));
      for (const alert of out.alerts) {
        const r = risk.find((x) => x.wardId === alert.wardId)!;
        expect(r.probability).toBe(alert.score);
        expect(r.contributingSignals).toEqual(alert.contributingSignals);
        checkedAbove++;
      }
    }
    expect(checkedAbove).toBeGreaterThan(0);
  }, 60_000);

  it("wardRisk never reads rows dated after today", () => {
    const today = addDays(START, EXPECTED_WITHIN);
    const poisoned: IndexedRow[] = rows.map((row) =>
      row.date <= today ? row : { ...row, get count(): number { throw new Error(`read future row ${row.date}`); } });
    expect(wardRisk(poisoned, today, city)).toEqual(wardRisk(rows.filter((r) => r.date <= today), today, city));
  }, 60_000);
});
