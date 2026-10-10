import { describe, it, expect } from "vitest";
import { createRng } from "../src/rng.js";

describe("createRng", () => {
  it("gives the same numbers for the same seed, different for a different seed", () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => rng.poisson(5));
    };
    expect(draw(1)).toEqual(draw(1));
    expect(draw(1)).not.toEqual(draw(2));
  });

  it("keeps int() inside its range, both ends included", () => {
    const rng = createRng(3);
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(2, 4)));
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it("draws Poisson counts with about the right average, small and large", () => {
    const rng = createRng(4);
    for (const mean of [2, 30, 120]) {
      const draws = Array.from({ length: 5000 }, () => rng.poisson(mean));
      const average = draws.reduce((sum, value) => sum + value, 0) / draws.length;
      expect(average, `mean ${mean}`).toBeGreaterThan(mean * 0.95);
      expect(average, `mean ${mean}`).toBeLessThan(mean * 1.05);
      expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    }
    expect(rng.poisson(0)).toBe(0);
  });

  it("rejects bad input loudly", () => {
    const rng = createRng(5);
    expect(() => rng.poisson(-1)).toThrow(RangeError);
    expect(() => rng.poisson(NaN)).toThrow(RangeError);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
