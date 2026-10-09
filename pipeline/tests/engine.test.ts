import { describe, expect, it } from "vitest";
import { SignalIngestionEngine, processRawSignals } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore, type SignalSink } from "../src/sink.js";

describe("SignalIngestionEngine - Idempotency & Deduplication", () => {
  it("1. Two identical batch rows do not double count (last-write-wins within batch)", () => {
    const rawBatchWithDuplicates = [
      {
        wardId: 10,
        signalType: "rain",
        date: "2026-10-06",
        count: 5.0,
        sourceTag: "real",
      },
      {
        wardId: 10,
        signalType: "rain",
        date: "2026-10-06",
        count: 8.5, // Updated / second occurrence in same batch
        sourceTag: "real",
      },
    ];

    const { rows } = processRawSignals(rawBatchWithDuplicates);

    // Must deduplicate to exactly 1 canonical row with latest count, not 13.5
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      wardId: 10,
      signalType: "rain",
      date: "2026-10-06",
      count: 8.5,
      sourceTag: "real",
      reportedOn: "2026-10-06",
    });
  });

  it("2. A rerun of the same batch is idempotent in the store", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    const dailyBatch = [
      {
        wardId: 40,
        signalType: "pharmacy",
        date: "2026-10-06",
        count: 31,
        sourceTag: "synthetic",
      },
      {
        wardId: 40,
        signalType: "rain",
        date: "2026-10-06",
        count: 12.4,
        sourceTag: "real",
      },
    ];

    // Initial run
    await engine.ingest(dailyBatch);
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(31);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(12.4);

    // Replay / rerun exact same batch
    await engine.ingest(dailyBatch);
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(31);
    expect(store.get(40, "rain", "2026-10-06", "real")?.count).toBe(12.4);

    // Replay with revised count for the day
    await engine.ingest([
      {
        wardId: 40,
        signalType: "pharmacy",
        date: "2026-10-06",
        count: 35,
        sourceTag: "synthetic",
      },
    ]);
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(35);
  });

  it("3 & 4. Distinct complaint events contribute to daily SignalRow without engine needing event identities", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    // Simulated event-level storage/adapter handling individual complaint events
    // Event 1: Complaint #A received at 10:00 IST for Ward 40
    // Event 2: Complaint #B received at 14:00 IST for Ward 40
    const complaintEvents = new Set<string>(["complaint-uuid-A", "complaint-uuid-B"]);

    // The complaint adapter aggregates unique events into daily total count
    const dailyComplaintRow = {
      wardId: 40,
      signalType: "complaint" as const,
      date: "2026-10-06",
      count: complaintEvents.size, // count = 2
      sourceTag: "user" as const,
    };

    // Engine ingests the canonical daily SignalRow without knowing anything about individual event IDs
    await engine.ingest([dailyComplaintRow]);

    expect(store.size).toBe(1);
    expect(store.get(40, "complaint", "2026-10-06", "user")).toEqual({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 2,
      sourceTag: "user",
      reportedOn: "2026-10-06",
    });

    // Replaying duplicate Event 1 ("complaint-uuid-A") does not increase unique event count
    complaintEvents.add("complaint-uuid-A"); // Set size remains 2
    await engine.ingest([
      {
        wardId: 40,
        signalType: "complaint",
        date: "2026-10-06",
        count: complaintEvents.size, // still 2
        sourceTag: "user",
      },
    ]);
    expect(store.get(40, "complaint", "2026-10-06", "user")?.count).toBe(2);

    // A 3rd distinct complaint event arrives
    complaintEvents.add("complaint-uuid-C"); // Set size is now 3
    await engine.ingest([
      {
        wardId: 40,
        signalType: "complaint",
        date: "2026-10-06",
        count: complaintEvents.size, // 3
        sourceTag: "user",
      },
    ]);

    // Engine updates the canonical daily count to 3 idempotently
    expect(store.size).toBe(1);
    expect(store.get(40, "complaint", "2026-10-06", "user")?.count).toBe(3);
  });

  it("handles non-conflicting source tags on the same ward, date, and signal type", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    const rawBatch = [
      {
        wardId: 5,
        signalType: "complaint",
        date: "2026-10-06",
        count: 3,
        sourceTag: "user",
      },
      {
        wardId: 5,
        signalType: "complaint",
        date: "2026-10-06",
        count: 10,
        sourceTag: "synthetic",
      },
    ];

    const result = await engine.ingest(rawBatch);
    expect(result.writtenCount).toBe(2);
    expect(store.size).toBe(2);
    expect(store.get(5, "complaint", "2026-10-06", "user")?.count).toBe(3);
    expect(store.get(5, "complaint", "2026-10-06", "synthetic")?.count).toBe(10);
  });

  it("collects errors for invalid records in non-strict mode without aborting valid rows", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    const mixedBatch = [
      {
        wardId: 40,
        signalType: "rain",
        date: "2026-10-06",
        count: 10,
        sourceTag: "real",
      },
      {
        wardId: -1, // Invalid ward ID
        signalType: "rain",
        date: "2026-10-06",
        count: 10,
        sourceTag: "real",
      },
      {
        wardId: 41,
        signalType: "complaint",
        date: "2026-10-06",
        count: 2,
        sourceTag: "user",
      },
    ];

    const result = await engine.ingest(mixedBatch);

    expect(result.totalReceived).toBe(3);
    expect(result.writtenCount).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].error).toBeInstanceOf(PipelineValidationError);

    expect(store.size).toBe(2);
    expect(store.get(40, "rain", "2026-10-06", "real")).toBeDefined();
    expect(store.get(41, "complaint", "2026-10-06", "user")).toBeDefined();
  });

  it("throws immediately on invalid record when strict mode is enabled", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    const invalidBatch = [
      {
        wardId: 40,
        signalType: "invalid-type",
        date: "2026-10-06",
        count: 10,
        sourceTag: "real",
      },
    ];

    await expect(engine.ingest(invalidBatch, { strict: true })).rejects.toThrow(
      PipelineValidationError
    );
    expect(store.size).toBe(0);
  });

  it("filters unrecognized ward IDs when knownWardIds is supplied", async () => {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);

    const batch = [
      { wardId: 40, signalType: "rain", date: "2026-10-06", count: 12.4, sourceTag: "real" },
      { wardId: 999, signalType: "rain", date: "2026-10-06", count: 12.4, sourceTag: "real" }, // unknown ward
    ];

    // Non-strict mode: routes unknown ward to errors
    const result = await engine.ingest(batch, { knownWardIds: [40, 41, 42] });
    expect(result.totalReceived).toBe(2);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].error.message).toContain("Ward ID 999 is not in the list of known ward IDs");
    expect(store.size).toBe(1);
    expect(store.get(40, "rain", "2026-10-06", "real")).toBeDefined();
    expect(store.get(999, "rain", "2026-10-06", "real")).toBeUndefined();

    // Strict mode: throws immediately
    await expect(
      engine.ingest(batch, { knownWardIds: new Set([40, 41]), strict: true })
    ).rejects.toThrow(PipelineValidationError);
  });

  it("handles empty batches without calling sink write", async () => {
    let written = false;
    const mockSink: SignalSink = {
      write: () => {
        written = true;
      },
    };

    const engine = new SignalIngestionEngine(mockSink);
    const result = await engine.ingest([]);

    expect(result.totalReceived).toBe(0);
    expect(result.writtenCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(written).toBe(false);
  });
});
