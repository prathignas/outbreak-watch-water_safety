import { BAYES, RAIN_SURGE } from "./params.js";

/*
 * Every number the cause classifier (src/classifier.ts) uses. Same rule as
 * params.ts: each number is a checkable source, derived from one, or marked
 * "ASSUMPTION - needs source". The weights were written down BEFORE the
 * evaluation was run and were not tuned to its results (see docs/STATUS.md).
 */

export interface ClassifierParams {
  // --- Which alerts count as "currently alerting" -----------------------------
  /** An alert from this many days back (today included) still counts as "currently alerting". */
  activeAlertDays: number;

  // --- Feature: concentration in one pipeline zone ----------------------------
  /** A zone needs at least this many alerting wards before it can look like a pipe problem. */
  minZoneWards: number;
  /** suspectedZoneId is set when the zone's alerting share, above the city-wide share, reaches this. */
  suspectZoneShare: number;

  // --- Feature: onset speed ----------------------------------------------------
  /** Days of the ward's own history looked at to find the first rise and the peak. */
  onsetWindowDays: number;
  /** A day counts as "risen" when its score is above this many spreads. */
  riseScore: number;
  /** Days in the trailing rolling average used to find the peak (so one noisy day cannot become the peak). */
  onsetSmoothingDays: number;
  /** The peak day is the first day the rolling average reaches this share of its highest value in the window. */
  onsetPeakShare: number;
  /** Onset this fast or faster (days from first rise to peak) counts fully as "sudden". */
  fastOnsetDays: number;
  /** Onset this slow or slower counts fully as "gradual". */
  slowOnsetDays: number;

  // --- Feature: spread to neighbours ------------------------------------------
  /** Days looked back to see whether neighbouring wards have been creeping up. */
  spreadWindowDays: number;
  /** A neighbour counts as "spread to" when its average score over the window is above this. */
  neighbourMeanScore: number;

  // --- Feature: city-wide ------------------------------------------------------
  /** This share of all wards alerting at once counts fully as "city-wide". */
  cityWideAlertShare: number;
  /** Days averaged when checking how many wards are quietly elevated city-wide. */
  cityElevatedDays: number;
  /** A ward is "quietly elevated" when its average score over those days is above this. */
  cityElevatedScore: number;
  /** This share of wards quietly elevated counts fully as "city-wide". */
  cityWideElevatedShare: number;

  // --- Feature: heavy rain -------------------------------------------------------
  /** Rain at or above this many mm in a day counts as heavy. */
  heavyRainMm: number;
  /** Days looked back (today included) for heavy rain. */
  rainLookbackDays: number;

  // --- Rule weights (points added to a cause's score) ---------------------------
  weights: {
    water: { zoneConcentration: number; suddenOnset: number; heavyRain: number };
    food: { foodVenueWard: number; singleWard: number; suddenOnset: number };
    p2p: { gradualOnset: number; neighbourSpread: number; notFoodVenueWard: number };
    seasonal: { cityWide: number; gradualOnset: number };
  };
  /** Score points that "unknown" always has. A cause must beat this to win. */
  unknownBase: number;
  /** Extra points for "unknown" when the top two causes are close (mixed evidence). */
  mixedBonus: number;
  /** "Close" means the top two cause scores are within this many points. */
  mixedMargin: number;
  /** Softmax temperature: higher spreads the probabilities more evenly. */
  temperature: number;
}

export const CLASSIFIER_PARAMS: ClassifierParams = {
  // Derived: the same window the Bayes detector already looks over (BAYES.evidenceWindowDays).
  activeAlertDays: BAYES.evidenceWindowDays,

  minZoneWards: 2, // Team design choice: one ward alone can never look like a pipeline problem.
  suspectZoneShare: 0.25, // ASSUMPTION - needs source.

  onsetWindowDays: 14, // ASSUMPTION - needs source. Longer than the slowest local ramp in OUTBREAK_PROFILES (p2p, 7 days).
  riseScore: 1.5, // ASSUMPTION - needs source.
  onsetSmoothingDays: 3, // ASSUMPTION - needs source. Added 2026-10-06 (onset fix, see docs/STATUS.md); chosen on hand-built series, not on results.
  onsetPeakShare: 0.85, // ASSUMPTION - needs source. Added 2026-10-06 (onset fix); chosen on hand-built series (tests/classifier.test.ts), not on results.
  fastOnsetDays: 2, // ASSUMPTION - needs source.
  slowOnsetDays: 6, // ASSUMPTION - needs source.

  spreadWindowDays: 14, // ASSUMPTION - needs source. Brief asked for 10 to 14 days.
  neighbourMeanScore: 0.75, // ASSUMPTION - needs source.

  cityWideAlertShare: 0.3, // ASSUMPTION - needs source.
  cityElevatedDays: 3, // ASSUMPTION - needs source.
  cityElevatedScore: 1, // ASSUMPTION - needs source.
  cityWideElevatedShare: 0.5, // ASSUMPTION - needs source.

  // Source: IMD rainfall terms, "moderate rain" starts at 15.6 mm in a day (same as RAIN_SURGE.triggerMm). TODO: exact IMD URL.
  heavyRainMm: RAIN_SURGE.triggerMm,
  rainLookbackDays: 10, // ASSUMPTION - needs source.

  // Every weight below: ASSUMPTION - needs source. Chosen by reasoning about each cause, not fitted to data.
  weights: {
    water: { zoneConcentration: 2.5, suddenOnset: 1, heavyRain: 0.5 },
    food: { foodVenueWard: 1.5, singleWard: 1.5, suddenOnset: 1 },
    p2p: { gradualOnset: 2, neighbourSpread: 1, notFoodVenueWard: 0.25 },
    seasonal: { cityWide: 3.5, gradualOnset: 0.5 },
  },
  unknownBase: 2, // ASSUMPTION - needs source. Raised from 1.5 before any evaluation: at 1.5 a lone ward with no rise at all tied food.
  mixedBonus: 1, // ASSUMPTION - needs source.
  mixedMargin: 0.5, // ASSUMPTION - needs source.
  temperature: 1, // ASSUMPTION - needs source. Plain softmax.
};
