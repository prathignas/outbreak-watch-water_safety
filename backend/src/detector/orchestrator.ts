import { type IDatabase, getDatabase, alertKey } from "../db/repository.js";
import type { DbAlert } from "../db/types.js";
import { type ISesService, SesService, MockSesService } from "../notifications/ses.js";
import {
  addDays,
  emptyDetectorState,
  runDetector,
  SignalIndex,
  type CityModel,
} from "@outbreak/detection";
import { type Alert, DETECTION_METHODS } from "@outbreak/contract";
import { DETECTOR, istDate } from "../config.js";
import { combineSources } from "./combineSources.js";
import { getCity } from "../city.js";
import { METRIC_DIMENSIONS, METRIC_NAMESPACE, METRICS, type MetricValues } from "../metrics.js";

export interface DetectorExecutionOptions {
  /** The last day to run (YYYY-MM-DD, India time). Default: today in India. */
  date?: string;
  /**
   * Re-run from this day: forget the state saved from this day on, then run forward again.
   * Used after the demo injects rows into past days.
   */
  rerunFrom?: string;
  db?: IDatabase;
  sesService?: ISesService;
  city?: CityModel & { wardName?(wardId: number): string };
}

export interface DetectorExecutionResult {
  /** The last day run (or today, if nothing needed running). */
  date: string;
  /** Every day runDetector ran for in this call, oldest first. Empty if today was already done. */
  daysRun: string[];
  /** Signal rows loaded from the database. */
  signalsRead: number;
  /** Alerts runDetector said to send (after its cooldown). */
  alertsGenerated: number;
  /** Of those, how many were new rows in the database (these are emailed). */
  alertsPersisted: number;
  /** Of those, how many were already stored (a re-run): updated, not emailed again. */
  duplicatesSkipped: number;
  /** Wards that alerted again inside their cooldown (runDetector heldBack). */
  heldBack: number;
  /** Untouched alerts on re-run days that the re-run no longer raised. */
  alertsRemoved: number;
  /** The new alerts. */
  alerts: DbAlert[];
}

/** Today's date in India (Asia/Kolkata), YYYY-MM-DD. */
export const getCurrentIstDate = (): string => istDate();

/**
 * Validates that an alert produced by P1 matches the contract.
 */
export function validateAlert(alert: any): alert is Alert {
  if (!alert || typeof alert !== "object") return false;
  if (typeof alert.wardId !== "number" || !Number.isInteger(alert.wardId)) return false;
  if (typeof alert.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(alert.date)) return false;
  if (typeof alert.score !== "number" || alert.score < 0 || alert.score > 1) return false;
  if (!DETECTION_METHODS.includes(alert.method)) return false;
  if (!Array.isArray(alert.contributingSignals)) return false;
  if (!alert.causeProbs || typeof alert.causeProbs !== "object") return false;
  if (!Array.isArray(alert.evidence)) return false;
  return true;
}

/**
 * Scrubs any database passwords or auth tokens from error strings.
 */
function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/:\/\/[^:]+:[^@]+@/g, "://***:***@");
}

/**
 * Emits CloudWatch metrics using AWS Embedded Metric Format (EMF).
 * Names come from metrics.ts, which the CDK dashboard also reads.
 */
function emitCloudWatchMetrics(values: Partial<MetricValues>, targetDate: string) {
  const all: MetricValues = {
    detectorRuns: 0,
    alertsSent: 0,
    alertsHeldBack: 0,
    duplicateAlerts: 0,
    signalsEvaluated: 0,
    detectorErrors: 0,
    ...values,
  };
  const keys = Object.keys(METRICS) as Array<keyof typeof METRICS>;
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRIC_NAMESPACE,
            Dimensions: [Object.keys(METRIC_DIMENSIONS)],
            Metrics: keys.map((k) => ({ Name: METRICS[k], Unit: "Count" })),
          },
        ],
      },
      ...METRIC_DIMENSIONS,
      ...Object.fromEntries(keys.map((k) => [METRICS[k], all[k]])),
      target_date: targetDate,
    })
  );
}

function defaultSes(): ISesService {
  return process.env.SES_MOCK === "true" || process.env.NODE_ENV === "test" ? new MockSesService() : new SesService();
}

/**
 * Orchestrates the Outbreak Watch detection cycle:
 * EventBridge -> Detector Lambda -> 70 days of rows + saved state from the DB
 * -> P1 runDetector(rows, day, city, RUN_DETECTOR_PARAMS, state), once per day not yet run
 * -> alerts + state saved in ONE transaction -> SES email for each new alert.
 *
 * P1's runDetector must move forward one day at a time. So when today has already run (the
 * 5-minute schedule), the run reloads the state saved at the end of YESTERDAY and recomputes
 * today, so rows that arrived since (the morning feed, late webhooks, complaints) are used.
 * Today's alerts are updated in place; an alert that already exists is not emailed again.
 */
export async function executeDetector(options: DetectorExecutionOptions = {}): Promise<DetectorExecutionResult> {
  const db = options.db ?? getDatabase();
  const city = options.city ?? getCity();
  const params = DETECTOR.params;
  const method = params.method;
  const today = options.date ?? istDate();

  return db.withDetectorLock(async () => {
    console.log(`[Detector] Detector started. Target date (IST): ${today}`);

    let firstDay: string;
    let rows;
    let saved;
    try {
      if (options.rerunFrom) {
        console.log(`[Detector] Re-running from ${options.rerunFrom}: forgetting the state saved from that day on.`);
        await db.deleteDetectorStatesFrom(method, options.rerunFrom);
      }
      saved = await db.getLatestDetectorState(method, today);
      if (saved?.asOfDate === today) {
        // Today ran already: start again from the end of yesterday and recompute today.
        console.log(`[Detector] ${today} has already run; recomputing it from yesterday's saved state with the rows that have arrived since.`);
        await db.deleteDetectorStatesFrom(method, today);
        saved = await db.getLatestDetectorState(method, today);
      }
      firstDay = saved ? addDays(saved.asOfDate, 1) : addDays(today, -DETECTOR.warmupDays);
      const earliest = addDays(today, -DETECTOR.maxCatchUpDays);
      if (firstDay < earliest) firstDay = earliest;

      // P1 needs LIVE.recommendedHistoryDays (70) of rows before the first day it runs.
      // Only rows that had reached us by today; runDetector also hides rows reported after each day.
      rows = await db.getSignals({ startDate: addDays(firstDay, -DETECTOR.historyDays), endDate: today, reportedBy: today });
      console.log(`[Detector] History loaded. ${rows.length} signals from ${addDays(firstDay, -DETECTOR.historyDays)} to ${today}.`);
    } catch (dbErr: any) {
      const errorMsg = sanitizeErrorMessage(dbErr?.message || "Unknown DB error");
      console.error(`[Detector] Database failure loading signal history: ${errorMsg}`);
      emitCloudWatchMetrics({ detectorRuns: 1, detectorErrors: 1 }, today);
      throw new Error(`Database failure loading signal history: ${errorMsg}`);
    }

    // Simulated and form complaints for the same ward and day are added up (combineSources.ts).
    const index = new SignalIndex(combineSources(rows));
    let state = saved?.state ?? emptyDetectorState(method);
    const result: DetectorExecutionResult = {
      date: today,
      daysRun: [],
      signalsRead: rows.length,
      alertsGenerated: 0,
      alertsPersisted: 0,
      duplicatesSkipped: 0,
      heldBack: 0,
      alertsRemoved: 0,
      alerts: [],
    };
    const produced = new Set<string>();
    const ses = options.sesService ?? defaultSes();

    try {
      for (let day = firstDay; day <= today; day = addDays(day, 1)) {
        const out = runDetector(index, day, city, params, state);
        const valid = out.alerts.filter((a) => {
          if (!validateAlert(a)) console.warn(`[Detector] Discarding malformed alert:`, a);
          return validateAlert(a);
        });
        // Alerts and the state for this day are saved together, or not at all.
        const savedAlerts = await db.saveDetectorDay({
          method,
          asOfDate: day,
          state: out.state,
          alerts: valid.map((alert) => ({ alert, causeEvidence: out.causeEvidence[String(alert.wardId)] ?? [] })),
          actor: DETECTOR.actor,
          keepStateDays: DETECTOR.keepStateDays,
        });
        state = out.state;
        result.daysRun.push(day);
        result.alertsGenerated += valid.length;
        result.heldBack += out.heldBack.length;
        for (const { alert, isNew } of savedAlerts) {
          produced.add(alertKey(alert));
          if (!isNew) {
            result.duplicatesSkipped++;
            console.log(`[Detector] duplicate alert skipped: ward ${alert.wardId}, date ${alert.date}, method ${alert.method}`);
            continue;
          }
          result.alertsPersisted++;
          result.alerts.push(alert);
          console.log(`[Detector] Alert persisted: ${alert.id} for ward ${alert.wardId} on ${alert.date} (score: ${alert.score})`);
          await notify(db, ses, alert, city);
        }
      }
      result.alertsRemoved = await db.deleteUntouchedAlerts(firstDay, today, produced);
    } catch (err: any) {
      const errorMsg = sanitizeErrorMessage(err?.message || "Detector execution error");
      console.error(`[Detector] Detector run failed: ${errorMsg}`);
      emitCloudWatchMetrics({ detectorRuns: 1, detectorErrors: 1, alertsSent: result.alertsPersisted }, today);
      throw new Error(`Detector failure: ${errorMsg}`);
    }

    console.log(`[Detector] Ran ${result.daysRun.join(", ")}: ${result.alertsPersisted} new alert(s), ${result.heldBack} held back by the cooldown.`);
    emitCloudWatchMetrics(
      {
        detectorRuns: 1,
        alertsSent: result.alertsPersisted,
        alertsHeldBack: result.heldBack,
        duplicateAlerts: result.duplicatesSkipped,
        signalsEvaluated: result.signalsRead,
      },
      today
    );
    return result;
  });
}

/** Emails the officer about a new alert and records the outcome in alert_events. Never throws. */
async function notify(db: IDatabase, ses: ISesService, alert: DbAlert, city: DetectorExecutionOptions["city"]) {
  let wardName = `Ward ${alert.wardId}`;
  try {
    if (city?.wardName) wardName = `${city.wardName(alert.wardId)} (Ward ${alert.wardId})`;
  } catch {
    // unknown ward in the city model: keep the plain label
  }
  const emailRes = await ses.sendAlertNotification(alert, wardName);
  await db.insertAlertEvent({
    alertId: alert.id,
    event: emailRes.success ? "emailed" : "email_failed",
    actor: DETECTOR.actor,
    note: emailRes.success
      ? `Notification email sent to the officer (MessageId: ${emailRes.messageId})`
      : `Email delivery failed: ${emailRes.error}`,
    at: new Date().toISOString(),
  });
  if (emailRes.success) console.log(`[Detector] Email sent for alert ${alert.id}`);
  else console.error(`[Detector] Email delivery failed for alert ${alert.id}: ${emailRes.error}`);
}
