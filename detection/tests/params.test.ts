import { describe, it, expect } from "vitest";
import * as params from "../src/params.js";
import { SIGNAL_TYPES } from "../src/types.js";

/** Collects every number inside an object or array, with a path so failures are readable. */
function allNumbers(value: unknown, path: string): Array<[string, number]> {
  if (typeof value === "number") return [[path, value]];
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => allNumbers(child, `${path}.${key}`));
  }
  return [];
}

describe("params", () => {
  it("has no negative or non-finite numbers", () => {
    for (const [path, value] of allNumbers(params, "params")) {
      expect(Number.isFinite(value), path).toBe(true);
      expect(value, path).toBeGreaterThanOrEqual(0);
    }
  });

  it("has a weekday effect of 7 days and a seasonal effect of 12 months", () => {
    for (const signal of SIGNAL_TYPES) {
      expect(params.WEEKDAY_EFFECT[signal]).toHaveLength(7);
    }
    expect(params.SEASONAL_EFFECT).toHaveLength(12);
    expect(params.RAIN_SEASONAL_EFFECT).toHaveLength(12);
  });

  it("makes monsoon months higher than winter months", () => {
    const [jan, , , , , jun, jul, aug, sep] = params.SEASONAL_EFFECT;
    for (const monsoonMonth of [jun, jul, aug, sep]) {
      expect(monsoonMonth).toBeGreaterThan(jan);
    }
  });

  it("has delays in order: complaint, then pharmacy, then hospital", () => {
    const { complaint, pharmacy, hospital } = params.SIGNAL_DELAY_DAYS;
    for (const delay of Object.values(params.SIGNAL_DELAY_DAYS)) {
      expect(delay.min).toBeLessThanOrEqual(delay.max);
    }
    expect(complaint.max).toBeLessThanOrEqual(pharmacy.min);
    expect(pharmacy.max).toBeLessThanOrEqual(hospital.min);
  });

  it("has outbreak multipliers above 1 and sensible spread", () => {
    for (const [cause, profile] of Object.entries(params.OUTBREAK_PROFILES)) {
      expect(profile.peakMultiplier, cause).toBeGreaterThan(1);
      expect(profile.neighbourSpread, cause).toBeLessThanOrEqual(1);
      expect(profile.rampDays, cause).toBeLessThanOrEqual(profile.durationDays);
    }
  });

  it("has probabilities between 0 and 1", () => {
    expect(params.DETECTOR_THRESHOLDS.bayesProbability).toBeLessThanOrEqual(1);
    expect(params.DETECTOR_THRESHOLDS.bayesPriorPerWardDay).toBeLessThanOrEqual(1);
  });
});
