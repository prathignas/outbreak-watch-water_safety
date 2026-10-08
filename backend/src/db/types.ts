/*
 * P3's storage shapes (database rows). They are NOT part of the shared contract:
 * the API turns them into contract-v2 AlertRecords (see api/records.ts).
 */
import type { Alert, AlertStatus } from "@outbreak/contract";
import type { DetectorState } from "@outbreak/detection";

export type { AlertStatus };

/** An alert as stored: the contract Alert plus the database fields. */
export interface DbAlert extends Alert {
  /** Database id (UUID). */
  id: string;
  status: AlertStatus;
  /** ISO timestamp when the alert was saved. */
  createdAt: string;
  /** The classifier's reasons (runDetector causeEvidence[wardId]). */
  causeEvidence: string[];
}

/** What can happen to an alert. Stored in alert_events.event. */
export const ALERT_EVENT_TYPES = [
  "created",
  "emailed",
  "email_failed",
  "acknowledged",
  "resolved",
  "note_added",
] as const;
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

/** One row of the alert_events audit table. */
export interface AlertEventRow {
  id?: string;
  alertId: string;
  event: AlertEventType;
  /** Who did it: the X-Officer-Name header, or "Daily detector run". */
  actor: string;
  note?: string | null;
  at: string;
}

export interface Ward {
  id: number;
  name: string;
  zoneId?: number | null;
  geometry?: any;
}

export interface PipelineZone {
  id: number;
  name: string;
  geometry?: any;
}

/** One saved detector state (detector_state table), "as of" the last day it ran. */
export interface SavedDetectorState {
  method: DetectorState["method"];
  asOfDate: string;
  state: DetectorState;
}

/** One sent alert from a detector run, with the classifier's reasons. */
export interface DetectorAlert {
  alert: Alert;
  causeEvidence: string[];
}
