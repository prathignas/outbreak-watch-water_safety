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
 * Raw pharmacy daily record input schema.
 * Represents pre-aggregated daily pharmacy sales / prescription counts for a ward.
 */
export type RawPharmacyDailyRecord = RawDailyWardCountRecord;

const PHARMACY_SIGNAL_TYPE = SIGNAL_TYPES.find((t) => t === "pharmacy") ?? "pharmacy";
const SYNTHETIC_SOURCE_TAG = SOURCE_TAGS.find((t) => t === "synthetic") ?? "synthetic";

const PHARMACY_CONFIG: DailyWardCountParserConfig = {
  signalType: PHARMACY_SIGNAL_TYPE,
  defaultSourceTag: SYNTHETIC_SOURCE_TAG,
  sourceName: "Pharmacy",
};

/**
 * Pure function: Parses and validates a single raw pharmacy daily record into a canonical SignalRow.
 *
 * Contract rules:
 * - signalType: "pharmacy"
 * - sourceTag: "synthetic" (default)
 * - count: daily total (non-negative finite number)
 * - date: IST date string (YYYY-MM-DD)
 */
export function parsePharmacyDailyRecord(raw: unknown): ReportedSignalRow {
  return parseDailyWardCountRecord(raw, PHARMACY_CONFIG);
}

/**
 * Pure function: Parses a payload of one or multiple pharmacy daily records into canonical SignalRow[].
 */
export function parsePharmacyPayload(payload: unknown): ReportedSignalRow[] {
  return parseDailyWardCountPayload(payload, PHARMACY_CONFIG);
}
