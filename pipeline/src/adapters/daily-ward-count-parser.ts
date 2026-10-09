import {
  type ReportedSignalRow,
  type SignalType,
  type SourceTag,
} from "@outbreak/contract";
import { toIstDateString } from "../date.js";
import { PipelineValidationError } from "../errors.js";
import {
  validateCount,
  validateDateString,
  validateSignalRow,
  validateSourceTag,
  validateWardId,
} from "../validation.js";

/**
 * Raw input schema for pre-aggregated daily ward count signals.
 */
export interface RawDailyWardCountRecord {
  /** Target ward ID */
  wardId?: number;
  ward_id?: number;

  /** Date or timestamp (YYYY-MM-DD, ISO string, Date object) */
  date?: string | Date | number;
  timestamp?: string | Date | number;
  created_at?: string | Date | number;
  at?: string | Date | number;

  /** Daily signal count */
  count?: number;

  /** Optional source tag */
  sourceTag?: SourceTag | string;
  source_tag?: SourceTag | string;

  /** The day the row reached us (contract v2). Default: the row's own date. */
  reportedOn?: string | Date | number;
  reported_on?: string | Date | number;
}

/**
 * Configuration options for parsing daily ward count records.
 */
export interface DailyWardCountParserConfig {
  /** The signal type to assign (e.g. 'hospital', 'pharmacy') */
  signalType: SignalType;
  /** Default source tag to assign when omitted (e.g. 'synthetic') */
  defaultSourceTag: SourceTag;
  /** Human-readable source name for error messages (e.g. 'Hospital', 'Pharmacy') */
  sourceName: string;
}

/**
 * Per-delivery options (a webhook call).
 */
export interface DailyWardCountParseOptions {
  /**
   * The India day this delivery reached us. When given (webhooks): date and reportedOn
   * default to it, and a reportedOn after it is refused (a row cannot arrive in the future).
   * This is the backend's documented webhook body: [{ wardId, count, date?, reportedOn? }].
   */
  receivedOn?: string;
}

/**
 * Pure function: Parses and validates a single raw daily record into a canonical SignalRow.
 */
export function parseDailyWardCountRecord(
  raw: unknown,
  config: DailyWardCountParserConfig,
  options: DailyWardCountParseOptions = {}
): ReportedSignalRow {
  const { signalType, defaultSourceTag, sourceName } = config;
  const receivedOn = options.receivedOn === undefined ? undefined : validateDateString(options.receivedOn);

  if (typeof raw !== "object" || raw === null) {
    throw new PipelineValidationError(`${sourceName} record must be a non-null object`);
  }

  const payload = raw as RawDailyWardCountRecord;

  // 1. Extract & validate ward ID
  const rawWardId = payload.wardId ?? payload.ward_id;
  if (rawWardId === undefined || rawWardId === null) {
    throw new PipelineValidationError(`${sourceName} record is missing 'wardId'`);
  }
  const wardId = validateWardId(rawWardId);

  // 1b. A row that names its own signal type must name this endpoint's type.
  const namedType = (payload as Record<string, unknown>).signalType ?? (payload as Record<string, unknown>).signal_type;
  if (namedType !== undefined && namedType !== signalType) {
    throw new PipelineValidationError(
      `${sourceName} record has signalType '${String(namedType)}'; this feed only takes '${signalType}'`
    );
  }

  // 2. Extract & validate date / timestamp (default: the day it was received)
  const rawDate = payload.date ?? payload.timestamp ?? payload.created_at ?? payload.at ?? receivedOn;
  if (rawDate === undefined || rawDate === null) {
    throw new PipelineValidationError(`${sourceName} record is missing 'date' or 'timestamp'`);
  }
  const istDate = toIstDateString(rawDate as Date | string | number);

  // 3. Extract & validate count
  if (payload.count === undefined || payload.count === null) {
    throw new PipelineValidationError(`${sourceName} record is missing 'count'`);
  }
  const count = validateCount(payload.count);

  // 4. Extract & validate source tag
  const rawSourceTag = payload.sourceTag ?? payload.source_tag;
  let sourceTag: SourceTag;

  if (rawSourceTag !== undefined && rawSourceTag !== null) {
    if (typeof rawSourceTag !== "string") {
      throw new PipelineValidationError(
        `${sourceName} record sourceTag must be a string, received: ${String(rawSourceTag)}`
      );
    }
    // Validate tag format / contract membership
    validateSourceTag(rawSourceTag);
    // Enforce defaultSourceTag (e.g. synthetic numbers must say synthetic)
    if (rawSourceTag !== defaultSourceTag) {
      throw new PipelineValidationError(
        `${sourceName} record sourceTag must be '${defaultSourceTag}', received: '${rawSourceTag}'`
      );
    }
    sourceTag = defaultSourceTag;
  } else {
    sourceTag = defaultSourceTag;
  }

  // 5. The day the row reached us (contract v2): never before its date, never after delivery.
  const rawReportedOn = payload.reportedOn ?? payload.reported_on;
  const reportedOn =
    rawReportedOn === undefined || rawReportedOn === null
      ? receivedOn ?? istDate
      : toIstDateString(rawReportedOn as Date | string | number);
  if (receivedOn !== undefined && reportedOn > receivedOn) {
    throw new PipelineValidationError(
      `${sourceName} record reportedOn ${reportedOn} is after the day it was received (${receivedOn})`
    );
  }

  const row: ReportedSignalRow = {
    wardId,
    signalType,
    date: istDate,
    count,
    sourceTag,
    reportedOn,
  };

  return validateSignalRow(row);
}

/**
 * Pure function: Parses a payload of one or multiple daily records into canonical SignalRow[].
 */
export function parseDailyWardCountPayload(
  payload: unknown,
  config: DailyWardCountParserConfig,
  options: DailyWardCountParseOptions = {}
): ReportedSignalRow[] {
  const { sourceName } = config;

  if (payload === null || payload === undefined) {
    throw new PipelineValidationError(`${sourceName} payload cannot be null or undefined`);
  }

  // If array of records
  if (Array.isArray(payload)) {
    return payload.map((item, index) => {
      try {
        return parseDailyWardCountRecord(item, config, options);
      } catch (err) {
        throw new PipelineValidationError(
          `Invalid ${sourceName.toLowerCase()} record at index ${index}: ${(err as Error).message}`
        );
      }
    });
  }

  // If wrapper object with records/data array
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.records)) {
      return parseDailyWardCountPayload(obj.records, config, options);
    }
    if (Array.isArray(obj.data)) {
      return parseDailyWardCountPayload(obj.data, config, options);
    }
    // Single record object
    return [parseDailyWardCountRecord(payload, config, options)];
  }

  throw new PipelineValidationError(
    `Unsupported ${sourceName.toLowerCase()} payload format: ${typeof payload}`
  );
}
