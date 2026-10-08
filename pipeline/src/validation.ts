import {
  SIGNAL_TYPES,
  SOURCE_TAGS,
  type ReportedSignalRow,
  type SignalType,
  type SourceTag,
} from "@outbreak/contract";
import { isValidDateString } from "./date.js";
import { PipelineValidationError } from "./errors.js";

/**
 * Validates a ward ID according to the contract: a whole number >= 0 (BBMP ward numbers; 0 is allowed).
 */
export function validateWardId(wardId: unknown): number {
  if (typeof wardId !== "number" || !Number.isInteger(wardId) || wardId < 0) {
    throw new PipelineValidationError(
      `Ward ID must be a whole number >= 0, received: ${String(wardId)}`
    );
  }
  return wardId;
}

/**
 * Validates a signal type against allowed SIGNAL_TYPES from @outbreak/contract.
 */
export function validateSignalType(signalType: unknown): SignalType {
  if (
    typeof signalType !== "string" ||
    !(SIGNAL_TYPES as readonly string[]).includes(signalType)
  ) {
    throw new PipelineValidationError(
      `Invalid signal type: '${String(signalType)}'. Allowed types: ${SIGNAL_TYPES.join(", ")}`
    );
  }
  return signalType as SignalType;
}

/**
 * Validates a source tag against allowed SOURCE_TAGS from @outbreak/contract.
 */
export function validateSourceTag(sourceTag: unknown): SourceTag {
  if (
    typeof sourceTag !== "string" ||
    !(SOURCE_TAGS as readonly string[]).includes(sourceTag)
  ) {
    throw new PipelineValidationError(
      `Invalid source tag: '${String(sourceTag)}'. Allowed tags: ${SOURCE_TAGS.join(", ")}`
    );
  }
  return sourceTag as SourceTag;
}

/**
 * Validates count / daily total: non-negative finite number.
 * Rain may be a decimal (e.g., 12.4 mm); others are non-negative numeric counts.
 */
export function validateCount(count: unknown): number {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    throw new PipelineValidationError(
      `Count must be a non-negative finite number, received: ${String(count)}`
    );
  }
  return count;
}

/**
 * Validates date string: must be a valid YYYY-MM-DD IST date.
 */
export function validateDateString(date: unknown): string {
  if (typeof date !== "string" || !isValidDateString(date)) {
    throw new PipelineValidationError(
      `Date must be a valid YYYY-MM-DD string, received: ${String(date)}`
    );
  }
  return date;
}

/**
 * Validates reportedOn (contract v2): a valid YYYY-MM-DD India day, never before the row's date.
 */
export function validateReportedOn(reportedOn: unknown, date: string): string {
  const day = validateDateString(reportedOn);
  if (day < date) {
    throw new PipelineValidationError(
      `reportedOn ${day} is before date ${date}; a row cannot arrive before the day it is for`
    );
  }
  return day;
}

/**
 * Validates that an arbitrary object adheres strictly to the contract's row structure
 * (SignalRow plus reportedOn, contract v2).
 */
export function validateSignalRow(row: unknown): ReportedSignalRow {
  if (typeof row !== "object" || row === null) {
    throw new PipelineValidationError("SignalRow must be a non-null object");
  }

  const candidate = row as Record<string, unknown>;

  const wardId = validateWardId(candidate.wardId);
  const signalType = validateSignalType(candidate.signalType);
  const date = validateDateString(candidate.date);
  const count = validateCount(candidate.count);
  const sourceTag = validateSourceTag(candidate.sourceTag);
  const reportedOn = validateReportedOn(candidate.reportedOn, date);

  return {
    wardId,
    signalType,
    date,
    count,
    sourceTag,
    reportedOn,
  };
}
