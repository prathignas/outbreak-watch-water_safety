/*
 * Small date helpers. Every date is a "YYYY-MM-DD" string read as UTC, so
 * time zones and daylight saving can never shift a day.
 */

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toTime(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Not a valid YYYY-MM-DD date: ${date}`);
  }
  return time;
}

export function addDays(date: string, days: number): string {
  return new Date(toTime(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday, like Date.getDay(). */
export function weekdayOf(date: string): number {
  return new Date(toTime(date)).getUTCDay();
}

/** 0 = January ... 11 = December. */
export function monthOf(date: string): number {
  return new Date(toTime(date)).getUTCMonth();
}

export function yearOf(date: string): number {
  return new Date(toTime(date)).getUTCFullYear();
}

/** Every date from start to end, both included. */
export function dateRange(startDate: string, endDate: string): string[] {
  const dayCount = daysBetween(startDate, endDate) + 1;
  return Array.from({ length: Math.max(dayCount, 0) }, (_, day) => addDays(startDate, day));
}
