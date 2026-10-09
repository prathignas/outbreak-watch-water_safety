import { describe, expect, it, afterEach, vi } from "vitest";
import { addDays, rowsArrivingOn } from "@outbreak/detection";
import { MemoryDatabase } from "../src/db/repository.js";
import { runDailyFeed, type WebhookPoster } from "../src/handlers/feedHandler.js";
import { getCity } from "../src/city.js";
import { DEMO } from "../src/config.js";
import type { AlertRecord } from "@outbreak/contract";
import { call, freezeClock, officer, webhook, FROZEN_TODAY } from "./helpers.js";

describe("demo_outbreaks: an injected outbreak survives the next feed runs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("inject, run the feed for the next 2 days: the injected ward's rows stay above baseline", async () => {
    freezeClock();
    const db = new MemoryDatabase();
    await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
    const inject = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18 } });
    expect(inject.status).toBe(200);
    expect(await db.getActiveDemoOutbreaks()).toMatchObject([{ wardId: 18, cause: "water", startDate: addDays(FROZEN_TODAY, -4), seed: DEMO.seed }]);

    // The feed's pharmacy/hospital rows go through the real /webhooks route (the API is the only writer).
    const posted: string[] = [];
    const postWebhook: WebhookPoster = async (kind, records) => {
      const res = await call(db, { method: "POST", path: `/webhooks/${kind}`, headers: webhook(), body: { records } });
      if (res.status !== 200) throw new Error(`webhook ${kind}: ${res.status} ${JSON.stringify(res.body)}`);
      posted.push(kind);
    };

    const city = getCity();
    const total = (rows: Array<{ wardId: number; count: number }>) => rows.filter((r) => r.wardId === 18).reduce((n, r) => n + r.count, 0);
    for (const day of [addDays(FROZEN_TODAY, 1), addDays(FROZEN_TODAY, 2)]) {
      vi.setSystemTime(new Date(`${day}T06:00:00+05:30`));
      const result = await runDailyFeed({ day, db, postWebhook });
      expect(result.ok).toBe(true);
      const stored = (await db.getSignals({ wardId: 18 })).filter((r) => r.reportedOn === day);
      expect(stored.length).toBeGreaterThan(0);
      expect(total(stored)).toBeGreaterThan(total(rowsArrivingOn(day, DEMO.seed, { city })));
    }
    expect(posted).toEqual(["pharmacy", "hospital", "pharmacy", "hospital"]);

    // Reset clears the table: the next feed run is baseline again.
    await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
    expect(await db.getActiveDemoOutbreaks()).toEqual([]);
  });
});

describe("POST /demo/inject: a spreading outbreak, detector run day by day", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("water in ward 18 gives >= 3 alerts in zone 14 wards; later alerts carry P1's causeProbs", async () => {
    freezeClock();
    const db = new MemoryDatabase();
    await call(db, { method: "POST", path: "/demo/reset", headers: officer(), body: { scenario: false } });
    const res = await call(db, { method: "POST", path: "/demo/inject", headers: officer(), body: { cause: "water", wardId: 18 } });
    expect(res.status).toBe(200);
    expect(res.body.injection.startDate).toBe(addDays(FROZEN_TODAY, -4));
    const zone = res.body.injection.zoneId;
    const zoneWards = new Set(getCity().getWardsInZone(zone));

    const alerts = ((await call(db, { method: "GET", path: "/alerts" })).body as AlertRecord[])
      .filter((r) => r.alert.date >= res.body.injection.startDate && zoneWards.has(r.alert.wardId))
      .sort((a, b) => a.alert.date.localeCompare(b.alert.date));
    console.log(
      "[inject water ward 18]",
      JSON.stringify(alerts.map((r) => ({ ward: r.alert.wardId, date: r.alert.date, causeProbs: r.alert.causeProbs })))
    );
    expect(alerts.length).toBeGreaterThanOrEqual(3);
    const later = alerts.slice(1);
    expect(later.every((r) => r.alert.causeProbs && Object.keys(r.alert.causeProbs).length > 0)).toBe(true);
  });
});
