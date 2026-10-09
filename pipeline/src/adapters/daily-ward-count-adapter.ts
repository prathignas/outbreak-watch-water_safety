import { type IngestOptions, type IngestResult, type SignalIngestionEngine } from "../engine.js";
import {
  type DailyWardCountParseOptions,
  type DailyWardCountParserConfig,
  parseDailyWardCountPayload,
} from "./daily-ward-count-parser.js";

/**
 * Options for daily ward count adapter ingestion.
 */
export interface DailyWardCountAdapterOptions extends IngestOptions, DailyWardCountParseOptions {}

/**
 * Common base adapter for pre-aggregated daily ward count signals (hospital, pharmacy).
 */
export class DailyWardCountAdapter {
  constructor(
    protected readonly engine: SignalIngestionEngine,
    protected readonly config: DailyWardCountParserConfig
  ) {}

  /**
   * Ingests one or more daily records into the downstream storage sink.
   */
  async ingestData(
    rawPayload: unknown,
    options: DailyWardCountAdapterOptions = {}
  ): Promise<IngestResult> {
    const { receivedOn, ...ingestOptions } = options;
    const signalRows = parseDailyWardCountPayload(rawPayload, this.config, { receivedOn });
    return this.engine.ingest(signalRows, ingestOptions);
  }
}
