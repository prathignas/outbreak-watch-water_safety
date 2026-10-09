import { runRainJob, PostgresSignalSink, type RainJobResult } from "@outbreak/pipeline";
import { getDatabase, type IDatabase } from "../db/repository.js";
import { getCity } from "../city.js";
import { getRawArchive } from "../rawArchive.js";
import { emitMetrics, PIPELINE_METRICS } from "../metrics.js";

const M = PIPELINE_METRICS.rain;

/**
 * Hourly (EventBridge): real rain from Open-Meteo (P1's archive API and point) for the last
 * 7 days up to today, one value per day into all 243 wards, tagged "real". On a failed fetch
 * nothing is written and the run fails (Lambda Errors + RainFetchFailures), so it shows up.
 */
export async function handler(): Promise<RainJobResult> {
  const result = await runRainJob({
    sink: new PostgresSignalSink(getDatabase()),
    wardIds: getCity().wardIds(),
    archive: getRawArchive(),
  });
  emitMetrics(M.dimensions, {
    [M.names.runs]: 1,
    [M.names.rowsWritten]: result.ok ? result.rowsWritten : 0,
    [M.names.fetchFailures]: result.ok ? 0 : 1,
  });
  if (!result.ok) throw new Error(`Rain job failed, nothing written: ${result.error}`);
  return result;
}

/** Days of real rain loaded after a reset or db:setup (Open-Meteo past_days maximum). */
export const RAIN_BACKFILL_DAYS = 92;

/**
 * After /demo/reset or db:setup wipes the signals: load the last 92 days of real Open-Meteo
 * rain, so the rain card always has history. Never throws: on a failed fetch nothing is
 * written (no made-up rain) and the reset still finishes. Skipped under Vitest (no network).
 */
export async function loadRecentRain(db: IDatabase): Promise<RainJobResult | null> {
  if (process.env.VITEST) return null;
  try {
    const result = await runRainJob({ sink: new PostgresSignalSink(db), wardIds: getCity().wardIds(), archive: getRawArchive(), pastDays: RAIN_BACKFILL_DAYS });
    if (!result.ok) console.error(`[rain] Backfill failed, no rain written: ${result.error}`);
    return result;
  } catch (err) {
    console.error("[rain] Backfill failed, no rain written:", err);
    return null;
  }
}
