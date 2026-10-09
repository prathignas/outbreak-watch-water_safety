import { toIstDateString } from "../date.js";
import { PipelineValidationError } from "../errors.js";
import { validateWardId } from "../validation.js";
import { type GeoLocation, type WardResolver } from "./ward-resolver.js";

/**
 * Raw complaint event payload schema.
 */
export interface RawComplaintEvent {
  /** Unique complaint event identifier */
  id?: string;
  complaintId?: string;
  complaint_id?: string;

  /** Timestamp of complaint submission */
  timestamp?: Date | string | number;
  created_at?: Date | string | number;
  at?: Date | string | number;

  /** Complaint content / text description */
  content?: string;
  text?: string;
  description?: string;

  /** Direct ward ID (if pre-resolved) */
  wardId?: number;
  ward_id?: number;

  /** Geo coordinates (to be resolved by WardResolver) */
  location?: GeoLocation;
  latitude?: number;
  lat?: number;
  longitude?: number;
  lng?: number;
}

/**
 * Validated and normalized complaint event ready for deduplication and aggregation.
 */
export interface ValidatedComplaintEvent {
  /** Stable unique event ID */
  id: string;
  /** Resolved ward ID */
  wardId: number;
  /** Indian Standard Time date (YYYY-MM-DD) */
  date: string;
  /** ISO timestamp */
  timestamp: string;
  /** Verified complaint text */
  content: string;
}

/**
 * Validates complaint event fields and resolves its ward ID via the supplied WardResolver.
 */
export async function resolveAndValidateComplaintEvent(
  raw: unknown,
  wardResolver: WardResolver
): Promise<ValidatedComplaintEvent> {
  if (typeof raw !== "object" || raw === null) {
    throw new PipelineValidationError("Complaint event must be a non-null object");
  }

  const payload = raw as RawComplaintEvent;

  // 1. Validate ID
  const rawId = payload.id ?? payload.complaintId ?? payload.complaint_id;
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    throw new PipelineValidationError(
      `Complaint event must have a non-empty string ID, received: ${String(rawId)}`
    );
  }
  const id = rawId.trim();

  // 2. Validate Content
  const rawContent = payload.content ?? payload.text ?? payload.description;
  if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
    throw new PipelineValidationError(
      `Complaint event must have non-empty content/description, received: ${String(rawContent)}`
    );
  }
  const content = rawContent.trim();

  // 3. Validate Timestamp & IST Date
  const rawTimestamp = payload.timestamp ?? payload.created_at ?? payload.at;
  if (rawTimestamp === undefined || rawTimestamp === null) {
    throw new PipelineValidationError("Complaint event is missing timestamp");
  }

  let dateStr: string;
  let isoTimestamp: string;
  try {
    dateStr = toIstDateString(rawTimestamp);
    isoTimestamp =
      rawTimestamp instanceof Date
        ? rawTimestamp.toISOString()
        : new Date(rawTimestamp).toISOString();
  } catch (err) {
    throw new PipelineValidationError(
      `Invalid complaint timestamp '${String(rawTimestamp)}': ${(err as Error).message}`
    );
  }

  // 4. Resolve and Validate Ward ID
  const directWardId = payload.wardId ?? payload.ward_id;
  const lat = payload.location?.latitude ?? payload.latitude ?? payload.lat;
  const lng = payload.location?.longitude ?? payload.longitude ?? payload.lng;
  const hasCoordinates = lat !== undefined || lng !== undefined || payload.location !== undefined;

  let resolvedWardId: number | null = null;

  if (hasCoordinates) {
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof lng !== "number" ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      throw new PipelineValidationError(
        `Complaint event has invalid coordinates (lat: ${String(lat)}, lng: ${String(lng)})`
      );
    }

    const coordWardId = await wardResolver.resolveWard({ latitude: lat, longitude: lng });
    if (coordWardId === null || coordWardId === undefined) {
      throw new PipelineValidationError(
        `WardResolver could not map coordinates (lat: ${lat}, lng: ${lng}) to any known ward`
      );
    }
    validateWardId(coordWardId);

    if (directWardId !== undefined) {
      const validatedDirect = validateWardId(directWardId);
      if (validatedDirect !== coordWardId) {
        throw new PipelineValidationError(
          `Complaint event specifies wardId ${validatedDirect} but coordinates (lat: ${lat}, lng: ${lng}) resolve to ward ${coordWardId}`
        );
      }
      resolvedWardId = validatedDirect;
    } else {
      resolvedWardId = coordWardId;
    }
  } else if (directWardId !== undefined) {
    resolvedWardId = validateWardId(directWardId);
  } else {
    throw new PipelineValidationError(
      `Complaint event requires either a valid wardId or valid coordinates (lat: ${String(lat)}, lng: ${String(lng)})`
    );
  }

  return {
    id,
    wardId: resolvedWardId,
    date: dateStr,
    timestamp: isoTimestamp,
    content,
  };
}
