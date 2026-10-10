import { describe, it, expect, beforeAll } from "vitest";
import { GridCity } from "../src/city.js";
import { addDays, yearOf } from "../src/dates.js";
import {
  DATA_SPLIT,
  FESTIVALS,
  OUTBREAK_MIX_PER_YEAR,
  OUTBREAK_PLACEMENT,
  OUTBREAK_PROFILES,
  RAIN_SURGE,
  SIMULATION,
} from "../src/params.js";
import { loadRealRain } from "../src/realRain.js";
import { outbreakCurve, simulate, type Simulation } from "../src/simulator.js";
import { SYNTHETIC_SIGNAL_TYPES } from "../src/types.js";

const city = new GridCity();
let easy: Simulation;
let realistic: Simulation;
let hard: Simulation;

beforeAll(() => {
  easy = simulate({ difficulty: "easy" });
  realistic = simulate({ difficulty: "realistic" });
  hard = simulate({ difficulty: "hard" });
});

/** Pharmacy count in the origin ward on the day the pharmacy signal peaks. */
function pharmacyAtPeak(sim: Simulation, cause: "water" | "food" | "p2p") {
  return sim.answerKey.outbreaks
    .filter((outbreak) => outbreak.cause === cause)
    .map((outbreak) => {
      const date = addDays(outbreak.peakDate, outbreak.signalDelayDays.pharmacy);
      return sim.count("pharmacy", outbreak.originWardId as number, date) / sim.normalLevel("pharmacy", date);
    });
}
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe("params for the simulator", () => {
  it("outbreak mix adds up to outbreaksPerYear, and years match the split", () => {
    const total = Object.values(OUTBREAK_MIX_PER_YEAR).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(SIMULATION.outbreaksPerYear);
    expect(DATA_SPLIT.tuningYears.length + DATA_SPLIT.testYears.length).toBe(SIMULATION.years);
  });

  it("outbreak curve climbs to 1 at the peak and is 0 outside the outbreak", () => {
    const { rampDays, durationDays } = OUTBREAK_PROFILES.water;
    expect(outbreakCurve("water", -1)).toBe(0);
    expect(outbreakCurve("water", rampDays - 1)).toBe(1);
    expect(outbreakCurve("water", durationDays)).toBe(0);
  });
});

describe("simulate", () => {
  it("is repeatable: same seed same data, different seed different data", () => {
    const again = simulate({ difficulty: "realistic" });
    expect(again.answerKey).toEqual(realistic.answerKey);
    expect(again.count("pharmacy", 10, "2023-07-01")).toBe(realistic.count("pharmacy", 10, "2023-07-01"));
    const other = simulate({ seed: 99 });
    expect(other.answerKey.outbreaks).not.toEqual(realistic.answerKey.outbreaks);
  });

  it("uses real rain unchanged and tags it real; health rows are tagged synthetic", () => {
    const rain = loadRealRain();
    expect(realistic.rain.map((day) => day.mm)).toEqual(rain.map((day) => day.mm));
    let checked = 0;
    for (const row of realistic.rows()) {
      if (row.signalType === "rain") {
        expect(row.sourceTag).toBe("real");
        expect(row.count).toBe(realistic.rainOn(row.date));
      } else {
        expect(row.sourceTag).toBe("synthetic");
      }
      if (++checked > 20_000) break;
    }
  });

  it("refuses to run if a real rain day is missing", () => {
    const rain = loadRealRain().filter((day) => day.date !== "2023-06-15");
    expect(() => simulate({ rain })).toThrow(/No real rain for 2023-06-15/);
  });

  it("plants the right number of each outbreak type every year, after warm-up, inside one year", () => {
    const { outbreaks } = realistic.answerKey;
    expect(outbreaks).toHaveLength(SIMULATION.outbreaksPerYear * SIMULATION.years);
    for (const year of [...DATA_SPLIT.tuningYears, ...DATA_SPLIT.testYears]) {
      for (const [cause, count] of Object.entries(OUTBREAK_MIX_PER_YEAR)) {
        const found = outbreaks.filter((o) => o.cause === cause && yearOf(o.startDate) === year);
        expect(found, `${year} ${cause}`).toHaveLength(count);
      }
    }
    for (const outbreak of outbreaks) {
      expect(yearOf(addDays(outbreak.endDate, outbreak.signalDelayDays.hospital))).toBe(yearOf(outbreak.startDate));
      expect(outbreak.startDate >= addDays("2022-01-01", OUTBREAK_PLACEMENT.warmupDays)).toBe(true);
    }
  });

  it("labels 2022-2023 as tuning and 2024-2025 as test", () => {
    for (const outbreak of realistic.answerKey.outbreaks) {
      const expected = DATA_SPLIT.tuningYears.includes(yearOf(outbreak.startDate)) ? "tuning" : "test";
      expect(outbreak.split).toBe(expected);
    }
    expect(realistic.splitOf("2023-12-31")).toBe("tuning");
    expect(realistic.splitOf("2024-01-01")).toBe("test");
  });

  it("places each outbreak type sensibly", () => {
    for (const outbreak of realistic.answerKey.outbreaks) {
      if (outbreak.cause === "water") {
        // Follows the pipes: every affected ward is on the same supply zone, and it started 1-7 days after real rain.
        for (const { wardId } of outbreak.affectedWards) expect(city.getZoneOfWard(wardId)).toBe(outbreak.zoneId);
        expect(outbreak.triggerRainDate).not.toBeNull();
        const daysAfter = (Date.parse(outbreak.startDate) - Date.parse(outbreak.triggerRainDate as string)) / 86_400_000;
        expect(daysAfter).toBeGreaterThanOrEqual(1);
        expect(daysAfter).toBeLessThanOrEqual(OUTBREAK_PLACEMENT.waterDaysAfterRain);
        expect(realistic.rainOn(outbreak.triggerRainDate as string)).toBeGreaterThanOrEqual(RAIN_SURGE.triggerMm);
      }
      if (outbreak.cause === "food") expect(city.isFoodVenueWard(outbreak.originWardId as number)).toBe(true);
      if (outbreak.cause === "seasonal") {
        expect(outbreak.originWardId).toBeNull();
        expect(outbreak.affectedWards).toHaveLength(200);
      }
    }
  });

  it("shows complaints first, then pharmacy, then hospital", () => {
    for (const { firstSignalDate } of realistic.answerKey.outbreaks) {
      expect(firstSignalDate.complaint <= firstSignalDate.pharmacy).toBe(true);
      expect(firstSignalDate.pharmacy <= firstSignalDate.hospital).toBe(true);
    }
  });

  it("makes outbreaks clearly visible, loudest on easy and quietest on hard", () => {
    const realisticPeak = average(pharmacyAtPeak(realistic, "water"));
    expect(realisticPeak).toBeGreaterThan(2.5); // profile says 4x at peak
    expect(average(pharmacyAtPeak(easy, "water"))).toBeGreaterThan(realisticPeak);
    expect(average(pharmacyAtPeak(hard, "water"))).toBeLessThan(realisticPeak);
  });

  it("adds harmless surges on real rainy days and festivals, except on easy", () => {
    expect(easy.answerKey.harmlessSurges).toHaveLength(0);
    const surges = realistic.answerKey.harmlessSurges;
    const rainyDays = realistic.rain.filter((day) => day.mm >= RAIN_SURGE.triggerMm);
    expect(surges.filter((s) => s.kind === "rain")).toHaveLength(rainyDays.length);
    expect(surges.filter((s) => s.kind === "festival").map((s) => s.triggerDate)).toEqual(FESTIVALS.map((f) => f.date));

    // City-wide complaints relative to normal: higher on rainy days than on dry days.
    const cityRatio = (sim: Simulation, date: string) =>
      average(sim.wardIds.map((wardId) => sim.count("complaint", wardId, date))) / sim.normalLevel("complaint", date);
    const dryDays = realistic.rain.filter((day) => day.mm === 0).slice(0, 100);
    const wet = average(rainyDays.map((day) => cityRatio(realistic, day.date)));
    const dry = average(dryDays.map((day) => cityRatio(realistic, day.date)));
    expect(wet).toBeGreaterThan(dry * 1.5);
  });

  it("adds reporting delays: none on easy, within the set range on hard", () => {
    for (const signal of SYNTHETIC_SIGNAL_TYPES) {
      expect(easy.reportedOn(signal, 5, "2024-03-03")).toBe("2024-03-03");
    }
    const { min, max } = hard.settings.reportingLagDays.hospital;
    const lags = hard.dates.slice(0, 200).map((date) =>
      (Date.parse(hard.reportedOn("hospital", 7, date)) - Date.parse(date)) / 86_400_000);
    expect(Math.min(...lags)).toBe(min);
    expect(Math.max(...lags)).toBe(max);
  });
});
