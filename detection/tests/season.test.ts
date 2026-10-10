import { describe, it, expect } from "vitest";
import { dateRange } from "../src/dates.js";
import { SEASONAL_EFFECT } from "../src/params.js";
import { seasonalEffectOn } from "../src/season.js";

describe("smooth seasonal curve", () => {
  it("equals the month's value on the middle of the month", () => {
    expect(seasonalEffectOn("2024-01-16")).toBeCloseTo(SEASONAL_EFFECT[0], 6); // January middle = day 16
    expect(seasonalEffectOn("2024-07-16")).toBeCloseTo(SEASONAL_EFFECT[6], 6);
  });

  it("has no step on 1 July (June 1.3 -> July 1.4): the change is gradual", () => {
    const june30 = seasonalEffectOn("2024-06-30");
    const july1 = seasonalEffectOn("2024-07-01");
    expect(july1 - june30).toBeGreaterThan(0);
    expect(july1 - june30).toBeLessThan(0.01); // was 0.1 with the monthly step
    expect(june30).toBeGreaterThan(SEASONAL_EFFECT[5]);
    expect(july1).toBeLessThan(SEASONAL_EFFECT[6]);
  });

  it("never jumps by more than the biggest monthly difference spread over a month, and wraps the year", () => {
    const days = dateRange("2023-12-01", "2025-01-31");
    let biggest = 0;
    for (let i = 1; i < days.length; i++) biggest = Math.max(biggest, Math.abs(seasonalEffectOn(days[i]) - seasonalEffectOn(days[i - 1])));
    expect(biggest).toBeLessThan(0.25 / 28); // biggest monthly change (May 1.1 -> Jun 1.3 is 0.2) spread over ~30 days
    expect(Math.abs(seasonalEffectOn("2025-01-01") - seasonalEffectOn("2024-12-31"))).toBeLessThan(0.01);
  });

  it("stays between the lowest and highest monthly values", () => {
    for (const date of dateRange("2024-01-01", "2024-12-31")) {
      expect(seasonalEffectOn(date)).toBeGreaterThanOrEqual(Math.min(...SEASONAL_EFFECT) - 1e-9);
      expect(seasonalEffectOn(date)).toBeLessThanOrEqual(Math.max(...SEASONAL_EFFECT) + 1e-9);
    }
  });
});
