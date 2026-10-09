/*
 * Backend settings. Every number here is either taken from P1's code or is a
 * demo choice copied from the frontend's mock backend (frontend/src/mock/backend.ts),
 * so the real backend behaves like the demo everyone has already seen.
 */
import { LIVE, RUN_DETECTOR_PARAMS } from "@outbreak/detection";

export const DETECTOR = {
  /** P1's live settings (params.live.ts): Bayes, locked FINAL alert line, 7-day cooldown. */
  params: RUN_DETECTOR_PARAMS,
  /** Days of rows loaded before the first day a run looks at. P1: LIVE.recommendedHistoryDays (70). */
  historyDays: LIVE.recommendedHistoryDays,
  /**
   * With no saved state yet, the detector starts this many days back, so the cooldown and the
   * classifier have recent context on day one. Same as the frontend mock (MOCK.warmupRunDays).
   */
  warmupDays: 7,
  /** Never catch up more than this many missed days in one run (keeps a Lambda run short). */
  maxCatchUpDays: 14,
  /** Saved states older than this are deleted (they are only kept to re-run recent days). */
  keepStateDays: 30,
  /** Shown as the actor of "raised" events (contract-v2 section 4b). */
  actor: "Daily detector run",
};

export const DEMO = {
  /** Seed for P1's generator. Same as the handoff samples and the frontend mock. */
  seed: Number(process.env.DEMO_SEED ?? 2026),
  /**
   * Days of synthetic history written by the seed. The frontend draws 8 weeks and compares
   * them with the 8 weeks before (it asks for 112 days), like the mock (MOCK.historyDays).
   * This is more than the detector's 70 days, so the detector always has full history.
   */
  historyDays: 112,
  /** An injected outbreak starts this many days back, so its signals have arrived. Mock: MOCK.injectBackdateDays. */
  injectBackdateDays: 4,
};

/** Today's date in India (Asia/Kolkata), YYYY-MM-DD. The contract's day rule. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
