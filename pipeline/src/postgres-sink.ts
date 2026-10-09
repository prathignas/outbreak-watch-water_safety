import type { ReportedSignalRow } from "@outbreak/contract";
import { type SignalSink } from "./sink.js";

/**
 * The one database method this sink needs: the backend's existing
 * `IDatabase.insertSignals` (backend/src/db/repository.ts). Pass `getDatabase()` from
 * `@outbreak/backend`. It is typed by shape here so the pipeline does not import the backend
 * (the backend imports the pipeline).
 *
 * What insertSignals does (P3's code, unchanged): a batched
 *   INSERT INTO signals (ward_id, signal_type, date, count, source_tag, reported_on) ...
 *   ON CONFLICT (ward_id, signal_type, date, source_tag)
 *   DO UPDATE SET count = EXCLUDED.count, reported_on = EXCLUDED.reported_on
 */
export interface SignalWriter {
  insertSignals(rows: ReportedSignalRow[]): Promise<number>;
}

/**
 * Production sink: writes rows to PostgreSQL through the backend's insertSignals.
 * No SQL of its own. A repeat of the same (ward, signal, date, source tag) updates the row
 * (new count, new reported_on); it is never added twice.
 */
export class PostgresSignalSink implements SignalSink {
  constructor(private readonly db: SignalWriter) {}

  async write(rows: readonly ReportedSignalRow[]): Promise<void> {
    if (rows.length === 0) return;
    // reportedOn is always set: the pipeline never relies on the backend's "default = date".
    await this.db.insertSignals(rows.map((row) => ({ ...row })));
  }
}
