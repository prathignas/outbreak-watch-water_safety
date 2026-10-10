import { describe, it, expect } from "vitest";
import { computeBaseline, MIN_HISTORY } from "../src/baseline.js";

describe("computeBaseline", () => {
  it("Case A: worked example [38, 41, 40, 95], today = 120", () => {
    const result = computeBaseline([38, 41, 40, 95], 120);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);

    expect(result.baseline).toBeCloseTo(40.5, 2);
    // raw spread = 1.4826 * 1.5 ≈ 2.22, below the floor sqrt(40.5) ≈ 6.364
    expect(result.spread).toBeCloseTo(Math.sqrt(40.5), 2);
    expect(result.spread).toBeCloseTo(6.364, 2);
    expect(result.score).toBeCloseTo(12.49, 2);
  });

  it("Case B: one outlier in history barely moves the baseline", () => {
    const clean = computeBaseline([20, 22, 21, 23, 22], 25);
    const withOutlier = computeBaseline([20, 22, 21, 23, 500], 25);
    if (!clean.ok || !withOutlier.ok) throw new Error("expected ok");

    expect(clean.baseline).toBe(22);
    expect(withOutlier.baseline).toBe(22);
    // The mean would have jumped from 21.6 to 117.2; the median does not move.
  });

  it("Case C: history shorter than MIN_HISTORY is rejected", () => {
    expect(MIN_HISTORY).toBe(4);
    expect(computeBaseline([10, 12, 11], 15)).toEqual({
      ok: false,
      reason: "insufficient_history",
    });
  });

  it("Case D: flat history does not give a zero spread", () => {
    const result = computeBaseline([10, 10, 10, 10], 10);
    if (!result.ok) throw new Error("expected ok");

    expect(result.baseline).toBe(10);
    expect(result.spread).toBeGreaterThan(0);
    expect(result.spread).toBeCloseTo(Math.sqrt(10), 2);
    expect(result.score).toBe(0);
  });

  it("Case D2: flat history of zeros falls back to a spread of 1", () => {
    const result = computeBaseline([0, 0, 0, 0], 3);
    if (!result.ok) throw new Error("expected ok");

    expect(result.spread).toBe(1);
    expect(result.score).toBe(3);
  });

  describe("Case E: invalid input", () => {
    it("rejects empty history", () => {
      expect(computeBaseline([], 5)).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("rejects a negative count in history", () => {
      expect(computeBaseline([10, -1, 12, 11], 15)).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("rejects a negative count for today", () => {
      expect(computeBaseline([10, 11, 12, 11], -3)).toEqual({ ok: false, reason: "invalid_input" });
    });

    it("rejects non-finite values", () => {
      expect(computeBaseline([10, NaN, 12, 11], 15)).toEqual({ ok: false, reason: "invalid_input" });
      expect(computeBaseline([10, 11, 12, 11], Infinity)).toEqual({ ok: false, reason: "invalid_input" });
    });
  });
});
