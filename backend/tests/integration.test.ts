import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MemoryDatabase } from "../src/db/repository.js";
import { MockSesService } from "../src/notifications/ses.js";
import { executeDetector } from "../src/detector/orchestrator.js";
import { seedDatabase } from "../src/db/seed.js";
import { call, freezeClock, officer, FROZEN_TODAY } from "./helpers.js";
import type { AlertRecord } from "@outbreak/contract";

describe("End-to-End Integration Pipeline", () => {
  let db: MemoryDatabase;
  let ses: MockSesService;

  beforeEach(async () => {
    freezeClock();
    db = new MemoryDatabase();
    ses = new MockSesService();
    // 1. Initial seed: P1's city.json and generateHistory()
    await seedDatabase(db, FROZEN_TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes full lifecycle: seed -> inject -> runDetector() -> alert persistence -> SES -> ack -> note -> resolve -> reset", async () => {
    // 2. Inject a water outbreak in ward 18 (zone 14) with P1's generator, without running the detector.
    const inject = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18, runDetector: false } });
    expect(inject.status).toBe(200);
    const affected = new Set<number>(inject.body.injection.affectedWards.map((w: { wardId: number }) => w.wardId));

    // 3. Detector execution cycle (what the EventBridge schedule does)
    const execResult = await executeDetector({ db, sesService: ses });
    expect(execResult.daysRun.at(-1)).toBe(FROZEN_TODAY);
    expect(execResult.alertsPersisted).toBeGreaterThanOrEqual(1);

    // 4. Verify an alert in the outbreak zone, filled by P1's classifier
    const alerts = await db.getAlerts();
    const alert = alerts.find((a) => affected.has(a.wardId))!;
    expect(alert).toBeDefined();
    expect(alert.status).toBe("open");
    expect(alert.method).toBe("bayes");
    expect(alert.score).toBeGreaterThanOrEqual(0.715);
    expect(alert.contributingSignals.length).toBeGreaterThanOrEqual(2);
    expect(alert.evidence.at(-1)).toMatch(/^chance of an outbreak: \d+%$/);
    expect(alert.causeEvidence.at(-1)).toMatch(/^triage hint, not a diagnosis/);

    // 5. Verify SES Notification was dispatched with mandatory disclaimer
    expect(ses.sentEmails.length).toBe(execResult.alertsPersisted);
    expect(ses.sentEmails.find((e) => e.alertId === alert.id)?.disclaimerPresent).toBe(true);

    // 6. Verify audit event log
    expect((await db.getAlertEvents(alert.id)).map((e) => e.event)).toEqual(["created", "emailed"]);

    // 7. GET /alerts/:id -> AlertRecord
    const getRes = await call(db, { method: "GET", path: `/alerts/${alert.id}` });
    expect(getRes.status).toBe(200);
    const record: AlertRecord = getRes.body;
    expect(record.alert.wardId).toBe(alert.wardId);
    expect(record.events.map((e) => e.kind)).toEqual(["raised", "note"]);

    // 8. Officer Acknowledges, adds a note, resolves
    const ackRes = await call(db, { method: "POST", path: `/alerts/${alert.id}/ack`, headers: officer("Officer Sharma") });
    expect(ackRes.body.status).toBe("acknowledged");
    const noteRes = await call(db, { method: "POST", path: `/alerts/${alert.id}/notes`, headers: officer("Officer Sharma"), body: { text: "Field team testing water samples" } });
    expect(noteRes.status).toBe(200);
    const resolveRes = await call(db, { method: "POST", path: `/alerts/${alert.id}/resolve`, headers: officer("Officer Sharma") });
    expect(resolveRes.body.status).toBe("resolved");

    const finalEvents = await db.getAlertEvents(alert.id);
    expect(finalEvents.map((e) => e.event)).toEqual(["created", "emailed", "acknowledged", "note_added", "resolved"]);
    expect(finalEvents.slice(2).every((e) => e.actor === "Officer Sharma")).toBe(true);

    // 9. Demo Reset: alerts, events, signals and detector state cleared, then re-seeded and re-run
    const resetRes = await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
    expect(resetRes.status).toBe(200);
    expect(await db.getAlertById(alert.id)).toBeNull();
    expect((await db.getSignals()).every((r) => r.sourceTag === "synthetic")).toBe(true);
    expect((await db.getWards()).length).toBe(243);
    expect((await db.getPipelineZones()).length).toBe(43);
  });

  it("proves reset + inject demo controls are deterministic, repeatable, and idempotent across multiple cycles", async () => {
    let first: string | null = null;
    for (let cycle = 1; cycle <= 3; cycle++) {
      // 1. POST /demo/reset
      const resetRes = await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.today).toBe(FROZEN_TODAY);
      expect(resetRes.body.injection).toBeNull();

      // 2. POST /demo/inject
      const injectRes = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18 } });
      expect(injectRes.status).toBe(200);
      expect(injectRes.body.injection.zoneId).toBe(14);

      // 3. GET /alerts -> the same alerts, with the same numbers, every cycle
      const getRes = await call(db, { method: "GET", path: "/alerts" });
      const summary = JSON.stringify(
        (getRes.body as AlertRecord[]).map((r) => [r.alert.wardId, r.alert.date, r.alert.score, r.alert.causeProbs, r.causeEvidence]).sort()
      );
      first ??= summary;
      expect(summary).toBe(first);

      // 4. Verify audit trail (created & emailed) on every alert
      for (const r of getRes.body as AlertRecord[]) {
        expect((await db.getAlertEvents(r.id)).map((e) => e.event)).toEqual(["created", "emailed"]);
      }
    }
  });
});
