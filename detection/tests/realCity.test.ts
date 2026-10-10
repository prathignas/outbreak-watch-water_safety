import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { RealCity } from "../src/city.js";
import { dateRange, addDays } from "../src/dates.js";
import * as bayes from "../src/detectors/bayes.js";
import * as cusum from "../src/detectors/cusum.js";
import * as threshold from "../src/detectors/threshold.js";
import { DETECTOR_PARAMS, REAL_CITY } from "../src/params.js";
import { SignalIndex } from "../src/scoring.js";
import { simulate } from "../src/simulator.js";

const city = RealCity.fromFile();
const wards = city.data.wards;

describe("RealCity (data/city.json)", () => {
  it("has the same ward count as data/wards.geojson, with unique ids", () => {
    const geojson = JSON.parse(readFileSync("data/wards.geojson", "utf8")) as { features: unknown[] };
    expect(wards).toHaveLength(geojson.features.length);
    expect(new Set(city.wardIds()).size).toBe(wards.length);
  });

  it("has mutual neighbours, never itself, and every ward has at least one", () => {
    for (const id of city.wardIds()) {
      const neighbours = city.getNeighbours(id);
      expect(neighbours.length, `ward ${id}`).toBeGreaterThan(0);
      expect(neighbours).not.toContain(id);
      for (const other of neighbours) expect(city.getNeighbours(other), `${id} <-> ${other}`).toContain(id);
    }
    for (const link of city.data.approximateNeighbours) expect(city.getNeighbours(link.wardId)).toContain(link.linkedTo);
  });

  it("gives each ward a real zone or null, following the share rule", () => {
    const zoneIds = new Set(city.data.zones.map((z) => z.id));
    for (const ward of wards) {
      expect(ward.zoneShare).toBeGreaterThanOrEqual(0);
      expect(ward.zoneShare).toBeLessThanOrEqual(1.0001);
      if (ward.zoneId === null) {
        expect(ward.zoneShare).toBeLessThan(REAL_CITY.minZoneShare);
      } else {
        expect(zoneIds.has(ward.zoneId)).toBe(true);
        expect(ward.zoneShare).toBeGreaterThanOrEqual(REAL_CITY.minZoneShare);
        expect(city.getWardsInZone(ward.zoneId)).toContain(ward.id);
      }
    }
  });

  it("has valid venue counts, and the food flag is exactly the top share by venues per sq km", () => {
    for (const ward of wards) {
      expect(Number.isInteger(ward.venueCount)).toBe(true);
      expect(ward.venueCount).toBeGreaterThanOrEqual(0);
      expect(ward.areaKm2).toBeGreaterThan(0);
    }
    const ranked = [...wards].sort((a, b) => b.venueCount / b.areaKm2 - a.venueCount / a.areaKm2 || a.id - b.id);
    const expected = new Set(ranked.slice(0, Math.round(wards.length * REAL_CITY.foodVenueTopShare)).map((w) => w.id));
    for (const ward of wards) expect(city.isFoodVenueWard(ward.id), `ward ${ward.id}`).toBe(expected.has(ward.id));
  });

  it("runs the simulator and all three detectors for one month without errors", () => {
    const sim = simulate({ difficulty: "realistic", city });
    const month = dateRange("2022-03-01", "2022-03-31");
    const from = addDays(month[0], -7 * DETECTOR_PARAMS.lookbackWeeks);
    const index = new SignalIndex([...sim.rows()].filter((r) => r.date >= from && r.date <= month.at(-1)!));
    let state = cusum.emptyCusumState();
    let total = 0;
    for (const today of month) {
      total += threshold.detect(index, today, city, DETECTOR_PARAMS).alerts.length;
      const result = cusum.detect(index, today, city, DETECTOR_PARAMS, state);
      state = result.state;
      total += result.alerts.length;
      for (const alert of bayes.detect(index, today, city, DETECTOR_PARAMS).alerts) {
        expect(city.wardIds()).toContain(alert.wardId);
        total++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
