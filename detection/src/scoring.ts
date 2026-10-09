import { computeBaseline } from "./baseline.js";
import { addDays, weekdayOf } from "./dates.js";
import { DETECTOR_PARAMS, type DetectorParams } from "./params.js";
import { SIGNAL_TYPES, SYNTHETIC_SIGNAL_TYPES, type SignalRow, type SignalType } from "./types.js";

/*
 * Turns raw daily counts into "how unusual is this?" scores.
 *
 * No future data, by construction:
 *   - Every read goes through a SignalView fixed to one "today". Asking it for
 *     a date after today throws a LeakageError, so a bug cannot quietly peek.
 *   - A row whose reportedOn is after today is invisible, as in real life.
 *   - A day's baseline uses only same-weekday days BEFORE it (7, 14, ... days
 *     earlier), never the day itself.
 *   - When given a plain list of rows, rows dated after today are dropped
 *     before any count is even read.
 */

/** Signals the detectors may alert on. Rain is city-wide context only: it is scored but never alerts. */
export const HEALTH_SIGNALS = SYNTHETIC_SIGNAL_TYPES;
export type HealthSignal = (typeof HEALTH_SIGNALS)[number];

/** A database row, optionally with the day it reached our system (late data is invisible before then). */
export interface IndexedRow extends SignalRow {
  reportedOn?: string;
}

/** Thrown if any code asks for data from after "today". It always means a bug. */
export class LeakageError extends Error {
  constructor(today: string, date: string) {
    super(`Tried to read ${date} while scoring as of ${today}: that is future data`);
    this.name = "LeakageError";
  }
}

type Cell = { count: number; reportedOn: string };
const keyOf = (wardId: number, signal: SignalType, date: string) => `${wardId}|${signal}|${date}`;

/** All rows, looked up by ward, signal and date. Build once, then take a view for each day. */
export class SignalIndex {
  private readonly cells = new Map<string, Cell>();

  constructor(rows: Iterable<IndexedRow>) {
    for (const row of rows) {
      this.cells.set(keyOf(row.wardId, row.signalType, row.date), {
        count: row.count,
        reportedOn: row.reportedOn ?? row.date,
      });
    }
  }

  /** What the system knew at the end of `today`. */
  asOf(today: string): SignalView {
    return new SignalView(this.cells, today);
  }
}

/** A read-only window onto the data as it stood on one day. It refuses to read the future. */
export class SignalView {
  constructor(
    private readonly cells: ReadonlyMap<string, Cell>,
    readonly today: string,
  ) {}

  /** The count, or undefined if there is no row or it had not been reported yet. */
  count(wardId: number, signal: SignalType, date: string): number | undefined {
    if (date > this.today) throw new LeakageError(this.today, date);
    const cell = this.cells.get(keyOf(wardId, signal, date));
    if (!cell || cell.reportedOn > this.today) return undefined;
    return cell.count;
  }

  /** The same data, seen from an earlier day. Cannot move later. */
  asOf(today: string): SignalView {
    if (today > this.today) throw new LeakageError(this.today, today);
    return today === this.today ? this : new SignalView(this.cells, today);
  }
}

/** What the detectors accept: plain rows (e.g. from the database), a prebuilt index, or a view. */
export type SignalInput = readonly IndexedRow[] | SignalIndex | SignalView;

export function viewAsOf(input: SignalInput, today: string): SignalView {
  if (input instanceof SignalView) return input.asOf(today);
  if (input instanceof SignalIndex) return input.asOf(today);
  // Drop future rows using only their date, before reading any count.
  return new SignalIndex(input.filter((row) => row.date <= today)).asOf(today);
}

export interface SignalScore {
  signal: SignalType;
  /** The day that was scored. */
  date: string;
  /** How many spreads above normal (from computeBaseline). */
  score: number;
  /** count / baseline, for evidence text. null when the baseline is 0. */
  ratio: number | null;
  count: number;
  baseline: number;
}

const historyDatesCache = new Map<string, string[]>();

/** The same weekday in each of the previous `weeks` weeks: date-7, date-14, ... All strictly before `date`. */
export function sameWeekdayHistoryDates(date: string, weeks: number): string[] {
  const cacheKey = `${date}|${weeks}`;
  let dates = historyDatesCache.get(cacheKey);
  if (!dates) {
    dates = Array.from({ length: weeks }, (_, week) => addDays(date, -7 * (week + 1)));
    historyDatesCache.set(cacheKey, dates);
  }
  return dates;
}

/**
 * Scores one ward, signal and day. Returns null ("no baseline") when the day has
 * no data yet or there is too little history; the caller then skips it.
 */
export function scoreSignal(
  view: SignalView,
  wardId: number,
  signal: SignalType,
  date: string,
  params: DetectorParams = DETECTOR_PARAMS,
): SignalScore | null {
  const count = view.count(wardId, signal, date);
  if (count === undefined) return null;

  const history: number[] = [];
  for (const pastDate of sameWeekdayHistoryDates(date, params.lookbackWeeks)) {
    const pastCount = view.count(wardId, signal, pastDate);
    if (pastCount !== undefined) history.push(pastCount);
  }

  const result = computeBaseline(history, count);
  if (!result.ok) return null;
  return {
    signal,
    date,
    score: result.score,
    ratio: result.baseline > 0 ? count / result.baseline : null,
    count,
    baseline: result.baseline,
  };
}

export type WardScores = Record<SignalType, SignalScore | null>;

/** Scores every signal (rain included, as context) for one ward on one day. */
export function scoreWard(
  rows: SignalInput,
  wardId: number,
  date: string,
  params: DetectorParams = DETECTOR_PARAMS,
): WardScores {
  const view = viewAsOf(rows, date);
  return Object.fromEntries(
    SIGNAL_TYPES.map((signal) => [signal, scoreSignal(view, wardId, signal, date, params)]),
  ) as WardScores;
}

const SIGNAL_LABELS: Record<SignalType, string> = {
  complaint: "complaints",
  pharmacy: "pharmacy sales",
  hospital: "hospital visits",
  rain: "rain",
};
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Plain English, e.g. "pharmacy sales 3.2x normal for a Monday (96 vs usual 30, on 2024-03-04)". */
export function describeScore(score: SignalScore): string {
  const label = SIGNAL_LABELS[score.signal];
  const weekday = WEEKDAY_NAMES[weekdayOf(score.date)];
  const howHigh = score.ratio === null ? `${score.count} where usually 0` : `${score.ratio.toFixed(1)}x normal`;
  return `${label} ${howHigh} for a ${weekday} (${score.count} vs usual ${score.baseline}, on ${score.date})`;
}
