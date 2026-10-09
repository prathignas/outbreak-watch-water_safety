import { seededRandom } from "./random.js";

/** Above this mean, a Poisson count is drawn with the normal approximation (fast and accurate enough). */
const POISSON_NORMAL_CUTOFF = 30;

/**
 * Seeded randomness for the simulator. Same seed in, same numbers out, every run,
 * so anyone can re-create exactly the data our backtest was scored on.
 * Built on seededRandom (mulberry32) from random.ts.
 */
export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number from min to max, both included. */
  int(min: number, max: number): number;
  /** A standard normal number (average 0, spread 1). */
  normal(): number;
  /** A random count with the given average, like "how many people bought ORS today". */
  poisson(mean: number): number;
  /** One item from a non-empty list. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  const next = seededRandom(seed);

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Bad int range: ${min}..${max}`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  // Box-Muller: turns two uniform numbers into one normal number.
  const normal = (): number => {
    let uniform = next();
    while (uniform === 0) uniform = next();
    return Math.sqrt(-2 * Math.log(uniform)) * Math.cos(2 * Math.PI * next());
  };

  const poisson = (mean: number): number => {
    if (!Number.isFinite(mean) || mean < 0) throw new RangeError(`Bad Poisson mean: ${mean}`);
    if (mean === 0) return 0;
    if (mean > POISSON_NORMAL_CUTOFF) {
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal()));
    }
    // Knuth's method: multiply uniforms until the product drops below e^-mean.
    const limit = Math.exp(-mean);
    let count = 0;
    let product = next();
    while (product > limit) {
      count++;
      product *= next();
    }
    return count;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError("Cannot pick from an empty list");
    return items[int(0, items.length - 1)];
  };

  return { next, int, normal, poisson, pick };
}
