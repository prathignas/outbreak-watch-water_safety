import { addDays, dateRange, describeInjection, generateLiveDay, type CityModel, type OutbreakCause } from "@outbreak/detection";
import scenarioFile from "./demo-scenario.json" with { type: "json" };
import type { IDatabase, SignalWrite } from "../db/repository.js";
import type { HttpRequest, HttpResponse } from "../api/router.js";
import { executeDetector } from "../detector/orchestrator.js";
import { MockSesService } from "../notifications/ses.js";
import { getCity } from "../city.js";

type CauseProbs = Record<string, number>;

/*
 * The demo scenario, so the app is never empty: planted outbreaks (P1's generateLiveDay,
 * tagged "synthetic"), the real detector run day by day, then a little officer activity
 * through the real API routes. Loaded by POST /demo/reset and the DB-setup Lambda.
 * Nothing here changes a detector or classifier rule; demo-scenario.json only picks wards,
 * start days and seeds.
 */

export interface ScenarioOutbreak {
  cause: Exclude<OutbreakCause, "seasonal">;
  wardId: number;
  startDaysAgo: number;
  seed: number;
}
export interface Scenario {
  detectorFromDaysAgo: number;
  outbreaks: ScenarioOutbreak[];
  officer: { name: string; ackNote: string; resolveNote: string };
}

export const DEMO_SCENARIO = scenarioFile as unknown as Scenario;

/** Calls one API route (the router itself, so the same checks and activity log apply). */
export type ApiCall = (req: HttpRequest) => Promise<HttpResponse>;

export const topCause = (p: CauseProbs) => Object.entries(p).sort((a, b) => b[1] - a[1])[0];

/**
 * One day of outbreak rows: for each outbreak already started, P1's rows for its affected
 * wards only (generateLiveDay returns the whole city; the baseline is already seeded).
 * Two outbreaks over the same ward: the larger count is kept.
 */
export function outbreakRowsForDay(day: string, outbreaks: Array<{ cause: OutbreakCause; wardId: number; startDate: string; seed: number }>, city: CityModel): SignalWrite[] {
  const rows = new Map<string, SignalWrite>();
  for (const o of outbreaks) {
    if (o.startDate > day) continue;
    const options = { injectOutbreak: o.cause, wardId: o.wardId, startDate: o.startDate, city };
    const affected = new Set((describeInjection(o.startDate, o.seed, options)?.affectedWards ?? []).map((w) => w.wardId));
    for (const row of generateLiveDay(day, o.seed, options)) {
      if (!affected.has(row.wardId)) continue;
      const key = `${row.wardId}|${row.signalType}|${row.date}`;
      const current = rows.get(key);
      if (!current || row.count > current.count) rows.set(key, row);
    }
  }
  return [...rows.values()];
}

export interface ScenarioResult {
  outbreaks: Array<{ cause: string; wardId: number; startDate: string }>;
  alerts: number;
  waterTop: number;
  otherTop: number;
  acknowledged: string | null;
  resolved: string | null;
}

/**
 * Loads the scenario onto a freshly seeded database (no detector state, no alerts).
 * `api` + `demoKey` make the officer actions go through the real routes; without a key they are skipped.
 */
export async function loadScenario(
  db: IDatabase,
  today: string,
  options: { scenario?: Scenario; city?: CityModel; api?: ApiCall; demoKey?: string; log?: Pick<Console, "log"> } = {}
): Promise<ScenarioResult> {
  const scenario = options.scenario ?? DEMO_SCENARIO;
  const city = options.city ?? getCity();
  const log = options.log ?? console;
  const outbreaks = scenario.outbreaks.map((o) => ({ cause: o.cause, wardId: o.wardId, startDate: addDays(today, -o.startDaysAgo), seed: o.seed }));
  for (const o of outbreaks) await db.insertDemoOutbreak(o);

  // Day by day, like the 5-minute run would have seen it. A demo load never sends email.
  const ses = new MockSesService();
  const from = addDays(today, -scenario.detectorFromDaysAgo);
  for (const [i, day] of dateRange(from, today).entries()) {
    await db.insertSignals(outbreakRowsForDay(day, outbreaks, city));
    await executeDetector({ db, date: day, city: city as never, sesService: ses, ...(i === 0 ? { rerunFrom: from } : {}) });
  }

  const alerts = (await db.getAlerts({})).filter((a) => a.date >= from);
  const water = alerts.filter((a) => topCause(a.causeProbs)[0] === "water").sort((a, b) => b.causeProbs.water - a.causeProbs.water);
  const other = alerts.filter((a) => topCause(a.causeProbs)[0] !== "water");

  // Officer activity through the real routes: acknowledge one water alert (the first scenario
  // outbreak's zone if it has one), resolve one other alert, leave the rest open.
  let acknowledged: string | null = null;
  let resolved: string | null = null;
  if (options.api && options.demoKey) {
    const headers = { "X-Demo-Auth": options.demoKey, "X-Officer-Name": scenario.officer.name, "Content-Type": "application/json" };
    const call = async (path: string, body?: unknown) => {
      const res = await options.api!({ method: "POST", path, headers, body });
      if (res.statusCode !== 200) throw new Error(`Scenario: POST ${path} -> ${res.statusCode} ${res.body}`);
    };
    const firstZone = city.getZoneOfWard(scenario.outbreaks[0]?.wardId ?? -1);
    const ack = water.find((a) => city.getZoneOfWard(a.wardId) === firstZone) ?? water[0];
    if (ack) {
      await call(`/alerts/${ack.id}/ack`);
      await call(`/alerts/${ack.id}/notes`, { text: scenario.officer.ackNote });
      acknowledged = ack.id;
    }
    const res = other[0];
    if (res) {
      await call(`/alerts/${res.id}/notes`, { text: scenario.officer.resolveNote });
      await call(`/alerts/${res.id}/resolve`);
      resolved = res.id;
    }
  } else {
    log.log("[Scenario] No demo key: officer actions skipped.");
  }

  const result = { outbreaks, alerts: alerts.length, waterTop: water.length, otherTop: other.length, acknowledged, resolved };
  log.log(`[Scenario] ${outbreaks.length} outbreaks, ${alerts.length} alerts (${water.length} water-top, ${other.length} other).`);
  return result;
}
