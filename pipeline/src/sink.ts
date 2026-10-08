import {
  type ReportedSignalRow,
  type SignalRow,
  type SignalType,
  type SourceTag,
} from "@outbreak/contract";

/**
 * Returns the unique key for a SignalRow according to the contract:
 * UNIQUE (ward_id, signal_type, date, source_tag).
 */
export function getSignalRowKey(row: Pick<SignalRow, "wardId" | "signalType" | "date" | "sourceTag">): string {
  return `${row.wardId}:${row.signalType}:${row.date}:${row.sourceTag}`;
}

/**
 * Abstract sink interface for persisting canonical rows (SignalRow + reportedOn).
 * Decouples ingestion logic from actual storage mechanism (PostgreSQL, in-memory, etc.).
 */
export interface SignalSink {
  /**
   * Persists a batch of rows.
   * Implementations must handle uniqueness/idempotency per the contract: a row with the same
   * (wardId, signalType, date, sourceTag) replaces the old one (new count and new reportedOn).
   */
  write(rows: readonly ReportedSignalRow[]): Promise<void> | void;
}

/**
 * Extended sink interface with query and inspection methods, useful for testing and caches.
 */
export interface SignalStore extends SignalSink {
  getAll(): readonly ReportedSignalRow[];
  get(wardId: number, signalType: SignalType, date: string, sourceTag: SourceTag): ReportedSignalRow | undefined;
  clear(): void;
  readonly size: number;
}

/**
 * Pure in-memory implementation of SignalStore for unit testing and offline processing.
 * Idempotently indexes rows by UNIQUE(ward_id, signal_type, date, source_tag).
 */
export class InMemorySignalStore implements SignalStore {
  private readonly storage = new Map<string, ReportedSignalRow>();

  write(rows: readonly ReportedSignalRow[]): void {
    for (const row of rows) {
      const key = getSignalRowKey(row);
      // Idempotent upsert: latest row replaces previous value for this unique key
      this.storage.set(key, { ...row });
    }
  }

  getAll(): ReportedSignalRow[] {
    return Array.from(this.storage.values());
  }

  get(wardId: number, signalType: SignalType, date: string, sourceTag: SourceTag): ReportedSignalRow | undefined {
    const key = `${wardId}:${signalType}:${date}:${sourceTag}`;
    const found = this.storage.get(key);
    return found ? { ...found } : undefined;
  }

  clear(): void {
    this.storage.clear();
  }

  get size(): number {
    return this.storage.size;
  }
}
