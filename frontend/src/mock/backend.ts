/*
 * The mock backend: the detection module's OWN code (imported from ../detection/src via @engine,
 * nothing copied), plus an in-memory store of alert records. It answers every route the
 * real backend will. Runs inside a Web Worker in the browser (engine.worker.ts) and
 * directly in tests. Deterministic: same seed and actions give the same data. Persists nothing.
 */
import { RealCity, type CityFile } from "@engine/city.js";
import { addDays, daysBetween } from "@engine/dates.js";
import { describeInjection, generateLiveDay } from "@engine/live.js";
import { emptyDetectorState, runDetector, RUN_DETECTOR_PARAMS, wardRisk, type DetectorState } from "@engine/runDetector.js";
import { SignalIndex } from "@engine/scoring.js";
import { isoAt } from "@/lib/clock";
import type { AlertRecord, AlertStatus, DemoState, InjectableCause, Injection, InjectResponse, LiveSignalRow, RainRow, WardRisk } from "@/api/types";

/** Mock settings. All are demo choices, documented in docs/FRONTEND.md and README. */
export const MOCK = {
  /** Same seed and start date as the handoff samples (handoff/sample-run-detector.json). */
  seed: 2026,
  startDate: "2026-07-08",
  /** Days of rows kept before the first detector run: 8-week chart + 8 weeks of "normal" history. */
  historyDays: 112,
  /** The detector has been running for this many days when the demo opens. */
  warmupRunDays: 7,
  /** An injected outbreak is placed this many days back, so its signals are already arriving. */
  injectBackdateDays: 3,
  /** New alerts from an injection become visible after this delay (the "daily run" catching up). */
  appearsAfterMs: 2500,
  /** The daily run is modelled at 06:00 India time; createdAt uses it. */
  runTime: "T06:00:00+05:30",
  /** When the mock follows the real clock, the same planted outbreaks as the real demo
   * (backend/src/demo/demo-scenario.json), relative to today, so the app is never empty. */
  scenario: {
    detectorFromDaysAgo: 10,
    outbreaks: [
      { cause: "water", wardId: 18, startDaysAgo: 6, seed: 2026 },
      { cause: "water", wardId: 52, startDaysAgo: 5, seed: 2026 },
      { cause: "water", wardId: 151, startDaysAgo: 4, seed: 2026 },
      { cause: "food", wardId: 120, startDaysAgo: 3, seed: 2026 },
      { cause: "p2p", wardId: 138, startDaysAgo: 8, seed: 2026 },
    ] as Array<{ cause: InjectableCause; wardId: number; startDaysAgo: number; seed: number }>,
  },
};

export class MockError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Options {
  city: CityFile;
  rain: Array<{ date: string; mm: number }>;
  seed?: number;
  startDate?: string;
  now?: () => number;
  /** Plant MOCK.scenario's outbreaks relative to the start day (the browser mock does). */
  scenario?: boolean;
}

export class MockBackend {
  private readonly city: RealCity;
  private readonly rainByDate: Map<string, number>;
  private readonly seed: number;
  private readonly startDate: string;
  private readonly now: () => number;
  private readonly withScenario: boolean;
  private planted: Array<{ cause: InjectableCause; wardId: number; startDate: string; seed: number; affected: Set<number> }> = [];
  private today!: string;
  private firstRunDay!: string;
  private injection: Injection | null = null;
  private rowsByDay = new Map<string, LiveSignalRow[]>();
  private index!: SignalIndex;
  /** Detector state after each day's run. */
  private stateAfter = new Map<string, DetectorState>();
  private records = new Map<string, AlertRecord & { visibleFrom: number }>();

  constructor(options: Options) {
    this.city = new RealCity(options.city);
    this.rainByDate = new Map(options.rain.map((r) => [r.date, r.mm]));
    this.seed = options.seed ?? MOCK.seed;
    this.startDate = options.startDate ?? MOCK.startDate;
    this.now = options.now ?? (() => Date.now()); // tests pass a fixed clock; the worker passes the page clock
    this.withScenario = options.scenario ?? false;
    this.reset();
  }

  /* ---------------- demo ---------------- */

  reset(): DemoState {
    this.today = this.startDate;
    this.firstRunDay = addDays(this.startDate, -(this.withScenario ? MOCK.scenario.detectorFromDaysAgo : MOCK.warmupRunDays));
    this.planted = this.withScenario
      ? MOCK.scenario.outbreaks.map((o) => {
          const startDate = addDays(this.startDate, -o.startDaysAgo);
          const options = { injectOutbreak: o.cause, wardId: o.wardId, startDate, city: this.city };
          const affected = new Set((describeInjection(startDate, o.seed, options)?.affectedWards ?? []).map((w) => w.wardId));
          return { ...o, startDate, affected };
        })
      : [];
    this.injection = null;
    this.rowsByDay.clear();
    this.stateAfter.clear();
    this.records.clear();
    for (let d = addDays(this.startDate, -MOCK.historyDays); d <= this.today; d = addDays(d, 1)) this.rowsByDay.set(d, this.generateDay(d));
    this.rebuildIndex();
    this.runFrom(this.firstRunDay, 0);
    return this.state();
  }

  state(): DemoState {
    return { today: this.today, seed: this.seed, injection: this.injection };
  }

  /** Moves the demo clock forward to `day` (the real IST day), one daily run per day, keeping
   * alerts, actions and any injection. Used when the tab stays open past midnight IST. */
  syncTo(day: string): DemoState {
    while (this.today < day) this.advance();
    return this.state();
  }

  advance(): DemoState {
    this.today = addDays(this.today, 1);
    this.rowsByDay.set(this.today, this.generateDay(this.today));
    this.rebuildIndex();
    this.runFrom(this.today, 0);
    return this.state();
  }

  inject(cause: InjectableCause, wardId: number): InjectResponse {
    if (!["water", "food", "p2p"].includes(cause)) throw new MockError(400, `Unknown outbreak type: ${cause}`);
    if (!this.city.wardIds().includes(wardId)) throw new MockError(400, `Unknown ward: ${wardId}`);
    // One injected outbreak at a time: a new one replaces the previous one.
    let start = addDays(this.today, -MOCK.injectBackdateDays);
    if (start <= this.firstRunDay) start = addDays(this.firstRunDay, 1);
    const options = { injectOutbreak: cause, wardId, startDate: start, city: this.city };
    this.injection = describeInjection(start, this.seed, options) as Injection;
    for (const day of this.rowsByDay.keys()) {
      if (day >= start) this.rowsByDay.set(day, this.generateDay(day));
    }
    this.rebuildIndex();
    this.runFrom(start, MOCK.appearsAfterMs);
    return { injection: this.injection, appearsAfterMs: MOCK.appearsAfterMs };
  }

  /* ---------------- alerts ---------------- */

  listAlerts(): AlertRecord[] {
    const t = this.now();
    return [...this.records.values()]
      .filter((r) => r.visibleFrom <= t)
      .map(strip)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.alert.score - a.alert.score);
  }

  getAlert(id: string): AlertRecord {
    const record = this.records.get(id);
    if (!record || record.visibleFrom > this.now()) throw new MockError(404, `No alert with id ${id}`);
    return strip(record);
  }

  ack(id: string, by: string): AlertRecord {
    return this.transition(id, by, "acknowledged", ["open"]);
  }

  resolve(id: string, by: string): AlertRecord {
    return this.transition(id, by, "resolved", ["open", "acknowledged"]);
  }

  addNote(id: string, by: string, text: string): AlertRecord {
    const clean = text.trim();
    if (!clean) throw new MockError(400, "A note cannot be empty.");
    if (clean.length > 2000) throw new MockError(400, "A note can be at most 2000 characters.");
    const record = this.mustGet(id);
    record.events.push({ at: isoAt(this.now()), by: who(by), kind: "note", text: clean });
    return strip(record);
  }

  /* ---------------- data ---------------- */

  wardSignals(wardId: number, from: string, to: string): LiveSignalRow[] {
    if (!this.city.wardIds().includes(wardId)) throw new MockError(404, `Unknown ward: ${wardId}`);
    const end = to > this.today ? this.today : to;
    const out: LiveSignalRow[] = [];
    for (let d = from; d <= end; d = addDays(d, 1)) {
      // Only what the system knew by today: late rows stay out until they arrive.
      for (const row of this.rowsByDay.get(d) ?? []) if (row.wardId === wardId && row.reportedOn <= this.today) out.push(row);
      const mm = this.rainByDate.get(d);
      if (mm !== undefined) out.push({ wardId, signalType: "rain", date: d, count: mm, sourceTag: "real", reportedOn: d });
    }
    return out;
  }

  risk(date: string): WardRisk[] {
    if (date > this.today) throw new MockError(400, `Cannot give risk for ${date}: the demo clock is at ${this.today}.`);
    return wardRisk(this.index, date, this.city, RUN_DETECTOR_PARAMS);
  }

  rain(from: string, to: string): RainRow[] {
    const end = to > this.today ? this.today : to;
    const out: RainRow[] = [];
    for (let d = from; d <= end; d = addDays(d, 1)) {
      const mm = this.rainByDate.get(d);
      if (mm !== undefined) out.push({ date: d, mm, sourceTag: "real" });
    }
    return out;
  }

  /* ---------------- internals ---------------- */

  private generateDay(date: string): LiveSignalRow[] {
    const inject = this.injection && date >= this.injection.startDate
      ? { injectOutbreak: this.injection.cause, wardId: this.injection.originWardId ?? undefined, startDate: this.injection.startDate }
      : {};
    const rows = generateLiveDay(date, this.seed, { city: this.city, ...inject }) as LiveSignalRow[];
    if (!this.planted.some((o) => o.startDate <= date)) return rows;
    // Planted outbreaks: their rows for the wards they reach; where two overlap, the larger count wins.
    const byKey = new Map(rows.map((row) => [`${row.wardId}|${row.signalType}|${row.date}`, row]));
    for (const o of this.planted) {
      if (o.startDate > date) continue;
      for (const row of generateLiveDay(date, o.seed, { city: this.city, injectOutbreak: o.cause, wardId: o.wardId, startDate: o.startDate }) as LiveSignalRow[]) {
        if (!o.affected.has(row.wardId)) continue;
        const key = `${row.wardId}|${row.signalType}|${row.date}`;
        const current = byKey.get(key);
        if (!current || row.count > current.count) byKey.set(key, row);
      }
    }
    return [...byKey.values()];
  }

  private rebuildIndex(): void {
    const rows: LiveSignalRow[] = [];
    for (const [day, dayRows] of this.rowsByDay) {
      rows.push(...dayRows);
      const mm = this.rainByDate.get(day);
      if (mm !== undefined) for (const wardId of this.city.wardIds()) rows.push({ wardId, signalType: "rain", date: day, count: mm, sourceTag: "real", reportedOn: day });
    }
    this.index = new SignalIndex(rows);
  }

  /** (Re)runs the daily detector from `from` up to today, starting from the state saved the day before. */
  private runFrom(from: string, delayMs: number): void {
    let state = this.stateAfter.get(addDays(from, -1)) ?? emptyDetectorState();
    const visibleFrom = this.now() + delayMs;
    // Records raised on re-run days are rebuilt; keep any an officer already worked on.
    for (const [id, r] of this.records) {
      if (r.alert.date >= from && r.events.length === 1) this.records.delete(id);
    }
    for (let day = from; day <= this.today; day = addDays(day, 1)) {
      const out = runDetector(this.index, day, this.city, RUN_DETECTOR_PARAMS, state);
      state = out.state;
      this.stateAfter.set(day, state);
      for (const alert of out.alerts) {
        const id = `${alert.method}-${alert.wardId}-${alert.date}`;
        if (this.records.has(id)) continue;
        const createdAt = `${alert.date}${MOCK.runTime}`;
        this.records.set(id, {
          id,
          status: "open",
          createdAt,
          alert,
          causeEvidence: out.causeEvidence[String(alert.wardId)] ?? [],
          events: [{ at: createdAt, by: "Daily detector run", kind: "raised" }],
          visibleFrom,
        });
      }
    }
  }

  private mustGet(id: string) {
    const record = this.records.get(id);
    if (!record || record.visibleFrom > this.now()) throw new MockError(404, `No alert with id ${id}`);
    return record;
  }

  private transition(id: string, by: string, to: AlertStatus, allowedFrom: AlertStatus[]): AlertRecord {
    const record = this.mustGet(id);
    if (!allowedFrom.includes(record.status)) throw new MockError(409, `Alert is ${record.status}; it cannot become ${to}.`);
    record.status = to;
    record.events.push({ at: isoAt(this.now()), by: who(by), kind: to === "acknowledged" ? "acknowledged" : "resolved" });
    return strip(record);
  }

  /** Days of demo clock since the start (for tests). */
  daysRun(): number {
    return daysBetween(this.startDate, this.today);
  }
}

const who = (by: string) => (by.trim() ? by.trim().slice(0, 80) : "Unnamed officer");

function strip(record: AlertRecord & { visibleFrom: number }): AlertRecord {
  const { visibleFrom: _hidden, ...rest } = record;
  return structuredClone(rest);
}
