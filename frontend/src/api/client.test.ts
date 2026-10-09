import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import city from "@/mock/data/city.json";
import rain from "@/mock/data/rain.json";
import { MockBackend } from "@/mock/backend";
import { directEngine } from "@/mock/engineClient";
import { makeHandlers, MOCK_DEMO_KEY } from "@/mock/handlers";
import type { CityFile } from "@engine/city.js";
import { api, ApiError, config, request, urlFor } from "./client";
import { clearSession, setSession } from "./session";

const backend = new MockBackend({ city: city as unknown as CityFile, rain });
const server = setupServer(...makeHandlers(directEngine(backend), 0));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => { server.resetHandlers(); clearSession(); });
afterAll(() => server.close());

describe("API client (mock mode, real MSW handlers)", () => {
  it("builds same-origin URLs in mock mode and base-URL URLs in real mode", () => {
    expect(urlFor("/alerts")).toBe(`${location.origin}/alerts`);
    const saved = { ...config };
    Object.assign(config, { mode: "real", baseUrl: "https://api.example.org" });
    expect(urlFor("/alerts")).toBe("https://api.example.org/alerts");
    Object.assign(config, saved);
  });

  it("lists alerts with contract shapes", async () => {
    const alerts = await api.listAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(Object.keys(alerts[0]).sort()).toEqual(["alert", "causeEvidence", "createdAt", "events", "id", "status"]);
    expect(Object.keys(alerts[0].alert).sort()).toEqual(["causeProbs", "contributingSignals", "date", "evidence", "method", "score", "suspectedZoneId", "wardId"]);
  });

  it("sends X-Demo-Auth and X-Officer-Name; officer actions fail without the key", async () => {
    const id = (await api.listAlerts())[0].id;
    await expect(api.ackAlert(id)).rejects.toMatchObject({ status: 401 });
    setSession({ demoKey: MOCK_DEMO_KEY, officerName: "Asha Rao" });
    const acked = await api.ackAlert(id);
    expect(acked.status).toBe("acknowledged");
    expect(acked.events.at(-1)).toMatchObject({ kind: "acknowledged", by: "Asha Rao" });
    await expect(api.ackAlert(id)).rejects.toMatchObject({ status: 409 });
    const noted = await api.addNote(id, "Valve checked");
    expect(noted.events.at(-1)).toMatchObject({ kind: "note", text: "Valve checked" });
  });

  it("turns server errors into ApiError with the server's message", async () => {
    const error = await api.getAlert("missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: "No alert with id missing" });
    server.use(http.get("*/backtest", () => HttpResponse.text("boom", { status: 500 })));
    await expect(api.getBacktest()).rejects.toMatchObject({ status: 500, message: "Request failed (500)." });
  });

  it("reports a network failure and a timeout in plain words", async () => {
    server.use(http.get("*/alerts", () => HttpResponse.error()));
    await expect(api.listAlerts()).rejects.toMatchObject({ status: 0, message: "Could not reach the server." });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(http.get("*/alerts", () => new Promise(() => {})));
    const pending = request("/alerts");
    vi.advanceTimersByTime(config.timeoutMs + 10);
    await expect(pending).rejects.toMatchObject({ message: "The server took too long to answer." });
    vi.useRealTimers();
  });

  it("serves risk, rain, signals and the backtest with chance levels", async () => {
    const { today } = await api.getDemoState();
    expect(await api.getRisk(today)).toHaveLength(243);
    const rainRows = await api.getRain("2026-07-01", today);
    expect(rainRows.every((r) => r.sourceTag === "real")).toBe(true);
    const signals = await api.getWardSignals(39, "2026-06-01", today);
    expect(signals.every((r) => r.reportedOn <= today)).toBe(true);
    const bt = await api.getBacktest();
    expect(bt.status).toBe("FINAL");
    expect(bt.chanceCheck?.rows.length).toBeGreaterThan(0);
    expect("runs" in bt).toBe(false);
    await expect(api.getRisk("bad")).rejects.toMatchObject({ status: 400 });
  });

  it("demo inject, advance and reset change what the API returns", async () => {
    setSession({ demoKey: MOCK_DEMO_KEY, officerName: "Asha Rao" });
    const { injection } = await api.injectOutbreak("food", 120);
    expect(injection).toMatchObject({ cause: "food", originWardId: 120 });
    expect((await api.getDemoState()).injection?.originWardId).toBe(120);
    expect((await api.advanceDay()).today).toBe("2026-07-09");
    expect(await api.resetDemo()).toMatchObject({ today: "2026-07-08", injection: null });
  });
});
