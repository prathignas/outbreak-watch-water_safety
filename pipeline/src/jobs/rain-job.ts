import { SignalIngestionEngine } from "../engine.js";
import { RainAdapter, type RainAdapterOptions } from "../adapters/rain-adapter.js";
import { fetchOpenMeteoRain } from "../adapters/rain-fetcher.js";
import { type RawArchive, saveRawCopy } from "../raw-archive.js";
import { type SignalSink } from "../sink.js";

export interface RainJobOptions extends Pick<RainAdapterOptions, "now" | "pastDays" | "fetchFn"> {
  /** Where the rows go (the backend's Postgres sink in production). */
  sink: SignalSink;
  /** Every ward in P1's city.json (243). The same value is written into each. */
  wardIds: readonly number[];
  /** Keeps the untouched Open-Meteo answer (S3 in AWS). Optional. */
  archive?: RawArchive;
  log?: Pick<Console, "log" | "error">;
}

export type RainJobResult =
  | { ok: true; today: string; wards: number; rowsWritten: number; days: Array<{ date: string; mm: number }>; droppedFuture: string[]; skipped: string[]; rawKey: string | null }
  | { ok: false; today: string | null; error: string };

/**
 * The hourly rain job: fetch real rain from Open-Meteo (P1's source), write one value per
 * day into every ward, tagged "real". If the fetch or the answer fails, it logs the error
 * and writes NOTHING: no zeros, no guesses.
 */
export async function runRainJob(options: RainJobOptions): Promise<RainJobResult> {
  const log = options.log ?? console;
  let rawKey: string | null = null;
  // Keep the untouched answer before anything is parsed, so a bad answer can be inspected.
  const fetcher: typeof fetchOpenMeteoRain = async (fetchOptions) => {
    const raw = await fetchOpenMeteoRain(fetchOptions);
    rawKey = await saveRawCopy(options.archive, "rain", fetchOptions.endDate, raw, log);
    return raw;
  };
  try {
    if (options.wardIds.length === 0) throw new Error("No ward ids given; rain is written into every ward");
    const adapter = new RainAdapter(new SignalIngestionEngine(options.sink), fetcher);
    const result = await adapter.ingestRain(options.wardIds, {
      now: options.now,
      pastDays: options.pastDays,
      fetchFn: options.fetchFn,
      strict: true,
    });
    const days = result.readings.map((r) => ({ date: r.date, mm: r.precipitationMm }));
    log.log(
      `[rain] ${result.today}: wrote ${result.writtenCount} real rain rows (${days.length} days x ${options.wardIds.length} wards)` +
        (result.skipped.length ? `; no value from Open-Meteo for ${result.skipped.map((s) => s.date).join(", ")} (nothing written)` : "") +
        (result.droppedFuture.length ? `; dropped future ${result.droppedFuture.join(", ")}` : "")
    );
    return {
      ok: true,
      today: result.today,
      wards: options.wardIds.length,
      rowsWritten: result.writtenCount,
      days,
      droppedFuture: result.droppedFuture,
      skipped: result.skipped.map((s) => s.date),
      rawKey,
    };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    log.error(`[rain] FAILED, nothing written (no zeros or guesses): ${message}`);
    return { ok: false, today: null, error: message };
  }
}
