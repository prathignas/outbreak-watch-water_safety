import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MemoryDatabase } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";
import { DEMO } from "../src/config.js";
import { call, freezeClock, officer, webhook, DEMO_KEY, FROZEN_TODAY } from "./helpers.js";
import type { AlertRecord, WardRisk } from "@outbreak/contract";

/* Every route in frontend/README.md, with the shapes the app expects. */
describe("REST API Endpoints", () => {
  let db: MemoryDatabase;

  beforeEach(async () => {
    freezeClock();
    db = new MemoryDatabase();
    await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function firstAlert(): Promise<AlertRecord> {
    const res = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18 } });
    expect(res.status).toBe(200);
    const list = await call(db, { method: "GET", path: "/alerts" });
    return list.body[0];
  }

  it("GET /alerts returns AlertRecord[], newest createdAt first", async () => {
    await firstAlert();
    const res = await call(db, { method: "GET", path: "/alerts" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const record: AlertRecord = res.body[0];
    expect(Object.keys(record).sort()).toEqual(["alert", "causeEvidence", "createdAt", "events", "id", "status"]);
    expect(Object.keys(record.alert).sort()).toEqual(
      ["causeProbs", "contributingSignals", "date", "evidence", "method", "score", "suspectedZoneId", "wardId"]
    );
    expect(record.events[0]).toEqual({ at: expect.any(String), by: "Daily detector run", kind: "raised" });
    const created = res.body.map((r: AlertRecord) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it("GET /alerts/:id returns one AlertRecord with the classifier's reasons", async () => {
    const record = await firstAlert();
    const res = await call(db, { method: "GET", path: `/alerts/${record.id}` });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(record.id);
    expect(res.body.causeEvidence.at(-1)).toMatch(/^triage hint, not a diagnosis/);
    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual(["raised", "note"]); // the email note
  });

  it("POST /alerts/:id/ack needs no demo key, records X-Officer-Name and returns the AlertRecord", async () => {
    const record = await firstAlert();
    const res = await call(db, { method: "POST", path: `/alerts/${record.id}/ack`, headers: { "X-Officer-Name": "Dr. Meera" } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
    expect(res.body.events.at(-1)).toEqual({ at: expect.any(String), by: "Dr. Meera", kind: "acknowledged" });

    // A missing name is the caller's mistake (400).
    const noName = await call(db, { method: "POST", path: `/alerts/${record.id}/ack` });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("OFFICER_NAME_REQUIRED");

    // Header names in any case (API Gateway REST keeps the client's case).
    const again = await call(db, { method: "POST", path: `/alerts/${record.id}/ack`, headers: { "x-officer-name": "Dr. Meera" } });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("Alert is acknowledged; it cannot become acknowledged.");
  });

  it("POST /alerts/:id/resolve needs no demo key and transitions status; resolving twice is 409", async () => {
    const record = await firstAlert();
    const res = await call(db, { method: "POST", path: `/alerts/${record.id}/resolve`, headers: { "X-Officer-Name": "Asha Rao" } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect((await call(db, { method: "POST", path: `/alerts/${record.id}/resolve`, headers: officer() })).status).toBe(409);
    expect((await call(db, { method: "POST", path: `/alerts/${record.id}/ack`, headers: officer() })).status).toBe(409);
  });

  it("POST /alerts/:id/notes adds a note event; empty or too long is 400", async () => {
    const record = await firstAlert();
    const res = await call(db, { method: "POST", path: `/alerts/${record.id}/notes`, headers: officer(), body: { text: "  Sent a team to test the water.  " } });
    expect(res.status).toBe(200);
    expect(res.body.events.at(-1)).toEqual({ at: expect.any(String), by: "Asha Rao", kind: "note", text: "Sent a team to test the water." });
    expect((await call(db, { method: "POST", path: `/alerts/${record.id}/notes`, headers: officer(), body: { text: " " } })).body.message).toBe("A note cannot be empty.");
    expect((await call(db, { method: "POST", path: `/alerts/${record.id}/notes`, headers: officer(), body: { text: "x".repeat(2001) } })).status).toBe(400);
    expect((await call(db, { method: "POST", path: `/alerts/${record.id}/notes`, headers: { "X-Officer-Name": "Asha Rao" }, body: { text: "hi" } })).status).toBe(200);
  });

  it("POST /complaints: the form's body gives a 'user' row; a retry with the same complaintId counts once", async () => {
    const form = { complaintId: "form-abc", wardId: 18, description: "Dirty water from the tap" };
    const res = await call(db, { method: "POST", path: "/complaints", body: form });
    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.signal).toEqual({ wardId: 18, signalType: "complaint", date: FROZEN_TODAY, count: 1, sourceTag: "user", reportedOn: FROZEN_TODAY });

    const retry = await call(db, { method: "POST", path: "/complaints", body: form });
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.signal.count).toBe(1);

    const another = await call(db, { method: "POST", path: "/complaints", body: { ...form, complaintId: "form-def" } });
    expect(another.body.signal.count).toBe(2);
    // No id sent: the server makes one, so each submission counts once.
    const noId = await call(db, { method: "POST", path: "/complaints", body: { wardId: 18, description: "Smell" } });
    expect(noId.body.signal.count).toBe(3);
    expect(await db.countComplaintEvents(18, FROZEN_TODAY)).toBe(3);
  });

  it("POST /complaints: the server's clock sets the day, not the client's", async () => {
    const res = await call(db, { method: "POST", path: "/complaints", body: { complaintId: "c-t", wardId: 18, description: "x", timestamp: "2026-01-01T00:00:00Z" } });
    expect(res.body.signal.date).toBe(FROZEN_TODAY);
  });

  it("POST /webhooks/pharmacy ingests pharmacy counts with source tag synthetic and reportedOn", async () => {
    const res = await call(db, { method: "POST", path: "/webhooks/pharmacy", headers: webhook(), body: [{ wardId: 18, count: 31, date: "2026-07-08" }] });
    expect(res.status).toBe(200);
    expect(res.body.signalsIngested).toBe(1);
    const rows = await db.getSignals({ wardId: 18, startDate: "2026-07-08", endDate: "2026-07-08" });
    expect(rows.find((r) => r.signalType === "pharmacy")).toEqual({ wardId: 18, signalType: "pharmacy", date: "2026-07-08", count: 31, sourceTag: "synthetic", reportedOn: FROZEN_TODAY });
  });

  it("POST /webhooks/hospital: date and reportedOn default to today in India", async () => {
    const res = await call(db, { method: "POST", path: "/webhooks/hospital", headers: webhook(), body: { wardId: 18, count: 4 } });
    expect(res.status).toBe(200);
    const rows = await db.getSignals({ wardId: 18, startDate: FROZEN_TODAY, endDate: FROZEN_TODAY });
    expect(rows.find((r) => r.signalType === "hospital")).toEqual({ wardId: 18, signalType: "hospital", date: FROZEN_TODAY, count: 4, sourceTag: "synthetic", reportedOn: FROZEN_TODAY });
  });

  it("GET /wards returns P1's wards with their water zone and no made-up risk status", async () => {
    const res = await call(db, { method: "GET", path: "/wards" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(243);
    expect(res.body.wards.find((w: { id: number }) => w.id === 18)).toEqual({ id: 18, name: "Bagalakunte", zoneId: 14, openAlerts: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/"status":"(warning|normal)"/);
  });

  it("GET /wards/:id/risk returns that ward's entry from P1's wardRisk", async () => {
    const res = await call(db, { method: "GET", path: "/wards/18/risk" });
    expect(res.status).toBe(200);
    const all = await call(db, { method: "GET", path: "/risk", queryStringParameters: { date: FROZEN_TODAY } });
    expect(res.body.risk).toEqual(all.body.find((r: WardRisk) => r.wardId === 18));
  });

  it("GET /risk?date= returns WardRisk[] for every ward", async () => {
    const res = await call(db, { method: "GET", path: "/risk", queryStringParameters: { date: FROZEN_TODAY } });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(243);
    for (const r of res.body as WardRisk[]) {
      expect(r.probability).toBeGreaterThanOrEqual(0);
      expect(r.probability).toBeLessThanOrEqual(1);
    }
    expect((await call(db, { method: "GET", path: "/risk" })).status).toBe(400);
    expect((await call(db, { method: "GET", path: "/risk", queryStringParameters: { date: "2026-07-10" } })).status).toBe(400);
  });

  it("GET /rain returns only real rain rows, one per day (none until P2 writes them)", async () => {
    const q = { from: "2026-07-01", to: FROZEN_TODAY };
    expect((await call(db, { method: "GET", path: "/rain", queryStringParameters: q })).body).toEqual([]);
    await db.insertSignals([18, 19].map((wardId) => ({ wardId, signalType: "rain" as const, date: "2026-07-08", count: 7.2, sourceTag: "real" as const })));
    expect((await call(db, { method: "GET", path: "/rain", queryStringParameters: q })).body).toEqual([{ date: "2026-07-08", mm: 7.2, sourceTag: "real" }]);
    expect((await call(db, { method: "GET", path: "/rain", queryStringParameters: { from: "x", to: "y" } })).status).toBe(400);
  });

  it("GET /wards/:id/signals returns LiveSignalRow[] known by today", async () => {
    const res = await call(db, { method: "GET", path: "/wards/18/signals", queryStringParameters: { from: "2026-06-01", to: FROZEN_TODAY } });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(row.wardId).toBe(18);
      expect(row.reportedOn <= FROZEN_TODAY).toBe(true);
      expect(row.sourceTag).toBe("synthetic");
    }
    expect((await call(db, { method: "GET", path: "/wards/999/signals", queryStringParameters: { from: "2026-06-01", to: FROZEN_TODAY } })).status).toBe(404);
  });

  it("GET /backtest serves P1's results file without runs, with the chance check", async () => {
    const res = await call(db, { method: "GET", path: "/backtest" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("FINAL");
    expect(res.body.runs).toBeUndefined();
    expect(res.body.chanceCheck.rows.length).toBeGreaterThan(0);
    expect(res.body.summary.length).toBeGreaterThan(0);
    // Exactly P1's file minus the per-seed detail, plus a found/total tally of its "detected" flags.
    const { runs, ...file } = JSON.parse(readFileSync(new URL("../../detection/results/backtest.json", import.meta.url), "utf8"));
    const { counts, ...rest } = res.body;
    expect(rest).toEqual(file);
    const water = counts.find((c: any) => c.method === "bayes" && c.difficulty === "realistic" && c.budget === 0.25 && c.cause === "water");
    const flags = runs
      .filter((r: any) => r.difficulty === "realistic")
      .flatMap((r: any) => r.results.filter((x: any) => x.method === "bayes" && x.budget === 0.25))
      .flatMap((x: any) => x.test.outbreaks.filter((o: any) => o.cause === "water"));
    expect(water).toMatchObject({ total: flags.length, found: flags.filter((o: any) => o.detected).length });
    expect(JSON.stringify(res.body)).not.toMatch(/sensitivity|leadTimeDays|primaryRecommendation/);
  });

  it("GET /backtest is 503 { message } when the file is missing, never made-up numbers", async () => {
    process.env.BACKTEST_PATH = "/nonexistent/backtest.json";
    try {
      const res = await call(db, { method: "GET", path: "/backtest" });
      expect(res.status).toBe(503);
      expect(res.body.message).toBe("backtest not run yet");
    } finally {
      delete process.env.BACKTEST_PATH;
    }
  });

  it("POST /demo/inject uses P1's generateLiveDay: every row synthetic, and returns { injection, appearsAfterMs }", async () => {
    const res = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18 } });
    expect(res.status).toBe(200);
    expect(res.body.appearsAfterMs).toBe(0);
    expect(res.body.injection).toMatchObject({ cause: "water", startDate: "2026-07-05", originWardId: 18, zoneId: 14 });
    const rows = await db.getSignals();
    expect(rows.every((r) => r.sourceTag === "synthetic")).toBe(true);
    const alerts = (await call(db, { method: "GET", path: "/alerts" })).body as AlertRecord[];
    const zone14 = new Set(res.body.injection.affectedWards.map((w: { wardId: number }) => w.wardId));
    expect(alerts.some((r) => zone14.has(r.alert.wardId))).toBe(true);

    const later = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "food", wardId: 57, runDetector: false } });
    expect(later.body.appearsAfterMs).toBe(5 * 60 * 1000);
  });

  it("POST /demo/reset returns { today, seed, injection } and leaves only seeded synthetic rows", async () => {
    await firstAlert();
    const res = await call(db, { method: "POST", path: "/demo/reset", headers: officer() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ today: FROZEN_TODAY, seed: DEMO.seed, injection: null });
    expect((await db.getSignals()).length).toBe((DEMO.historyDays + 1) * 243 * 3);
    expect(await db.getLatestDetectorState("bayes")).not.toBeNull();
  });

  it("GET /alerts rejects invalid query params", async () => {
    expect((await call(db, { method: "GET", path: "/alerts", queryStringParameters: { status: "pending" } })).status).toBe(400);
    expect((await call(db, { method: "GET", path: "/alerts", queryStringParameters: { limit: "0" } })).status).toBe(400);
    expect((await call(db, { method: "GET", path: "/alerts", queryStringParameters: { wardId: "-1" } })).status).toBe(400);
    expect((await call(db, { method: "GET", path: "/alerts", queryStringParameters: { wardId: "0" } })).status).toBe(200);
  });

  it("GET /alerts/:id returns 404 { message } for non-existent alert", async () => {
    const res = await call(db, { method: "GET", path: "/alerts/00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("No alert with id 00000000-0000-4000-8000-000000000000");
  });

  it("POST /alerts/:id/ack and /resolve return 404 for non-existent alert", async () => {
    expect((await call(db, { method: "POST", path: "/alerts/nope/ack", headers: officer() })).status).toBe(404);
    expect((await call(db, { method: "POST", path: "/alerts/nope/resolve", headers: officer() })).status).toBe(404);
  });

  it("POST /complaints returns 400 for an unknown ward, a bad body or an old-style count; ward 0 passes the id check", async () => {
    const unknown = await call(db, { method: "POST", path: "/complaints", body: { wardId: 999, description: "x" } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain("Ward ID 999 is not in the list of known ward IDs");
    expect((await call(db, { method: "POST", path: "/complaints", body: { wardId: -1, description: "x" } })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/complaints", body: {} })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/complaints", body: { wardId: 18 } })).status).toBe(400); // no description
    expect((await call(db, { method: "POST", path: "/complaints", body: { wardId: 18, description: "x", count: 5 } })).status).toBe(400);
    // Ward 0 is a valid id; it is refused only because P1's city has no ward 0.
    expect((await call(db, { method: "POST", path: "/complaints", body: { wardId: 0, description: "x" } })).body.message).toContain("Ward ID 0 is not in the list");
  });

  it("POST /webhooks/* needs the webhook secret header (401 without it or with a wrong one; nothing written)", async () => {
    const body = [{ wardId: 18, count: 5 }];
    expect((await call(db, { method: "POST", path: "/webhooks/pharmacy", body })).status).toBe(401);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: { "X-Webhook-Secret": "wrong" }, body })).status).toBe(401);
    // The demo key is not the webhook secret.
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: officer(), body })).status).toBe(401);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: { "x-webhook-secret": "test-webhook-secret" }, body })).status).toBe(200);
    // The header name comes from WEBHOOK_SECRET_HEADER.
    process.env.WEBHOOK_SECRET_HEADER = "X-Feed-Key";
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: webhook(), body })).status).toBe(401);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: { "X-Feed-Key": "test-webhook-secret" }, body })).status).toBe(200);
    // No secret configured: everything is refused.
    delete process.env.WEBHOOK_SECRET;
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: { "X-Feed-Key": "" }, body })).status).toBe(401);
  });

  it("POST /webhooks/pharmacy returns 400 for malformed payload", async () => {
    expect((await call(db, { method: "POST", path: "/webhooks/pharmacy", headers: webhook(), body: [{ wardId: "x", count: 1 }] })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: webhook(), body: [{ wardId: 18, count: 1, date: "2026-07-08", reportedOn: "2026-07-07" }] })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: webhook(), body: [{ wardId: 999, count: 1 }] })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/webhooks/hospital", headers: webhook(), body: [{ wardId: 18, count: 1, sourceTag: "real" }] })).status).toBe(400);
    // One bad row refuses the whole batch: nothing is written.
    const before = (await db.getSignals({ wardId: 17 })).length;
    expect((await call(db, { method: "POST", path: "/webhooks/pharmacy", headers: webhook(), body: [{ wardId: 17, count: 1, date: "2026-07-09" }, { wardId: "x", count: 1 }] })).status).toBe(400);
    expect((await db.getSignals({ wardId: 17 })).length).toBe(before);
  });

  it("GET /wards/:id/risk returns 404 for non-existent ward", async () => {
    expect((await call(db, { method: "GET", path: "/wards/999/risk" })).status).toBe(404);
  });

  it("POST /demo/inject and /reset require demo auth; inject rejects unknown causes and wards", async () => {
    expect((await call(db, { method: "POST", path: "/demo/inject", body: { cause: "water", wardId: 18 } })).status).toBe(401);
    expect((await call(db, { method: "POST", path: "/demo/reset" })).status).toBe(401);
    expect((await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "seasonal", wardId: 18 } })).status).toBe(400);
    expect((await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 999 } })).body.message).toBe("Unknown ward: 999");
  });

  it("answers CORS preflight with X-Officer-Name allowed", async () => {
    const res = await call(db, { method: "OPTIONS", path: "/alerts/x/ack" });
    expect(res.status).toBe(204);
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("X-Officer-Name");
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("X-Demo-Auth");
  });

  it("returns 404 for unknown endpoint routes", async () => {
    const res = await call(db, { method: "GET", path: "/summary" });
    expect(res.status).toBe(404);
    expect(typeof res.body.message).toBe("string");
  });
});
