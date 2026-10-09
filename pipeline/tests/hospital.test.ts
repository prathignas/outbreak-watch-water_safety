import { describe, expect, it } from "vitest";
import { ComplaintAdapter } from "../src/adapters/complaint-adapter.js";
import { HospitalAdapter } from "../src/adapters/hospital-adapter.js";
import {
  parseHospitalDailyRecord,
  parseHospitalPayload,
} from "../src/adapters/hospital-parser.js";
import { RainAdapter } from "../src/adapters/rain-adapter.js";
import { InMemoryWardResolver } from "../src/adapters/ward-resolver.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";

describe("Hospital Data Ingestion Adapter", () => {
  function setupTestEnvironment() {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);
    const hospitalAdapter = new HospitalAdapter(engine);

    return { store, engine, hospitalAdapter };
  }

  it("1. One valid hospital daily record -> correct SignalRow", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const rawRecord = {
      wardId: 40,
      date: "2026-10-06",
      count: 8,
    };

    const result = await hospitalAdapter.ingestHospitalData(rawRecord);

    expect(result.totalReceived).toBe(1);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")).toEqual({
      wardId: 40,
      signalType: "hospital",
      date: "2026-10-06",
      count: 8,
      sourceTag: "synthetic",
      reportedOn: "2026-10-06",
    });
  });

  it("2. Multiple wards -> separate SignalRows", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const rawBatch = [
      { wardId: 40, date: "2026-10-06", count: 8 },
      { wardId: 41, date: "2026-10-06", count: 15 },
      { wardId: 42, date: "2026-10-06", count: 3 },
    ];

    const result = await hospitalAdapter.ingestHospitalData(rawBatch);

    expect(result.writtenCount).toBe(3);
    expect(store.size).toBe(3);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
    expect(store.get(41, "hospital", "2026-10-06", "synthetic")?.count).toBe(15);
    expect(store.get(42, "hospital", "2026-10-06", "synthetic")?.count).toBe(3);
  });

  it("3. Valid zero count is permitted", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const rawRecord = { wardId: 40, date: "2026-10-06", count: 0 };
    await hospitalAdapter.ingestHospitalData(rawRecord);

    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(0);
  });

  it("4. Invalid wardId -> rejected", () => {
    expect(() => parseHospitalDailyRecord({ wardId: -1, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 1.5, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: "40", date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    // Ward id 0 is allowed (contract: ward ids are >= 0)
    expect(parseHospitalDailyRecord({ wardId: 0, date: "2026-10-06", count: 5 }).wardId).toBe(0);
  });

  it("5. Negative / invalid count -> rejected", () => {
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: -1 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: Number.NaN })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: Number.POSITIVE_INFINITY })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: "8" })).toThrow(
      PipelineValidationError
    );
  });

  it("6. Invalid date -> rejected", () => {
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-02-30", count: 8 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "invalid-date", count: 8 })).toThrow(
      PipelineValidationError
    );
  });

  it("7. Missing required field -> rejected", () => {
    expect(() => parseHospitalDailyRecord({ date: "2026-10-06", count: 8 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, count: 8 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06" })).toThrow(
      PipelineValidationError
    );
  });

  it("8. Malformed input -> rejected", () => {
    expect(() => parseHospitalDailyRecord(null)).toThrow(PipelineValidationError);
    expect(() => parseHospitalDailyRecord(undefined)).toThrow(PipelineValidationError);
    expect(() => parseHospitalPayload(null)).toThrow(PipelineValidationError);
    expect(() => parseHospitalPayload("not an object")).toThrow(PipelineValidationError);
  });

  it("9. Correct hospital signalType is assigned", () => {
    const row = parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 8 });
    expect(row.signalType).toBe("hospital");
  });

  it("10. Correct sourceTag ('synthetic') is assigned by default", () => {
    const row = parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 8 });
    expect(row.sourceTag).toBe("synthetic");
  });

  it("11. Correct IST date handling when a UTC timestamp is used", () => {
    // 8:30 pm UTC on 6 Oct = 2:00 am IST on 7 Oct
    const row = parseHospitalDailyRecord({
      wardId: 40,
      timestamp: "2026-10-06T20:30:00Z",
      count: 12,
    });
    expect(row.date).toBe("2026-10-07");
  });

  it("12. Duplicate identical daily record in batch -> no double count", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const batchWithDuplicate = [
      { wardId: 40, date: "2026-10-06", count: 8 },
      { wardId: 40, date: "2026-10-06", count: 8 },
    ];

    const result = await hospitalAdapter.ingestHospitalData(batchWithDuplicate);

    // IngestionEngine deduplicates on (wardId, signalType, date, sourceTag)
    expect(result.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
  });

  it("13. Rerun of the same daily batch -> completely idempotent", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const dailyBatch = [
      { wardId: 40, date: "2026-10-06", count: 8 },
      { wardId: 41, date: "2026-10-06", count: 14 },
    ];

    // First run
    await hospitalAdapter.ingestHospitalData(dailyBatch);
    expect(store.size).toBe(2);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);

    // Re-run identical batch
    await hospitalAdapter.ingestHospitalData(dailyBatch);
    expect(store.size).toBe(2);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
  });

  it("14. Updated daily value for the same ward/day -> replaces previous value", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    // Initial value
    await hospitalAdapter.ingestHospitalData({ wardId: 40, date: "2026-10-06", count: 8 });
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);

    // Corrected / updated daily total
    await hospitalAdapter.ingestHospitalData({ wardId: 40, date: "2026-10-06", count: 12 });
    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(12);
  });

  it("15. Hospital and Rain data for the same ward/day remain separate because signalType differs", async () => {
    const { store, engine, hospitalAdapter } = setupTestEnvironment();

    // Ingest Hospital record
    await hospitalAdapter.ingestHospitalData({ wardId: 40, date: "2026-10-06", count: 8 });

    // Ingest Rain record for the same ward and date
    const mockRainFetcher = async () => ({
      daily: {
        time: ["2026-10-06"],
        precipitation_sum: [12.4],
      },
    });
    const rainAdapter = new RainAdapter(engine, mockRainFetcher);
    await rainAdapter.ingestRain([40]);

    // Both rows coexist in the sink under their respective signalType
    expect(store.size).toBe(2);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(12.4);
  });

  it("16. Hospital and Complaint data for the same ward/day remain separate because signalType differs", async () => {
    const { store, engine, hospitalAdapter } = setupTestEnvironment();

    // Ingest Hospital record
    await hospitalAdapter.ingestHospitalData({ wardId: 40, date: "2026-10-06", count: 8 });

    // Ingest Complaint record for the same ward and date
    const wardResolver = new InMemoryWardResolver().setPoint(12.9716, 77.5946, 40);
    const complaintAdapter = new ComplaintAdapter(engine, wardResolver);
    await complaintAdapter.ingestComplaints([
      {
        id: "comp-1",
        content: "Water contamination",
        timestamp: "2026-10-06T10:00:00Z",
        wardId: 40,
      },
    ]);

    // Both rows coexist in the sink under their respective signalType and sourceTag
    expect(store.size).toBe(2);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(8);
    expect(store.get(40, "complaint", "2026-10-06", "user")?.count).toBe(1);
  });

  it("17. Verify final output passes through existing SignalIngestionEngine and strictly matches SignalRow contract", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    await hospitalAdapter.ingestHospitalData([
      { ward_id: 40, date: "2026-10-06", count: 20, source_tag: "synthetic" },
    ]);

    const storedRow = store.get(40, "hospital", "2026-10-06", "synthetic");
    expect(storedRow).toEqual({
      wardId: 40,
      signalType: "hospital",
      date: "2026-10-06",
      count: 20,
      sourceTag: "synthetic",
      reportedOn: "2026-10-06",
    });
  });

  it("18. Decimal count handling is accepted as valid finite non-negative number", () => {
    const row = parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5.5 });
    expect(row.count).toBe(5.5);
  });

  it("19. Timestamp with time but no timezone specifier is rejected", () => {
    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, timestamp: "2026-10-06T14:30:00", count: 5 })
    ).toThrow(PipelineValidationError);
  });

  it("20. Same key twice in one payload collapses to last count in engine", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const batch = [
      { wardId: 40, date: "2026-10-06", count: 5 },
      { wardId: 40, date: "2026-10-06", count: 12 },
    ];

    const result = await hospitalAdapter.ingestHospitalData(batch);
    expect(result.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(12);
  });

  it("21. Mixed payload with invalid record rejects batch at parse time with index", () => {
    const mixedBatch = [
      { wardId: 40, date: "2026-10-06", count: 5 },
      { wardId: -1, date: "2026-10-06", count: 10 }, // invalid wardId at index 1
    ];

    expect(() => parseHospitalPayload(mixedBatch)).toThrow(/index 1/);
  });

  it("22. Replay idempotency preserves existing row and count", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    const record = { wardId: 40, date: "2026-10-06", count: 7 };
    await hospitalAdapter.ingestHospitalData(record);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(7);

    // Replay same record
    const replayResult = await hospitalAdapter.ingestHospitalData(record);
    expect(replayResult.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(7);
  });

  it("23. sourceTag validation: non-synthetic tags ('real', 'user', 'scraped', '', 5) rejected; 'synthetic' and missing tag accepted", async () => {
    const { store, hospitalAdapter } = setupTestEnvironment();

    // 1. Accepted: missing sourceTag (defaults to synthetic)
    const rowDefault = parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5 });
    expect(rowDefault.sourceTag).toBe("synthetic");

    // 2. Accepted: explicit 'synthetic'
    const rowExplicit = parseHospitalDailyRecord({
      wardId: 40,
      date: "2026-10-06",
      count: 5,
      sourceTag: "synthetic",
    });
    expect(rowExplicit.sourceTag).toBe("synthetic");

    // 3. Rejected: 'real', 'user', 'scraped', '', 5
    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "real" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "user" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "scraped" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "" })
    ).toThrow(PipelineValidationError);

    expect(() =>
      parseHospitalDailyRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: 5 as unknown as string })
    ).toThrow(PipelineValidationError);

    // 4. Rejected records in batch are not written to sink
    const invalidBatch = [
      { wardId: 40, date: "2026-10-06", count: 5, sourceTag: "real" },
    ];
    await expect(hospitalAdapter.ingestHospitalData(invalidBatch)).rejects.toThrow(
      PipelineValidationError
    );
    expect(store.size).toBe(0);
  });
});
