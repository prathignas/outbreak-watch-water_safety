import type { CityModel } from "@outbreak/contract";
import { rowsArrivingOn } from "@outbreak/detection";
import { LiveDayAdapter, type RowsArrivingOn } from "../adapters/live-day-adapter.js";
import { type RawArchive, saveRawCopy } from "../raw-archive.js";
import { type SignalSink } from "../sink.js";

export interface FeedJobOptions {
  /** The India day processed: rows whose reportedOn is this day are written. */
  day: string;
  sink: SignalSink;
  /** P1's seed (the backend's DEMO.seed) and RealCity. */
  seed: number;
  city: CityModel;
  /** Keeps the untouched batch (S3 in AWS). Optional. */
  archive?: RawArchive;
  /** Tests only. Default: P1's real rowsArrivingOn. */
  rowsArrivingOn?: RowsArrivingOn;
  log?: Pick<Console, "log" | "error">;
}

export type FeedJobResult =
  | { ok: true; day: string; rowsWritten: number; lateRows: number; rawKey: string | null }
  | { ok: false; day: string; error: string };

/**
 * The daily synthetic feed (IST morning): P1's rowsArrivingOn(day) -> LiveDayAdapter -> sink.
 * Every row is "synthetic". Late rows for earlier days are expected (date < reportedOn).
 * Strict: one bad row and nothing is written.
 */
export async function runFeedJob(options: FeedJobOptions): Promise<FeedJobResult> {
  const log = options.log ?? console;
  let rawKey: string | null = null;
  const generate: RowsArrivingOn = options.rowsArrivingOn ?? ((day) => rowsArrivingOn(day, options.seed, { city: options.city }));
  try {
    const adapter = new LiveDayAdapter(options.sink, {
      seed: options.seed,
      city: options.city,
      // Keep the batch exactly as the generator gave it, before it is checked and written.
      rowsArrivingOn: async (day) => {
        const rows = await generate(day);
        rawKey = await saveRawCopy(options.archive, "feed", day, rows, log);
        return rows;
      },
    });
    const result = await adapter.ingestLiveDay(options.day, { strict: true });
    const lateRows = result.rows.filter((r) => r.date < r.reportedOn).length;
    log.log(`[feed] ${options.day}: wrote ${result.writtenCount} synthetic rows (${lateRows} late rows for earlier days)`);
    return { ok: true, day: options.day, rowsWritten: result.writtenCount, lateRows, rawKey };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error(`[feed] ${options.day} FAILED, nothing written: ${message}`);
    return { ok: false, day: options.day, error: message };
  }
}
