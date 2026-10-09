import { addDays } from "@outbreak/detection";
import { toIstDateString } from "../date.js";
import { type IngestResult, type SignalIngestionEngine } from "../engine.js";
import { type FetchRainOptions, fetchOpenMeteoRain, validatePastDays } from "./rain-fetcher.js";
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

    const rawJson = await this.fetcher({
      startDate: addDays(todayIst, -pastDays),
      endDate: todayIst,
      fetchFn: options.fetchFn,
    });
    const { readings, skipped } = parseOpenMeteoRainResponse(rawJson);

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
