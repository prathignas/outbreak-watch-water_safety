import {
  type ReportedSignalRow,
  type SignalType,
  type SourceTag,
} from "@outbreak/contract";
import { toIstDateString } from "./date.js";
import { PipelineValidationError } from "./errors.js";
import {
  validateCount,
  validateReportedOn,
  validateSignalRow,
  validateSignalType,
  validateSourceTag,
  validateWardId,
} from "./validation.js";

/**
 * Clean input options for creating a SignalRow.
 */
export interface CreateSignalRowInput {
  wardId: number;
  signalType: SignalType;
  date: Date | string | number;
  count: number;
  sourceTag: SourceTag;
  /** The day the row reached us. Default: the row's own date (a real-time feed, contract v2). */
  reportedOn?: Date | string | number;
}

/**
 * Flexible raw input schema accepting snake_case or timestamp variations.
 */
export interface RawSignalInput {
  wardId?: number;
  ward_id?: number;
  signalType?: SignalType | string;
  signal_type?: SignalType | string;
  date?: string | Date | number;
  timestamp?: string | Date | number;
  created_at?: string | Date | number;
  at?: string | Date | number;
  count?: number;
  sourceTag?: SourceTag | string;
  source_tag?: SourceTag | string;
  reportedOn?: string | Date | number;
  reported_on?: string | Date | number;
}

/**
 * Creates and validates a SignalRow from strongly-typed parameters,
 * automatically converting the date/timestamp to an IST YYYY-MM-DD string.
 */
export function createSignalRow(input: CreateSignalRowInput): ReportedSignalRow {
  if (typeof input !== "object" || input === null) {
    throw new PipelineValidationError("Input must be a non-null object");
  }

  const istDate = toIstDateString(input.date);

  const row: ReportedSignalRow = {
    wardId: validateWardId(input.wardId),
    signalType: validateSignalType(input.signalType),
    date: istDate,
    count: validateCount(input.count),
    sourceTag: validateSourceTag(input.sourceTag),
    reportedOn: input.reportedOn === undefined ? istDate : toIstDateString(input.reportedOn),
  };

  return validateSignalRow(row);
}

/**
 * Normalizes raw/heterogeneous inputs (supporting snake_case and various timestamp fields)
 * into a standardized, validated SignalRow adhering to @outbreak/contract.
 */
export function normalizeSignalRow(raw: unknown): ReportedSignalRow {
  if (typeof raw !== "object" || raw === null) {
    throw new PipelineValidationError("Raw input must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;

  const rawWardId = obj.wardId ?? obj.ward_id;
  const rawSignalType = obj.signalType ?? obj.signal_type;
  const rawDate = obj.date ?? obj.timestamp ?? obj.created_at ?? obj.at;
  const rawCount = obj.count;
  const rawSourceTag = obj.sourceTag ?? obj.source_tag;
  const rawReportedOn = obj.reportedOn ?? obj.reported_on;

  if (rawWardId === undefined) {
    throw new PipelineValidationError("Missing ward ID (expected 'wardId' or 'ward_id')");
  }
  if (rawSignalType === undefined) {
    throw new PipelineValidationError("Missing signal type (expected 'signalType' or 'signal_type')");
  }
  if (rawDate === undefined) {
    throw new PipelineValidationError("Missing date/timestamp (expected 'date', 'timestamp', 'created_at', or 'at')");
  }
  if (rawCount === undefined) {
    throw new PipelineValidationError("Missing count");
  }
  if (rawSourceTag === undefined) {
    throw new PipelineValidationError("Missing source tag (expected 'sourceTag' or 'source_tag')");
  }

  const wardId = validateWardId(rawWardId);
  const signalType = validateSignalType(rawSignalType);
  const istDate = toIstDateString(rawDate as Date | string | number);
  const count = validateCount(rawCount);
  const sourceTag = validateSourceTag(rawSourceTag);
  // Contract v2: a real-time feed's row arrives on its own day.
  const reportedOn = validateReportedOn(
    rawReportedOn === undefined || rawReportedOn === null ? istDate : toIstDateString(rawReportedOn as Date | string | number),
    istDate
  );

  return {
    wardId,
    signalType,
    date: istDate,
    count,
    sourceTag,
    reportedOn,
  };
}
