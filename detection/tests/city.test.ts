import { describe, it, expect } from "vitest";
import { GridCity } from "../src/city.js";

const city = new GridCity();
const ZONE_COUNT = 15;

describe("GridCity", () => {
  it("has 200 wards with ids 0 to 199", () => {
    const ids = city.wardIds();
    expect(ids).toHaveLength(200);
    expect(ids).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it("gives a corner ward 2 neighbours, an edge ward 3, a middle ward 4", () => {
    expect(city.getNeighbours(0).sort((a, b) => a - b)).toEqual([1, 20]); // top-left corner
    expect(city.getNeighbours(199)).toHaveLength(2); // bottom-right corner
    expect(city.getNeighbours(5).sort((a, b) => a - b)).toEqual([4, 6, 25]); // top edge
    expect(city.getNeighbours(45).sort((a, b) => a - b)).toEqual([25, 44, 46, 65]); // middle
  });

  it("has mutual neighbours (if A touches B, B touches A)", () => {
    for (const wardA of city.wardIds()) {
      for (const wardB of city.getNeighbours(wardA)) {
        expect(city.getNeighbours(wardB), `${wardA} <-> ${wardB}`).toContain(wardA);
      }
    }
  });

  it("puts every ward in exactly one zone, and all 15 zones are non-empty", () => {
    const seen = new Map<number, number>();
    for (let zoneId = 0; zoneId < ZONE_COUNT; zoneId++) {
      const wards = city.getWardsInZone(zoneId);
      expect(wards.length, `zone ${zoneId}`).toBeGreaterThan(0);
      for (const wardId of wards) {
        expect(seen.has(wardId), `ward ${wardId} in two zones`).toBe(false);
        seen.set(wardId, zoneId);
        expect(city.getZoneOfWard(wardId)).toBe(zoneId);
      }
    }
    expect(seen.size).toBe(200);
    expect(city.getWardsInZone(ZONE_COUNT)).toEqual([]);
  });

  it("keeps each zone connected (you can walk between its wards via neighbours)", () => {
    for (let zoneId = 0; zoneId < ZONE_COUNT; zoneId++) {
      const zoneWards = new Set(city.getWardsInZone(zoneId));
      const start = zoneWards.values().next().value as number;
      const reached = new Set([start]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.shift() as number;
        for (const next of city.getNeighbours(current)) {
          if (zoneWards.has(next) && !reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      expect(reached.size, `zone ${zoneId}`).toBe(zoneWards.size);
    }
  });

  it("marks about 10% of wards as food venues, the same on every run", () => {
    const foodWards = (c: GridCity) => c.wardIds().filter((id) => c.isFoodVenueWard(id));
    const firstRun = foodWards(new GridCity());
    const secondRun = foodWards(new GridCity());
    expect(firstRun).toHaveLength(20);
    expect(secondRun).toEqual(firstRun);
  });

  it("rejects ward ids that do not exist", () => {
    expect(() => city.getNeighbours(200)).toThrow(RangeError);
    expect(() => city.getZoneOfWard(-1)).toThrow(RangeError);
    expect(() => city.isFoodVenueWard(1.5)).toThrow(RangeError);
  });
});
