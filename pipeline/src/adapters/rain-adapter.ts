import { addDays } from "@outbreak/detection";
import { toIstDateString } from "../date.js";
import { type IngestResult, type SignalIngestionEngine } from "../engine.js";
import { type FetchRainOptions, fetchOpenMeteoRain, OPEN_METEO_FORECAST_URL, validatePastDays } from "./rain-fetcher.js";
import {
  createRainSignalRows,
  type DailyRainReading,
  parseOpenMeteoRainResponse,
} from "./rain-parser.js";

/** Fetches the raw Open-Meteo answer for a day range. */
export type RainFetcher = (options: FetchRainOptions) => Promise<unknown>;

/**
 * Options for configuring RainAdapter ingestion.
 */
export interface RainAdapterOptions {
  /** Days before today to ask for again, so late corrections land (default 7, 0-92). */
  pastDays?: number;
  /** Injected clock for determining today in IST (default: () => new Date()) */
  now?: () => Date;
  /** Injected fetch function for testing */
  fetchFn?: typeof fetch;
  /** Ingestion engine options */
  strict?: boolean;
  knownWardIds?: readonly number[] | Set<number>;
}

/**
 * Extended IngestResult for RainAdapter, reporting skipped null days and dropped future days.
 */
export interface RainIngestResult extends IngestResult {
  /** Today in India (the last day asked for). */
  today: string;
  /** One city-wide value per day that was written. */
  readings: DailyRainReading[];
  /** Days where precipitation_sum was null and skipped (nothing is written for them) */
  skipped: Array<{ date: string; index: number }>;
  /** Days dropped because their date was in the future relative to IST today */
  droppedFuture: string[];
}

/**
 * Adapter coordinating Open-Meteo rainfall retrieval, parsing, future-date filtering,
 * ward expansion, and canonical ingestion through the SignalIngestionEngine.
 * Rows: signalType "rain", sourceTag "real", count = mm, reportedOn = date (contract v2).
 */
export class RainAdapter {
  constructor(
    private readonly engine: SignalIngestionEngine,
    private readonly fetcher: RainFetcher = fetchOpenMeteoRain
  ) {}

  /**
   * Fetches Open-Meteo rainfall for the last pastDays days up to today (India), drops any
   * day after today, writes one row per day into every ward given. Throws (and writes
   * nothing) if the fetch fails or the answer is malformed.
   */
  async ingestRain(
    wardIds: readonly number[],
    options: RainAdapterOptions = {}
  ): Promise<RainIngestResult> {
    const pastDays = validatePastDays(options.pastDays ?? 7);
    const clock = options.now ?? (() => new Date());
    const todayIst = toIstDateString(clock());

    const startDate = addDays(todayIst, -pastDays);
    // The archive API answers up to today in UTC. Between 00:00 and 05:30 IST that is yesterday
    // in India, so asking for todayIst would be refused (400): stop the archive at its last day.
    const todayUtc = clock().toISOString().slice(0, 10);
    const archiveEnd = todayUtc < todayIst ? todayUtc : todayIst;
    const archive = parseOpenMeteoRainResponse(
      await this.fetcher({ startDate, endDate: archiveEnd, fetchFn: options.fetchFn })
    );
    const readings = [...archive.readings];
    let skipped = archive.skipped;

    // Days the archive cannot give (after its last day) or left empty (null, not processed yet)
    // come from the forecast API: same model, same point, its value for days already observed.
    const missing = new Set(skipped.map((s) => s.date));
    for (let day = addDays(archiveEnd, 1); day <= todayIst; day = addDays(day, 1)) {
      if (!readings.some((r) => r.date === day)) missing.add(day);
    }
    if (missing.size > 0) {
      const firstMissing = [...missing].sort()[0];
      const forecast = parseOpenMeteoRainResponse(
        await this.fetcher({ startDate: firstMissing, endDate: todayIst, baseUrl: OPEN_METEO_FORECAST_URL, fetchFn: options.fetchFn })
      );
      const filled = forecast.readings.filter((r) => missing.has(r.date));
      readings.push(...filled);
      readings.sort((a, b) => a.date.localeCompare(b.date));
      const filledDates = new Set(filled.map((r) => r.date));
      skipped = skipped.filter((s) => !filledDates.has(s.date));
    }

    const validReadings: DailyRainReading[] = [];
    const droppedFuture: string[] = [];

    for (const reading of readings) {
      if (reading.date > todayIst) {
        // Drop future forecast days (forecasts are not observed rain)
        droppedFuture.push(reading.date);
      } else {
        // Today itself is kept: it is a partial day; last-write-wins will correct/update it on later runs
        validReadings.push(reading);
      }
    }

    const signalRows = validReadings.length > 0 ? createRainSignalRows(validReadings, wardIds) : [];
    const ingestResult = await this.engine.ingest(signalRows, {
      strict: options.strict,
      knownWardIds: options.knownWardIds,
    });

    return {
      ...ingestResult,
      today: todayIst,
      readings: validReadings,
      skipped,
      droppedFuture,
    };
  }
}
