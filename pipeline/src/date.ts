import { PipelineValidationError } from "./errors.js";

/** Constant IST (Asia/Kolkata) offset in milliseconds: +05:30 (19,800,000 ms) */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Regular expression matching YYYY-MM-DD format */
export const YYYY_MM_DD_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates whether a given string is a valid calendar date in YYYY-MM-DD format.
 */
export function isValidDateString(dateStr: string): boolean {
  if (typeof dateStr !== "string") return false;
  const match = YYYY_MM_DD_REGEX.exec(dateStr);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Verify exact day count for the month/year using UTC Date arithmetic
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Converts a Date object, ISO timestamp string, unix timestamp (in ms), or YYYY-MM-DD string into an IST YYYY-MM-DD string.
 *
 * IST date rule (from contract.md):
 * "The day is the Indian date (IST, Asia/Kolkata), written YYYY-MM-DD.
 * Example: a complaint at 2:00 am IST on 7 October is 8:30 pm UTC on 6 October,
 * but it counts for 2026-10-07. Always convert to IST first, then take the date."
 */
export function toIstDateString(input: Date | string | number): string {
  if (input === null || input === undefined) {
    throw new PipelineValidationError("Date input cannot be null or undefined");
  }

  // If already a YYYY-MM-DD string, validate calendar validity directly
  if (typeof input === "string" && YYYY_MM_DD_REGEX.test(input)) {
    if (!isValidDateString(input)) {
      throw new PipelineValidationError(`Invalid calendar date string: '${input}'`);
    }
    return input;
  }

  // If string contains time, require an explicit timezone specifier ('Z' or offset)
  if (typeof input === "string") {
    const hasTimePortion = /[T\s]\d{1,2}:\d{2}/.test(input);
    const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(input.trim());
    if (hasTimePortion && !hasTimezone) {
      throw new PipelineValidationError(
        `Timestamp '${input}' lacks an explicit timezone specifier ('Z' or offset like '+05:30'). Local timestamps are ambiguous.`
      );
    }
  }

  let dateObj: Date;
  if (input instanceof Date) {
    dateObj = input;
  } else if (typeof input === "number" || typeof input === "string") {
    dateObj = new Date(input);
  } else {
    throw new PipelineValidationError(`Unsupported date input type: ${typeof input}`);
  }

  const timeMs = dateObj.getTime();
  if (Number.isNaN(timeMs)) {
    throw new PipelineValidationError(`Cannot parse invalid date/timestamp: '${String(input)}'`);
  }

  // Shift UTC timestamp by +05:30 to get IST date components
  const istDate = new Date(timeMs + IST_OFFSET_MS);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");

  const formatted = `${year}-${month}-${day}`;
  if (!isValidDateString(formatted)) {
    throw new PipelineValidationError(`Computed invalid IST date '${formatted}' for input '${String(input)}'`);
  }

  return formatted;
}
