/*
 * Shapes the screens use that are NOT in the v1 contract (src/contract/types.ts).
 * Every one of them is a "contract v2 proposal" from docs/contract-v2.md, as decided by
 * Person 1 on 2026-10-06. Field names match that document exactly.
 */
import type { Alert, CauseType, DetectionMethod, SignalRow } from "@/contract/types";

/** contract v2 proposal: a signal row plus the day it reached the system. */
export interface LiveSignalRow extends SignalRow {
  reportedOn: string;
}

/** contract v2 proposal (section 4b). */
export interface AlertEvent {
  at: string;
  by: string;
  kind: "raised" | "acknowledged" | "resolved" | "note";
  text?: string;
}

export type AlertStatus = "open" | "acknowledged" | "resolved";

/** contract v2 proposal (section 4b). */
export interface AlertRecord {
  id: string;
  status: AlertStatus;
  createdAt: string;
  /** Contract v1 shape, unchanged. evidence = the detector's reasons. */
  alert: Alert;
  /** The classifier's reasons (triage hint). */
  causeEvidence: string[];
  events: AlertEvent[];
}

/** contract v2 proposal (section 4c): GET /risk. Relative risk, simulated health data. */
export interface WardRisk {
  wardId: number;
  probability: number;
  contributingSignals: Array<"complaint" | "pharmacy" | "hospital">;
}

/** contract v2 proposal (section 4c): GET /rain. */
export interface RainRow {
  date: string;
  mm: number;
  sourceTag: "real";
}

export type OutbreakCause = "water" | "food" | "p2p" | "seasonal";
export type InjectableCause = "water" | "food" | "p2p";

/** Shaped like handoff/sample-live-day-injected.json "injection". */
export interface Injection {
  cause: OutbreakCause;
  startDate: string;
  originWardId: number | null;
  zoneId: number | null;
  affectedWards: Array<{ wardId: number; weight: number }>;
  signalDelayDays: Record<"complaint" | "pharmacy" | "hospital", number>;
  firstSignalDate: Record<"complaint" | "pharmacy" | "hospital", string>;
}

export interface InjectResponse {
  injection: Injection;
  appearsAfterMs: number;
}

/** MOCK MODE ONLY (GET /demo/state): the demo clock and the active injection. */
export interface DemoState {
  today: string;
  seed: number;
  injection: Injection | null;
}

/* ---- Backtest (contract v2 proposal, section 5; GET /backtest without "runs") ---- */
export interface Spread {
  median: number;
  p10: number;
  p90: number;
  n: number;
}
export type Difficulty = "easy" | "realistic" | "hard";
export interface BacktestSummaryRow {
  method: DetectionMethod;
  difficulty: Difficulty;
  budget: number;
  cause: OutbreakCause;
  subset: "all" | "outsideWave";
  detectionRate: Spread | null;
  medianDelayDays: Spread | null;
  outbreaksPerSeed: number;
}
export interface FalseAlarmRow {
  method: DetectionMethod;
  difficulty: Difficulty;
  budget: number;
  waveCounted: Spread | null;
  waveExcluded: Spread | null;
  lockedSetting: Spread | null;
  budgetMissedSeeds: number;
}
export interface FusionFlag {
  difficulty: Difficulty;
  budget: number;
  cause: OutbreakCause;
  subset: "all" | "outsideWave";
  simplerMethod: "threshold" | "cusum";
  text: string;
}
export interface ChanceRow {
  method: DetectionMethod;
  difficulty: Difficulty;
  budget: number;
  cause: OutbreakCause;
  status: "computed" | "not computed";
  phantomDetectionRate: Spread | null;
  phantomsPerSeed: number;
  note: string | null;
}
export interface BacktestResult {
  status: "FINAL" | "PRELIMINARY";
  preliminary: boolean;
  city: string;
  wardCount: number;
  seeds: number[];
  difficulties: Difficulty[];
  rules: {
    matchingRule: string;
    tuningYears: number[];
    testYears: number[];
    falseAlarmBudgets: number[];
    episodeGapDays: number;
    matchGraceDays: number;
    calibratedOn: string;
  };
  summary: BacktestSummaryRow[];
  falseAlarms: FalseAlarmRow[];
  fusionDoesNotHelp: FusionFlag[];
  chanceCheck?: { method: string; seeds: number[]; rows: ChanceRow[] };
  /** Found / total outbreaks over all seeds (a tally of P1's per-seed "detected" flags). */
  counts?: BacktestCount[];
}
export interface BacktestCount {
  method: DetectionMethod;
  difficulty: Difficulty;
  budget: number;
  cause: OutbreakCause;
  found: number;
  total: number;
}

export type { CauseType };
