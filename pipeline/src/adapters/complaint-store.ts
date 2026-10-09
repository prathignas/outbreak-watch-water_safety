import { type ValidatedComplaintEvent } from "./complaint-parser.js";

/**
 * Storage and deduplication interface for individual complaint events.
 *
 * NOTE: In production (e.g. serverless Lambda functions, multi-process APIs, or across restarts),
 * this event store must be backed by a persistent database (such as PostgreSQL) so that event
 * deduplication and cumulative daily counts survive restarts and are shared across adapter instances.
 */
export interface ComplaintEventStore {
  /** Checks if an event ID has already been recorded */
  has(id: string): Promise<boolean> | boolean;

  /**
   * Records a validated complaint event.
   * Returns true if event was newly recorded, or false if it was already recorded (duplicate).
   */
  record(event: ValidatedComplaintEvent): Promise<boolean> | boolean;

  /** Returns total count of distinct complaints for a given ward and IST date */
  getDailyCount(wardId: number, date: string): Promise<number> | number;

  /** Returns all recorded events (useful for inspection and testing) */
  getAllEvents?(): Promise<ValidatedComplaintEvent[]> | ValidatedComplaintEvent[];

  /** Clears the store (for test resets) */
  clear?(): Promise<void> | void;
}

/**
 * In-memory implementation of ComplaintEventStore.
 * Provides exact event-level deduplication and daily ward-level aggregation.
 */
export class InMemoryComplaintEventStore implements ComplaintEventStore {
  private readonly eventsById = new Map<string, ValidatedComplaintEvent>();
  private readonly dailyCounts = new Map<string, number>();

  has(id: string): boolean {
    return this.eventsById.has(id);
  }

  record(event: ValidatedComplaintEvent): boolean {
    if (this.eventsById.has(event.id)) {
      return false; // Duplicate event
    }

    this.eventsById.set(event.id, { ...event });
    const dayKey = `${event.wardId}:${event.date}`;
    const current = this.dailyCounts.get(dayKey) ?? 0;
    this.dailyCounts.set(dayKey, current + 1);

    return true;
  }

  getDailyCount(wardId: number, date: string): number {
    const dayKey = `${wardId}:${date}`;
    return this.dailyCounts.get(dayKey) ?? 0;
  }

  getAllEvents(): ValidatedComplaintEvent[] {
    return Array.from(this.eventsById.values());
  }

  clear(): void {
    this.eventsById.clear();
    this.dailyCounts.clear();
  }

  get size(): number {
    return this.eventsById.size;
  }
}

/**
 * The three table operations a persistent store needs. The backend's IDatabase has them
 * (backend/src/db/repository.ts, table complaint_events from migration 003); pass getDatabase().
 * Typed by shape, so the pipeline does not import the backend.
 */
export interface ComplaintEventTable {
  /** Inserts the id; false if it was already there. */
  recordComplaintEvent(event: { id: string; wardId: number; date: string }): Promise<boolean>;
  hasComplaintEvent(id: string): Promise<boolean>;
  countComplaintEvents(wardId: number, date: string): Promise<number>;
}

/**
 * Production ComplaintEventStore: event ids live in the database, so de-duplication and the
 * daily counts survive Lambda restarts and are shared by every Lambda instance.
 */
export class DatabaseComplaintEventStore implements ComplaintEventStore {
  constructor(private readonly table: ComplaintEventTable) {}

  has(id: string): Promise<boolean> {
    return this.table.hasComplaintEvent(id);
  }

  record(event: ValidatedComplaintEvent): Promise<boolean> {
    return this.table.recordComplaintEvent({ id: event.id, wardId: event.wardId, date: event.date });
  }

  getDailyCount(wardId: number, date: string): Promise<number> {
    return this.table.countComplaintEvents(wardId, date);
  }
}
