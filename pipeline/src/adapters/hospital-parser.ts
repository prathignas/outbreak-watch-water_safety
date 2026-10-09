import {
  SIGNAL_TYPES,
  SOURCE_TAGS,
  type ReportedSignalRow,
} from "@outbreak/contract";
import {
  type DailyWardCountParserConfig,
  parseDailyWardCountPayload,
  parseDailyWardCountRecord,
  type RawDailyWardCountRecord,
} from "./daily-ward-count-parser.js";

/**
 * Raw hospital daily record input schema.
 * Represents pre-aggregated daily hospital admission / visit counts for a ward.
 */
export type RawHospitalDailyRecord = RawDailyWardCountRecord;

const HOSPITAL_SIGNAL_TYPE = SIGNAL_TYPES.find((t) => t === "hospital") ?? "hospital";
const SYNTHETIC_SOURCE_TAG = SOURCE_TAGS.find((t) => t === "synthetic") ?? "synthetic";

const HOSPITAL_CONFIG: DailyWardCountParserConfig = {
  signalType: HOSPITAL_SIGNAL_TYPE,
  defaultSourceTag: SYNTHETIC_SOURCE_TAG,
  sourceName: "Hospital",
};

/**
 * Pure function: Parses and validates a single raw hospital daily record into a canonical SignalRow.
 *
 * Contract rules:
 * - signalType: "hospital"
 * - sourceTag: "synthetic" (default)
 * - count: daily total (non-negative finite number)
 * - date: IST date string (YYYY-MM-DD)
 */
export function parseHospitalDailyRecord(raw: unknown): ReportedSignalRow {
  return parseDailyWardCountRecord(raw, HOSPITAL_CONFIG);
}

/**
 * Pure function: Parses a payload of one or multiple hospital daily records into canonical SignalRow[].
 */
export function parseHospitalPayload(payload: unknown): ReportedSignalRow[] {
  return parseDailyWardCountPayload(payload, HOSPITAL_CONFIG);
}
