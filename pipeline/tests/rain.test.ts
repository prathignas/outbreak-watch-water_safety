import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RainAdapter } from "../src/adapters/rain-adapter.js";
import {
  buildOpenMeteoUrl,
  fetchOpenMeteoRain,
  validatePastDays,
} from "../src/adapters/rain-fetcher.js";
import {
  createRainSignalRows,
  parseOpenMeteoRainResponse,
} from "../src/adapters/rain-parser.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError, RainFetchError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";
import { runRainJob } from "../src/jobs/rain-job.js";
import { InMemoryRawArchive } from "../src/raw-archive.js";
import { RAIN_SOURCE, RealCity } from "@outbreak/detection";

function loadFixture(name: string): unknown {
  const path = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("Rain Adapter - Response Parser", () => {
  it("parses valid Open-Meteo response with multiple daily values", () => {
    const fixture = loadFixture("open-meteo-rain");
    const { readings, skipped } = parseOpenMeteoRainResponse(fixture);

    expect(readings).toHaveLength(3);
    expect(skipped).toHaveLength(0);
    expect(readings[0]).toEqual({ date: "2026-10-05", precipitationMm: 0.0 });
    expect(readings[1]).toEqual({ date: "2026-10-06", precipitationMm: 12.4 }); // decimal preserved
    expect(readings[2]).toEqual({ date: "2026-10-07", precipitationMm: 5.8 });
  });

  it("skips null precipitation_sum days and reports them in skipped array without failing batch", () => {
    const payloadWithNull = {
      daily: {
        time: ["2026-10-05", "2026-10-06", "2026-10-07"],
        precipitation_sum: [0.0, null, 5.8],
      },
    };

    const { readings, skipped } = parseOpenMeteoRainResponse(payloadWithNull);

    expect(readings).toHaveLength(2);
    expect(readings[0]).toEqual({ date: "2026-10-05", precipitationMm: 0.0 });
    expect(readings[1]).toEqual({ date: "2026-10-07", precipitationMm: 5.8 });

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toEqual({ date: "2026-10-06", index: 1 });
  });

  it("expands city-wide rainfall across all specified ward IDs into canonical SignalRows", () => {
    const fixture = loadFixture("open-meteo-rain");
    const { readings } = parseOpenMeteoRainResponse(fixture);
    const wardIds = [40, 41];

    const signalRows = createRainSignalRows(readings, wardIds);

    // 2 wards * 3 days = 6 SignalRows
    expect(signalRows).toHaveLength(6);

    // Check exact SignalRow fields conform to contract
    expect(signalRows[0]).toEqual({
      wardId: 40,
      signalType: "rain",
      date: "2026-10-05",
      count: 0.0,
      sourceTag: "real",
      reportedOn: "2026-10-05",
    });
    expect(signalRows[1]).toEqual({
      wardId: 40,
      signalType: "rain",
      date: "2026-10-06",
      count: 12.4,
      sourceTag: "real",
      reportedOn: "2026-10-06",
    });
    expect(signalRows[3]).toEqual({
      wardId: 41,
      signalType: "rain",
      date: "2026-10-05",
      count: 0.0,
      sourceTag: "real",
      reportedOn: "2026-10-05",
    });
  });

  it("throws PipelineValidationError when daily object is missing", () => {
    expect(() => parseOpenMeteoRainResponse({})).toThrow(PipelineValidationError);
    expect(() => parseOpenMeteoRainResponse({ daily: null })).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError when daily.time is missing or not an array", () => {
    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { precipitation_sum: [12.4] },
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: "2026-10-06", precipitation_sum: [12.4] },
      })
    ).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError when daily.precipitation_sum is missing or not an array", () => {
    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: ["2026-10-06"] },
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: ["2026-10-06"], precipitation_sum: 12.4 },
      })
    ).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError for mismatched array lengths", () => {
    expect(() =>
      parseOpenMeteoRainResponse({
        daily: {
          time: ["2026-10-06", "2026-10-07"],
          precipitation_sum: [12.4], // 2 vs 1
        },
      })
    ).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError for malformed rainfall values (negative, NaN, string)", () => {
    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: ["2026-10-06"], precipitation_sum: [-5.0] },
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: ["2026-10-06"], precipitation_sum: [Number.NaN] },
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseOpenMeteoRainResponse({
        daily: { time: ["2026-10-06"], precipitation_sum: ["12.4"] },
      })
    ).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError for empty ward list during expansion", () => {
    expect(() => createRainSignalRows([{ date: "2026-10-06", precipitationMm: 12.4 }], [])).toThrow(
      PipelineValidationError
    );
  });
});

describe("Rain Adapter - HTTP Fetcher & URL Builder", () => {
  it("asks P1's source exactly: the archive API, same point, daily precipitation_sum, Asia/Kolkata", () => {
    const url = new URL(buildOpenMeteoUrl({ startDate: "2026-09-30", endDate: "2026-10-07" }));
    expect(`${url.origin}${url.pathname}`).toBe(RAIN_SOURCE.url);
    expect(url.origin).toBe("https://archive-api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe(String(RAIN_SOURCE.latitude));
    expect(url.searchParams.get("longitude")).toBe(String(RAIN_SOURCE.longitude));
    expect(url.searchParams.get("latitude")).toBe("12.9716");
    expect(url.searchParams.get("longitude")).toBe("77.5946");
    expect(url.searchParams.get("daily")).toBe("precipitation_sum");
    expect(url.searchParams.get("timezone")).toBe("Asia/Kolkata");
    expect(url.searchParams.get("start_date")).toBe("2026-09-30");
    expect(url.searchParams.get("end_date")).toBe("2026-10-07");
    // No forecast and no unit change: the default unit is mm, as in P1's rain.json.
    expect(url.searchParams.has("forecast_days")).toBe(false);
    expect(url.searchParams.has("precipitation_unit")).toBe(false);
  });

  it("rejects a bad date range", () => {
    expect(() => buildOpenMeteoUrl({ startDate: "2026-10-07", endDate: "2026-10-01" })).toThrow(PipelineValidationError);
    expect(() => buildOpenMeteoUrl({ startDate: "2026-02-30", endDate: "2026-03-01" })).toThrow(PipelineValidationError);
  });

  it("refuses an answer in another unit or another timezone", () => {
    const fixture = loadFixture("open-meteo-rain") as Record<string, unknown>;
    expect(() => parseOpenMeteoRainResponse({ ...fixture, daily_units: { time: "iso8601", precipitation_sum: "inch" } })).toThrow(
      PipelineValidationError
    );
    expect(() => parseOpenMeteoRainResponse({ ...fixture, timezone: "GMT" })).toThrow(PipelineValidationError);
  });

  it("validates pastDays option (0, 7, 92 accepted; -1, 93, 1.5, '7', NaN rejected)", () => {
    expect(validatePastDays(0)).toBe(0);
    expect(validatePastDays(7)).toBe(7);
    expect(validatePastDays(92)).toBe(92);

    expect(() => validatePastDays(-1)).toThrow(PipelineValidationError);
    expect(() => validatePastDays(93)).toThrow(PipelineValidationError);
    expect(() => validatePastDays(1.5)).toThrow(PipelineValidationError);
    expect(() => validatePastDays("7" as unknown as number)).toThrow(PipelineValidationError);
    expect(() => validatePastDays(Number.NaN)).toThrow(PipelineValidationError);
  });

  it("fetches data successfully using injected fetch", async () => {
    const fixture = loadFixture("open-meteo-rain");
    const mockFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    })) as unknown as typeof fetch;

    const data = await fetchOpenMeteoRain({ startDate: "2026-10-05", endDate: "2026-10-07", fetchFn: mockFetch });
    expect(data).toEqual(fixture);
  });

  it("handles HTTP 500 error cleanly by throwing RainFetchError", async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "API unavailable",
    })) as unknown as typeof fetch;

    await expect(fetchOpenMeteoRain({ startDate: "2026-10-05", endDate: "2026-10-07", fetchFn: mockFetch })).rejects.toThrow(RainFetchError);
  });

  it("handles network failure cleanly by throwing RainFetchError", async () => {
    const mockFetch = (async () => {
      throw new Error("DNS resolution failure");
    }) as unknown as typeof fetch;

    await expect(fetchOpenMeteoRain({ startDate: "2026-10-05", endDate: "2026-10-07", fetchFn: mockFetch })).rejects.toThrow(RainFetchError);
  });
});

describe("Rain Adapter - End-to-End Ingestion & Future Date Filtering", () => {
  it("drops future dates with a fixed clock while keeping today (partial day) and past days", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    // Mock payload covering 2026-10-05, 2026-10-06, 2026-10-07
    const fixture = loadFixture("open-meteo-rain");
    const mockFetcher = async () => fixture;
    const rainAdapter = new RainAdapter(engine, mockFetcher);

    // Fixed clock: today in IST is 2026-10-06 (10:00 UTC = 15:30 IST on Oct 6)
    const fixedNow = () => new Date("2026-10-06T10:00:00.000Z");

    const wards = [40, 41];
    const result = await rainAdapter.ingestRain(wards, { now: fixedNow });

    // 2026-10-05 (past) and 2026-10-06 (today) kept -> 2 days * 2 wards = 4 rows
    // 2026-10-07 (future) dropped
    expect(result.writtenCount).toBe(4);
    expect(result.droppedFuture).toEqual(["2026-10-07"]);
    expect(result.skipped).toHaveLength(0);

    // Stored rows check
    expect(store.size).toBe(4);
    expect(store.get(40, "rain", "2026-10-05", "real")?.count).toBe(0.0);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(12.4); // decimal preserved
    expect(store.get(40, "rain", "2026-10-07", "real")).toBeUndefined(); // future not written

    expect(store.get(41, "rain", "2026-10-05", "real")?.count).toBe(0.0);
    expect(store.get(41, "rain", "2026-10-06", "real")?.count).toBe(12.4);
    expect(store.get(41, "rain", "2026-10-07", "real")).toBeUndefined();
  });

  it("handles midnight IST boundary for now (18:29:59Z vs 18:30:00Z changes which day is today)", async () => {
    const fixture = loadFixture("open-meteo-rain"); // contains 2026-10-05, 2026-10-06, 2026-10-07
    const mockFetcher = async () => fixture;

    // 1. Clock just before midnight IST (18:29:59.999 UTC) -> today is 2026-10-06
    const store1 = new InMemorySignalStore();
    const engine1 = new SignalIngestionEngine(store1);
    const adapter1 = new RainAdapter(engine1, mockFetcher);

    const result1 = await adapter1.ingestRain([40], {
      now: () => new Date("2026-10-06T18:29:59.999Z"),
    });
    expect(result1.writtenCount).toBe(2); // 2026-10-05, 2026-10-06
    expect(result1.droppedFuture).toEqual(["2026-10-07"]);

    // 2. Clock exactly at midnight IST (18:30:00.000 UTC) -> today is 2026-10-07
    const store2 = new InMemorySignalStore();
    const engine2 = new SignalIngestionEngine(store2);
    const adapter2 = new RainAdapter(engine2, mockFetcher);

    const result2 = await adapter2.ingestRain([40], {
      now: () => new Date("2026-10-06T18:30:00.000Z"),
    });
    expect(result2.writtenCount).toBe(3); // 2026-10-05, 2026-10-06, 2026-10-07
    expect(result2.droppedFuture).toEqual([]);
    expect(store2.get(40, "rain", "2026-10-07", "real")?.count).toBe(5.8);
  });

  it("re-running rain ingestion is idempotent and updates partial day count on later runs", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    let countToday = 5.0;
    const dynamicFetcher = async () => ({
      daily: {
        time: ["2026-10-06"],
        precipitation_sum: [countToday],
      },
    });

    const rainAdapter = new RainAdapter(engine, dynamicFetcher);
    const fixedNow = () => new Date("2026-10-06T12:00:00Z");

    // First ingestion of partial day
    await rainAdapter.ingestRain([40], { now: fixedNow });
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(5.0);

    // Later run with updated observed count for today
    countToday = 14.5;
    await rainAdapter.ingestRain([40], { now: fixedNow });
    expect(store.size).toBe(1);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(14.5);
  });
});

describe("Rain job (hourly): all 243 wards, real only, nothing on failure", () => {
  const wardIds = RealCity.fromFile().wardIds();
  const quiet = { log: () => undefined, error: () => undefined };
  const okFetch = (body: unknown) =>
    (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

  it("writes one value per day into every one of P1's 243 wards, tagged real, reportedOn = date", async () => {
    const store = new InMemorySignalStore();
    const archive = new InMemoryRawArchive();
    const fixture = loadFixture("open-meteo-rain");
    const result = await runRainJob({
      sink: store,
      wardIds,
      archive,
      log: quiet,
      fetchFn: okFetch(fixture),
      now: () => new Date("2026-10-06T10:00:00Z"),
    });

    expect(wardIds).toHaveLength(243);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toEqual([
      { date: "2026-10-05", mm: 0 },
      { date: "2026-10-06", mm: 12.4 },
    ]);
    expect(result.droppedFuture).toEqual(["2026-10-07"]);
    expect(store.size).toBe(2 * 243);
    for (const wardId of wardIds) {
      expect(store.get(wardId, "rain", "2026-10-06", "real")).toEqual({
        wardId,
        signalType: "rain",
        date: "2026-10-06",
        count: 12.4,
        sourceTag: "real",
        reportedOn: "2026-10-06",
      });
    }
    // The untouched Open-Meteo answer is kept, filed under today.
    expect([...archive.saved.keys()]).toHaveLength(1);
    expect([...archive.saved.keys()][0]).toMatch(/^raw\/rain\/2026-10-06\//);
    expect([...archive.saved.values()][0]).toEqual(fixture);
  });

  it("asks for the last 7 days up to today by default", async () => {
    const urls: string[] = [];
    const spy = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => loadFixture("open-meteo-rain") };
    }) as unknown as typeof fetch;
    await runRainJob({ sink: new InMemorySignalStore(), wardIds, log: quiet, fetchFn: spy, now: () => new Date("2026-10-07T03:00:00Z") });
    const url = new URL(urls[0]);
    expect(url.searchParams.get("start_date")).toBe("2026-09-30");
    expect(url.searchParams.get("end_date")).toBe("2026-10-07");
  });

  it("on a failed fetch: logs it and writes nothing (no zeros)", async () => {
    const store = new InMemorySignalStore();
    const errors: string[] = [];
    const down = (async () => ({ ok: false, status: 503, statusText: "Service Unavailable", text: async () => "" })) as unknown as typeof fetch;
    const result = await runRainJob({ sink: store, wardIds, fetchFn: down, log: { log: () => undefined, error: (m: string) => errors.push(m) } });

    expect(result.ok).toBe(false);
    expect(store.size).toBe(0);
    expect(errors.join(" ")).toContain("nothing written");
  });

  it("on a malformed answer (one bad value): writes nothing at all", async () => {
    const store = new InMemorySignalStore();
    const bad = { daily: { time: ["2026-10-05", "2026-10-06"], precipitation_sum: [1.2, -3] } };
    const result = await runRainJob({ sink: store, wardIds, fetchFn: okFetch(bad), log: quiet, now: () => new Date("2026-10-06T10:00:00Z") });
    expect(result.ok).toBe(false);
    expect(store.size).toBe(0);
  });

  it("a day with no value (null) gets no row; other days are written", async () => {
    const store = new InMemorySignalStore();
    const partial = { daily: { time: ["2026-10-05", "2026-10-06"], precipitation_sum: [1.2, null] } };
    const result = await runRainJob({ sink: store, wardIds, fetchFn: okFetch(partial), log: quiet, now: () => new Date("2026-10-06T10:00:00Z") });
    expect(result.ok).toBe(true);
    expect(store.size).toBe(243);
    expect(store.get(1, "rain", "2026-10-06", "real")).toBeUndefined();
  });
});
