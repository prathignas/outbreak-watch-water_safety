import { describe, expect, it } from "vitest";
import { PipelineValidationError } from "../src/errors.js";
import { createSignalRow, normalizeSignalRow } from "../src/normalize.js";

describe("pipeline normalization - createSignalRow", () => {
  it("creates a SignalRow from typed parameters with YYYY-MM-DD date", () => {
    const row = createSignalRow({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 4,
      sourceTag: "user",
    });

    expect(row).toEqual({
      wardId: 40,
      signalType: "complaint",
      date: "2026-10-06",
      count: 4,
      sourceTag: "user",
      reportedOn: "2026-10-06",
    });
  });

  it("converts Date objects and UTC timestamps into IST dates during creation", () => {
    const row = createSignalRow({
      wardId: 40,
      signalType: "pharmacy",
      date: new Date("2026-10-06T20:30:00Z"), // 2:00 am IST on 7 Oct
      count: 31,
      sourceTag: "synthetic",
    });

    expect(row.date).toBe("2026-10-07");
    expect(row.count).toBe(31);
    expect(row.sourceTag).toBe("synthetic");
  });
});

describe("pipeline normalization - normalizeSignalRow", () => {
  it("normalizes camelCase raw inputs", () => {
    const raw = {
      wardId: 40,
      signalType: "rain",
      date: "2026-10-06",
      count: 12.4,
      sourceTag: "real",
    };

    const normalized = normalizeSignalRow(raw);
    expect(normalized).toEqual({
      wardId: 40,
      signalType: "rain",
      date: "2026-10-06",
      count: 12.4,
      sourceTag: "real",
      reportedOn: "2026-10-06",
    });
  });

  it("normalizes snake_case database style inputs", () => {
    const raw = {
      ward_id: 40,
      signal_type: "hospital",
      date: "2026-10-06",
      count: 15,
      source_tag: "synthetic",
    };

    const normalized = normalizeSignalRow(raw);
    expect(normalized).toEqual({
      wardId: 40,
      signalType: "hospital",
      date: "2026-10-06",
      count: 15,
      sourceTag: "synthetic",
      reportedOn: "2026-10-06",
    });
  });

  it("normalizes timestamp / created_at / at fields into IST date strings", () => {
    const rawWithTimestamp = {
      ward_id: 12,
      signal_type: "complaint",
      timestamp: "2026-10-06T18:30:00.000Z", // Exactly midnight IST -> 2026-10-07
      count: 1,
      source_tag: "user",
    };

    const normalized = normalizeSignalRow(rawWithTimestamp);
    expect(normalized.date).toBe("2026-10-07");
    expect(normalized.wardId).toBe(12);

    const rawWithCreatedAt = {
      wardId: 12,
      signalType: "complaint",
      created_at: "2026-10-06T18:29:59.000Z", // Just before midnight IST -> 2026-10-06
      count: 2,
      sourceTag: "user",
    };

    const normalizedCreatedAt = normalizeSignalRow(rawWithCreatedAt);
    expect(normalizedCreatedAt.date).toBe("2026-10-06");
  });

  it("throws PipelineValidationError for missing required fields", () => {
    expect(() => normalizeSignalRow(null)).toThrow(PipelineValidationError);
    expect(() =>
      normalizeSignalRow({
        signalType: "rain",
        date: "2026-10-06",
        count: 10,
        sourceTag: "real",
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      normalizeSignalRow({
        wardId: 10,
        date: "2026-10-06",
        count: 10,
        sourceTag: "real",
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      normalizeSignalRow({
        wardId: 10,
        signalType: "rain",
        count: 10,
        sourceTag: "real",
      })
    ).toThrow(PipelineValidationError);

    expect(() =>
      normalizeSignalRow({
        wardId: 10,
        signalType: "rain",
        date: "2026-10-06",
        sourceTag: "real",
      })
    ).toThrow(PipelineValidationError);
  });
});
