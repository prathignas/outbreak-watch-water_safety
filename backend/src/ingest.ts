/*
 * The ONE write path for incoming signals: P2's parsers and adapters -> P2's ingestion engine
 * -> P2's PostgresSignalSink -> this backend's insertSignals. Used by POST /complaints,
 * POST /webhooks/pharmacy|hospital, and the rain and feed Lambdas. No other code writes signals,
 * apart from the demo seed and the demo inject (both P1's generator, all "synthetic").
 */
import { randomUUID } from "node:crypto";
import {
  ComplaintAdapter,
  DatabaseComplaintEventStore,
  HospitalAdapter,
  PharmacyAdapter,
  PipelineValidationError,
  PostgresSignalSink,
  SignalIngestionEngine,
  type ReportedSignalRow,
  type RawArchive,
  type WardResolver,
} from "@outbreak/pipeline";
import { saveRawCopy } from "@outbreak/pipeline";
import type { IDatabase } from "./db/repository.js";
import { getCity } from "./city.js";
import { istDate } from "./config.js";

export { PipelineValidationError };

/** The engine every route and job writes through. */
export function signalEngine(db: IDatabase): SignalIngestionEngine {
  return new SignalIngestionEngine(new PostgresSignalSink(db));
}

/** Coordinates -> ward, with PostGIS (ST_Contains on P1's ward shapes). */
function wardResolver(db: IDatabase): WardResolver {
  return { resolveWard: async ({ latitude, longitude }) => (await db.getWardContainingPoint(longitude, latitude))?.id ?? null };
}

export interface ComplaintOutcome {
  duplicate: boolean;
  /** The ward's "user" complaint row for today, after this complaint. */
  signal: ReportedSignalRow;
}

/**
 * One citizen complaint from the frontend form: { complaintId, wardId, description }
 * (lat/lng instead of wardId also works). The server's clock decides the India day, so the
 * row's date = reportedOn = today. complaintId de-duplicates retries (table complaint_events);
 * with no id, the server makes one, so each submission counts once. Throws PipelineValidationError.
 */
export async function ingestComplaint(db: IDatabase, body: unknown, now: Date = new Date()): Promise<ComplaintOutcome> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PipelineValidationError("Send one complaint as a JSON object: { complaintId, wardId, description }");
  }
  const raw = body as Record<string, unknown>;
  // Each submission is ONE complaint. The old body allowed { count }; refuse it rather than ignore it.
  if (raw.count !== undefined && raw.count !== 1) {
    throw new PipelineValidationError("count is not accepted: each submission is one complaint");
  }
  const id = raw.id ?? raw.complaintId ?? raw.complaint_id ?? randomUUID();
  const today = istDate(now);
  // The client's own clock is not trusted for the day: the server stamps the time.
  const event = { ...raw, id, complaintId: undefined, complaint_id: undefined, created_at: undefined, at: undefined, timestamp: now.toISOString() };

  const adapter = new ComplaintAdapter(signalEngine(db), wardResolver(db), new DatabaseComplaintEventStore(db));
  const result = await adapter.ingestComplaints([event], { strict: true, knownWardIds: getCity().wardIds(), receivedOn: today });
  return { duplicate: result.duplicateCount > 0, signal: result.ingestResult.rows[0] };
}

const DAILY_ADAPTERS = {
  pharmacy: (db: IDatabase) => {
    const adapter = new PharmacyAdapter(signalEngine(db));
    return (payload: unknown, receivedOn: string) => adapter.ingestPharmacyData(payload, { receivedOn, strict: true, knownWardIds: getCity().wardIds() });
  },
  hospital: (db: IDatabase) => {
    const adapter = new HospitalAdapter(signalEngine(db));
    return (payload: unknown, receivedOn: string) => adapter.ingestHospitalData(payload, { receivedOn, strict: true, knownWardIds: getCity().wardIds() });
  },
};

/**
 * One webhook batch: [{ wardId, count, date?, reportedOn? }] (or one object, or { records: [...] }).
 * Tagged "synthetic". date and reportedOn default to today in India. A raw copy goes to the
 * archive first (S3 in AWS) when one is given. Throws PipelineValidationError; nothing is written then.
 */
export async function ingestWebhook(
  db: IDatabase,
  kind: "pharmacy" | "hospital",
  body: unknown,
  options: { now?: Date; archive?: RawArchive } = {}
): Promise<{ rowsWritten: number; rawKey: string | null }> {
  const today = istDate(options.now ?? new Date());
  const rawKey = await saveRawCopy(options.archive, `webhook-${kind}`, today, body);
  const result = await DAILY_ADAPTERS[kind](db)(body, today);
  return { rowsWritten: result.writtenCount, rawKey };
}
