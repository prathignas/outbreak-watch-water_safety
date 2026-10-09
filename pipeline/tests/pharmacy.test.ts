import { describe, expect, it } from "vitest";
import { ComplaintAdapter } from "../src/adapters/complaint-adapter.js";
import { HospitalAdapter } from "../src/adapters/hospital-adapter.js";
import { PharmacyAdapter } from "../src/adapters/pharmacy-adapter.js";
import {
  parsePharmacyDailyRecord,
  parsePharmacyPayload,
} from "../src/adapters/pharmacy-parser.js";
import { RainAdapter } from "../src/adapters/rain-adapter.js";
import { InMemoryWardResolver } from "../src/adapters/ward-resolver.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";

describe("Pharmacy Data Ingestion Adapter", () => {
  function setupTestEnvironment() {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);
    const pharmacyAdapter = new PharmacyAdapter(engine);

    return { store, engine, pharmacyAdapter };
  }

  it("1. One valid pharmacy daily record -> correct SignalRow", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const rawRecord = {
      wardId: 40,
      date: "2026-10-06",
      count: 25,
    };

    const result = await pharmacyAdapter.ingestPharmacyData(rawRecord);

    expect(result.totalReceived).toBe(1);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")).toEqual({
      wardId: 40,
      signalType: "pharmacy",
      date: "2026-10-06",
      count: 25,
      sourceTag: "synthetic",
      reportedOn: "2026-10-06",
    });
  });

  it("2. Multiple wards -> separate SignalRows", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const rawBatch = [
      { wardId: 40, date: "2026-10-06", count: 25 },
      { wardId: 41, date: "2026-10-06", count: 42 },
      { wardId: 42, date: "2026-10-06", count: 18 },
    ];

    const result = await pharmacyAdapter.ingestPharmacyData(rawBatch);

    expect(result.writtenCount).toBe(3);
    expect(store.size).toBe(3);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(25);
    expect(store.get(41, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(42);
    expect(store.get(42, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(18);
  });

  it("3. Valid zero count is permitted; non-reported days are not written as zero", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const rawRecord = { wardId: 40, date: "2026-10-06", count: 0 };
    await pharmacyAdapter.ingestPharmacyData(rawRecord);

    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(0);
    // Non-reported days are undefined, not 0
    expect(store.get(40, "pharmacy", "2026-10-07", "synthetic")).toBeUndefined();
  });

  it("4. Decimal count is accepted as a valid finite non-negative number", () => {
    const row = parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 15.5 });
    expect(row.count).toBe(15.5);
  });

  it("5. Invalid wardId -> rejected", () => {
    // Ward id 0 is allowed (contract: ward ids are >= 0)
    expect(parsePharmacyDailyRecord({ wardId: 0, date: "2026-10-06", count: 5 }).wardId).toBe(0);
    expect(() => parsePharmacyDailyRecord({ wardId: -1, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: 1.5, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: "40", date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: null, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
  });

  it("6. Negative, NaN, Infinity, string count -> rejected", () => {
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: -1 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: Number.NaN })).toThrow(
      PipelineValidationError
    );
    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: Number.POSITIVE_INFINITY })
    ).toThrow(PipelineValidationError);
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: "25" })).toThrow(
      PipelineValidationError
    );
  });

  it("7. Invalid dates: 2026-02-30, month 13, no-timezone timestamp -> rejected", () => {
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-02-30", count: 10 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-13-01", count: 10 })).toThrow(
      PipelineValidationError
    );
    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, timestamp: "2026-10-06T14:30:00", count: 10 })
    ).toThrow(PipelineValidationError);
  });

  it("8. Date rollover and timezone offset handling", () => {
    // 2026-12-31T18:30:00Z -> 2027-01-01 (IST midnight)
    const rowRollover = parsePharmacyDailyRecord({
      wardId: 40,
      timestamp: "2026-12-31T18:30:00Z",
      count: 10,
    });
    expect(rowRollover.date).toBe("2027-01-01");

    // 2026-12-31T18:29:59Z -> 2026-12-31
    const rowBeforeRollover = parsePharmacyDailyRecord({
      wardId: 40,
      timestamp: "2026-12-31T18:29:59Z",
      count: 10,
    });
    expect(rowBeforeRollover.date).toBe("2026-12-31");

    // +05:30 offset preserved
    const rowOffset = parsePharmacyDailyRecord({
      wardId: 40,
      timestamp: "2026-10-06T20:30:00+05:30",
      count: 10,
    });
    expect(rowOffset.date).toBe("2026-10-06");
  });

  it("9. Correct pharmacy signalType and synthetic sourceTag assigned by default", () => {
    const row = parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25 });
    expect(row.signalType).toBe("pharmacy");
    expect(row.sourceTag).toBe("synthetic");
  });

  it("10. Missing required fields -> rejected", () => {
    expect(() => parsePharmacyDailyRecord({ date: "2026-10-06", count: 25 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: 40, count: 25 })).toThrow(
      PipelineValidationError
    );
    expect(() => parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06" })).toThrow(
      PipelineValidationError
    );
  });

  it("11. Malformed input -> rejected", () => {
    expect(() => parsePharmacyDailyRecord(null)).toThrow(PipelineValidationError);
    expect(() => parsePharmacyDailyRecord(undefined)).toThrow(PipelineValidationError);
    expect(() => parsePharmacyPayload(null)).toThrow(PipelineValidationError);
    expect(() => parsePharmacyPayload("invalid payload")).toThrow(PipelineValidationError);
  });

  it("12. Duplicate identical daily record in batch collapses without double counting", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const batch = [
      { wardId: 40, date: "2026-10-06", count: 25 },
      { wardId: 40, date: "2026-10-06", count: 25 },
    ];

    const result = await pharmacyAdapter.ingestPharmacyData(batch);
    expect(result.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(25);
  });

  it("13. Same key twice in one payload collapses to the last count", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const batch = [
      { wardId: 40, date: "2026-10-06", count: 10 },
      { wardId: 40, date: "2026-10-06", count: 30 },
    ];

    const result = await pharmacyAdapter.ingestPharmacyData(batch);
    expect(result.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(30);
  });

  it("14. Replay of the same daily batch is completely idempotent", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const batch = [
      { wardId: 40, date: "2026-10-06", count: 25 },
      { wardId: 41, date: "2026-10-06", count: 35 },
    ];

    await pharmacyAdapter.ingestPharmacyData(batch);
    expect(store.size).toBe(2);

    // Replay
    const replayResult = await pharmacyAdapter.ingestPharmacyData(batch);
    expect(replayResult.writtenCount).toBe(2);
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(25);
    expect(store.get(41, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(35);
  });

  it("15. Updated daily value for the same ward/day replaces previous value", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    await pharmacyAdapter.ingestPharmacyData({ wardId: 40, date: "2026-10-06", count: 25 });
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(25);

    await pharmacyAdapter.ingestPharmacyData({ wardId: 40, date: "2026-10-06", count: 40 });
    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(40);
  });

  it("16. Hospital and Pharmacy rows for the same ward and date do NOT overwrite each other", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);
    const pharmacyAdapter = new PharmacyAdapter(engine);
    const hospitalAdapter = new HospitalAdapter(engine);

    // Ingest pharmacy row
    await pharmacyAdapter.ingestPharmacyData({ wardId: 40, date: "2026-10-06", count: 50 });

    // Ingest hospital row for identical ward and date
    await hospitalAdapter.ingestHospitalData({ wardId: 40, date: "2026-10-06", count: 8 });

    // Both rows coexist independently under their distinct signalType
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(50);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
  });

  it("17. Pharmacy, Rain, and Complaint rows for same ward and date coexist cleanly", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);
    const pharmacyAdapter = new PharmacyAdapter(engine);

    await pharmacyAdapter.ingestPharmacyData({ wardId: 40, date: "2026-10-06", count: 50 });

    const mockRainFetcher = async () => ({
      daily: { time: ["2026-10-06"], precipitation_sum: [12.4] },
    });
    const rainAdapter = new RainAdapter(engine, mockRainFetcher);
    await rainAdapter.ingestRain([40]);

    const wardResolver = new InMemoryWardResolver().setPoint(12.9716, 77.5946, 40);
    const complaintAdapter = new ComplaintAdapter(engine, wardResolver);
    await complaintAdapter.ingestComplaints([
      { id: "c-1", content: "Tap water muddy", timestamp: "2026-10-06T10:00:00Z", wardId: 40 },
    ]);

    expect(store.size).toBe(3);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(50);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(12.4);
    expect(store.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("18. knownWardIds option routes unknown wards to errors; strict mode throws", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    const batch = [
      { wardId: 40, date: "2026-10-06", count: 20 },
      { wardId: 999, date: "2026-10-06", count: 20 }, // unknown ward
    ];

    // Non-strict: records unknown ward in errors array
    const result = await pharmacyAdapter.ingestPharmacyData(batch, {
      knownWardIds: [40, 41],
    });
    expect(result.totalReceived).toBe(2);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")).toBeDefined();
    expect(store.get(999, "pharmacy", "2026-10-06", "synthetic")).toBeUndefined();

    // Strict: throws immediately
    await expect(
      pharmacyAdapter.ingestPharmacyData(batch, {
        knownWardIds: [40, 41],
        strict: true,
      })
    ).rejects.toThrow(PipelineValidationError);
  });

  it("19. Mixed payload with invalid record fails parsing with specific index error", () => {
    const mixedBatch = [
      { wardId: 40, date: "2026-10-06", count: 25 },
      { wardId: -5, date: "2026-10-06", count: 25 }, // invalid at index 1
    ];

    expect(() => parsePharmacyPayload(mixedBatch)).toThrow(/index 1/);
  });

  it("20. Accepts wrapper object with records or data array", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    await pharmacyAdapter.ingestPharmacyData({
      records: [{ wardId: 40, date: "2026-10-06", count: 12 }],
    });
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(12);

    await pharmacyAdapter.ingestPharmacyData({
      data: [{ wardId: 41, date: "2026-10-06", count: 18 }],
    });
    expect(store.get(41, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(18);
  });

  it("21. sourceTag validation: non-synthetic tags ('real', 'user', 'scraped', '', 5) rejected; 'synthetic' and missing tag accepted", async () => {
    const { store, pharmacyAdapter } = setupTestEnvironment();

    // 1. Accepted: missing sourceTag (defaults to synthetic)
    const rowDefault = parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25 });
    expect(rowDefault.sourceTag).toBe("synthetic");

    // 2. Accepted: explicit 'synthetic'
    const rowExplicit = parsePharmacyDailyRecord({
      wardId: 40,
      date: "2026-10-06",
      count: 25,
      sourceTag: "synthetic",
    });
    expect(rowExplicit.sourceTag).toBe("synthetic");

    // 3. Rejected: 'real', 'user', 'scraped', '', 5
    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25, sourceTag: "real" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25, sourceTag: "user" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25, sourceTag: "scraped" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25, sourceTag: "" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parsePharmacyDailyRecord({ wardId: 40, date: "2026-10-06", count: 25, sourceTag: 5 as unknown as string })
    ).toThrow(PipelineValidationError);

    // 4. Rejected records in batch are not written to sink
    const invalidBatch = [
      { wardId: 40, date: "2026-10-06", count: 25, sourceTag: "real" },
    ];
    await expect(pharmacyAdapter.ingestPharmacyData(invalidBatch)).rejects.toThrow(
      PipelineValidationError
    );
    expect(store.size).toBe(0);
  });
});
