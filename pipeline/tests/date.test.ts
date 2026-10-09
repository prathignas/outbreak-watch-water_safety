import { describe, expect, it } from "vitest";
import { isValidDateString, toIstDateString } from "../src/date.js";
import { PipelineValidationError } from "../src/errors.js";

describe("date utility - isValidDateString", () => {
  it("accepts valid calendar dates", () => {
    expect(isValidDateString("2026-10-06")).toBe(true);
    expect(isValidDateString("2026-01-01")).toBe(true);
    expect(isValidDateString("2026-12-31")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true); // Leap year
  });

  it("rejects invalid calendar dates and non-existent days", () => {
    expect(isValidDateString("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidDateString("2026-04-31")).toBe(false); // April has 30 days
    expect(isValidDateString("2026-13-01")).toBe(false); // Invalid month
    expect(isValidDateString("2026-00-10")).toBe(false); // Invalid month 00
    expect(isValidDateString("2026-05-00")).toBe(false); // Invalid day 00
    expect(isValidDateString("2026-05-32")).toBe(false); // Day > 31
  });

  it("rejects malformed string formats", () => {
    expect(isValidDateString("06-10-2026")).toBe(false);
    expect(isValidDateString("2026/10/06")).toBe(false);
    expect(isValidDateString("2026-10-6")).toBe(false);
    expect(isValidDateString("")).toBe(false);
    expect(isValidDateString("invalid-date")).toBe(false);
  });
});

describe("date utility - toIstDateString", () => {
  it("preserves valid YYYY-MM-DD date strings", () => {
    expect(toIstDateString("2026-10-06")).toBe("2026-10-06");
    expect(toIstDateString("2026-01-15")).toBe("2026-01-15");
  });

  it("handles the exact contract example: 8:30 pm UTC on 6 Oct is 2:00 am IST on 7 Oct", () => {
    // 8:30 pm UTC on 6 Oct = 2026-10-06T20:30:00Z
    const utcTimestamp = "2026-10-06T20:30:00.000Z";
    expect(toIstDateString(utcTimestamp)).toBe("2026-10-07");
    expect(toIstDateString(new Date(utcTimestamp))).toBe("2026-10-07");
  });

  it("handles IST midnight boundaries correctly (UTC 18:30:00 transition)", () => {
    // 18:29:59.999 UTC + 05:30 = 23:59:59.999 IST on 2026-10-06
    const justBeforeMidnightUtc = "2026-10-06T18:29:59.999Z";
    expect(toIstDateString(justBeforeMidnightUtc)).toBe("2026-10-06");

    // 18:30:00.000 UTC + 05:30 = 00:00:00.000 IST on 2026-10-07
    const exactMidnightUtc = "2026-10-06T18:30:00.000Z";
    expect(toIstDateString(exactMidnightUtc)).toBe("2026-10-07");

    // 18:30:01.000 UTC + 05:30 = 00:00:01.000 IST on 2026-10-07
    const justAfterMidnightUtc = "2026-10-06T18:30:01.000Z";
    expect(toIstDateString(justAfterMidnightUtc)).toBe("2026-10-07");
  });

  it("handles epoch millisecond timestamps", () => {
    // 2026-10-06T18:30:00.000Z in ms
    const epochMs = Date.parse("2026-10-06T18:30:00.000Z");
    expect(toIstDateString(epochMs)).toBe("2026-10-07");
  });

  it("handles explicit timezone offsets (+05:30 and +00:00)", () => {
    // 20:30 at +05:30 is 20:30 IST on Oct 6 -> 2026-10-06
    expect(toIstDateString("2026-10-06T20:30:00+05:30")).toBe("2026-10-06");

    // 14:30 UTC (+00:00) + 5:30 = 20:00 IST on Oct 6 -> 2026-10-06
    expect(toIstDateString("2026-10-06T14:30:00+00:00")).toBe("2026-10-06");
  });

  it("handles year rollover at IST midnight: 2026-12-31T18:30:00Z -> 2027-01-01", () => {
    // 18:30:00 UTC on Dec 31 + 5:30 = 00:00:00 IST on Jan 1
    expect(toIstDateString("2026-12-31T18:30:00Z")).toBe("2027-01-01");
  });

  it("rejects ISO strings with time but no explicit timezone ('Z' or offset)", () => {
    expect(() => toIstDateString("2026-10-06T14:30:00")).toThrow(PipelineValidationError);
    expect(() => toIstDateString("2026-10-06 14:30:00")).toThrow(PipelineValidationError);
  });

  it("throws PipelineValidationError for invalid input types or dates", () => {
    expect(() => toIstDateString(null as unknown as string)).toThrow(PipelineValidationError);
    expect(() => toIstDateString(undefined as unknown as string)).toThrow(PipelineValidationError);
    expect(() => toIstDateString("not-a-date")).toThrow(PipelineValidationError);
    expect(() => toIstDateString("2026-02-30")).toThrow(PipelineValidationError);
    expect(() => toIstDateString(Number.NaN)).toThrow(PipelineValidationError);
  });
});
