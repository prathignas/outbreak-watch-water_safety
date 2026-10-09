import { SEASONAL_EFFECT } from "./params.js";

/*
 * The seasonal multiplier for one day, changing SMOOTHLY between months.
 *
 * Before (until 2026-10-06), the simulator used SEASONAL_EFFECT[month]: a step
 * on the 1st of each month (e.g. 1.3 on 30 June, 1.4 on 1 July). Against an
 * 8-week baseline, every ward then looked suddenly "a bit high" on the 1st,
 * which the cause classifier read as a city-wide (seasonal) rise.
 *
 * Now each month's SEASONAL_EFFECT value sits on the middle day of that month,
 * and days in between are a straight line between the two nearest middles
 * (December wraps to January). The monthly values themselves are unchanged
 * (still ASSUMPTION - needs source, see params.ts); only the step is gone.
 */

const MS_PER_DAY = 86_400_000;

/** Day number (days since 1970-01-01, UTC) of the middle of a month; month may be -1 or 12 (wraps the year). */
function monthMiddle(year: number, month: number): number {
  const start = Date.UTC(year, month, 1) / MS_PER_DAY;
  const next = Date.UTC(year, month + 1, 1) / MS_PER_DAY;
  return (start + next - 1) / 2;
}

const effectOf = (month: number) => SEASONAL_EFFECT[((month % 12) + 12) % 12];

export function seasonalEffectOn(date: string): number {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) throw new RangeError(`Not a valid YYYY-MM-DD date: ${date}`);
  const day = time / MS_PER_DAY;
  const d = new Date(time);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const middle = monthMiddle(year, month);
  // Interpolate towards the previous month's middle before this month's middle, the next one's after.
  const [fromMonth, toMonth] = day < middle ? [month - 1, month] : [month, month + 1];
  const from = monthMiddle(year, fromMonth);
  const to = monthMiddle(year, toMonth);
  const share = (day - from) / (to - from);
  return effectOf(fromMonth) + (effectOf(toMonth) - effectOf(fromMonth)) * share;
}
