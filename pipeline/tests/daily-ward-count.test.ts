import { describe, expect, it } from "vitest";
import { HospitalAdapter } from "../src/adapters/hospital-adapter.js";
import { parseHospitalDailyRecord } from "../src/adapters/hospital-parser.js";
import { PharmacyAdapter } from "../src/adapters/pharmacy-adapter.js";
import { parsePharmacyDailyRecord } from "../src/adapters/pharmacy-parser.js";
import { SignalIngestionEngine } from "../src/engine.js";
import { PipelineValidationError } from "../src/errors.js";
import { InMemorySignalStore } from "../src/sink.js";

interface AdapterTestCase {
  name: "HospitalAdapter" | "PharmacyAdapter";
  signalType: "hospital" | "pharmacy";
  createAdapter: (engine: SignalIngestionEngine) => {
    ingest: (rawPayload: unknown, options?: Record<string, unknown>) => Promise<unknown>;
  };
  parseRecord: (raw: unknown) => { signalType: string; sourceTag: string; count: number; date: string; wardId: number };
}

const testCases: AdapterTestCase[] = [
  {
    name: "HospitalAdapter",
    signalType: "hospital",
    createAdapter: (engine) => {
      const adapter = new HospitalAdapter(engine);
      return {
        ingest: (raw, opts) => adapter.ingestHospitalData(raw, opts),
      };
    },
    parseRecord: parseHospitalDailyRecord,
  },
  {
    name: "PharmacyAdapter",
    signalType: "pharmacy",
    createAdapter: (engine) => {
      const adapter = new PharmacyAdapter(engine);
      return {
        ingest: (raw, opts) => adapter.ingestPharmacyData(raw, opts),
      };
    },
    parseRecord: parsePharmacyDailyRecord,
  },
];

describe.each(testCases)("$name - Shared Daily Ward Count Table-Driven Suite", ({ signalType, createAdapter, parseRecord }) => {
  function setupEnv() {
    const store = new InMemorySignalStore();
    const engine = new SignalIngestionEngine(store);
    const adapter = createAdapter(engine);
    return { store, engine, adapter };
  }

  it("1. zero count accepted", async () => {
    const { store, adapter } = setupEnv();
    await adapter.ingest({ wardId: 40, date: "2026-10-06", count: 0 });
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(0);
  });

  it("2. negative, NaN, Infinity and string counts rejected", () => {
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: -1 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: Number.NaN })).toThrow(
      PipelineValidationError
    );
    expect(() =>
      parseRecord({ wardId: 40, date: "2026-10-06", count: Number.POSITIVE_INFINITY })
    ).toThrow(PipelineValidationError);
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: "10" })).toThrow(
      PipelineValidationError
    );
  });

  it("3. bad wardIds (-1, 1.5, '40', null) rejected; ward 0 allowed", () => {
    expect(parseRecord({ wardId: 0, date: "2026-10-06", count: 5 }).wardId).toBe(0);
    expect(() => parseRecord({ wardId: -1, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: 1.5, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: "40", date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: null, date: "2026-10-06", count: 5 })).toThrow(
      PipelineValidationError
    );
  });

  it("4. Feb 30 rejected", () => {
    expect(() => parseRecord({ wardId: 40, date: "2026-02-30", count: 5 })).toThrow(
      PipelineValidationError
    );
  });

  it("5. month 13 rejected", () => {
    expect(() => parseRecord({ wardId: 40, date: "2026-13-01", count: 5 })).toThrow(
      PipelineValidationError
    );
  });

  it("6. no-timezone timestamp rejected", () => {
    expect(() =>
      parseRecord({ wardId: 40, timestamp: "2026-10-06T14:30:00", count: 5 })
    ).toThrow(PipelineValidationError);
  });

  it("7. 18:29:59Z vs 18:30:00Z IST boundaries", () => {
    const beforeMidnight = parseRecord({
      wardId: 40,
      timestamp: "2026-12-31T18:29:59Z",
      count: 5,
    });
    expect(beforeMidnight.date).toBe("2026-12-31");

    const atMidnight = parseRecord({
      wardId: 40,
      timestamp: "2026-12-31T18:30:00Z",
      count: 5,
    });
    expect(atMidnight.date).toBe("2027-01-01");
  });

  it("8. replay is idempotent", async () => {
    const { store, adapter } = setupEnv();
    const batch = [{ wardId: 40, date: "2026-10-06", count: 10 }];

    await adapter.ingest(batch);
    expect(store.size).toBe(1);
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(10);

    await adapter.ingest(batch);
    expect(store.size).toBe(1);
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(10);
  });

  it("9. last write wins on updated count", async () => {
    const { store, adapter } = setupEnv();

    await adapter.ingest({ wardId: 40, date: "2026-10-06", count: 10 });
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(10);

    await adapter.ingest({ wardId: 40, date: "2026-10-06", count: 25 });
    expect(store.size).toBe(1);
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(25);
  });

  it("10. same key twice in one payload collapses to the last count", async () => {
    const { store, adapter } = setupEnv();
    const batch = [
      { wardId: 40, date: "2026-10-06", count: 10 },
      { wardId: 40, date: "2026-10-06", count: 35 },
    ];

    await adapter.ingest(batch);
    expect(store.size).toBe(1);
    expect(store.get(40, signalType, "2026-10-06", "synthetic")?.count).toBe(35);
  });

  it("11. knownWardIds option sends unknown wards to errors array", async () => {
    const { store, adapter } = setupEnv();
    const batch = [
      { wardId: 40, date: "2026-10-06", count: 10 },
      { wardId: 999, date: "2026-10-06", count: 10 },
    ];

    const result = (await adapter.ingest(batch, { knownWardIds: [40] })) as {
      writtenCount: number;
      errors: Array<{ index: number }>;
    };
    expect(result.writtenCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get(40, signalType, "2026-10-06", "synthetic")).toBeDefined();
    expect(store.get(999, signalType, "2026-10-06", "synthetic")).toBeUndefined();
  });

  it("12. strict mode throws immediately on error or unknown ward", async () => {
    const { adapter } = setupEnv();
    const batch = [
      { wardId: 40, date: "2026-10-06", count: 10 },
      { wardId: 999, date: "2026-10-06", count: 10 },
    ];

    await expect(adapter.ingest(batch, { knownWardIds: [40], strict: true })).rejects.toThrow(
      PipelineValidationError
    );
  });

  it("13. non-synthetic tag rejected; missing tag defaults to synthetic", () => {
    // Missing tag -> synthetic
    const rowDefault = parseRecord({ wardId: 40, date: "2026-10-06", count: 5 });
    expect(rowDefault.sourceTag).toBe("synthetic");

    // Explicit synthetic -> synthetic
    const rowExplicit = parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "synthetic" });
    expect(rowExplicit.sourceTag).toBe("synthetic");

    // Non-synthetic tags rejected
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "real" })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "user" })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "scraped" })).toThrow(
      PipelineValidationError
    );
    expect(() => parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: "" })).toThrow(
      PipelineValidationError
    );
    expect(() =>
      parseRecord({ wardId: 40, date: "2026-10-06", count: 5, sourceTag: 5 as unknown as string })
    ).toThrow(PipelineValidationError);
  });
});
