import type { SignalType, SyntheticSignalType } from "./types.js";

/*
 * Every number the detection system uses lives here, so we can see and defend
 * each one. Each number says where it came from: a source you can check, or
 * "ASSUMPTION - needs source". Results must never be tuned by hand to look good.
 */

// ---------------------------------------------------------------------------
// Normal levels (used by the simulator to make synthetic data)
// ---------------------------------------------------------------------------

/** Average daily count in one ward on a normal day, before weekday and season effects. */
export const NORMAL_DAILY_LEVEL: Record<SignalType, number> = {
  complaint: 2, // ASSUMPTION - needs source. Citizen complaints about water or illness per ward per day.
  pharmacy: 30, // ASSUMPTION - needs source. Diarrhoea-related sales (ORS, anti-diarrhoeals) per ward per day.
  hospital: 3, // ASSUMPTION - needs source. Stomach-illness hospital visits per ward per day.
  rain: 2, // ASSUMPTION - needs source. Not used since Piece 3: the simulator uses real rain (see RAIN_SOURCE).
};

/**
 * Weekday effect: multiply the normal level by this. Index 0 = Sunday, 6 = Saturday
 * (matches JavaScript's Date.getDay()).
 */
export const WEEKDAY_EFFECT: Record<SignalType, number[]> = {
  complaint: [0.7, 1.1, 1.05, 1.0, 1.0, 1.0, 0.8], // ASSUMPTION - needs source. Fewer complaints filed on weekends.
  pharmacy: [0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05], // ASSUMPTION - needs source. Sales fairly flat, a little lower on Sunday.
  hospital: [0.8, 1.15, 1.05, 1.0, 1.0, 1.0, 0.9], // ASSUMPTION - needs source. Fewer visits on weekends, catch-up on Monday.
  rain: [1, 1, 1, 1, 1, 1, 1], // Rain does not know what day it is.
};

/**
 * Extra day-to-day noise on top of natural count noise, as a fraction of the level.
 * 0.15 means a typical day can be about 15% above or below its expected level.
 */
export const NOISE_LEVEL = 0.15; // ASSUMPTION - needs source.

/**
 * City-wide seasonal pattern for health signals: multiply the normal level by this.
 * Index 0 = January, 11 = December.
 * Which months are "monsoon": IMD season definitions (monsoon June-September,
 * post-monsoon October-December). The multiplier values: ASSUMPTION - needs source.
 */
export const SEASONAL_EFFECT = [
  1.0, 1.0, // Jan, Feb: winter
  1.05, 1.1, 1.1, // Mar-May: pre-monsoon, hot
  1.3, 1.4, 1.4, 1.3, // Jun-Sep: monsoon, more water-borne illness
  1.2, 1.1, 1.0, // Oct-Dec: post-monsoon
];

/**
 * Rain by month, in mm per day.
 * ASSUMPTION - needs source. Not used since Piece 3: the simulator uses real
 * Open-Meteo rain instead (see RAIN_SOURCE). Kept so older code still compiles.
 */
export const RAIN_SEASONAL_EFFECT = [
  0.1, 0.1, // Jan, Feb
  0.3, 0.8, 1.5, // Mar-May
  1.5, 1.5, 2.0, 2.5, // Jun-Sep
  2.5, 1.2, 0.3, // Oct-Dec
];

// ---------------------------------------------------------------------------
// Signal delays: how many days after people fall ill each signal shows it
// ---------------------------------------------------------------------------

/**
 * Days between infection and the signal showing it, as a range.
 * ASSUMPTION - needs source. The order (complaints first, then pharmacy, then
 * hospital) is our team's design choice: people complain, then buy medicine,
 * then go to hospital only if it gets worse.
 */
export const SIGNAL_DELAY_DAYS: Record<SignalType, { min: number; max: number }> = {
  complaint: { min: 0, max: 1 },
  pharmacy: { min: 1, max: 2 },
  hospital: { min: 3, max: 4 },
  rain: { min: 0, max: 0 }, // Rain is the cause, not a symptom, so it has no delay.
};

// ---------------------------------------------------------------------------
// Outbreaks (used by the simulator to plant outbreaks for the backtest)
// ---------------------------------------------------------------------------

/** How each kind of outbreak looks. Every value: ASSUMPTION - needs source. */
export interface OutbreakProfile {
  /** At its worst, signals are this many times normal. */
  peakMultiplier: number;
  /** Days from start to the worst day. */
  rampDays: number;
  /** Total days the outbreak lasts. */
  durationDays: number;
  /** Share of the effect that also reaches neighbouring wards (0 = none, 1 = all). */
  neighbourSpread: number;
}

export const OUTBREAK_PROFILES: Record<"water" | "food" | "p2p" | "seasonal", OutbreakProfile> = {
  // Contaminated pipe: sharp rise, lasts until the leak is fixed, neighbours on the same line are hit.
  water: { peakMultiplier: 4, rampDays: 3, durationDays: 14, neighbourSpread: 0.5 },
  // One bad meal or vendor: very sudden, short, stays local.
  food: { peakMultiplier: 3, rampDays: 1, durationDays: 4, neighbourSpread: 0.1 },
  // Passed between people: slow build, lasts weeks, creeps into neighbours.
  p2p: { peakMultiplier: 2, rampDays: 7, durationDays: 21, neighbourSpread: 0.3 },
  // Season-wide rise: gentle, long, everywhere at once.
  seasonal: { peakMultiplier: 1.5, rampDays: 14, durationDays: 60, neighbourSpread: 1.0 },
};

/** Backtest setup. */
export const SIMULATION = {
  years: 4, // Matches SIM_PERIOD (2022-2025, the years we have real rain for). CONTEXT.md first said 3.
  outbreaksPerYear: 12, // ASSUMPTION - needs source. Enough outbreaks to measure detection, not a real-world rate.
  randomSeed: 42, // Any fixed number; it only makes runs repeatable.
};

// ---------------------------------------------------------------------------
// Grid city (a stand-in for real Bengaluru wards until PostGIS data is wired in)
// ---------------------------------------------------------------------------

/** Shape of the test city. None of these are measurements of Bengaluru. */
export const GRID_CITY = {
  columns: 20, // Our design choice. 20 x 10 = 200 wards, close to Bengaluru's ward count in size.
  rows: 10, // Our design choice.
  zoneColumns: 5, // Our design choice. 5 x 3 = 15 pipeline zones.
  zoneRows: 3, // Our design choice.
  foodVenueShare: 0.1, // ASSUMPTION - needs source. About 10% of wards have a busy food market or street.
  randomSeed: 7, // Any fixed number; it only makes the food venue wards repeatable.
};

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** Minimum number of past same-weekday values before we trust a baseline (4 = four weeks). */
export const MIN_HISTORY = 4; // ASSUMPTION - needs source.

/** How many weeks back we look to work out "normal" for a ward and weekday. */
export const BASELINE_LOOKBACK_WEEKS = 8; // ASSUMPTION - needs source.

export const DETECTOR_THRESHOLDS = {
  /** Threshold method: alert when today is this many spreads above normal. */
  thresholdScore: 3, // ASSUMPTION - needs source. Common "3 standard deviations" rule of thumb.
  /** CUSUM: ignore excess below this many spreads per day (filters normal noise). */
  cusumSlack: 0.5, // ASSUMPTION - needs source. Usual textbook default for CUSUM.
  /** CUSUM: alert when the running total of excess passes this. */
  cusumLimit: 4, // ASSUMPTION - needs source. Usual textbook default for CUSUM.
  /** Bayes: alert when the chance of an outbreak passes this. */
  bayesProbability: 0.8, // ASSUMPTION - needs source.
  /** Bayes: chance of an outbreak in a given ward on a given day before looking at data. */
  bayesPriorPerWardDay: 0.002, // ASSUMPTION - needs source. Roughly 1 outbreak per ward every ~1.4 years.
  /** Neighbour check: a neighbour this many spreads above normal counts as "also rising". */
  neighbourScore: 2, // ASSUMPTION - needs source.
};

/** Most false alarms we accept per ward per year. Detector thresholds are judged against this. */
export const FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR = 1; // ASSUMPTION - needs source.

/** After an alert, do not raise another for the same ward for this many days. */
export const ALERT_COOLDOWN_DAYS = 7; // ASSUMPTION - needs source.

// ---------------------------------------------------------------------------
// Piece 3: the grounded simulator
// ---------------------------------------------------------------------------

/** The days we simulate. Chosen to match the real rain we downloaded (team design choice). */
export const SIM_PERIOD = { startDate: "2022-01-01", endDate: "2025-12-31" };

/**
 * Tuning years: the only years we may look at while choosing detector settings.
 * Test years: kept aside and scored once at the end, so results are honest.
 * Team design choice.
 */
export const DATA_SPLIT = { tuningYears: [2022, 2023], testYears: [2024, 2025] };

/**
 * Real daily rain for Bengaluru. Source: Open-Meteo Historical Weather API
 * (https://archive-api.open-meteo.com/v1/archive), field precipitation_sum.
 * It is a weather-model reanalysis for one grid cell, not a rain-gauge reading,
 * and we use the same value for every ward. See data/SOURCES.md.
 */
export const RAIN_SOURCE = {
  url: "https://archive-api.open-meteo.com/v1/archive",
  latitude: 12.9716, // Central Bengaluru (the point we asked for). Open-Meteo answered for 12.970, 77.564.
  longitude: 77.5946,
  startDate: "2022-01-01",
  endDate: "2025-12-31",
  timezone: "Asia/Kolkata",
  file: "data/raw/rain.json",
};

/**
 * Harmless rain surge: after a rainy day, people file waterlogging/drain complaints
 * and buy a bit more medicine, but nobody is part of an outbreak. The detector must
 * learn not to panic about these.
 */
export const RAIN_SURGE = {
  triggerMm: 15.6, // Source: IMD rainfall terms, "moderate rain" starts at 15.6 mm in a day. TODO: add exact IMD URL.
  complaintBoost: 0.8, // ASSUMPTION - needs source. Complaints +80% city-wide.
  complaintStartDay: 0, // ASSUMPTION - needs source. Same day as the rain.
  complaintDays: 2, // ASSUMPTION - needs source.
  pharmacyBoost: 0.15, // ASSUMPTION - needs source. Pharmacy sales +15% city-wide.
  pharmacyStartDay: 1, // ASSUMPTION - needs source. The day after the rain.
  pharmacyDays: 2, // ASSUMPTION - needs source.
};

/**
 * Big Bengaluru festivals (2022-2025). Dates source: Google Calendar public
 * "Holidays in India" feed (en.indian#holiday@group.v.calendar.google.com),
 * downloaded 2026-10-06. Karnataka's official holiday may differ by a day.
 */
export const FESTIVALS: Array<{ name: string; date: string }> = [
  { name: "Makar Sankranti", date: "2022-01-14" },
  { name: "Ugadi", date: "2022-04-02" },
  { name: "Ganesh Chaturthi", date: "2022-08-31" },
  { name: "Deepavali", date: "2022-10-24" },
  { name: "Makar Sankranti", date: "2023-01-14" },
  { name: "Ugadi", date: "2023-03-22" },
  { name: "Ganesh Chaturthi", date: "2023-09-19" },
  { name: "Deepavali", date: "2023-11-12" },
  { name: "Makar Sankranti", date: "2024-01-14" },
  { name: "Ugadi", date: "2024-04-09" },
  { name: "Ganesh Chaturthi", date: "2024-09-07" },
  { name: "Deepavali", date: "2024-10-31" },
  { name: "Makar Sankranti", date: "2025-01-14" },
  { name: "Ugadi", date: "2025-03-30" },
  { name: "Ganesh Chaturthi", date: "2025-08-27" },
  { name: "Deepavali", date: "2025-10-20" },
];

/** Harmless festival surge: feasting and crowds mean more stomach upsets and complaints for a few days. */
export const FESTIVAL_SURGE = {
  complaintBoost: 0.3, // ASSUMPTION - needs source. Complaints +30% city-wide (garbage, crowds).
  pharmacyBoost: 0.3, // ASSUMPTION - needs source. Pharmacy sales +30% city-wide.
  startDay: 1, // ASSUMPTION - needs source. Starts the day after the festival.
  days: 3, // ASSUMPTION - needs source.
};

/** How many of each outbreak type we plant per year. Adds up to SIMULATION.outbreaksPerYear. */
export const OUTBREAK_MIX_PER_YEAR = {
  water: 4, // ASSUMPTION - needs source.
  food: 4, // ASSUMPTION - needs source.
  p2p: 3, // ASSUMPTION - needs source.
  seasonal: 1, // ASSUMPTION - needs source. One bad season a year.
};

/** Rules for where and when outbreaks are planted. */
export const OUTBREAK_PLACEMENT = {
  /** Water outbreaks start 1 to this many days after a real rainy day (>= RAIN_SURGE.triggerMm). */
  waterDaysAfterRain: 7, // ASSUMPTION - needs source. Rain-driven sewage leaks into pipes.
  /** The seasonal wave starts between these months (0 = January). June-July = start of monsoon (IMD season). */
  seasonalStartMonths: [5, 6], // Month choice from IMD monsoon season; that the wave starts then is ASSUMPTION - needs source.
  /** Quiet days kept between two outbreaks touching the same ward, so answers are not ambiguous. */
  gapDays: 14, // Team design choice.
  /** No outbreak in the first weeks, so the detector has history to compare with. */
  warmupDays: BASELINE_LOOKBACK_WEEKS * 7, // Derived from BASELINE_LOOKBACK_WEEKS.
};

export type DifficultyLevel = "easy" | "realistic" | "hard";

export interface DifficultySettings {
  /** Multiplies how far above normal an outbreak goes (1 = OUTBREAK_PROFILES as written). */
  outbreakStrength: number;
  /** Day-to-day noise, as a fraction of the level (replaces NOISE_LEVEL). */
  noiseLevel: number;
  /** Multiplies the rain and festival surges (0 = switched off). */
  harmlessSurgeScale: number;
  /** Days between a count happening and it reaching our system, per signal. */
  reportingLagDays: Record<SyntheticSignalType, { min: number; max: number }>;
}

/** Three test settings for the backtest. All values: ASSUMPTION - needs source. */
export const DIFFICULTY_LEVELS: Record<DifficultyLevel, DifficultySettings> = {
  // Loud outbreaks, little noise, no harmless surges, no reporting lag.
  easy: {
    outbreakStrength: 1.5,
    noiseLevel: 0.08,
    harmlessSurgeScale: 0,
    reportingLagDays: { complaint: { min: 0, max: 0 }, pharmacy: { min: 0, max: 0 }, hospital: { min: 0, max: 0 } },
  },
  // Our best guess at real life.
  realistic: {
    outbreakStrength: 1,
    noiseLevel: NOISE_LEVEL,
    harmlessSurgeScale: 1,
    reportingLagDays: { complaint: { min: 0, max: 0 }, pharmacy: { min: 0, max: 1 }, hospital: { min: 1, max: 3 } },
  },
  // Quiet outbreaks, noisy data, bigger harmless surges, slow reporting.
  hard: {
    outbreakStrength: 0.6,
    noiseLevel: 0.25,
    harmlessSurgeScale: 1.5,
    reportingLagDays: { complaint: { min: 0, max: 1 }, pharmacy: { min: 1, max: 2 }, hospital: { min: 2, max: 5 } },
  },
};

// ---------------------------------------------------------------------------
// Piece 4: the three detectors
// ---------------------------------------------------------------------------

/**
 * Bayes: how a score turns into evidence. A signal's likelihood ratio is
 * LR = min(lrCap, exp(gain * max(0, score - scoreFloor))).
 */
export const BAYES = {
  /** How fast evidence grows for each spread above the floor. */
  gain: 0.8, // ASSUMPTION - needs source. Calibrated later in the backtest on tuning years only.
  /** Scores up to this many spreads are ordinary noise and add no evidence (LR = 1). */
  scoreFloor: 1, // ASSUMPTION - needs source.
  /** One signal can multiply the odds by at most this much, so one broken feed cannot decide alone. */
  lrCap: 100, // ASSUMPTION - needs source.
  /** A signal "contributes" if its score passed this on any day in the evidence window. */
  contributionScore: 2, // ASSUMPTION - needs source.
  /**
   * Days of evidence looked at, today included. Derived: the gap between the earliest
   * signal (complaint) and the latest (hospital) in SIGNAL_DELAY_DAYS, plus today.
   * SIGNAL_DELAY_DAYS itself is an ASSUMPTION.
   */
  evidenceWindowDays: SIGNAL_DELAY_DAYS.hospital.max - SIGNAL_DELAY_DAYS.complaint.min + 1,
  /** How much the neighbouring wards' average score counts, compared with the ward's own signal. */
  neighbourWeight: 0.25, // ASSUMPTION - needs source. Kept low on purpose so neighbours only nudge.
  /** Fire only if at least this many different signals contributed. */
  minSignals: 2, // Team design rule: one signal alone is too easy to fake or break.
};

/** The slowest any synthetic signal reaches our system, over every difficulty level. Derived. */
const MAX_REPORTING_LAG_DAYS = Math.max(
  ...Object.values(DIFFICULTY_LEVELS).flatMap((level) => Object.values(level.reportingLagDays).map((lag) => lag.max)),
);

/**
 * CUSUM: how many days it waits for a late-reported day before giving up on it.
 * Derived from MAX_REPORTING_LAG_DAYS (the lags themselves are ASSUMPTIONs).
 */
export const CUSUM_MAX_WAIT_DAYS = MAX_REPORTING_LAG_DAYS;

/**
 * Demo and backtest: an alert counts as "found an outbreak" if it is in an affected ward
 * between the outbreak's first day and this many days after its last day.
 * Derived: the slowest signal delay plus the slowest reporting lag.
 */
export const ALERT_MATCH_GRACE_DAYS = SIGNAL_DELAY_DAYS.hospital.max + MAX_REPORTING_LAG_DAYS;

/** Every setting a detector reads, in one object, so tests and the backtest can swap values. */
export interface DetectorParams {
  /** Same-weekday weeks of history used for "normal". */
  lookbackWeeks: number;
  /** Threshold: alert when a score is above this. */
  thresholdScore: number;
  /** CUSUM allowance k: excess below this per day is ignored. */
  cusumSlack: number;
  /** CUSUM decision limit h: alert when the running sum is above this. */
  cusumLimit: number;
  /** CUSUM: days to wait for a late-reported day. */
  cusumMaxWaitDays: number;
  /** Bayes: chance of an outbreak in a ward on a day before looking at data. */
  bayesPrior: number;
  /** Bayes: alert when the chance of an outbreak is above this. */
  bayesAlertProbability: number;
  bayesGain: number;
  bayesScoreFloor: number;
  bayesLrCap: number;
  bayesContributionScore: number;
  bayesWindowDays: number;
  bayesNeighbourWeight: number;
  bayesMinSignals: number;
}

/** The default settings. Every value comes from a commented constant above. */
export const DETECTOR_PARAMS: DetectorParams = {
  lookbackWeeks: BASELINE_LOOKBACK_WEEKS,
  thresholdScore: DETECTOR_THRESHOLDS.thresholdScore,
  cusumSlack: DETECTOR_THRESHOLDS.cusumSlack,
  cusumLimit: DETECTOR_THRESHOLDS.cusumLimit,
  cusumMaxWaitDays: CUSUM_MAX_WAIT_DAYS,
  bayesPrior: DETECTOR_THRESHOLDS.bayesPriorPerWardDay,
  bayesAlertProbability: DETECTOR_THRESHOLDS.bayesProbability,
  bayesGain: BAYES.gain,
  bayesScoreFloor: BAYES.scoreFloor,
  bayesLrCap: BAYES.lrCap,
  bayesContributionScore: BAYES.contributionScore,
  bayesWindowDays: BAYES.evidenceWindowDays,
  bayesNeighbourWeight: BAYES.neighbourWeight,
  bayesMinSignals: BAYES.minSignals,
};

// ---------------------------------------------------------------------------
// Piece 5: the real Bengaluru city model (built by scripts/buildCity.ts)
// ---------------------------------------------------------------------------

export const REAL_CITY = {
  /** Two wards are neighbours if their borders touch or come within this many metres (map lines rarely meet exactly). */
  neighbourToleranceMetres: 20, // ASSUMPTION - needs source.
  /** A ward gets a water zone only if one BWSSB sub-division covers at least this share of its area; otherwise null. */
  minZoneShare: 0.5, // ASSUMPTION - needs source.
  /** The top this-share of wards by food venues per sq km are marked as food venue wards. */
  foodVenueTopShare: 0.1, // ASSUMPTION - needs source. Same 10% as GRID_CITY.foodVenueShare.
  /** OpenStreetMap amenity tags counted as food venues. Team design choice of which tags count. */
  foodAmenities: ["restaurant", "fast_food", "cafe", "food_court"],
  /** Where the OpenStreetMap food data comes from (data is ODbL, (c) OpenStreetMap contributors). */
  overpassUrl: "https://overpass-api.de/api/interpreter",
  osmFoodFile: "data/raw/osm_food.json",
  cityFile: "data/city.json",
};

// ---------------------------------------------------------------------------
// Piece 7: the backtest (rules written in docs/STATUS.md before any run)
// ---------------------------------------------------------------------------

/** Evenly spaced values from `from` to `to` (both included), rounded to avoid float drift. */
function gridOf(from: number, to: number, step: number): number[] {
  const count = Math.round((to - from) / step) + 1;
  return Array.from({ length: count }, (_, i) => Number((from + i * step).toFixed(6)));
}

export const BACKTEST = {
  /** Alerts of one method in the same or adjacent wards this close in days are one episode. */
  episodeGapDays: ALERT_COOLDOWN_DAYS, // Derived from ALERT_COOLDOWN_DAYS (an ASSUMPTION).
  /** Seeds for the full run. Seed i = SIMULATION.randomSeed + i. */
  seeds: 20, // Team design choice: enough runs to show the spread.
  /**
   * False-alarm budgets (episodes per ward per year) to calibrate for. Each method is
   * calibrated separately for each one. The first is FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR.
   */
  falseAlarmBudgets: [
    FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR,
    0.25, // ASSUMPTION - needs source. Team decision (2026-10-06): a stricter budget, one false alarm per ward every 4 years.
  ],
  /** Seeds for --quick (testing the pipeline only). */
  quickSeeds: 2, // Team design choice.
  /**
   * Search grids for each method's single alert setting. Team design choice:
   * wide enough that the strictest value is far past the default.
   */
  grids: {
    /** Threshold level, in spreads above normal. */
    threshold: gridOf(2, 40, 0.25),
    /** CUSUM decision limit h. */
    cusum: gridOf(1, 100, 0.5),
    /** Bayes alert probability: odds from 10^-1 to 10^6 in steps of 10^0.1, as probabilities. */
    bayes: gridOf(-1, 6, 0.1).map((log10Odds) => 10 ** log10Odds / (1 + 10 ** log10Odds)),
  },
};
