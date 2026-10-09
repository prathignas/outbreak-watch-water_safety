import { describe, expect, it, vi } from "vitest";
import { LiveDayAdapter } from "../src/adapters/live-day-adapter.js";
import { LiveDayGeneratorError, PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";
import { type LiveSignalRow } from "@outbreak/contract";
import { RealCity, rowsArrivingOn } from "@outbreak/detection";

/** P1's real city (243 wards) and the seed the backend uses. */
const city = RealCity.fromFile();
const SEED = 2026;

/**
 * Tests 1-17 feed hand-made rows through the tests-only override, to check that untrusted rows
 * are rejected. A row "arrives" on the day processed: reportedOn = that day.
 */
type SignalRow = Omit<LiveSignalRow, "signalType" | "sourceTag"> & {
  signalType: LiveSignalRow["signalType"] | "rain";
  sourceTag: LiveSignalRow["sourceTag"];
};

describe("LiveDayAdapter (P1 Synthetic Live-Day Feed)", () => {
  function setupTestEnvironment(
    fake: (date: string) => SignalRow[] | Promise<SignalRow[]>
  ) {
    const store = new InMemorySignalStore();
    const adapter = new LiveDayAdapter(store, {
      seed: SEED,
      city,
      rowsArrivingOn: fake as (date: string) => LiveSignalRow[] | Promise<LiveSignalRow[]>,
    });
    return { store, adapter };
  }

  it("1. Valid synthetic rows are written to the sink", async () => {
    const fakeGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count: 32, sourceTag: "synthetic" },
      { wardId: 40, signalType: "hospital", date, reportedOn: date, count: 9, sourceTag: "synthetic" },
      { wardId: 41, signalType: "pharmacy", date, reportedOn: date, count: 15, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(fakeGenerator);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.totalReceived).toBe(3);
    expect(result.writtenCount).toBe(3);
    expect(result.errors).toHaveLength(0);

    expect(store.size).toBe(3);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(32);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(9);
    expect(store.get(41, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(15);
  });

  it("2. Rain row rejected (not in SYNTHETIC_SIGNAL_TYPES)", async () => {
    const fakeGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count: 20, sourceTag: "synthetic" },
      { wardId: 40, signalType: "rain", date, reportedOn: date, count: 12.4, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(fakeGenerator);

    // Non-strict: rain row routed to errors
    const result = await adapter.ingestLiveDay("2026-10-06");
    expect(result.totalReceived).toBe(2);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].error.message).toContain("not a synthetic signal type");

    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")).toBeDefined();
    expect(store.get(40, "rain", "2026-10-06", "synthetic")).toBeUndefined();
  });

  it("3. Non-synthetic sourceTag is rejected", async () => {
    const fakeGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count: 20, sourceTag: "real" as unknown as "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(fakeGenerator);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.totalReceived).toBe(1);
    expect(result.writtenCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toContain("sourceTag must be 'synthetic'");
    expect(store.size).toBe(0);
  });

  it("4. A row that did not arrive on the day processed is rejected", async () => {
    const fakeGenerator = (): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date: "2026-10-07", reportedOn: "2026-10-07", count: 20, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(fakeGenerator);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.totalReceived).toBe(1);
    expect(result.writtenCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toContain("is not the day processed");
    expect(store.size).toBe(0);
  });

  it("5. Empty result writes nothing without error", async () => {
    const fakeGenerator = (): SignalRow[] => [];
    const { store, adapter } = setupTestEnvironment(fakeGenerator);

    const result = await adapter.ingestLiveDay("2026-10-06");
    expect(result.totalReceived).toBe(0);
    expect(result.writtenCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("6. Generator throwing synchronously wraps in LiveDayGeneratorError", async () => {
    const throwingGenerator = () => {
      throw new Error("Synthetic generator simulation crashed");
    };

    const { adapter } = setupTestEnvironment(throwingGenerator);
    await expect(adapter.ingestLiveDay("2026-10-06")).rejects.toThrow(LiveDayGeneratorError);
  });

  it("7. Async generator returning Promise<SignalRow[]> works cleanly", async () => {
    const asyncGenerator = async (date: string): Promise<SignalRow[]> => {
      return [{ wardId: 40, signalType: "hospital", date, reportedOn: date, count: 5, sourceTag: "synthetic" }];
    };

    const { store, adapter } = setupTestEnvironment(asyncGenerator);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.writtenCount).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(5);
  });

  it("8. Non-array generator result throws LiveDayGeneratorError", async () => {
    const badGenerator = (() => "not-an-array") as unknown as (date: string) => SignalRow[];
    const { adapter } = setupTestEnvironment(badGenerator);

    await expect(adapter.ingestLiveDay("2026-10-06")).rejects.toThrow(LiveDayGeneratorError);
  });

  it("9. Replay of same day is completely idempotent", async () => {
    const fakeGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count: 10, sourceTag: "synthetic" },
      { wardId: 41, signalType: "pharmacy", date, reportedOn: date, count: 20, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(fakeGenerator);
    await adapter.ingestLiveDay("2026-10-06");
    expect(store.size).toBe(2);

    // Replay
    const replayResult = await adapter.ingestLiveDay("2026-10-06");
    expect(replayResult.writtenCount).toBe(2);
    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(10);
  });

  it("10. Last write wins on updated live-day run", async () => {
    let count = 10;
    const dynamicGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(dynamicGenerator);
    await adapter.ingestLiveDay("2026-10-06");
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(10);

    // Update count on second run
    count = 25;
    await adapter.ingestLiveDay("2026-10-06");
    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(25);
  });

  it("11. Same key twice in one live-day payload collapses to last count", async () => {
    const duplicateKeyGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "hospital", date, reportedOn: date, count: 5, sourceTag: "synthetic" },
      { wardId: 40, signalType: "hospital", date, reportedOn: date, count: 12, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(duplicateKeyGenerator);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.writtenCount).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, "hospital", "2026-10-06", "synthetic")?.count).toBe(12);
  });

  it("12. knownWardIds option sends unlisted wards to errors", async () => {
    const generator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "pharmacy", date, reportedOn: date, count: 10, sourceTag: "synthetic" },
      { wardId: 999, signalType: "pharmacy", date, reportedOn: date, count: 10, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(generator);
    const result = await adapter.ingestLiveDay("2026-10-06", { knownWardIds: [40, 41] });

    expect(result.totalReceived).toBe(2);
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);

    expect(store.size).toBe(1);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")).toBeDefined();
    expect(store.get(999, "pharmacy", "2026-10-06", "synthetic")).toBeUndefined();
  });

  it("13. strict mode throws immediately on invalid record", async () => {
    const invalidGenerator = (date: string): SignalRow[] => [
      { wardId: 40, signalType: "rain", date, reportedOn: date, count: 10, sourceTag: "synthetic" },
    ];

    const { adapter } = setupTestEnvironment(invalidGenerator);
    await expect(adapter.ingestLiveDay("2026-10-06", { strict: true })).rejects.toThrow(
      PipelineValidationError
    );
  });

  it("14. Invalid date argument is rejected before calling generator", async () => {
    const generatorMock = vi.fn();
    const { adapter } = setupTestEnvironment(generatorMock);

    await expect(adapter.ingestLiveDay("not-a-date")).rejects.toThrow(PipelineValidationError);
    await expect(adapter.ingestLiveDay("2026-02-30")).rejects.toThrow(PipelineValidationError);
    expect(generatorMock).not.toHaveBeenCalled();
  });

  it("15. Generator is called exactly once with the requested date string", async () => {
    const generatorMock = vi.fn().mockReturnValue([]);
    const { adapter } = setupTestEnvironment(generatorMock);

    await adapter.ingestLiveDay("2026-10-06");
    expect(generatorMock).toHaveBeenCalledTimes(1);
    expect(generatorMock).toHaveBeenCalledWith("2026-10-06");
  });

  it("16. Non-plain-object array elements (null, string, number, array) go into errors with index without crashing; strict throws", async () => {
    const mixedGenerator = (): unknown[] => [
      { wardId: 40, signalType: "pharmacy", date: "2026-10-06", reportedOn: "2026-10-06", count: 10, sourceTag: "synthetic" },
      null, // index 1
      "invalid-string-row", // index 2
      12345, // index 3
      [{ wardId: 40, signalType: "pharmacy", date: "2026-10-06", reportedOn: "2026-10-06", count: 5, sourceTag: "synthetic" }], // index 4: nested array
      { wardId: 41, signalType: "hospital", date: "2026-10-06", reportedOn: "2026-10-06", count: 7, sourceTag: "synthetic" },
    ];

    const { store, adapter } = setupTestEnvironment(mixedGenerator as unknown as (date: string) => SignalRow[]);

    // Non-strict mode: valid objects ingested, non-plain-objects quarantined in errors
    const result = await adapter.ingestLiveDay("2026-10-06");
    expect(result.totalReceived).toBe(6);
    expect(result.writtenCount).toBe(2);
    expect(result.errors).toHaveLength(4);

    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].error.message).toContain("must be a plain object");
    expect(result.errors[1].index).toBe(2);
    expect(result.errors[1].error.message).toContain("must be a plain object");
    expect(result.errors[2].index).toBe(3);
    expect(result.errors[2].error.message).toContain("must be a plain object");
    expect(result.errors[3].index).toBe(4);
    expect(result.errors[3].error.message).toContain("must be a plain object");

    expect(store.size).toBe(2);
    expect(store.get(40, "pharmacy", "2026-10-06", "synthetic")?.count).toBe(10);
    expect(store.get(41, "hospital", "2026-10-06", "synthetic")?.count).toBe(7);

    // Strict mode: throws PipelineValidationError immediately
    await expect(adapter.ingestLiveDay("2026-10-06", { strict: true })).rejects.toThrow(
      PipelineValidationError
    );
  });

  it("17. LiveDayGeneratorError wraps thrown or rejected error and preserves the original error as cause", async () => {
    const originalError = new Error("Database connection dropped inside generator");
    const failingGenerator = () => {
      throw originalError;
    };

    const { adapter } = setupTestEnvironment(failingGenerator);

    try {
      await adapter.ingestLiveDay("2026-10-06");
      expect.fail("Expected ingestLiveDay to throw LiveDayGeneratorError");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDayGeneratorError);
      const genErr = err as LiveDayGeneratorError;
      expect(genErr.cause).toBe(originalError);
      expect(genErr.causeError).toBe(originalError);
    }

    // Async rejection
    const rejectedError = new Error("Network timeout during generator execution");
    const rejectingGenerator = async () => {
      throw rejectedError;
    };

    const { adapter: asyncAdapter } = setupTestEnvironment(rejectingGenerator);
    try {
      await asyncAdapter.ingestLiveDay("2026-10-06");
      expect.fail("Expected async ingestLiveDay to throw LiveDayGeneratorError");
    } catch (err) {
      expect(err).toBeInstanceOf(LiveDayGeneratorError);
      const genErr = err as LiveDayGeneratorError;
      expect(genErr.cause).toBe(rejectedError);
      expect(genErr.causeError).toBe(rejectedError);
    }
  });

  it("18. A late row (date earlier than reportedOn) is accepted and keeps its date", async () => {
    const lagged = (day: string): SignalRow[] => [
      { wardId: 40, signalType: "hospital", date: "2026-10-04", reportedOn: day, count: 3, sourceTag: "synthetic" },
    ];
    const { store, adapter } = setupTestEnvironment(lagged);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.errors).toHaveLength(0);
    expect(store.get(40, "hospital", "2026-10-04", "synthetic")).toEqual({
      wardId: 40,
      signalType: "hospital",
      date: "2026-10-04",
      count: 3,
      sourceTag: "synthetic",
      reportedOn: "2026-10-06",
    });
  });

  it("19. A row dated after the day it arrived is rejected (reportedOn < date)", async () => {
    const future = (day: string): SignalRow[] => [
      { wardId: 40, signalType: "hospital", date: "2026-10-08", reportedOn: day, count: 3, sourceTag: "synthetic" },
    ];
    const { store, adapter } = setupTestEnvironment(future);
    const result = await adapter.ingestLiveDay("2026-10-06");

    expect(result.writtenCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(store.size).toBe(0);
  });

  it("20. Needs P1's seed and city", () => {
    const store = new InMemorySignalStore();
    expect(() => new LiveDayAdapter(store, {} as never)).toThrow(PipelineValidationError);
  });
});

describe("LiveDayAdapter with P1's real rowsArrivingOn (no fake)", () => {
  const DAY = "2026-10-06";

  it("writes exactly the rows P1's rowsArrivingOn gives for the day, unchanged", async () => {
    const store = new InMemorySignalStore();
    const adapter = new LiveDayAdapter(store, { seed: SEED, city });
    const result = await adapter.ingestLiveDay(DAY);

    const expected = rowsArrivingOn(DAY, SEED, { city });
    expect(expected.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
    expect(result.writtenCount).toBe(expected.length);
    for (const row of expected) {
      expect(store.get(row.wardId, row.signalType, row.date, "synthetic")).toEqual(row);
    }
  });

  it("includes late rows (date before reportedOn), all reported on the day and tagged synthetic", async () => {
    const store = new InMemorySignalStore();
    await new LiveDayAdapter(store, { seed: SEED, city }).ingestLiveDay(DAY);
    const rows = store.getAll();

    expect(rows.every((r) => r.reportedOn === DAY)).toBe(true);
    expect(rows.every((r) => r.sourceTag === "synthetic")).toBe(true);
    expect(rows.every((r) => r.signalType !== "rain")).toBe(true);
    expect(rows.every((r) => r.date <= r.reportedOn)).toBe(true);
    expect(rows.some((r) => r.date < r.reportedOn)).toBe(true);
    // Every ward id is one of P1's 243 BBMP wards.
    const wards = new Set(city.wardIds());
    expect(wards.size).toBe(243);
    expect(rows.every((r) => wards.has(r.wardId))).toBe(true);
  });

  it("is idempotent: running the same day twice gives the same store", async () => {
    const store = new InMemorySignalStore();
    const adapter = new LiveDayAdapter(store, { seed: SEED, city });
    await adapter.ingestLiveDay(DAY);
    const first = JSON.stringify(store.getAll());
    await adapter.ingestLiveDay(DAY);
    expect(JSON.stringify(store.getAll())).toBe(first);
  });
});

describe("runFeedJob (daily synthetic feed)", () => {
  it("writes P1's rows arriving on the day, counts late rows, keeps a raw copy", async () => {
    const { runFeedJob } = await import("../src/jobs/feed-job.js");
    const { InMemoryRawArchive } = await import("../src/raw-archive.js");
    const store = new InMemorySignalStore();
    const archive = new InMemoryRawArchive();
    const result = await runFeedJob({ day: "2026-10-07", sink: store, seed: SEED, city, archive, log: { log: () => undefined, error: () => undefined } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = rowsArrivingOn("2026-10-07", SEED, { city });
    expect(result.rowsWritten).toBe(expected.length);
    expect(result.lateRows).toBe(expected.filter((r) => r.date < r.reportedOn).length);
    expect(result.lateRows).toBeGreaterThan(0);
    expect([...archive.saved.values()][0]).toEqual(expected);
    expect(result.rawKey).toMatch(/^raw\/feed\/2026-10-07\//);
  });

  it("one bad row: nothing written", async () => {
    const { runFeedJob } = await import("../src/jobs/feed-job.js");
    const store = new InMemorySignalStore();
    const result = await runFeedJob({
      day: "2026-10-07", sink: store, seed: SEED, city, log: { log: () => undefined, error: () => undefined },
      rowsArrivingOn: () => [
        { wardId: 1, signalType: "pharmacy", date: "2026-10-07", reportedOn: "2026-10-07", count: 3, sourceTag: "synthetic" },
        { wardId: 1, signalType: "hospital", date: "2026-10-07", reportedOn: "2026-10-06", count: 3, sourceTag: "synthetic" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(store.size).toBe(0);
  });
});
