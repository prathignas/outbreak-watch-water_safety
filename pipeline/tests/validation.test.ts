import { describe, expect, it } from "vitest";
import { PipelineValidationError } from "../src/errors.js";
import {
  validateCount,
  validateDateString,
  validateSignalRow,
  validateSignalType,
  validateSourceTag,
  validateWardId,
} from "../src/validation.js";

describe("pipeline validation - validateWardId", () => {
  it("accepts positive integers", () => {
    expect(validateWardId(1)).toBe(1);
    expect(validateWardId(40)).toBe(40);
    expect(validateWardId(198)).toBe(198);
  });

  it("accepts ward 0 (contract: ward ids are >= 0)", () => {
    expect(validateWardId(0)).toBe(0);
  });

  it("rejects negative numbers, floats, and non-numbers", () => {
    expect(() => validateWardId(-1)).toThrow(PipelineValidationError);
    expect(() => validateWardId(1.5)).toThrow(PipelineValidationError);
    expect(() => validateWardId(Number.NaN)).toThrow(PipelineValidationError);
    expect(() => validateWardId("40")).toThrow(PipelineValidationError);
    expect(() => validateWardId(null)).toThrow(PipelineValidationError);
  });
});

describe("pipeline validation - validateSignalType", () => {
  it("accepts all four contract signal types", () => {
    expect(validateSignalType("complaint")).toBe("complaint");
    expect(validateSignalType("pharmacy")).toBe("pharmacy");
    expect(validateSignalType("hospital")).toBe("hospital");
    expect(validateSignalType("rain")).toBe("rain");
  });

  it("rejects invalid signal types", () => {
    expect(() => validateSignalType("weather")).toThrow(PipelineValidationError);
    expect(() => validateSignalType("fever")).toThrow(PipelineValidationError);
    expect(() => validateSignalType("")).toThrow(PipelineValidationError);
    expect(() => validateSignalType(123)).toThrow(PipelineValidationError);
  });
});

describe("pipeline validation - validateSourceTag", () => {
  it("accepts all four contract source tags", () => {
    expect(validateSourceTag("real")).toBe("real");
    expect(validateSourceTag("scraped")).toBe("scraped");
    expect(validateSourceTag("user")).toBe("user");
    expect(validateSourceTag("synthetic")).toBe("synthetic");
  });

  it("rejects invalid source tags", () => {
    expect(() => validateSourceTag("manual")).toThrow(PipelineValidationError);
    expect(() => validateSourceTag("simulated")).toThrow(PipelineValidationError);
    expect(() => validateSourceTag("")).toThrow(PipelineValidationError);
    expect(() => validateSourceTag(null)).toThrow(PipelineValidationError);
  });
});

describe("pipeline validation - validateCount", () => {
  it("accepts non-negative integers and decimals", () => {
    expect(validateCount(0)).toBe(0);
    expect(validateCount(10)).toBe(10);
    expect(validateCount(12.4)).toBe(12.4); // Rain decimal count
  });

  it("rejects negative numbers, NaN, Infinity, and non-numbers", () => {
    expect(() => validateCount(-1)).toThrow(PipelineValidationError);
    expect(() => validateCount(-0.1)).toThrow(PipelineValidationError);
    expect(() => validateCount(Number.NaN)).toThrow(PipelineValidationError);
    expect(() => validateCount(Number.POSITIVE_INFINITY)).toThrow(PipelineValidationError);
    expect(() => validateCount("10")).toThrow(PipelineValidationError);
    expect(() => validateCount(null)).toThrow(PipelineValidationError);
  });
});

describe("pipeline validation - validateDateString", () => {
  it("accepts valid YYYY-MM-DD format", () => {
    expect(validateDateString("2026-10-06")).toBe("2026-10-06");
  });

  it("rejects invalid dates and formats", () => {
    expect(() => validateDateString("2026-02-31")).toThrow(PipelineValidationError);
    expect(() => validateDateString("invalid")).toThrow(PipelineValidationError);
    expect(() => validateDateString(12345)).toThrow(PipelineValidationError);
  });
});

describe("pipeline validation - validateSignalRow", () => {
  it("validates a complete and conformant SignalRow", () => {
    const validRow = {
      wardId: 40,
      signalType: "rain" as const,
      date: "2026-10-06",
      count: 12.4,
      sourceTag: "real" as const,
      reportedOn: "2026-10-06",
    };

    const validated = validateSignalRow(validRow);
    expect(validated).toEqual(validRow);
  });

  it("rejects a row that arrives before the day it is for (reportedOn < date)", () => {
    expect(() =>
      validateSignalRow({ wardId: 40, signalType: "rain", date: "2026-10-06", count: 1, sourceTag: "real", reportedOn: "2026-10-05" })
    ).toThrow(PipelineValidationError);
  });

  it("rejects a row with no reportedOn", () => {
    expect(() =>
      validateSignalRow({ wardId: 40, signalType: "rain", date: "2026-10-06", count: 1, sourceTag: "real" })
    ).toThrow(PipelineValidationError);
  });

  it("rejects rows with invalid or missing fields", () => {
    expect(() => validateSignalRow(null)).toThrow(PipelineValidationError);
    expect(() =>
      validateSignalRow({
        wardId: 40,
        signalType: "invalid-type",
        date: "2026-10-06",
        count: 5,
        sourceTag: "real",
      })
    ).toThrow(PipelineValidationError);
  });
});
