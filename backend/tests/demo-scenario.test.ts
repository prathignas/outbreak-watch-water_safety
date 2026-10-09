import { describe, expect, it, afterEach, vi } from "vitest";
import type { AlertRecord } from "@outbreak/contract";
import { MemoryDatabase } from "../src/db/repository.js";
import { DEMO_SCENARIO, topCause } from "../src/demo/scenario.js";
import { getCity } from "../src/city.js";
import { call, freezeClock, officer } from "./helpers.js";

describe("demo scenario: POST /demo/reset never leaves the app empty", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("after reset: >= 3 water-top alerts, >= 2 others, officer activity, and the map's suspected zones", async () => {
    freezeClock();
    const db = new MemoryDatabase();
    expect((await call(db, { method: "POST", path: "/demo/reset", headers: officer() })).status).toBe(200);
    const alerts = (await call(db, { method: "GET", path: "/alerts" })).body as AlertRecord[];

    const water = alerts.filter((r) => topCause(r.alert.causeProbs)[0] === "water");
    const other = alerts.filter((r) => topCause(r.alert.causeProbs)[0] !== "water");
    expect(water.length).toBeGreaterThanOrEqual(3);
    expect(other.length).toBeGreaterThanOrEqual(2);

    // One water alert acknowledged with the note, one other alert resolved, the rest open.
    const acked = alerts.filter((r) => r.status === "acknowledged");
    const resolved = alerts.filter((r) => r.status === "resolved");
    expect(acked).toHaveLength(1);
    expect(topCause(acked[0].alert.causeProbs)[0]).toBe("water");
    expect(acked[0].events.some((e) => e.kind === "note" && e.text === DEMO_SCENARIO.officer.ackNote)).toBe(true);
    expect(resolved).toHaveLength(1);
    expect(topCause(resolved[0].alert.causeProbs)[0]).not.toBe("water");
    expect(alerts.filter((r) => r.status === "open").length).toBe(alerts.length - 2);

    // The map (MapPage) outlines the suspected zones of alerts not yet resolved: every water outbreak's zone is there.
    const suspected = new Set(alerts.filter((r) => r.status !== "resolved").map((r) => r.alert.suspectedZoneId).filter((z): z is number => z !== null));
    const city = getCity();
    for (const o of DEMO_SCENARIO.outbreaks.filter((x) => x.cause === "water")) {
      expect(suspected.has(city.getZoneOfWard(o.wardId) ?? -1)).toBe(true);
    }
    // Saved, so the daily feed keeps the outbreaks going.
    expect(await db.getActiveDemoOutbreaks()).toHaveLength(DEMO_SCENARIO.outbreaks.length);
  });
});
