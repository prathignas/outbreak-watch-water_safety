import { z } from "zod";
import {
  addDays,
  dateRange,
  describeInjection,
  wardRisk,
  type Injection,
  type WardRisk,
} from "@outbreak/detection";
import type { AlertRecord, AlertStatus } from "@outbreak/contract";
import { type IDatabase, getDatabase } from "../db/repository.js";
import { verifyDemoAuth, verifyWebhookSecret, headerValue, webhookSecretHeader } from "./auth.js";
import { executeDetector } from "../detector/orchestrator.js";
import { seedDatabase } from "../db/seed.js";
import { loadScenario, outbreakRowsForDay } from "../demo/scenario.js";
import { toAlertRecord } from "./records.js";
import { loadBacktest } from "./backtest.js";
import { DEMO, DETECTOR, istDate } from "../config.js";
import { getCity } from "../city.js";
import { ingestComplaint, ingestWebhook, PipelineValidationError } from "../ingest.js";
import { getRawArchive } from "../rawArchive.js";
import { combineSources } from "../detector/combineSources.js";
import { emitMetrics, PIPELINE_METRICS } from "../metrics.js";
import { loadRecentRain } from "../handlers/rainHandler.js";

export interface HttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: any;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

const DISCLAIMER =
  "SUSPECTED, NOT CONFIRMED: Outbreak Watch statistical warnings are early indicators and do not represent verified medical outbreaks. The cause is a triage hint, not a diagnosis.";

/** CORS for the frontend (frontend/README.md): its two headers, GET and POST. */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": process.env.CORS_ALLOW_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Demo-Auth,X-Officer-Name,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function jsonResponse(statusCode: number, data: unknown): HttpResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(data),
  };
}

/** Errors are { message } (the frontend shows it as is), plus a code. */
function errorResponse(statusCode: number, code: string, message: string): HttpResponse {
  return jsonResponse(statusCode, { message, error: code });
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const WARD_ID = z.coerce.number().int().min(0);
const issues = (error: z.ZodError) => error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(", ");

// Request validation schemas
const getAlertsQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved"]).optional(),
  wardId: WARD_ID.optional(),
  date: DATE.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(1000),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const rangeQuerySchema = z.object({ from: DATE, to: DATE }).refine((q) => q.from <= q.to, "from must not be after to");

const noteSchema = z.object({
  text: z.string().trim().min(1, "A note cannot be empty.").max(2000, "A note can be at most 2000 characters."),
});

const demoInjectSchema = z.object({
  cause: z.enum(["water", "food", "p2p"]),
  wardId: z.number().int().min(0),
  /** The outbreak starts this many days before today (IST). */
  daysAgo: z.number().int().min(0).max(DETECTOR.maxCatchUpDays).optional().default(DEMO.injectBackdateDays),
  /** Run the detector now (default). false = leave it to the next scheduled run. */
  runDetector: z.boolean().optional().default(true),
});

/** Who did it, for the activity log: the X-Officer-Name header (free text, demo only). */
function officerName(headers: Record<string, string | undefined>): string {
  const name = (headerValue(headers, "X-Officer-Name") ?? "").trim();
  return name ? name.slice(0, 80) : "Unnamed officer";
}

/** The EventBridge schedule (infra): a run that was not started now happens within this time. */
const SCHEDULE_MS = 5 * 60 * 1000;

/** /risk is read every 10 s by every open dashboard; keep the answer for a short while. */
const RISK_CACHE_MS = 30_000;
const riskCache = new Map<string, { at: number; value: WardRisk[] }>();

async function riskFor(db: IDatabase, date: string): Promise<WardRisk[]> {
  const hit = riskCache.get(date);
  if (hit && Date.now() - hit.at < RISK_CACHE_MS) return hit.value;
  // Same rows runDetector would see on `date`: 70 days, only what had arrived by then.
  const rows = await db.getSignals({ startDate: addDays(date, -DETECTOR.historyDays), endDate: date, reportedBy: date });
  const value = wardRisk(combineSources(rows), date, getCity(), DETECTOR.params);
  riskCache.set(date, { at: Date.now(), value });
  return value;
}

async function alertRecord(db: IDatabase, id: string): Promise<AlertRecord | null> {
  const alert = await db.getAlertById(id);
  if (!alert) return null;
  return toAlertRecord(alert, await db.getAlertEvents(id));
}

const unauthorized = () => errorResponse(401, "UNAUTHORIZED", "The demo key is missing or wrong.");

/**
 * Main application HTTP router handling API requests.
 * Routes and shapes: frontend/README.md and detection/handoff/contract-v2.md.
 */
export async function handleRequest(req: HttpRequest, db: IDatabase = getDatabase()): Promise<HttpResponse> {
  const method = req.method.toUpperCase();
  const rawPath = req.path || "/";
  // Strip trailing slashes unless root
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const headers = req.headers || {};
  const query = req.queryStringParameters || {};

  // CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  try {
    // 1. GET /alerts -> AlertRecord[], newest createdAt first
    if (method === "GET" && path === "/alerts") {
      const parsedQuery = getAlertsQuerySchema.safeParse(query);
      if (!parsedQuery.success) return errorResponse(400, "BAD_REQUEST", issues(parsedQuery.error));

      const alerts = await db.getAlerts(parsedQuery.data);
      const events = await db.getAlertEventsFor(alerts.map((a) => a.id));
      return jsonResponse(200, alerts.map((a) => toAlertRecord(a, events.get(a.id) ?? [])));
    }

    // 2. GET /alerts/:id -> AlertRecord
    const alertIdMatch = path.match(/^\/alerts\/([a-zA-Z0-9-]+)$/);
    if (method === "GET" && alertIdMatch) {
      const record = await alertRecord(db, alertIdMatch[1]);
      if (!record) return errorResponse(404, "NOT_FOUND", `No alert with id ${alertIdMatch[1]}`);
      return jsonResponse(200, record);
    }

    // 3-5. POST /alerts/:id/ack | resolve | notes (officer routes)
    const actionMatch = path.match(/^\/alerts\/([a-zA-Z0-9-]+)\/(ack|resolve|notes)$/);
    if (method === "POST" && actionMatch) {
      if (!verifyDemoAuth(headers)) return unauthorized();
      const [, id, action] = actionMatch;
      const alert = await db.getAlertById(id);
      if (!alert) return errorResponse(404, "NOT_FOUND", `No alert with id ${id}`);
      const by = officerName(headers);
      const at = new Date().toISOString();

      if (action === "notes") {
        const parsed = noteSchema.safeParse(req.body || {});
        if (!parsed.success) return errorResponse(400, "BAD_REQUEST", parsed.error.issues[0].message);
        await db.insertAlertEvent({ alertId: id, event: "note_added", actor: by, note: parsed.data.text, at });
        return jsonResponse(200, await alertRecord(db, id));
      }

      // Allowed: open -> acknowledged -> resolved, and open -> resolved (contract-v2 section 4b).
      const to: AlertStatus = action === "ack" ? "acknowledged" : "resolved";
      const allowedFrom: AlertStatus[] = to === "acknowledged" ? ["open"] : ["open", "acknowledged"];
      if (!allowedFrom.includes(alert.status)) {
        return errorResponse(409, "CONFLICT", `Alert is ${alert.status}; it cannot become ${to}.`);
      }
      await db.updateAlertStatus(id, to);
      await db.insertAlertEvent({ alertId: id, event: to, actor: by, note: null, at });
      return jsonResponse(200, await alertRecord(db, id));
    }

    // 6. POST /complaints (the real citizen form: the only source of "user" rows).
    //    P2's complaint adapter -> engine -> PostgresSignalSink (backend/src/ingest.ts).
    if (method === "POST" && path === "/complaints") {
      const outcome = await ingestComplaint(db, req.body);
      riskCache.clear();
      return jsonResponse(outcome.duplicate ? 200 : 201, {
        success: true,
        duplicate: outcome.duplicate,
        message: outcome.duplicate ? "This complaint was already received; it is counted once." : "Citizen complaint registered",
        signal: outcome.signal,
      });
    }

    // 7-8. POST /webhooks/pharmacy | hospital (synthetic feeds): P2's parsers -> engine -> PostgresSignalSink.
    const webhookMatch = path.match(/^\/webhooks\/(pharmacy|hospital)$/);
    if (method === "POST" && webhookMatch) {
      if (!verifyWebhookSecret(headers)) {
        return errorResponse(401, "UNAUTHORIZED", `The webhook secret (header ${webhookSecretHeader()}) is missing or wrong.`);
      }
      const W = PIPELINE_METRICS.webhooks;
      let rowsWritten: number;
      try {
        ({ rowsWritten } = await ingestWebhook(db, webhookMatch[1] as "pharmacy" | "hospital", req.body, { archive: getRawArchive() }));
      } catch (err) {
        if (err instanceof PipelineValidationError) emitMetrics(W.dimensions, { [W.names.rejected]: 1 });
        throw err;
      }
      emitMetrics(W.dimensions, { [W.names.rowsWritten]: rowsWritten });
      riskCache.clear();
      return jsonResponse(200, { success: true, signalsIngested: rowsWritten });
    }

    // 9. GET /wards
    if (method === "GET" && path === "/wards") {
      const wards = await db.getWards();
      const openAlerts = await db.getAlerts({ status: "open" });
      return jsonResponse(200, {
        disclaimer: DISCLAIMER,
        count: wards.length,
        wards: wards.map((w) => ({ ...w, openAlerts: openAlerts.filter((a) => a.wardId === w.id).length })),
      });
    }

    // 10. GET /wards/:id/risk?date= (one ward's entry from P1's wardRisk)
    const wardRiskMatch = path.match(/^\/wards\/([0-9]+)\/risk$/);
    if (method === "GET" && wardRiskMatch) {
      const id = Number(wardRiskMatch[1]);
      const ward = await db.getWard(id);
      if (!ward) return errorResponse(404, "NOT_FOUND", `Unknown ward: ${id}`);
      const date = query.date ?? istDate();
      if (!DATE.safeParse(date).success) return errorResponse(400, "BAD_REQUEST", "date must be YYYY-MM-DD");
      if (date > istDate()) return errorResponse(400, "BAD_REQUEST", `Cannot give risk for ${date}: it is in the future.`);
      const risk = (await riskFor(db, date)).find((r) => r.wardId === id) ?? null;
      return jsonResponse(200, { disclaimer: DISCLAIMER, ward, date, risk, alerts: await db.getAlerts({ wardId: id }) });
    }

    // 11. GET /wards/:id/signals?from=&to= -> LiveSignalRow[] known by today
    const wardSignalsMatch = path.match(/^\/wards\/([0-9]+)\/signals$/);
    if (method === "GET" && wardSignalsMatch) {
      const range = rangeQuerySchema.safeParse(query);
      if (!range.success) return errorResponse(400, "BAD_REQUEST", "from and to must be YYYY-MM-DD");
      const id = Number(wardSignalsMatch[1]);
      if (!(await db.getWard(id))) return errorResponse(404, "NOT_FOUND", `Unknown ward: ${id}`);
      const today = istDate();
      const rows = await db.getSignals({
        wardId: id,
        startDate: range.data.from,
        endDate: range.data.to > today ? today : range.data.to,
        // Only what the system knew by today: late rows stay out until they arrive.
        reportedBy: today,
      });
      return jsonResponse(200, rows);
    }

    // 12. GET /risk?date= -> WardRisk[] for every ward (P1's wardRisk: relative risk, not an alert)
    if (method === "GET" && path === "/risk") {
      const date = query.date;
      if (!date || !DATE.safeParse(date).success) return errorResponse(400, "BAD_REQUEST", "date must be YYYY-MM-DD");
      if (date > istDate()) return errorResponse(400, "BAD_REQUEST", `Cannot give risk for ${date}: it is in the future.`);
      return jsonResponse(200, await riskFor(db, date));
    }

    // 13. GET /rain?from=&to= -> RainRow[] (real Open-Meteo rows from P2 only; empty until P2 writes some)
    if (method === "GET" && path === "/rain") {
      const range = rangeQuerySchema.safeParse(query);
      if (!range.success) return errorResponse(400, "BAD_REQUEST", "from and to must be YYYY-MM-DD");
      return jsonResponse(200, await db.getRain(range.data.from, range.data.to));
    }

    // 14. GET /backtest -> P1's results file without per-seed detail
    if (method === "GET" && path === "/backtest") {
      const backtest = loadBacktest();
      if (!backtest) return errorResponse(503, "UNAVAILABLE", "backtest not run yet");
      return jsonResponse(200, backtest);
    }

    // 15. POST /demo/inject (demo only): P1's generateLiveDay with an injected outbreak
    if (method === "POST" && path === "/demo/inject") {
      if (!verifyDemoAuth(headers)) return unauthorized();
      const parsed = demoInjectSchema.safeParse(req.body || {});
      if (!parsed.success) return errorResponse(400, "BAD_REQUEST", issues(parsed.error));
      const { cause, wardId } = parsed.data;
      const city = getCity();
      if (!city.wardIds().includes(wardId)) return errorResponse(400, "BAD_REQUEST", `Unknown ward: ${wardId}`);

      // The outbreak starts daysAgo days back, so it has had time to spread.
      const today = istDate();
      const startDate = addDays(today, -parsed.data.daysAgo);
      const options = { injectOutbreak: cause, wardId, startDate, city };
      const injection = describeInjection(startDate, DEMO.seed, options) as Injection;
      // Saved, so the daily feed keeps generating it instead of overwriting the ward with baseline rows.
      await db.insertDemoOutbreak({ wardId, cause, startDate, seed: DEMO.seed });
      riskCache.clear();

      // Only the outbreak's affected wards are rewritten, so other planted outbreaks (the demo scenario) stay.
      const planted = [{ cause, wardId, startDate, seed: DEMO.seed }];
      if (parsed.data.runDetector) {
        // Day by day, like the 5-minute run would have seen it: that day's rows (tagged "synthetic",
        // same keys as the seeded rows, so they are replaced), then the detector for that day.
        for (const [i, day] of dateRange(startDate, today).entries()) {
          await db.insertSignals(outbreakRowsForDay(day, planted, city));
          await executeDetector({ db, date: day, ...(i === 0 ? { rerunFrom: startDate } : {}) });
        }
        riskCache.clear();
        return jsonResponse(200, { injection, appearsAfterMs: 0 });
      }
      await db.insertSignals(dateRange(startDate, today).flatMap((day) => outbreakRowsForDay(day, planted, city)));
      // Forget the state from the start day on, so the next scheduled run re-runs those days.
      await db.deleteDetectorStatesFrom(DETECTOR.params.method, startDate);
      return jsonResponse(200, { injection, appearsAfterMs: SCHEDULE_MS });
    }

    // 16. POST /demo/reset (demo only): clear alerts, events, signals, detector state; re-seed;
    //     load the demo scenario (planted outbreaks, detector day by day, officer activity)
    if (method === "POST" && path === "/demo/reset") {
      if (!verifyDemoAuth(headers)) return unauthorized();
      const today = istDate();
      await db.withDetectorLock(async () => {
        await db.resetDemoData();
        await db.clearDemoOutbreaks();
        // Ward and zone shapes stay in the database; this only re-writes names, zones and history.
        await seedDatabase(db, today, { shapes: false });
        // The reset deleted the rain rows too: reload the last 92 days of real rain.
        await loadRecentRain(db);
      });
      // { "scenario": false }: only the seeded history (tests that need an empty alert list).
      if (req.body?.scenario === false) await executeDetector({ db, date: today });
      else await loadScenario(db, today, { api: (r) => handleRequest(r, db), demoKey: headerValue(headers, "X-Demo-Auth") });
      riskCache.clear();
      return jsonResponse(200, { today, seed: DEMO.seed, injection: null });
    }

    // Route not found
    return errorResponse(404, "NOT_FOUND", `Endpoint ${method} ${path} does not exist`);
  } catch (err: any) {
    // P2's parsers refuse bad input with PipelineValidationError: that is the caller's mistake.
    if (err instanceof PipelineValidationError) return errorResponse(400, "BAD_REQUEST", err.message);
    console.error(`[API] Unhandled error handling ${method} ${path}:`, err);
    return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred while processing your request.");
  }
}
