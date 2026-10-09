import { describe, expect, it, beforeEach } from "vitest";
import { MemoryDatabase } from "../src/db/repository.js";
import {
  WardRepository,
  ZoneRepository,
  SignalRepository,
  AlertRepository,
  AlertEventRepository,
} from "../src/db/repositories/index.js";
import { seedDatabase } from "../src/db/seed.js";
import { DEMO } from "../src/config.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { emptyDetectorState, type Alert } from "@outbreak/detection";

const TODAY = "2026-07-08";

/** A real alert from P1's handoff sample (ward 21, zone 14). */
const sampleAlert = (): Alert =>
  JSON.parse(readFileSync(join(__dirname, "../../detection/handoff/sample-run-detector.json"), "utf8")).firstDetection.alerts[0];

describe("Database Layer (PostgreSQL + PostGIS)", () => {
  let db: MemoryDatabase;
  let wardRepo: WardRepository;
  let zoneRepo: ZoneRepository;
  let signalRepo: SignalRepository;
  let alertRepo: AlertRepository;
  let alertEventRepo: AlertEventRepository;

  beforeEach(() => {
    db = new MemoryDatabase();
    wardRepo = new WardRepository(db);
    zoneRepo = new ZoneRepository(db);
    signalRepo = new SignalRepository(db);
    alertRepo = new AlertRepository(db);
    alertEventRepo = new AlertEventRepository(db);
  });

  // 1. Migration tests
  it("validates repeatable SQL migration definitions and PostGIS indexes", () => {
    const migrationPath = join(__dirname, "../src/db/migrations/001_initial_schema.sql");
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS postgis;");
    expect(sql).toContain("GEOMETRY(MultiPolygon, 4326)");
    expect(sql).toContain("USING GIST (geom)");
    expect(sql).toContain("CONSTRAINT uq_alerts UNIQUE (ward_id, date, method)");
    expect(sql).toContain("CONSTRAINT uq_signals UNIQUE (ward_id, signal_type, date, source_tag)");
    expect(sql).toContain("idx_alerts_ward_id");
    expect(sql).toContain("idx_alerts_date");
    expect(sql).toContain("idx_alerts_status");
    expect(sql).toContain("idx_signals_ward_id");
    expect(sql).toContain("idx_signals_date");
  });

  it("migration 002 adds what contract v2 needs", () => {
    const sql = readFileSync(join(__dirname, "../src/db/migrations/002_contract_v2.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS reported_on DATE");
    expect(sql).toContain("ALTER COLUMN reported_on SET NOT NULL");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS detector_state (");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS detector_state_cusum (");
    expect(sql).toContain("cause_evidence TEXT[]");
    expect(sql).toContain("ALTER COLUMN score TYPE DOUBLE PRECISION");
    expect(sql).toContain("CHECK (id >= 0)");
  });

  // 2. Seed test
  it("seeds P1's real wards and zones, and P1's synthetic history with no rain", async () => {
    const result = await seedDatabase(db, TODAY);
    expect(result.wardsCount).toBe(243);
    expect(result.zonesCount).toBe(43);
    expect(result.signalsCount).toBe((DEMO.historyDays + 1) * 243 * 3);

    expect((await wardRepo.getAll()).length).toBe(243);
    const ward18 = await wardRepo.getById(18);
    expect(ward18).toEqual({ id: 18, name: "Bagalakunte", zoneId: 14 });
    expect((await zoneRepo.getAll()).length).toBe(43);

    const rows = await signalRepo.getSignals();
    expect(rows.every((r) => r.sourceTag === "synthetic")).toBe(true);
    expect(rows.some((r) => r.signalType === "rain")).toBe(false);
    expect(rows.every((r) => r.reportedOn >= r.date)).toBe(true);
    expect(rows.at(-1)?.date).toBe(TODAY);
    expect(await db.getRain("2026-01-01", TODAY)).toEqual([]);
  });

  // 3. Insert signal test
  it("upserts daily signal rows: a later arrival updates count and reported_on", async () => {
    await signalRepo.insert({ wardId: 18, signalType: "hospital", date: "2026-10-06", count: 4, sourceTag: "synthetic", reportedOn: "2026-10-07" });
    await signalRepo.insert({ wardId: 18, signalType: "hospital", date: "2026-10-06", count: 11, sourceTag: "synthetic", reportedOn: "2026-10-09" });

    const rows = await signalRepo.getHistoryForWard(18, "2026-10-06", "2026-10-06");
    expect(rows).toEqual([{ wardId: 18, signalType: "hospital", date: "2026-10-06", count: 11, sourceTag: "synthetic", reportedOn: "2026-10-09" }]);
    // Not visible to a run for 2026-10-08: it had not arrived yet.
    expect(await db.getSignals({ reportedBy: "2026-10-08" })).toEqual([]);
  });

  it("accepts ward id 0", async () => {
    await db.insertWards([{ id: 0, name: "Ward zero" }]);
    await signalRepo.insert({ wardId: 0, signalType: "complaint", date: "2026-10-06", count: 1, sourceTag: "user" });
    expect(await wardRepo.getById(0)).toEqual({ id: 0, name: "Ward zero", zoneId: null });
    expect((await signalRepo.getHistoryForWard(0)).length).toBe(1);
  });

  // 4 & 5. Insert alert & duplicate prevention tests
  it("inserts alert and prevents duplicate alert insertion using UNIQUE(ward_id, date, method)", async () => {
    const alertData = sampleAlert();

    const first = await alertRepo.insert(alertData, ["triage hint, not a diagnosis: most likely unknown (55%); an officer must confirm"]);
    expect(first.isNew).toBe(true);
    expect(first.alert.id).toBeDefined();
    expect(first.alert.status).toBe("open");
    expect(first.alert.score).toBe(alertData.score); // full precision, not rounded
    expect(first.alert.causeEvidence.at(-1)).toMatch(/^triage hint/);

    const duplicate = await alertRepo.insert({ ...alertData, score: 0.92 });
    expect(duplicate.isNew).toBe(false);
    expect(duplicate.alert.id).toBe(first.alert.id);

    const alerts = await alertRepo.getAll({ wardId: alertData.wardId, date: alertData.date });
    expect(alerts.length).toBe(1);
  });

  // 6. Alert event insertion test
  it("records alert state transitions in alert_events audit log", async () => {
    const { alert } = await alertRepo.insert(sampleAlert());

    await alertEventRepo.recordEvent({ alertId: alert.id, event: "created", actor: "Daily detector run", note: null, at: "2026-07-08T00:30:00.000Z" });
    await alertRepo.updateStatus(alert.id, "acknowledged");
    await alertEventRepo.recordEvent({ alertId: alert.id, event: "acknowledged", actor: "Asha Rao", note: null, at: "2026-07-08T05:00:00.000Z" });
    await alertRepo.updateStatus(alert.id, "resolved");
    await alertEventRepo.recordEvent({ alertId: alert.id, event: "resolved", actor: "Asha Rao", note: null, at: "2026-07-08T09:00:00.000Z" });

    const events = await alertEventRepo.getEventsForAlert(alert.id);
    expect(events.map((e) => e.event)).toEqual(["created", "acknowledged", "resolved"]);
    expect(events[1].actor).toBe("Asha Rao");
  });

  it("saves and loads detector state, CUSUM cells included", async () => {
    const state = { ...emptyDetectorState("cusum"), lastRunDate: TODAY, lastAlertDate: { "21": TODAY } };
    state.cusum = { cells: { "21:pharmacy": { sum: 3.5, nextDate: "2026-07-09" }, "18:hospital": { sum: 0, nextDate: "2026-07-07" } } };
    await db.saveDetectorDay({ method: "cusum", asOfDate: TODAY, state, alerts: [], actor: "Daily detector run", keepStateDays: 30 });

    const loaded = await db.getLatestDetectorState("cusum", TODAY);
    expect(loaded).toEqual({ method: "cusum", asOfDate: TODAY, state });
    expect(await db.getLatestDetectorState("cusum", "2026-07-07")).toBeNull();
    expect(await db.getLatestDetectorState("bayes")).toBeNull();
  });

  // 7. Spatial query test
  it("performs spatial queries: point-in-ward lookup and ward-to-zone lookup", async () => {
    await seedDatabase(db, TODAY);

    // Bagalakunte's centre point (city.json centroid)
    const locatedWard = await wardRepo.findByCoordinates(77.499297, 13.056808);
    expect(locatedWard?.id).toBe(18);
    expect(locatedWard?.name).toBe("Bagalakunte");

    expect(await wardRepo.findByCoordinates(0.0, 0.0)).toBeNull();

    const zone = await zoneRepo.findZoneForWard(18);
    expect(zone?.id).toBe(14);
    expect(zone?.name).toBe("NW3");
  });
});
