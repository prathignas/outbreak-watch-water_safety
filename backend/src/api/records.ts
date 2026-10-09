import type { AlertEvent, AlertRecord } from "@outbreak/contract";
import type { AlertEventRow, DbAlert } from "../db/types.js";

/*
 * Stored alerts and audit rows -> contract-v2 AlertRecord (detection/handoff/contract-v2.md
 * section 4b; frontend/src/api/types.ts). The alert itself is P1's Alert, unchanged.
 */

/** One audit row as an activity-log line. Emails are shown as notes from the daily run. */
export function toAlertEvent(row: AlertEventRow): AlertEvent {
  switch (row.event) {
    case "created":
      return { at: row.at, by: row.actor, kind: "raised" };
    case "acknowledged":
    case "resolved":
      return { at: row.at, by: row.actor, kind: row.event };
    case "note_added":
      return { at: row.at, by: row.actor, kind: "note", text: row.note ?? "" };
    case "emailed":
      // SES_MOCK (local runs and tests) only logs the email; say so instead of claiming it was sent.
      return { at: row.at, by: row.actor, kind: "note", text: row.note?.includes("mock-msg-") ? "Alert email logged only (SES_MOCK: not sent)." : "Alert email sent to the officer." };
    case "email_failed":
      return { at: row.at, by: row.actor, kind: "note", text: `Alert email could not be sent (${(row.note ?? "").replace(/^Email delivery failed: /, "")}).` };
  }
}

export function toAlertRecord(stored: DbAlert, events: AlertEventRow[]): AlertRecord {
  const { id, status, createdAt, causeEvidence, wardId, date, score, method, contributingSignals, causeProbs, suspectedZoneId, evidence } = stored;
  return {
    id,
    status,
    createdAt,
    alert: { wardId, date, score, method, contributingSignals, causeProbs, suspectedZoneId, evidence },
    causeEvidence,
    events: events.map(toAlertEvent),
  };
}
