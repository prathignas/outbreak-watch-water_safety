import { GridCity, type CityModel } from "./city.js";
import { addDays, dateRange, daysBetween, monthOf, weekdayOf, yearOf } from "./dates.js";
import {
  DATA_SPLIT,
  DIFFICULTY_LEVELS,
  FESTIVAL_SURGE,
  FESTIVALS,
  NORMAL_DAILY_LEVEL,
  OUTBREAK_MIX_PER_YEAR,
  OUTBREAK_PLACEMENT,
  OUTBREAK_PROFILES,
  RAIN_SURGE,
  SIGNAL_DELAY_DAYS,
  SIM_PERIOD,
  SIMULATION,
  WEEKDAY_EFFECT,
  type DifficultyLevel,
  type DifficultySettings,
} from "./params.js";
import { loadRealRain, type RainDay } from "./realRain.js";
import { seasonalEffectOn } from "./season.js";
import { createRng, type Rng } from "./rng.js";
import { SYNTHETIC_SIGNAL_TYPES, type SignalRow, type SyntheticSignalType } from "./types.js";

/*
 * The grounded simulator. It makes 4 years of daily numbers for every ward:
 *   - rain is REAL (Open-Meteo, the same value for every ward),
 *   - complaints, pharmacy sales and hospital visits are SYNTHETIC,
 *   - harmless surges (after real rain days and real festival dates) are mixed in,
 *   - outbreaks are planted, and an answer key records exactly where and when.
 * The backtest later asks: did the detector find the planted outbreaks, how
 * early, and how often did it cry wolf on harmless surges?
 */

export type OutbreakCause = keyof typeof OUTBREAK_PROFILES;
export type DataSplitName = "tuning" | "test";

/** One planted outbreak: the truth the detector is scored against. */
export interface OutbreakAnswer {
  /** e.g. "2022-water-1". */
  id: string;
  cause: OutbreakCause;
  /** Tuning years may be looked at while choosing settings; test years may not. */
  split: DataSplitName;
  /** Where it starts. null for the seasonal wave, which is everywhere. */
  originWardId: number | null;
  /** The pipeline zone, for water outbreaks only. */
  zoneId: number | null;
  /** Every ward it touches, and how strongly (1 = full effect). */
  affectedWards: Array<{ wardId: number; weight: number }>;
  /** First day people fall ill. */
  startDate: string;
  /** Day the illness is at its worst. */
  peakDate: string;
  /** Last day of extra illness. */
  endDate: string;
  /** Days between falling ill and each signal showing it. */
  signalDelayDays: Record<SyntheticSignalType, number>;
  /** First day each signal is affected (startDate + delay). */
  firstSignalDate: Record<SyntheticSignalType, string>;
  /** For water outbreaks: the real rainy day that set it off, if any. */
  triggerRainDate: string | null;
}

/** A city-wide rise that is NOT an outbreak. Alerts here count as false alarms. */
export interface HarmlessSurge {
  kind: "rain" | "festival";
  /** e.g. "Deepavali" or "23.4 mm rain". */
  label: string;
  triggerDate: string;
  effects: Array<{ signal: SyntheticSignalType; startDate: string; endDate: string; boost: number }>;
}

/** A normal database row, plus the day it reached our system. */
export interface SimSignalRow extends SignalRow {
  reportedOn: string;
}

export interface SimulationOptions {
  difficulty?: DifficultyLevel;
  seed?: number;
  city?: CityModel;
  rain?: RainDay[];
}

export interface Simulation {
  difficulty: DifficultyLevel;
  seed: number;
  settings: DifficultySettings;
  dates: string[];
  wardIds: number[];
  rain: RainDay[];
  answerKey: { outbreaks: OutbreakAnswer[]; harmlessSurges: HarmlessSurge[] };
  /** The synthetic count for one signal, ward and day. */
  count(signal: SyntheticSignalType, wardId: number, date: string): number;
  /** The day that count reached our system (date + reporting lag). */
  reportedOn(signal: SyntheticSignalType, wardId: number, date: string): string;
  /** What a normal day would average (weekday and season only; no surge, outbreak or noise). */
  normalLevel(signal: SyntheticSignalType, date: string): number;
  /** Real rain in mm for that day. */
  rainOn(date: string): number;
  splitOf(date: string): DataSplitName;
  /** Every row: synthetic health rows plus one real rain row per ward per day. */
  rows(): Generator<SimSignalRow>;
}

/** Counts are stored as 16-bit numbers to keep ~1 million values small in memory. */
const MAX_COUNT = 65_535;
/** How many random tries to find a free place and time for an outbreak before giving up loudly. */
const MAX_PLACEMENT_TRIES = 1000;
/** Bigger outbreaks are placed first so the small ones fit around them. */
const PLACEMENT_ORDER: OutbreakCause[] = ["seasonal", "water", "p2p", "food"];

export function splitOfYear(year: number): DataSplitName {
  if (DATA_SPLIT.tuningYears.includes(year)) return "tuning";
  if (DATA_SPLIT.testYears.includes(year)) return "test";
  throw new RangeError(`Year ${year} is in neither the tuning nor the test split`);
}

/**
 * Outbreak shape as a fraction of its peak (0 to 1) on day t after it starts:
 * a straight climb over rampDays, then a straight fall until durationDays.
 */
export function outbreakCurve(cause: OutbreakCause, t: number): number {
  const { rampDays, durationDays } = OUTBREAK_PROFILES[cause];
  if (t < 0 || t >= durationDays) return 0;
  if (t < rampDays) return (t + 1) / rampDays;
  return (durationDays - t) / (durationDays - rampDays + 1);
}

export function simulate(options: SimulationOptions = {}): Simulation {
  const difficulty = options.difficulty ?? "realistic";
  const seed = options.seed ?? SIMULATION.randomSeed;
  const city = options.city ?? new GridCity();
  const settings = DIFFICULTY_LEVELS[difficulty];
  if (!settings) throw new RangeError(`Unknown difficulty: ${difficulty}`);

  const dates = dateRange(SIM_PERIOD.startDate, SIM_PERIOD.endDate);
  const dayCount = dates.length;
  const rain = alignRain(options.rain ?? loadRealRain(), dates);
  const wardIds = city.wardIds();
  const wardIndex = new Map(wardIds.map((wardId, index) => [wardId, index]));
  const dayIndexOf = (date: string): number => {
    const day = daysBetween(SIM_PERIOD.startDate, date);
    if (day < 0 || day >= dayCount) throw new RangeError(`Date outside simulation: ${date}`);
    return day;
  };

  // Separate random streams, so e.g. changing noise never moves where outbreaks are planted.
  const scheduleRng = createRng(seed);
  const noiseRng = createRng(seed + 1);
  const lagRng = createRng(seed + 2);

  // 1. Harmless city-wide surges from real rain days and real festival dates.
  const cityBoost = makeSignalArrays(() => new Float64Array(dayCount));
  const harmlessSurges = buildHarmlessSurges(rain, dates, settings.harmlessSurgeScale);
  for (const surge of harmlessSurges) {
    for (const effect of surge.effects) {
      for (let day = dayIndexOf(effect.startDate); day <= dayIndexOf(effect.endDate); day++) {
        cityBoost[effect.signal][day] += effect.boost;
      }
    }
  }

  // 2. Plant outbreaks and record the answer key.
  const outbreakExcess = makeSignalArrays(() => new Float64Array(wardIds.length * dayCount));
  const outbreaks = planOutbreaks({ city, rain, dates, scheduleRng });
  for (const outbreak of outbreaks) {
    const { peakMultiplier, durationDays } = OUTBREAK_PROFILES[outbreak.cause];
    const start = dayIndexOf(outbreak.startDate);
    for (const signal of SYNTHETIC_SIGNAL_TYPES) {
      const delay = outbreak.signalDelayDays[signal];
      for (const { wardId, weight } of outbreak.affectedWards) {
        const base = (wardIndex.get(wardId) as number) * dayCount;
        for (let t = 0; t < durationDays; t++) {
          const day = start + t + delay;
          if (day >= dayCount) break;
          outbreakExcess[signal][base + day] +=
            weight * settings.outbreakStrength * (peakMultiplier - 1) * outbreakCurve(outbreak.cause, t);
        }
      }
    }
  }

  // 3. Draw the actual counts: normal level x surges x outbreak x noise, then a Poisson count.
  const normal = makeSignalArrays(() => new Float64Array(dayCount));
  for (const signal of SYNTHETIC_SIGNAL_TYPES) {
    dates.forEach((date, day) => {
      normal[signal][day] =
        NORMAL_DAILY_LEVEL[signal] * WEEKDAY_EFFECT[signal][weekdayOf(date)] * seasonalEffectOn(date);
    });
  }

  const noise = settings.noiseLevel;
  const counts = makeSignalArrays(() => new Uint16Array(wardIds.length * dayCount));
  const lags = makeSignalArrays(() => new Uint8Array(wardIds.length * dayCount));
  for (const signal of SYNTHETIC_SIGNAL_TYPES) {
    const lagRange = settings.reportingLagDays[signal];
    for (let ward = 0; ward < wardIds.length; ward++) {
      for (let day = 0; day < dayCount; day++) {
        const cell = ward * dayCount + day;
        // Log-normal noise with average 1, so noise never changes the long-run level.
        const noiseFactor = Math.exp(noise * noiseRng.normal() - (noise * noise) / 2);
        const mean = normal[signal][day] * (1 + cityBoost[signal][day]) * (1 + outbreakExcess[signal][cell]) * noiseFactor;
        counts[signal][cell] = Math.min(noiseRng.poisson(mean), MAX_COUNT);
        lags[signal][cell] = lagRng.int(lagRange.min, lagRange.max);
      }
    }
  }

  const cellOf = (wardId: number, date: string): number => {
    const ward = wardIndex.get(wardId);
    if (ward === undefined) throw new RangeError(`Unknown ward id: ${wardId}`);
    return ward * dayCount + dayIndexOf(date);
  };

  return {
    difficulty,
    seed,
    settings,
    dates,
    wardIds,
    rain,
    answerKey: { outbreaks, harmlessSurges },
    count: (signal, wardId, date) => counts[signal][cellOf(wardId, date)],
    reportedOn: (signal, wardId, date) => addDays(date, lags[signal][cellOf(wardId, date)]),
    normalLevel: (signal, date) => normal[signal][dayIndexOf(date)],
    rainOn: (date) => rain[dayIndexOf(date)].mm,
    splitOf: (date) => splitOfYear(yearOf(date)),
    *rows() {
      for (let day = 0; day < dayCount; day++) {
        const date = dates[day];
        for (let ward = 0; ward < wardIds.length; ward++) {
          const wardId = wardIds[ward];
          const cell = ward * dayCount + day;
          for (const signal of SYNTHETIC_SIGNAL_TYPES) {
            yield {
              wardId,
              signalType: signal,
              date,
              count: counts[signal][cell],
              sourceTag: "synthetic",
              reportedOn: addDays(date, lags[signal][cell]),
            };
          }
          // Design choice: real rain is treated as available the same day.
          yield { wardId, signalType: "rain", date, count: rain[day].mm, sourceTag: "real", reportedOn: date };
        }
      }
    },
  };
}

function makeSignalArrays<T>(make: () => T): Record<SyntheticSignalType, T> {
  return { complaint: make(), pharmacy: make(), hospital: make() };
}

/** Picks out exactly the simulation days from the real rain. Missing days are an error, never filled in. */
function alignRain(rain: RainDay[], dates: string[]): RainDay[] {
  const byDate = new Map(rain.map((day) => [day.date, day]));
  return dates.map((date) => {
    const day = byDate.get(date);
    if (!day) throw new Error(`No real rain for ${date}; refusing to invent it. Run "npm run fetch-rain".`);
    return day;
  });
}

function buildHarmlessSurges(rain: RainDay[], dates: string[], scale: number): HarmlessSurge[] {
  if (scale === 0) return [];
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const clip = (signal: SyntheticSignalType, triggerDate: string, startDay: number, days: number, boost: number) => {
    const startDate = addDays(triggerDate, startDay);
    const endDate = addDays(startDate, days - 1);
    if (startDate > lastDate || endDate < firstDate) return [];
    return [{
      signal,
      startDate: startDate < firstDate ? firstDate : startDate,
      endDate: endDate > lastDate ? lastDate : endDate,
      boost: boost * scale,
    }];
  };

  const rainSurges: HarmlessSurge[] = rain
    .filter((day) => day.mm >= RAIN_SURGE.triggerMm)
    .map((day) => ({
      kind: "rain",
      label: `${day.mm.toFixed(1)} mm rain`,
      triggerDate: day.date,
      effects: [
        ...clip("complaint", day.date, RAIN_SURGE.complaintStartDay, RAIN_SURGE.complaintDays, RAIN_SURGE.complaintBoost),
        ...clip("pharmacy", day.date, RAIN_SURGE.pharmacyStartDay, RAIN_SURGE.pharmacyDays, RAIN_SURGE.pharmacyBoost),
      ],
    }));

  const festivalSurges: HarmlessSurge[] = FESTIVALS
    .filter((festival) => festival.date >= firstDate && festival.date <= lastDate)
    .map((festival) => ({
      kind: "festival",
      label: festival.name,
      triggerDate: festival.date,
      effects: [
        ...clip("complaint", festival.date, FESTIVAL_SURGE.startDay, FESTIVAL_SURGE.days, FESTIVAL_SURGE.complaintBoost),
        ...clip("pharmacy", festival.date, FESTIVAL_SURGE.startDay, FESTIVAL_SURGE.days, FESTIVAL_SURGE.pharmacyBoost),
      ],
    }));

  return [...rainSurges, ...festivalSurges].sort((a, b) => a.triggerDate.localeCompare(b.triggerDate));
}

interface PlanInput {
  city: CityModel;
  rain: RainDay[];
  dates: string[];
  scheduleRng: Rng;
}

/**
 * Decides where and when every outbreak happens. Rules:
 * - each outbreak (and all its delayed signals) stays inside one calendar year,
 *   so nothing leaks between the tuning and test years;
 * - none starts during the warm-up weeks;
 * - local outbreaks touching the same ward are kept apart by gapDays;
 * - the seasonal wave may overlap local outbreaks (that happens in real life).
 */
function planOutbreaks({ city, rain, dates, scheduleRng }: PlanInput): OutbreakAnswer[] {
  const maxDelay = Math.max(...SYNTHETIC_SIGNAL_TYPES.map((signal) => SIGNAL_DELAY_DAYS[signal].max));
  const allWards = city.wardIds();
  const foodWards = allWards.filter((wardId) => city.isFoodVenueWard(wardId));
  const busy = new Map<number, Array<[number, number]>>();
  const rainyDays = rain.flatMap((day, index) => (day.mm >= RAIN_SURGE.triggerMm ? [index] : []));
  const years = [...new Set(dates.map(yearOf))];
  const outbreaks: OutbreakAnswer[] = [];

  for (const year of years) {
    const firstDay = Math.max(dates.indexOf(`${year}-01-01`), OUTBREAK_PLACEMENT.warmupDays);
    const lastDay = dates.lastIndexOf(dates.filter((date) => yearOf(date) === year).at(-1) as string);

    for (const cause of PLACEMENT_ORDER) {
      for (let number = 1; number <= OUTBREAK_MIX_PER_YEAR[cause]; number++) {
        const profile = OUTBREAK_PROFILES[cause];
        const footprint = profile.durationDays + maxDelay; // start day to last affected signal day
        const latestStart = lastDay - footprint + 1;
        if (latestStart < firstDay) throw new Error(`Year ${year} is too short for a ${cause} outbreak`);

        let placed = false;
        for (let attempt = 0; attempt < MAX_PLACEMENT_TRIES && !placed; attempt++) {
          let start: number;
          let originWardId: number | null = null;
          let triggerRainDay: number | null = null;

          if (cause === "seasonal") {
            const [fromMonth, toMonth] = OUTBREAK_PLACEMENT.seasonalStartMonths;
            const window = dates
              .map((date, day) => ({ date, day }))
              .filter(({ date, day }) => yearOf(date) === year && monthOf(date) >= fromMonth && monthOf(date) <= toMonth &&
                day >= firstDay && day <= latestStart);
            if (window.length === 0) throw new Error(`No room for the seasonal wave in ${year}`);
            start = scheduleRng.pick(window).day;
          } else {
            const rainyThisYear = rainyDays.filter((day) => day >= firstDay - OUTBREAK_PLACEMENT.waterDaysAfterRain && day <= latestStart);
            if (cause === "water" && rainyThisYear.length > 0) {
              triggerRainDay = scheduleRng.pick(rainyThisYear);
              start = triggerRainDay + scheduleRng.int(1, OUTBREAK_PLACEMENT.waterDaysAfterRain);
            } else {
              start = scheduleRng.int(firstDay, latestStart);
            }
            if (start < firstDay || start > latestStart) continue;
            originWardId = scheduleRng.pick(cause === "food" ? foodWards : allWards);
          }

          const affectedWards = affectedWardsOf(cause, originWardId, city);
          const end = start + footprint - 1;
          if (cause !== "seasonal" && affectedWards.some(({ wardId }) => isBusy(busy, wardId, start, end))) continue;
          if (cause !== "seasonal") {
            for (const { wardId } of affectedWards) {
              busy.set(wardId, [...(busy.get(wardId) ?? []), [start, end]]);
            }
          }

          const startDate = dates[start];
          const signalDelayDays = makeSignalArrays(() => 0);
          const firstSignalDate = makeSignalArrays(() => startDate);
          for (const signal of SYNTHETIC_SIGNAL_TYPES) {
            const { min, max } = SIGNAL_DELAY_DAYS[signal];
            signalDelayDays[signal] = scheduleRng.int(min, max);
            firstSignalDate[signal] = addDays(startDate, signalDelayDays[signal]);
          }

          outbreaks.push({
            id: `${year}-${cause}-${number}`,
            cause,
            split: splitOfYear(year),
            originWardId,
            zoneId: cause === "water" && originWardId !== null ? city.getZoneOfWard(originWardId) : null,
            affectedWards,
            startDate,
            peakDate: addDays(startDate, profile.rampDays - 1),
            endDate: addDays(startDate, profile.durationDays - 1),
            signalDelayDays,
            firstSignalDate,
            triggerRainDate: triggerRainDay === null ? null : dates[triggerRainDay],
          });
          placed = true;
        }
        if (!placed) throw new Error(`Could not place ${cause} outbreak ${number} in ${year}`);
      }
    }
  }

  return outbreaks.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function isBusy(busy: Map<number, Array<[number, number]>>, wardId: number, start: number, end: number): boolean {
  const gap = OUTBREAK_PLACEMENT.gapDays;
  return (busy.get(wardId) ?? []).some(([from, to]) => start <= to + gap && end >= from - gap);
}

/** Which wards an outbreak reaches, and how strongly. */
function affectedWardsOf(cause: OutbreakCause, originWardId: number | null, city: CityModel) {
  const spread = OUTBREAK_PROFILES[cause].neighbourSpread;
  if (originWardId === null) {
    return city.wardIds().map((wardId) => ({ wardId, weight: spread }));
  }
  // Water follows the pipes: every ward on the same supply zone. Others spread to bordering wards.
  const zoneId = cause === "water" ? city.getZoneOfWard(originWardId) : null;
  const others = zoneId !== null
    ? city.getWardsInZone(zoneId).filter((wardId) => wardId !== originWardId)
    : city.getNeighbours(originWardId);
  return [{ wardId: originWardId, weight: 1 }, ...others.map((wardId) => ({ wardId, weight: spread }))];
}
