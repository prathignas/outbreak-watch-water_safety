import { type ReportedSignalRow } from "@outbreak/contract";
import { type IngestItemError, type IngestResult, type SignalIngestionEngine } from "../engine.js";
import { PipelineValidationError } from "../errors.js";
import { resolveAndValidateComplaintEvent } from "./complaint-parser.js";
import { type ComplaintEventStore, InMemoryComplaintEventStore } from "./complaint-store.js";
import { type WardResolver } from "./ward-resolver.js";

/**
 * Options for complaint processing.
 */
export interface ComplaintAdapterOptions {
  /**
   * If true, throws immediately on the first validation or ward resolution error.
   * If false (default), quarantines errors in the result report.
   */
  strict?: boolean;
  /**
   * Optional collection of known valid ward IDs.
   * When given, complaints resolving to unlisted wards are quarantined into errors (or thrown in strict mode).
   */
  knownWardIds?: readonly number[] | Set<number>;
  /**
   * The India day these complaints reached us (contract v2 reportedOn). Default: each
   * complaint's own date (a real-time form).
   */
  receivedOn?: string;
}

/**
 * Result returned from complaint ingestion batch.
 */
export interface ProcessComplaintsResult {
  /** Total raw complaint events received */
  totalReceived: number;
  /** Number of newly accepted and recorded complaint events */
  processedCount: number;
  /** Number of duplicate / replayed events detected and ignored */
  duplicateCount: number;
  /** Number of malformed / invalid events quarantined */
  errorCount: number;
  /** List of quarantined errors */
  errors: IngestItemError[];
  /** Result from the downstream SignalIngestionEngine */
  ingestResult: IngestResult;
}

/**
 * Adapter that ingests raw citizen complaint events, performs event-level deduplication,
 * aggregates counts by ward + IST date, and forwards canonical SignalRows to the SignalIngestionEngine.
 */
export class ComplaintAdapter {
  constructor(
    private readonly engine: SignalIngestionEngine,
    private readonly wardResolver: WardResolver,
    private readonly eventStore: ComplaintEventStore = new InMemoryComplaintEventStore()
  ) {}

  /**
   * Ingests a batch of raw complaint events.
   */
  async ingestComplaints(
    rawEvents: readonly unknown[],
    options: ComplaintAdapterOptions = {}
  ): Promise<ProcessComplaintsResult> {
    const { strict = false, knownWardIds, receivedOn } = options;
    const errors: IngestItemError[] = [];
    let processedCount = 0;
    let duplicateCount = 0;

    // Track unique (wardId, date) combinations affected in this batch
    const affectedDays = new Map<string, { wardId: number; date: string }>();

    for (let index = 0; index < rawEvents.length; index++) {
      const raw = rawEvents[index];
      try {
        const validated = await resolveAndValidateComplaintEvent(raw, this.wardResolver);

        if (knownWardIds !== undefined) {
          const isKnown =
            knownWardIds instanceof Set
              ? knownWardIds.has(validated.wardId)
              : knownWardIds.includes(validated.wardId);
          if (!isKnown) {
            throw new PipelineValidationError(
              `Ward ID ${validated.wardId} is not in the list of known ward IDs`
            );
          }
        }

        const isNew = await this.eventStore.record(validated);

        const dayKey = `${validated.wardId}:${validated.date}`;
        affectedDays.set(dayKey, { wardId: validated.wardId, date: validated.date });

        if (isNew) {
          processedCount++;
        } else {
          duplicateCount++;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (strict) {
          throw error;
        }
        errors.push({ index, error, raw });
      }
    }

    // Generate canonical daily SignalRows for all affected (wardId, date) pairs
    const signalRows: ReportedSignalRow[] = [];
    for (const { wardId, date } of affectedDays.values()) {
      const totalDailyCount = await this.eventStore.getDailyCount(wardId, date);
      signalRows.push({
        wardId,
        signalType: "complaint",
        date,
        count: totalDailyCount,
        sourceTag: "user",
        reportedOn: receivedOn ?? date,
      });
    }

    const ingestResult = await this.engine.ingest(signalRows, {
      strict,
      knownWardIds,
    });

    return {
      totalReceived: rawEvents.length,
      processedCount,
      duplicateCount,
      errorCount: errors.length,
      errors,
      ingestResult,
    };
  }
}
