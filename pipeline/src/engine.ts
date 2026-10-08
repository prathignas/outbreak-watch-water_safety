import type { ReportedSignalRow } from "@outbreak/contract";
import { PipelineValidationError } from "./errors.js";
import { normalizeSignalRow } from "./normalize.js";
import { getSignalRowKey, type SignalSink } from "./sink.js";

/**
 * An individual error record from a failed raw item ingestion.
 */
export interface IngestItemError {
  index: number;
  error: Error;
  raw: unknown;
}

/**
 * Options configuring ingestion behavior.
 */
export interface IngestOptions {
  /**
   * If true, throws an error immediately on the first invalid item.
   * If false (default), collects errors and continues processing valid items.
   */
  strict?: boolean;
  /**
   * Optional collection of known valid ward IDs.
   * When given, rows with other ward IDs are rejected into the errors array (or thrown in strict mode).
   */
  knownWardIds?: readonly number[] | Set<number>;
}

/**
 * Result returned by the ingestion engine.
 */
export interface IngestResult {
  /** Total number of raw inputs received */
  totalReceived: number;
  /** Canonical daily rows (SignalRow + reportedOn) produced and written to the sink */
  rows: ReportedSignalRow[];
  /** Number of rows passed to sink */
  writtenCount: number;
  /** List of errors encountered during validation/normalization */
  errors: IngestItemError[];
}

/**
 * Pure function to process, validate, normalize, and deduplicate a collection of raw daily signal inputs.
 *
 * Ingestion semantics:
 * - Each SignalRow represents the daily total for (wardId, signalType, date, sourceTag).
 * - If multiple rows in the same batch share the same unique contract key, only the last one is kept
 *   before calling the sink (last-write-wins idempotent upsert).
 * - If knownWardIds is specified, any row whose wardId is not recognized is routed to errors.
 * - Event-level deduplication and counting (e.g. for discrete citizen complaints) belongs in event adapters
 *   prior to producing canonical daily SignalRow totals.
 */
export function processRawSignals(
  rawInputs: readonly unknown[],
  options: IngestOptions = {}
): { rows: ReportedSignalRow[]; errors: IngestItemError[] } {
  const { strict = false, knownWardIds } = options;
  const errors: IngestItemError[] = [];
  const rowMap = new Map<string, ReportedSignalRow>();

  for (let index = 0; index < rawInputs.length; index++) {
    const raw = rawInputs[index];
    try {
      const normalized = normalizeSignalRow(raw);

      if (knownWardIds !== undefined) {
        const isKnown =
          knownWardIds instanceof Set
            ? knownWardIds.has(normalized.wardId)
            : knownWardIds.includes(normalized.wardId);

        if (!isKnown) {
          throw new PipelineValidationError(
            `Ward ID ${normalized.wardId} is not in the list of known ward IDs`
          );
        }
      }

      const key = getSignalRowKey(normalized);

      // Idempotent batch deduplication: keep only the last one for identical composite keys
      rowMap.set(key, normalized);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (strict) {
        throw error;
      }
      errors.push({ index, error, raw });
    }
  }

  return {
    rows: Array.from(rowMap.values()),
    errors,
  };
}

/**
 * Common ingestion engine that coordinates raw daily data intake, validation,
 * normalization, deduplication, and persistence to an abstract sink.
 */
export class SignalIngestionEngine {
  constructor(private readonly sink: SignalSink) {}

  /**
   * Ingests a collection of raw inputs into the downstream sink.
   */
  async ingest(
    rawInputs: readonly unknown[],
    options: IngestOptions = {}
  ): Promise<IngestResult> {
    const { rows, errors } = processRawSignals(rawInputs, options);

    if (rows.length > 0) {
      await this.sink.write(rows);
    }

    return {
      totalReceived: rawInputs.length,
      rows,
      writtenCount: rows.length,
      errors,
    };
  }
}
