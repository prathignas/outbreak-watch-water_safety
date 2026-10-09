import { GridCity, type CityModel } from "./city.js";
import { addDays, daysBetween, weekdayOf } from "./dates.js";
import {
  DIFFICULTY_LEVELS,
  NORMAL_DAILY_LEVEL,
  OUTBREAK_PROFILES,
  SIGNAL_DELAY_DAYS,
  WEEKDAY_EFFECT,
  type DifficultyLevel,
} from "./params.js";
import { LIVE } from "./params.live.js";
import { seasonalEffectOn } from "./season.js";
import { createRng } from "./rng.js";
import { outbreakCurve, type OutbreakCause } from "./simulator.js";
import { SYNTHETIC_SIGNAL_TYPES, type SignalRow, type SyntheticSignalType } from "./types.js";

/*
 * The live feed: one day of synthetic complaint, pharmacy and hospital rows,
 * for the demo and the deployed system (the pharmacy/hospital webhooks).
 * Rain is NOT made here: P2's ingestion supplies real rain.
 *
 * Deterministic per date: every (date, ward, signal) gets its own random
 * generator, seeded from a hash of (seed, date, ward, signal). So the same date
 * and seed always give the same rows, whatever order days are asked for in,
 * and with no stored state.
 *
 * It uses the simulator's numbers (normal levels, weekday and season effects,
 * noise, outbreak shapes, signal delays, reporting lags) from params.ts, so live
 * data looks like the data the backtest was scored on.
 */

/** A synthetic row plus the day it reaches our system (date + reporting lag), like the simulator's rows. */
export interface LiveSignalRow extends SignalRow {
  signalType: SyntheticSignalType;
  sourceTag: "synthetic";
  reportedOn: string;
}

export interface LiveOptions {
  /** Plant an outbreak of this kind. */
  injectOutbreak?: OutbreakCause;
  /** Where it starts. Ignored for "seasonal" (everywhere). If left out, picked from the seed (food: a food venue ward). */
  wardId?: number;
  /** The day it starts. Defaults to the requested date; pass the same startDate on later days to continue it. */
  startDate?: string;
  /** Which city. Defaults to GridCity; pass RealCity for Bengaluru. */
  city?: CityModel;
  /** Defaults to LIVE.difficulty ("realistic"). */
  difficulty?: DifficultyLevel;
}

/** What an injection looks like, so the caller (and the demo) can show the answer. */
export interface Injection {
  cause: OutbreakCause;
  startDate: string;
  originWardId: number | null;
  zoneId: number | null;
  affectedWards: Array<{ wardId: number; weight: number }>;
  /** Days between falling ill and each signal showing it (from SIGNAL_DELAY_DAYS). */
  signalDelayDays: Record<SyntheticSignalType, number>;
  /** First day each signal is affected (startDate + delay). Reporting lag comes on top. */
  firstSignalDate: Record<SyntheticSignalType, string>;
}

/** Day numbers are counted from this fixed date, only to feed the hash. */
const EPOCH = "2000-01-01";
/** Separate hash streams, so e.g. the lag draw never shifts the count draw. */
const STREAM = { count: 1, lag: 2, injection: 3 } as const;
const CAUSES: OutbreakCause[] = ["water", "food", "p2p", "seasonal"];

/** A small integer hash (FNV-1a style with extra mixing). Same numbers in, same seed out. */
function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const dayNumber = (date: string) => daysBetween(EPOCH, date);

/** Which wards an outbreak reaches, and how strongly. Same rule as the simulator (simulator.ts, affectedWardsOf). */
function affectedWardsOf(cause: OutbreakCause, originWardId: number | null, city: CityModel) {
  const spread = OUTBREAK_PROFILES[cause].neighbourSpread;
  if (originWardId === null) return city.wardIds().map((wardId) => ({ wardId, weight: spread }));
  const zoneId = cause === "water" ? city.getZoneOfWard(originWardId) : null;
  const others = zoneId !== null
    ? city.getWardsInZone(zoneId).filter((wardId) => wardId !== originWardId)
    : city.getNeighbours(originWardId);
  return [{ wardId: originWardId, weight: 1 }, ...others.map((wardId) => ({ wardId, weight: spread }))];
}

/** Works out the outbreak an inject option describes. Pure: same seed and options, same answer. */
export function describeInjection(date: string, seed: number, options: LiveOptions): Injection | null {
  const cause = options.injectOutbreak;
  if (!cause) return null;
  if (!CAUSES.includes(cause)) throw new RangeError(`Unknown outbreak type: ${cause}`);
  const city = options.city ?? new GridCity();
  const startDate = options.startDate ?? date;
  const rng = createRng(hashSeed(seed, dayNumber(startDate), CAUSES.indexOf(cause), STREAM.injection));

  let originWardId: number | null = null;
  if (cause !== "seasonal") {
    if (options.wardId !== undefined) {
      city.getNeighbours(options.wardId); // throws RangeError for an unknown ward
      originWardId = options.wardId;
    } else {
      const foodWards = city.wardIds().filter((w) => city.isFoodVenueWard(w));
      originWardId = rng.pick(cause === "food" && foodWards.length > 0 ? foodWards : city.wardIds());
    }
  }

  const signalDelayDays = { complaint: 0, pharmacy: 0, hospital: 0 };
  const firstSignalDate = { complaint: startDate, pharmacy: startDate, hospital: startDate };
  for (const signal of SYNTHETIC_SIGNAL_TYPES) {
    signalDelayDays[signal] = rng.int(SIGNAL_DELAY_DAYS[signal].min, SIGNAL_DELAY_DAYS[signal].max);
    firstSignalDate[signal] = addDays(startDate, signalDelayDays[signal]);
  }

  return {
    cause,
    startDate,
    originWardId,
    zoneId: cause === "water" && originWardId !== null ? city.getZoneOfWard(originWardId) : null,
    affectedWards: affectedWardsOf(cause, originWardId, city),
    signalDelayDays,
    firstSignalDate,
  };
}

/**
 * One day of synthetic rows: complaint, pharmacy and hospital for every ward, all
 * tagged "synthetic", each with the day it reaches our system (reportedOn).
 * Same date and seed (and options) -> exactly the same rows, in any call order.
 */
export function generateLiveDay(date: string, seed: number, options: LiveOptions = {}): LiveSignalRow[] {
  const city = options.city ?? new GridCity();
  const settings = DIFFICULTY_LEVELS[options.difficulty ?? LIVE.difficulty];
  if (!settings) throw new RangeError(`Unknown difficulty: ${options.difficulty}`);
  const injection = describeInjection(date, seed, { ...options, city });
  const weightOf = new Map(injection?.affectedWards.map((w) => [w.wardId, w.weight]) ?? []);
  const day = dayNumber(date);
  const noise = settings.noiseLevel;

  const rows: LiveSignalRow[] = [];
  for (const wardId of city.wardIds()) {
    SYNTHETIC_SIGNAL_TYPES.forEach((signal, signalIndex) => {
      const normal = NORMAL_DAILY_LEVEL[signal] * WEEKDAY_EFFECT[signal][weekdayOf(date)] * seasonalEffectOn(date);

      // Outbreak excess: the same formula as the simulator, shifted by this signal's delay.
      let excess = 0;
      const weight = weightOf.get(wardId);
      if (injection && weight !== undefined) {
        const t = daysBetween(injection.startDate, date) - injection.signalDelayDays[signal];
        const { peakMultiplier } = OUTBREAK_PROFILES[injection.cause];
        excess = weight * settings.outbreakStrength * (peakMultiplier - 1) * outbreakCurve(injection.cause, t);
      }

      // Own generator per cell: noise first, then the count, always in that order,
      // so an outbreak only changes the mean, never which random numbers are used.
      const rng = createRng(hashSeed(seed, day, wardId, signalIndex, STREAM.count));
      const noiseFactor = Math.exp(noise * rng.normal() - (noise * noise) / 2); // log-normal, average 1
      const count = rng.poisson(normal * (1 + excess) * noiseFactor);

      const lagRange = settings.reportingLagDays[signal];
      const lag = createRng(hashSeed(seed, day, wardId, signalIndex, STREAM.lag)).int(lagRange.min, lagRange.max);
      rows.push({ wardId, signalType: signal, date, count, sourceTag: "synthetic", reportedOn: addDays(date, lag) });
    });
  }
  return rows;
}

/**
 * The rows for the `days` days before endDate (endDate itself not included), oldest
 * first, to seed the database before going live. LIVE.recommendedHistoryDays (70)
 * gives the detectors and classifier full history. Pass inject options to put an
 * outbreak into the history too.
 */
export function generateHistory(endDate: string, days: number, seed: number, options: LiveOptions = {}): LiveSignalRow[] {
  if (!Number.isInteger(days) || days < 0) throw new RangeError(`days must be a whole number >= 0, got ${days}`);
  // Without a fixed start, every history day would think the outbreak starts on itself.
  if (options.injectOutbreak && !options.startDate) throw new Error("generateHistory with injectOutbreak needs a startDate");
  const city = options.city ?? new GridCity();
  const rows: LiveSignalRow[] = [];
  for (let back = days; back >= 1; back--) rows.push(...generateLiveDay(addDays(endDate, -back), seed, { ...options, city }));
  return rows;
}

/**
 * What the webhooks deliver on one day: every row whose reportedOn is that day
 * (late rows from earlier days included). Looks back far enough for the slowest lag.
 */
export function rowsArrivingOn(date: string, seed: number, options: LiveOptions = {}): LiveSignalRow[] {
  const settings = DIFFICULTY_LEVELS[options.difficulty ?? LIVE.difficulty];
  const maxLag = Math.max(...SYNTHETIC_SIGNAL_TYPES.map((s) => settings.reportingLagDays[s].max));
  // Pin the start: an injection with no startDate starts on `date`, not on each earlier day looked at.
  const fixed: LiveOptions = { ...options, city: options.city ?? new GridCity(), startDate: options.startDate ?? date };
  const rows: LiveSignalRow[] = [];
  for (let back = maxLag; back >= 0; back--) {
    // Earlier days before the start get no outbreak (the curve is 0 before day 0).
    rows.push(...generateLiveDay(addDays(date, -back), seed, fixed).filter((r) => r.reportedOn === date));
  }
  return rows;
}
