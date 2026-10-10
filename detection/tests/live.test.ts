import { describe, it, expect } from "vitest";
import { GridCity } from "../src/city.js";
import { addDays, dateRange } from "../src/dates.js";
import * as bayes from "../src/detectors/bayes.js";
import * as threshold from "../src/detectors/threshold.js";
import { describeInjection, generateHistory, generateLiveDay, rowsArrivingOn, type LiveSignalRow } from "../src/live.js";
import { DETECTOR_PARAMS, DIFFICULTY_LEVELS, OUTBREAK_PROFILES, SIGNAL_DELAY_DAYS } from "../src/params.js";
import { LIVE } from "../src/params.live.js";
import { SignalIndex } from "../src/scoring.js";
import type { Alert } from "../src/types.js";

const city = new GridCity();
const SEED = 2026;
const DAY = "2026-07-06"; // a Monday in the monsoon
const key = (r: LiveSignalRow) => `${r.wardId}|${r.signalType}|${r.date}`;
const byKey = (rows: LiveSignalRow[]) => new Map(rows.map((r) => [key(r), r]));
const middleWard = city.wardIds().find((w) => city.getNeighbours(w).length === 4 && !city.isFoodVenueWard(w))!;

describe("generateLiveDay", () => {
  it("gives complaint, pharmacy and hospital for every ward, all synthetic, and no rain", () => {
    const rows = generateLiveDay(DAY, SEED);
    expect(rows).toHaveLength(200 * 3);
    expect(rows.some((r) => (r.signalType as string) === "rain")).toBe(false);
    expect(new Set(rows.map((r) => r.signalType))).toEqual(new Set(["complaint", "pharmacy", "hospital"]));
    for (const r of rows) {
      expect(r.sourceTag).toBe("synthetic");
      expect(r.date).toBe(DAY);
      expect(Number.isInteger(r.count) && r.count >= 0).toBe(true);
      expect(r.reportedOn >= r.date).toBe(true);
    }
  });

  it("is deterministic per date: same date and seed, same rows, in any request order", () => {
    const days = dateRange(DAY, addDays(DAY, 4));
    const forwards = days.map((d) => generateLiveDay(d, SEED));
    const backwards = [...days].reverse().map((d) => generateLiveDay(d, SEED)).reverse();
    expect(backwards).toEqual(forwards);
    expect(generateLiveDay(days[2], SEED)).toEqual(forwards[2]); // asked for alone
    expect(generateLiveDay(DAY, SEED + 1)).not.toEqual(forwards[0]); // a different seed differs
    expect(forwards[1]).not.toEqual(forwards[0].map((r) => ({ ...r, date: days[1] }))); // days differ
  });

  it("uses the simulator's reporting lags for its difficulty", () => {
    const rows = dateRange(DAY, addDays(DAY, 20)).flatMap((d) => generateLiveDay(d, SEED));
    const lags = (signal: string) => new Set(rows.filter((r) => r.signalType === signal)
      .map((r) => Math.round((Date.parse(r.reportedOn) - Date.parse(r.date)) / 86_400_000)));
    const realistic = DIFFICULTY_LEVELS[LIVE.difficulty].reportingLagDays;
    expect(lags("complaint")).toEqual(new Set([realistic.complaint.min]));
    expect([...lags("hospital")].sort()).toEqual([1, 2, 3]); // realistic hospital lag 1-3 days
  });

  it("keeps normal levels near the params (pharmacy ~30 x weekday x July season)", () => {
    const pharmacy = generateLiveDay(DAY, SEED).filter((r) => r.signalType === "pharmacy");
    const average = pharmacy.reduce((s, r) => s + r.count, 0) / pharmacy.length;
    expect(average).toBeGreaterThan(30 * 1.4 * 0.9); // July effect 1.4, Monday 1.0
    expect(average).toBeLessThan(30 * 1.4 * 1.1);
  });
});

describe("generateHistory", () => {
  it("returns exactly the days before endDate, oldest first, matching generateLiveDay", () => {
    const rows = generateHistory(DAY, LIVE.recommendedHistoryDays, SEED);
    expect(LIVE.recommendedHistoryDays).toBe(70); // 8 weeks of baseline + 14 days for the classifier
    expect(rows).toHaveLength(70 * 600);
    const dates = [...new Set(rows.map((r) => r.date))];
    expect(dates).toEqual(dateRange(addDays(DAY, -70), addDays(DAY, -1)));
    expect(rows.filter((r) => r.date === addDays(DAY, -5))).toEqual(generateLiveDay(addDays(DAY, -5), SEED));
    expect(generateHistory(DAY, 0, SEED)).toEqual([]);
    expect(() => generateHistory(DAY, -1, SEED)).toThrow(RangeError);
    expect(() => generateHistory(DAY, 5, SEED, { injectOutbreak: "water" })).toThrow(/startDate/);
  });
});

describe("injected outbreaks", () => {
  const options = { injectOutbreak: "water" as const, wardId: middleWard, startDate: DAY };
  const injection = describeInjection(DAY, SEED, options)!;
  const days = dateRange(addDays(DAY, -3), addDays(DAY, 12));

  it("describes a water outbreak on the ward's whole pipeline zone, with delays from SIGNAL_DELAY_DAYS", () => {
    expect(injection.originWardId).toBe(middleWard);
    expect(injection.zoneId).toBe(city.getZoneOfWard(middleWard));
    expect(injection.affectedWards.map((w) => w.wardId).sort((a, b) => a - b))
      .toEqual(city.getWardsInZone(injection.zoneId!).sort((a, b) => a - b));
    for (const signal of ["complaint", "pharmacy", "hospital"] as const) {
      expect(injection.signalDelayDays[signal]).toBeGreaterThanOrEqual(SIGNAL_DELAY_DAYS[signal].min);
      expect(injection.signalDelayDays[signal]).toBeLessThanOrEqual(SIGNAL_DELAY_DAYS[signal].max);
    }
    // Asking on a later day with the same options gives the same outbreak.
    expect(describeInjection(addDays(DAY, 5), SEED, options)).toEqual(injection);
  });

  it("changes only the affected wards, only from each signal's first day, and raises them", () => {
    const affected = new Set(injection.affectedWards.map((w) => w.wardId));
    let raisedBy = 0;
    for (const date of days) {
      const plain = byKey(generateLiveDay(date, SEED));
      for (const row of generateLiveDay(date, SEED, options)) {
        const before = plain.get(key(row))!;
        expect(row.reportedOn).toBe(before.reportedOn); // lags never change
        const canChange = affected.has(row.wardId) && date >= injection.firstSignalDate[row.signalType];
        if (!canChange) expect(row.count, key(row)).toBe(before.count);
        else raisedBy += row.count - before.count;
        if (canChange) expect(row.count, key(row)).toBeGreaterThanOrEqual(before.count);
      }
    }
    expect(raisedBy).toBeGreaterThan(1000);
  });

  it("continues on later days, and is at its worst after the ramp", () => {
    const pharmacyOn = (date: string, opts = options) =>
      generateLiveDay(date, SEED, opts).find((r) => r.wardId === middleWard && r.signalType === "pharmacy")!.count;
    const peak = addDays(DAY, OUTBREAK_PROFILES.water.rampDays - 1 + injection.signalDelayDays.pharmacy);
    expect(pharmacyOn(peak)).toBeGreaterThan(2.5 * pharmacyOn(peak, {} as typeof options)); // profile peak is 4x
    const over = addDays(DAY, OUTBREAK_PROFILES.water.durationDays + injection.signalDelayDays.pharmacy);
    expect(pharmacyOn(over)).toBe(pharmacyOn(over, {} as typeof options)); // finished
  });

  it("picks a food venue ward for a food outbreak when no ward is given; seasonal hits every ward", () => {
    const food = describeInjection(DAY, SEED, { injectOutbreak: "food" })!;
    expect(city.isFoodVenueWard(food.originWardId!)).toBe(true);
    const seasonal = describeInjection(DAY, SEED, { injectOutbreak: "seasonal", wardId: 3 })!;
    expect(seasonal.originWardId).toBeNull();
    expect(seasonal.affectedWards).toHaveLength(200);
  });

  it("rowsArrivingOn gives exactly the rows the webhooks deliver that day, late ones included", () => {
    const arriving = rowsArrivingOn(DAY, SEED, options);
    expect(arriving.every((r) => r.reportedOn === DAY)).toBe(true);
    const lateHospital = arriving.filter((r) => r.signalType === "hospital" && r.date < DAY);
    expect(lateHospital.length).toBeGreaterThan(0);
    // Every row of a day arrives exactly once across the following days.
    const delivered = dateRange(DAY, addDays(DAY, 5)).flatMap((d) => rowsArrivingOn(d, SEED, options)).filter((r) => r.date === DAY);
    expect(delivered).toHaveLength(600);
  });
});

describe("detectors on live data (GridCity)", () => {
  // Expected: Bayes needs 2 signals. Pharmacy shows up at most SIGNAL_DELAY_DAYS.pharmacy.max days
  // after the start, plus the realistic reporting lag, and water takes rampDays to climb. Derived bound:
  const EXPECTED_WITHIN = SIGNAL_DELAY_DAYS.pharmacy.max + DIFFICULTY_LEVELS.realistic.reportingLagDays.pharmacy.max +
    OUTBREAK_PROFILES.water.rampDays; // 2 + 1 + 3 = 6 days

  it(`an injected water outbreak is alerted in an affected ward within ${EXPECTED_WITHIN} days, and not before it starts`, () => {
    const options = { injectOutbreak: "water" as const, wardId: middleWard, startDate: DAY };
    const affected = new Set(describeInjection(DAY, SEED, options)!.affectedWards.map((w) => w.wardId));
    const liveDays = dateRange(DAY, addDays(DAY, EXPECTED_WITHIN + 2));
    const index = new SignalIndex([
      ...generateHistory(DAY, LIVE.recommendedHistoryDays, SEED),
      ...liveDays.flatMap((d) => generateLiveDay(d, SEED, options)),
    ]);

    const firstAlert = (detect: typeof bayes.detect, days: string[]): Alert | undefined => {
      for (const today of days) {
        const hit = detect(index, today, city, DETECTOR_PARAMS).alerts.find((a) => affected.has(a.wardId));
        if (hit) return hit;
      }
      return undefined;
    };

    // The week before the start: no alert in the zone (the outbreak does not exist yet).
    expect(firstAlert(bayes.detect, dateRange(addDays(DAY, -7), addDays(DAY, -1)))).toBeUndefined();

    const alert = firstAlert(bayes.detect, liveDays);
    expect(alert, "Bayes never alerted").toBeDefined();
    const daysAfterStart = Math.round((Date.parse(alert!.date) - Date.parse(DAY)) / 86_400_000);
    expect(daysAfterStart).toBeLessThanOrEqual(EXPECTED_WITHIN);
    expect(firstAlert(threshold.detect, liveDays)).toBeDefined();
  }, 60_000);
});
