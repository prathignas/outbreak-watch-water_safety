import { describe, expect, it, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryDatabase } from "../src/db/repository.js";
import { MockSesService } from "../src/notifications/ses.js";
import { executeDetector } from "../src/detector/orchestrator.js";
import { seedDatabase } from "../src/db/seed.js";
import { getCityFile } from "../src/city.js";
import { METRICS } from "../src/metrics.js";
import { DEMO } from "../src/config.js";
import { call, freezeClock, officer, FROZEN_TODAY } from "./helpers.js";

describe("P3 End-to-End Workflow Verification", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes the exact 28-step workflow from fresh deployment to working demo within target time", async () => {
    const startTime = Date.now();
    freezeClock();

    // STEP 1: Verify the synthesized CDK template (run `npm run synth` first; the root `npm test` does)
    const templatePath = [join(process.cwd(), "..", "infra", "cdk.out", "OutbreakWatchStack.template.json"), join(process.cwd(), "infra", "cdk.out", "OutbreakWatchStack.template.json")].find(existsSync);
    expect(templatePath, "run `npm run synth` before the backend tests").toBeDefined();
    const resources: Record<string, any> = JSON.parse(readFileSync(templatePath!, "utf-8")).Resources;
    const ofType = (t: string) => Object.values(resources).filter((r: any) => r.Type === t);
    expect(ofType("AWS::RDS::DBInstance").length).toBe(1);
    const lambdaNames = ofType("AWS::Lambda::Function").map((r: any) => r.Properties.FunctionName).filter(Boolean);
    expect(lambdaNames).toEqual(expect.arrayContaining(["outbreak-watch-backend-api", "outbreak-watch-detector", "outbreak-watch-db-setup"]));
    expect(ofType("AWS::ApiGateway::RestApi").length).toBe(1);
    expect(ofType("AWS::Events::Rule").length).toBeGreaterThanOrEqual(1);
    expect(ofType("AWS::CloudWatch::Dashboard").length).toBe(1);
    expect(ofType("AWS::SecretsManager::Secret").length).toBe(1);
    expect(ofType("AWS::Budgets::Budget").length).toBe(1);
    // The dashboard reads the metric names the detector emits.
    const dashboard = JSON.stringify(ofType("AWS::CloudWatch::Dashboard")[0]);
    for (const name of [METRICS.detectorRuns, METRICS.alertsSent, METRICS.signalsEvaluated, METRICS.detectorErrors]) expect(dashboard).toContain(name);

    // STEP 2: Database migrations exist (001 unchanged, 002 for contract v2)
    const migDir = [join(process.cwd(), "backend", "src", "db", "migrations"), join(process.cwd(), "src", "db", "migrations")].find(existsSync)!;
    const sql001 = readFileSync(join(migDir, "001_initial_schema.sql"), "utf-8");
    for (const table of ["wards", "pipeline_zones", "signals", "alerts", "alert_events"]) expect(sql001).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    expect(readFileSync(join(migDir, "002_contract_v2.sql"), "utf-8")).toContain("CREATE TABLE IF NOT EXISTS detector_state");

    // STEP 3: Load P1's city.json
    const city = getCityFile();
    expect(city.wards.length).toBe(243);
    expect(city.zones.length).toBe(43);

    // STEP 4: Load seed data
    const db = new MemoryDatabase();
    const ses = new MockSesService();
    await seedDatabase(db, FROZEN_TODAY);

    // STEP 5-7: Verify wards, zones, signals
    const wards = await db.getWards();
    expect(wards.length).toBe(243);
    expect(wards.find((w) => w.id === 18)).toEqual({ id: 18, name: "Bagalakunte", zoneId: 14 });
    expect((await db.getPipelineZones()).length).toBe(43);
    const signals = await db.getSignals({});
    expect(signals.length).toBe((DEMO.historyDays + 1) * 243 * 3);
    expect(signals.every((s) => s.sourceTag === "synthetic")).toBe(true);

    // STEP 8: POST /demo/reset
    const resetRes = await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body).toEqual({ today: FROZEN_TODAY, seed: DEMO.seed, injection: null });
    const baseline = new Set((await db.getAlerts()).map((a) => a.id));

    // STEP 9: POST /demo/inject (water, ward 18), leaving the run to the detector
    const injectRes = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18, runDetector: false } });
    expect(injectRes.status).toBe(200);
    expect(injectRes.body.injection).toMatchObject({ cause: "water", originWardId: 18, zoneId: 14, startDate: "2026-07-05" });
    const zone14 = new Set<number>(injectRes.body.injection.affectedWards.map((w: { wardId: number }) => w.wardId));

    // STEP 10: Run the detector (as the EventBridge schedule would), capturing the EMF log line
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    const run1 = await executeDetector({ db, sesService: ses });
    spy.mockRestore();

    // STEP 11: The detector re-ran from the outbreak start with P1's runDetector
    expect(run1.daysRun[0]).toBe("2026-07-05");
    expect(run1.daysRun.at(-1)).toBe(FROZEN_TODAY);
    const outbreakAlert = run1.alerts.find((a) => zone14.has(a.wardId))!;
    expect(outbreakAlert).toBeDefined();
    expect(outbreakAlert.method).toBe("bayes");
    expect(outbreakAlert.suspectedZoneId === 14 || outbreakAlert.suspectedZoneId === null).toBe(true);

    // STEP 12: Alert persisted
    const stored = await db.getAlertById(outbreakAlert.id);
    expect(stored?.status).toBe("open");
    expect(baseline.has(outbreakAlert.id)).toBe(false);

    // STEP 13-15: created event, SES email, emailed event
    const events = await db.getAlertEvents(outbreakAlert.id);
    expect(events.map((e) => e.event)).toEqual(["created", "emailed"]);
    expect(events[0].actor).toBe("Daily detector run");
    const sentEmail = ses.sentEmails.find((e) => e.alertId === outbreakAlert.id)!;
    expect(sentEmail.subject).toBe(`Suspected Outbreak Signal — Ward ${outbreakAlert.wardId}`);
    expect(sentEmail.disclaimerPresent).toBe(true);

    // STEP 16-17: GET /alerts and GET /alerts/{id}
    const listRes = await call(db, { method: "GET", path: "/alerts" });
    expect(listRes.body.some((r: { id: string }) => r.id === outbreakAlert.id)).toBe(true);
    const detailRes = await call(db, { method: "GET", path: `/alerts/${outbreakAlert.id}` });
    expect(detailRes.body.causeEvidence.at(-1)).toMatch(/^triage hint, not a diagnosis/);

    // STEP 18-20: Acknowledge
    const ackRes = await call(db, { method: "POST", path: `/alerts/${outbreakAlert.id}/ack`, headers: officer("Officer Kumar") });
    expect(ackRes.body.status).toBe("acknowledged");
    expect((await db.getAlertById(outbreakAlert.id))?.status).toBe("acknowledged");
    expect((await db.getAlertEvents(outbreakAlert.id)).find((e) => e.event === "acknowledged")?.actor).toBe("Officer Kumar");

    // STEP 21-23: Resolve
    const resolveRes = await call(db, { method: "POST", path: `/alerts/${outbreakAlert.id}/resolve`, headers: officer("Officer Kumar") });
    expect(resolveRes.body.status).toBe("resolved");
    expect((await db.getAlertById(outbreakAlert.id))?.status).toBe("resolved");
    expect((await db.getAlertEvents(outbreakAlert.id)).find((e) => e.event === "resolved")?.actor).toBe("Officer Kumar");

    // STEP 24: Run the detector again for the same day (the 5-minute schedule)
    const lines2: string[] = [];
    const spy2 = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines2.push(args.map(String).join(" ")));
    const run2 = await executeDetector({ db, sesService: ses });
    spy2.mockRestore();

    // STEP 25-26: Today is recomputed from yesterday's state; no duplicate alert, no duplicate email
    expect(run2.daysRun).toEqual([FROZEN_TODAY]);
    expect(run2.alertsPersisted).toBe(0);
    expect((await db.getAlerts()).length).toBe(baseline.size + run1.alertsPersisted);
    expect(ses.sentEmails.length).toBe(run1.alertsPersisted);

    // STEP 27: CloudWatch EMF metrics, with the names the dashboard reads
    const emf = JSON.parse(lines.find((l) => l.includes('"Namespace":"OutbreakWatch"'))!);
    expect(emf.Service).toBe("DetectorLambda");
    expect(emf[METRICS.detectorRuns]).toBe(1);
    expect(emf[METRICS.alertsSent]).toBe(run1.alertsPersisted);
    expect(emf[METRICS.signalsEvaluated]).toBeGreaterThan(0);

    // STEP 28: No detector errors
    expect(emf[METRICS.detectorErrors]).toBe(0);
    expect(JSON.parse(lines2.find((l) => l.includes('"Namespace":"OutbreakWatch"'))!)[METRICS.detectorErrors]).toBe(0);

    // Target: less than 15 minutes
    expect(Date.now() - startTime).toBeLessThan(15 * 60 * 1000);
  });
});
