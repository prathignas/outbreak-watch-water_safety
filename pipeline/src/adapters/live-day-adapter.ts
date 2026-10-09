import {
  SOURCE_TAGS,
  SYNTHETIC_SIGNAL_TYPES,
  type CityModel,
  type LiveSignalRow,
} from "@outbreak/contract";
import { rowsArrivingOn } from "@outbreak/detection";
import {
  type IngestItemError,
  type IngestOptions,
  type IngestResult,
  SignalIngestionEngine,
} from "../engine.js";
import { LiveDayGeneratorError, PipelineValidationError } from "../errors.js";
import { type SignalSink } from "../sink.js";
import { validateDateString } from "../validation.js";

/** Gives the synthetic rows that reach us on one India day (their reportedOn is that day). */
export type RowsArrivingOn = (day: string) => LiveSignalRow[] | Promise<LiveSignalRow[]>;

/**
 * Options for LiveDayAdapter: P1's generator settings.
 */
export interface LiveDayGeneratorOptions {
  /** Seed for P1's generator. The backend uses DEMO.seed (2026), the same seed as the database seed. */
  seed: number;
  /** P1's real city (RealCity from city.json). Required: P1's default GridCity has made-up ward ids. */
  city: CityModel;
  /**
   * Override for tests only. Default: P1's real rowsArrivingOn(day, seed, { city }), which gives
   * every row whose reportedOn is `day`, including late rows for earlier days.
   */
  rowsArrivingOn?: RowsArrivingOn;
}

/**
 * Options for LiveDayAdapter ingestion.
 */
export interface LiveDayIngestOptions extends IngestOptions {}

const SYNTHETIC_SOURCE_TAG = SOURCE_TAGS.find((t) => t === "synthetic") ?? "synthetic";
const ALLOWED_SYNTHETIC_TYPES = SYNTHETIC_SIGNAL_TYPES as readonly string[];

/**
 * Adapter for P1's live synthetic feed: the complaint, pharmacy and hospital rows that reach
 * us on one India day (P1's rowsArrivingOn). Late rows are expected: a row's date may be
 * earlier than its reportedOn. Every row must say reportedOn = the day processed, and is
 * tagged "synthetic". Rows are checked, de-duplicated and written to the sink.
 */
export class LiveDayAdapter {
  private readonly engine: SignalIngestionEngine;
  private readonly arriving: RowsArrivingOn;

  constructor(
    sinkOrEngine: SignalSink | SignalIngestionEngine,
    options: LiveDayGeneratorOptions
  ) {
    if (!options || !Number.isInteger(options.seed) || !options.city) {
      throw new PipelineValidationError("LiveDayAdapter needs P1's seed (a whole number) and city");
    }
    const { seed, city } = options;
    this.arriving = options.rowsArrivingOn ?? ((day) => rowsArrivingOn(day, seed, { city }));
    this.engine =
      sinkOrEngine instanceof SignalIngestionEngine
        ? sinkOrEngine
        : new SignalIngestionEngine(sinkOrEngine);
  }

  /**
   * Ingests the synthetic rows that reach us on one India day (`day` = reportedOn).
   */
  async ingestLiveDay(
    day: string,
    options: LiveDayIngestOptions = {}
  ): Promise<IngestResult> {
    // 1. Validate date argument
    validateDateString(day);

    const { strict = false } = options;

    // 2. Call P1's generator
    let rawResult: unknown;
    try {
      rawResult = await this.arriving(day);
    } catch (err) {
      throw new LiveDayGeneratorError(
        `rowsArrivingOn failed for ${day}: ${(err as Error)?.message ?? String(err)}`,
        err
      );
    }

    if (!Array.isArray(rawResult)) {
      throw new LiveDayGeneratorError(
        `rowsArrivingOn must return an array of rows, received: ${typeof rawResult}`
      );
    }

    // 3. Untrusted row verification
    const validRowsToIngest: unknown[] = [];
    const initialErrors: IngestItemError[] = [];

    for (let index = 0; index < rawResult.length; index++) {
      const rawRow = rawResult[index];
      try {
        if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
          throw new PipelineValidationError(
            `Live day row at index ${index} must be a plain object, received: ${Array.isArray(rawRow) ? "array" : typeof rawRow}`
          );
        }

        const row = rawRow as Record<string, unknown>;

        // Must have reached us on the day processed. Its date may be earlier (a late row);
        // the engine checks it is never later than reportedOn.
        if (row.reportedOn !== day) {
          throw new PipelineValidationError(
            `Live day row reportedOn '${String(row.reportedOn)}' is not the day processed '${day}'`
          );
        }

        // Must be in SYNTHETIC_SIGNAL_TYPES (rain is real data, not synthetic)
        if (
          typeof row.signalType !== "string" ||
          !ALLOWED_SYNTHETIC_TYPES.includes(row.signalType)
        ) {
          throw new PipelineValidationError(
            `Signal type '${String(row.signalType)}' is not a synthetic signal type (${SYNTHETIC_SIGNAL_TYPES.join(", ")})`
          );
        }

        // Must have sourceTag 'synthetic'
        if (row.sourceTag !== SYNTHETIC_SOURCE_TAG) {
          throw new PipelineValidationError(
            `Live day row sourceTag must be '${SYNTHETIC_SOURCE_TAG}', received: '${String(row.sourceTag)}'`
          );
        }

        validRowsToIngest.push(rawRow);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (strict) {
          throw error;
        }
        initialErrors.push({ index, error, raw: rawRow });
      }
    }

    // 4. Ingest valid rows through the generic engine (deduplication, knownWardIds, sink)
    const engineResult = await this.engine.ingest(validRowsToIngest, options);

    return {
      totalReceived: rawResult.length,
      rows: engineResult.rows,
      writtenCount: engineResult.writtenCount,
      errors: [...initialErrors, ...engineResult.errors],
    };
  }
}
