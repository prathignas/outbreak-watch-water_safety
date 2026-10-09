import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDetectorState, type Alert } from "@outbreak/detection";

/*
 * The same repository, against a real PostgreSQL + PostGIS database.
 * Runs only when TEST_DATABASE_URL is set (it wipes that database's data), e.g.
 *   TEST_DATABASE_URL=postgres://outbreak@localhost:5433/outbreak_test npm test
 */
const url = process.env.TEST_DATABASE_URL;
const sample = JSON.parse(readFileSync(new URL("../../detection/handoff/sample-run-detector.json", import.meta.url), "utf8")) as {
  firstDetection: { alerts: Alert[]; causeEvidence: Record<string, string[]> };
};

describe.skipIf(!url)("PostgreSQL repository (real database)", () => {
  let mod: typeof import("../src/index.js");
  let db: InstanceType<typeof mod.PostgresDatabase>;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    mod = await import("../src/index.js");
    await mod.runMigrations();
    db = new mod.PostgresDatabase();
    await db.resetDemoData();
    await mod.seedCity(db);
  });

  afterAll(async () => {
    await mod?.closePool();
  });

  it("upserts signals with reported_on and hides rows that had not arrived", async () => {
    await db.insertSignals([
      { wardId: 18, signalType: "hospital", date: "2026-10-06", count: 4, sourceTag: "synthetic", reportedOn: "2026-10-07" },
      { wardId: 18, signalType: "hospital", date: "2026-10-06", count: 11, sourceTag: "synthetic", reportedOn: "2026-10-09" },
    ]);
    expect(await db.getSignals({ wardId: 18 })).toEqual([
      { wardId: 18, signalType: "hospital", date: "2026-10-06", count: 11, sourceTag: "synthetic", reportedOn: "2026-10-09" },
    ]);
    expect(await db.getSignals({ wardId: 18, reportedBy: "2026-10-08" })).toEqual([]);
  });

  it("P2's PostgresSignalSink goes through insertSignals: upsert on the key updates count and reported_on", async () => {
    const { PostgresSignalSink, SignalIngestionEngine } = await import("@outbreak/pipeline");
    const engine = new SignalIngestionEngine(new PostgresSignalSink(db));
    await engine.ingest([{ wardId: 19, signalType: "pharmacy", date: "2026-10-05", count: 7, sourceTag: "synthetic", reportedOn: "2026-10-06" }]);
    await engine.ingest([{ wardId: 19, signalType: "pharmacy", date: "2026-10-05", count: 9, sourceTag: "synthetic", reportedOn: "2026-10-08" }]);
    expect(await db.getSignals({ wardId: 19 })).toEqual([
      { wardId: 19, signalType: "pharmacy", date: "2026-10-05", count: 9, sourceTag: "synthetic", reportedOn: "2026-10-08" },
    ]);
  });

  it("complaint ids are stored (migration 003): a retry after a restart is counted once", async () => {
    const { ingestComplaint } = await import("../src/ingest.js");
    const now = new Date("2026-10-07T05:00:00Z");
    const form = { complaintId: "pg-form-1", wardId: 20, description: "Dirty water" };
    expect((await ingestComplaint(db, form, now)).signal.count).toBe(1);
    // A "restarted Lambda": a brand-new repository object, same database.
    const fresh = new mod.PostgresDatabase();
    const retry = await ingestComplaint(fresh, form, now);
    expect(retry.duplicate).toBe(true);
    expect(retry.signal.count).toBe(1);
    expect((await ingestComplaint(fresh, { ...form, complaintId: "pg-form-2" }, now)).signal.count).toBe(2);
    expect(await db.getSignals({ wardId: 20, startDate: "2026-10-07", endDate: "2026-10-07" })).toEqual([
      { wardId: 20, signalType: "complaint", date: "2026-10-07", count: 2, sourceTag: "user", reportedOn: "2026-10-07" },
    ]);
  });

  it("reads one real rain value per day", async () => {
    await db.insertSignals([1, 2, 3].map((wardId) => ({ wardId, signalType: "rain" as const, date: "2026-10-05", count: 12.4, sourceTag: "real" as const })));
    expect(await db.getRain("2026-10-01", "2026-10-07")).toEqual([{ date: "2026-10-05", mm: 12.4, sourceTag: "real" }]);
  });

  it("saves a detector day in one transaction: alerts, events, state; a re-run updates without a new event", async () => {
    const alerts = sample.firstDetection.alerts.map((alert) => ({ alert, causeEvidence: sample.firstDetection.causeEvidence[String(alert.wardId)] }));
    const state = { ...emptyDetectorState("bayes"), lastRunDate: "2026-07-08" };
    const first = await db.saveDetectorDay({ method: "bayes", asOfDate: "2026-07-08", state, alerts, actor: "Daily detector run", keepStateDays: 30 });
    expect(first.map((a) => a.isNew)).toEqual(alerts.map(() => true));
    expect(first[0].alert.score).toBe(sample.firstDetection.alerts[0].score); // DOUBLE PRECISION: not rounded
    expect(first[0].alert.causeEvidence).toEqual(alerts[0].causeEvidence);

    const again = await db.saveDetectorDay({ method: "bayes", asOfDate: "2026-07-08", state, alerts, actor: "Daily detector run", keepStateDays: 30 });
    expect(again.map((a) => a.isNew)).toEqual(alerts.map(() => false));
    expect(again[0].alert.id).toBe(first[0].alert.id);
    const events = await db.getAlertEvents(first[0].alert.id);
    expect(events.map((e) => e.event)).toEqual(["created"]);

    expect(await db.getLatestDetectorState("bayes", "2026-07-08")).toEqual({ method: "bayes", asOfDate: "2026-07-08", state });
  });

  it("stores CUSUM state as one row per ward and signal, and loads it back", async () => {
    const state = { ...emptyDetectorState("cusum"), lastRunDate: "2026-07-08" };
    state.cusum = { cells: { "21:pharmacy": { sum: 3.5, nextDate: "2026-07-09" }, "18:hospital": { sum: 0, nextDate: "2026-07-07" } } };
    await db.saveDetectorDay({ method: "cusum", asOfDate: "2026-07-08", state, alerts: [], actor: "x", keepStateDays: 30 });
    expect(await db.getLatestDetectorState("cusum")).toEqual({ method: "cusum", asOfDate: "2026-07-08", state });
    const { query } = mod;
    const rows = await query(`SELECT count(*)::int AS n FROM detector_state_cusum WHERE method = 'cusum'`);
    expect(rows.rows[0].n).toBe(2);
  });

  it("finds wards and zones with PostGIS", async () => {
    expect((await db.getWardContainingPoint(77.499297, 13.056808))?.id).toBe(18);
    expect((await db.findZoneForWard(18))?.id).toBe(14);
  });

  it("reset clears alerts, events, signals and detector state, keeps wards", async () => {
    await db.resetDemoData();
    expect(await db.getAlerts()).toEqual([]);
    expect(await db.getSignals()).toEqual([]);
    expect(await db.getLatestDetectorState("bayes")).toBeNull();
    expect(await db.getLatestDetectorState("cusum")).toBeNull();
    expect((await db.getWards()).length).toBe(243);
  });
});
