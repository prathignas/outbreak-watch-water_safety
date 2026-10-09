import { runFeedJob, PostgresSignalSink, saveRawCopy, type FeedJobResult, type RawArchive } from "@outbreak/pipeline";
import { describeInjection, rowsArrivingOn, type CityModel, type LiveSignalRow } from "@outbreak/detection";
import { type IDatabase, getDatabase } from "../db/repository.js";
import { webhookSecretHeader } from "../api/auth.js";
import { getCity } from "../city.js";
import { DEMO, istDate } from "../config.js";
import { getRawArchive } from "../rawArchive.js";
import { emitMetrics, PIPELINE_METRICS } from "../metrics.js";

const M = PIPELINE_METRICS.feed;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WebhookKind = "pharmacy" | "hospital";
export interface WebhookRecord {
  wardId: number;
  count: number;
  date: string;
  reportedOn: string;
}
/** Sends one batch to POST /webhooks/{kind}. Throws if the API refuses it. */
export type WebhookPoster = (kind: WebhookKind, records: WebhookRecord[]) => Promise<void>;

/** The real poster: API_URL + the webhook secret header, like any outside feed. */
export function httpWebhookPoster(apiUrl = process.env.API_URL, secret = process.env.WEBHOOK_SECRET): WebhookPoster {
  return async (kind, records) => {
    if (!apiUrl) throw new Error("API_URL is not set: the feed cannot reach /webhooks");
    if (!secret) throw new Error("WEBHOOK_SECRET is not set: the feed cannot call /webhooks");
    const url = `${apiUrl.replace(/\/+$/, "")}/webhooks/${kind}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [webhookSecretHeader()]: secret },
      body: JSON.stringify({ records }),
    });
    if (!res.ok) throw new Error(`POST /webhooks/${kind} failed: ${res.status} ${await res.text()}`);
  };
}

const rowKey = (r: LiveSignalRow) => `${r.wardId}|${r.signalType}|${r.date}`;

/**
 * Rows arriving on `day`: the baseline, with each active injected outbreak's affected wards
 * taken from a run that keeps generating that outbreak (same options generateLiveDay takes).
 */
export async function feedRows(db: IDatabase, day: string, seed: number, city: CityModel): Promise<LiveSignalRow[]> {
  const rows = new Map(rowsArrivingOn(day, seed, { city }).map((r) => [rowKey(r), r]));
  for (const outbreak of await db.getActiveDemoOutbreaks()) {
    const options = { injectOutbreak: outbreak.cause, wardId: outbreak.wardId, startDate: outbreak.startDate, city };
    const affected = new Set((describeInjection(outbreak.startDate, outbreak.seed, options)?.affectedWards ?? []).map((w) => w.wardId));
    for (const row of rowsArrivingOn(day, outbreak.seed, options)) {
      if (!affected.has(row.wardId)) continue;
      const current = rows.get(rowKey(row));
      // Two outbreaks over the same ward: keep the larger count.
      if (!current || row.count > current.count) rows.set(rowKey(row), row);
    }
  }
  return [...rows.values()];
}

export interface DailyFeedOptions {
  day: string;
  db: IDatabase;
  postWebhook: WebhookPoster;
  seed?: number;
  city?: CityModel;
  archive?: RawArchive;
}

export type DailyFeedResult = FeedJobResult & { webhookRows: number };

/**
 * One writer per source: pharmacy and hospital rows go through POST /webhooks/{kind} (the API
 * writes them); complaint rows go through P2's feed job straight to the signals table.
 */
export async function runDailyFeed(options: DailyFeedOptions): Promise<DailyFeedResult> {
  const { day, db } = options;
  const seed = options.seed ?? DEMO.seed;
  const city = options.city ?? getCity();
  let rows: LiveSignalRow[];
  let webhookRows = 0;
  let rawKey: string | null = null;
  try {
    rows = await feedRows(db, day, seed, city);
    // The whole batch, untouched, before anything is sent or written.
    rawKey = await saveRawCopy(options.archive, "feed", day, rows);
    for (const kind of ["pharmacy", "hospital"] as const) {
      const records = rows
        .filter((r) => r.signalType === kind)
        .map((r) => ({ wardId: r.wardId, count: r.count, date: r.date, reportedOn: r.reportedOn }));
      if (records.length === 0) continue;
      await options.postWebhook(kind, records);
      webhookRows += records.length;
    }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error(`[feed] ${day} FAILED before the complaint rows were written: ${message}`);
    return { ok: false, day, error: message, webhookRows };
  }
  const complaints = rows.filter((r) => r.signalType === "complaint");
  const result = await runFeedJob({ day, sink: new PostgresSignalSink(db), seed, city, rowsArrivingOn: () => complaints });
  return result.ok ? { ...result, rawKey, webhookRows } : { ...result, webhookRows };
}

/**
 * Daily, IST morning (EventBridge): P1's synthetic rows that arrive today
 * (rowsArrivingOn(today, DEMO.seed, RealCity)), all tagged "synthetic", late rows included,
 * plus any outbreak injected with POST /demo/inject that is still active.
 * Manual invoke { "day": "YYYY-MM-DD" } runs another day (a backfill).
 */
export async function handler(event?: { day?: string }): Promise<DailyFeedResult> {
  const day = typeof event?.day === "string" && DATE.test(event.day) ? event.day : istDate();
  const result = await runDailyFeed({ day, db: getDatabase(), postWebhook: httpWebhookPoster(), archive: getRawArchive() });
  emitMetrics(M.dimensions, {
    [M.names.runs]: 1,
    [M.names.rowsWritten]: result.ok ? result.rowsWritten + result.webhookRows : 0,
    [M.names.lateRows]: result.ok ? result.lateRows : 0,
    [M.names.failures]: result.ok ? 0 : 1,
  });
  if (!result.ok) throw new Error(`Feed job failed for ${day}: ${result.error}`);
  return result;
}
