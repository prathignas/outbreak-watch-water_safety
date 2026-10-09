/** The four kinds of daily signal we watch. Listed as an array so code can loop over them. */
export const SIGNAL_TYPES = ["complaint", "pharmacy", "hospital", "rain"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** The signals the simulator makes up. Rain is not here because it is real data. */
export const SYNTHETIC_SIGNAL_TYPES = ["complaint", "pharmacy", "hospital"] as const;
export type SyntheticSignalType = (typeof SYNTHETIC_SIGNAL_TYPES)[number];

/** Where a number came from, so nobody mistakes synthetic data for real data. */
export const SOURCE_TAGS = ["real", "scraped", "user", "synthetic"] as const;
export type SourceTag = (typeof SOURCE_TAGS)[number];

/** Likely causes we give as a triage hint. "p2p" means person-to-person. */
export const CAUSE_TYPES = ["water", "food", "p2p", "seasonal", "unknown"] as const;
export type CauseType = (typeof CAUSE_TYPES)[number];

/** The three detection methods we compare in the backtest. */
export const DETECTION_METHODS = ["threshold", "cusum", "bayes"] as const;
export type DetectionMethod = (typeof DETECTION_METHODS)[number];

/** One day's total for one ward and one signal type. One row in the database. */
export interface SignalRow {
  /** Which ward this count belongs to. */
  wardId: number;
  /** Which kind of signal this is. */
  signalType: SignalType;
  /** The day, as YYYY-MM-DD. */
  date: string;
  /** How many that day (for rain: millimetres of rain). */
  count: number;
  /** Where the number came from. */
  sourceTag: SourceTag;
}

/** What the detector raises when a ward looks unusual. */
export interface Alert {
  /** The ward that looks unusual. */
  wardId: number;
  /** The day the alert was raised for, as YYYY-MM-DD. */
  date: string;
  /** How sure we are that something is wrong, from 0 (not at all) to 1 (certain). */
  score: number;
  /** Which detection method raised it. */
  method: DetectionMethod;
  /** Which signals were unusually high and pushed the score up. */
  contributingSignals: SignalType[];
  /** Chance of each likely cause. The five numbers add up to 1. */
  causeProbs: Record<CauseType, number>;
  /** The water supply zone we suspect, or null if we cannot tell. */
  suspectedZoneId: number | null;
  /** Short plain-English reasons an officer can read, e.g. "pharmacy sales 3x normal". */
  evidence: string[];
}
