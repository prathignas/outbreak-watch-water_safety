import { BACKTEST, BASELINE_LOOKBACK_WEEKS, type DifficultyLevel } from "./params.js";
import type { DetectionMethod } from "./types.js";
import { CLASSIFIER_PARAMS } from "./params.classifier.js";

/*
 * Numbers used by the live-day generator (src/live.ts). Same rule as params.ts:
 * a source, a derivation, or "ASSUMPTION - needs source". The levels, noise,
 * outbreak shapes, signal delays and reporting lags are NOT repeated here: live.ts
 * reads them from params.ts so live data looks exactly like the backtest data.
 */

export const LIVE = {
  /** Which difficulty's noise, outbreak strength and reporting lags the live feed uses. */
  difficulty: "realistic" as DifficultyLevel, // Team design choice: our best guess at real life.
  /**
   * Days of history to seed the database with before going live. Derived: the
   * detectors' baseline window (BASELINE_LOOKBACK_WEEKS weeks) plus the classifier's
   * onset window, so every detector and classifier feature has full history on day one.
   */
  recommendedHistoryDays: BASELINE_LOOKBACK_WEEKS * 7 + CLASSIFIER_PARAMS.onsetWindowDays,
};

/** Settings for runDetector (src/runDetector.ts), the function the daily Lambda calls. */
export const RUN_DETECTOR = {
  /** Which detector runs live. Team design choice: the fused Bayes detector (see docs/STATUS.md for where it does and does not help). */
  method: "bayes" as DetectionMethod,
  /**
   * Bayes alert probability used live = 10^0.4 / (1 + 10^0.4) = 0.715 (a BACKTEST.grids.bayes value).
   * Derived: the median locked Bayes setting over 20 seeds in the FINAL backtest
   * (results/backtest.json: real city, realistic difficulty, false-alarm budget 0.25),
   * each locked on tuning years 2022-2023 only. Budget 0.25, not 1, because at budget 1
   * the chance check (results/chance.json) shows most "detections" are chance.
   * Team decision 2026-10-06; see docs/STATUS.md.
   */
  bayesAlertProbability: 10 ** 0.4 / (1 + 10 ** 0.4),
  /** A ward that alerted this many days ago or fewer does not alert again. Derived: BACKTEST.episodeGapDays (= ALERT_COOLDOWN_DAYS). */
  cooldownDays: BACKTEST.episodeGapDays,
};
