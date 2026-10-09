/*
 * The shared contract. Contract v1 is P1's detection/src/types.ts, re-exported
 * unchanged (never copied by hand). Contract v2 adds the shapes below, from
 * detection/handoff/contract-v2.md (sections 1, 4b and 4c).
 */
export * from "@outbreak/detection/types";

import type { Alert, SignalRow } from "@outbreak/detection/types";

/** contract-v2 section 1: a signal row plus the day it reached our system. P1's own type. */
export type { LiveSignalRow } from "@outbreak/detection";
/**
 * contract-v2 section 1, for every signal type and source tag: a SignalRow plus the India day
 * (Asia/Kolkata, YYYY-MM-DD) it reached our system. Never before `date`; equal to `date` for a
 * real-time feed. P1's LiveSignalRow (above) is the synthetic-only form of this row.
 * This is what P2's pipeline writes and what the backend's signals table stores.
 */
export interface ReportedSignalRow extends SignalRow {
  reportedOn: string;
}
/** P1's city model (ward ids, neighbours, water zones). P1's own type. */
export type { CityModel } from "@outbreak/detection";
/** contract-v2 section 4c: GET /risk. P1's own type (from wardRisk). */
export type { WardRisk } from "@outbreak/detection";

/** contract-v2 section 4b. */
export type AlertStatus = "open" | "acknowledged" | "resolved";
export const ALERT_STATUSES: readonly AlertStatus[] = ["open", "acknowledged", "resolved"];

/** contract-v2 section 4b: one line in an alert's activity log. */
export interface AlertEvent {
  /** ISO date-time. */
  at: string;
  /** X-Officer-Name, or "Daily detector run" for "raised". */
  by: string;
  kind: "raised" | "acknowledged" | "resolved" | "note";
  /** For notes. */
  text?: string;
}

/** contract-v2 section 4b: what GET /alerts and GET /alerts/{id} return. */
export interface AlertRecord {
  id: string;
  status: AlertStatus;
  /** ISO date-time the record was created (the detector run). */
  createdAt: string;
  /** Contract v1 shape, unchanged. evidence = the detector's reasons. */
  alert: Alert;
  /** The classifier's reasons: runDetector's causeEvidence[wardId]. */
  causeEvidence: string[];
  /** Oldest first. */
  events: AlertEvent[];
}

/** contract-v2 section 4c: GET /rain. One city-wide row per day, real Open-Meteo data only. */
export interface RainRow {
  date: string;
  mm: number;
  sourceTag: "real";
}
