import { type ReportedSignalRow } from "@outbreak/contract";
import { toIstDateString } from "../date.js";
import { PipelineValidationError } from "../errors.js";
import { validateCount, validateSignalRow, validateWardId } from "../validation.js";

/**
 * Parsed daily precipitation reading from weather response.
 */
export interface DailyRainReading {
  /** IST Date string (YYYY-MM-DD) */
  date: string;
  /** Millimetres of rainfall */
  precipitationMm: number;
}

/**
 * Result of parsing Open-Meteo rain response, including skipped null days.
 */
export interface ParseRainResult {
  /** Successfully parsed daily rainfall readings */
  readings: DailyRainReading[];
  /** Days where precipitation_sum was null and was skipped */
  skipped: Array<{ date: string; index: number }>;
}

/**
 * Pure parser function: Parses and validates Open-Meteo JSON response.
 *
 * Expected Open-Meteo response structure:
 * {
 *   "daily": {
 *     "time": ["2026-10-06", "2026-10-07"],
 *     "precipitation_sum": [12.4, 0.0]
 *   }
 * }
 */
export function parseOpenMeteoRainResponse(json: unknown): ParseRainResult {
  if (typeof json !== "object" || json === null) {
    throw new PipelineValidationError("Open-Meteo response must be a non-null JSON object");
  }

  const payload = json as Record<string, unknown>;

  if (typeof payload.daily !== "object" || payload.daily === null) {
    throw new PipelineValidationError("Open-Meteo response is missing 'daily' object");
  }

  // Same units and days as P1's rain.json: millimetres, Asia/Kolkata calendar days.
  // We never ask for another unit; if the answer says one anyway, refuse it rather than convert.
  const units = payload.daily_units as Record<string, unknown> | undefined;
  if (units?.precipitation_sum !== undefined && units.precipitation_sum !== "mm") {
    throw new PipelineValidationError(
      `Open-Meteo precipitation unit is '${String(units.precipitation_sum)}', expected 'mm'`
    );
  }
  if (payload.timezone !== undefined && payload.timezone !== "Asia/Kolkata") {
    throw new PipelineValidationError(
      `Open-Meteo days are in '${String(payload.timezone)}', expected 'Asia/Kolkata'`
    );
  }

  const daily = payload.daily as Record<string, unknown>;

  if (!Array.isArray(daily.time)) {
    throw new PipelineValidationError("Open-Meteo response is missing 'daily.time' array");
  }

  if (!Array.isArray(daily.precipitation_sum)) {
    throw new PipelineValidationError("Open-Meteo response is missing 'daily.precipitation_sum' array");
  }

  if (daily.time.length !== daily.precipitation_sum.length) {
    throw new PipelineValidationError(
      `Mismatched array lengths in Open-Meteo response: time has ${daily.time.length} items, precipitation_sum has ${daily.precipitation_sum.length} items`
    );
  }

  const readings: DailyRainReading[] = [];
  const skipped: Array<{ date: string; index: number }> = [];

  for (let i = 0; i < daily.time.length; i++) {
    const rawTime = daily.time[i];
    const rawPrecipitation = daily.precipitation_sum[i];

    if (rawTime === null || rawTime === undefined || typeof rawTime !== "string") {
      throw new PipelineValidationError(`Invalid time entry at index ${i}: expected date string, received ${String(rawTime)}`);
    }

    const istDate = toIstDateString(rawTime);

    // Skip null precipitation_sum days without failing the whole batch
    if (rawPrecipitation === null) {
      skipped.push({ date: istDate, index: i });
      continue;
    }

    if (rawPrecipitation === undefined || typeof rawPrecipitation !== "number" || !Number.isFinite(rawPrecipitation) || rawPrecipitation < 0) {
      throw new PipelineValidationError(
        `Invalid precipitation_sum entry at index ${i}: expected non-negative finite number, received ${String(rawPrecipitation)}`
      );
    }

    const precipitationMm = validateCount(rawPrecipitation);

    readings.push({
      date: istDate,
      precipitationMm,
    });
  }

  return { readings, skipped };
}

/**
 * Expands daily rainfall readings into canonical SignalRow[] across all specified wards.
 *
 * Contract rule:
 * "Rain: the count is millimetres of rain that day, a decimal (e.g. 12.4).
 * It is one city-wide value per day, written into every ward's rain row with source tag 'real'."
 */
export function createRainSignalRows(
  readings: readonly DailyRainReading[],
  wardIds: readonly number[]
): ReportedSignalRow[] {
  if (!Array.isArray(wardIds) || wardIds.length === 0) {
    throw new PipelineValidationError("At least one wardId must be provided to create rain SignalRows");
  }

  const rows: ReportedSignalRow[] = [];

  for (const rawWardId of wardIds) {
    const wardId = validateWardId(rawWardId);
    for (const reading of readings) {
      const row: ReportedSignalRow = {
        wardId,
        signalType: "rain",
        date: reading.date,
        count: reading.precipitationMm,
        sourceTag: "real",
        // Contract v2: rain is reported on its own day.
        reportedOn: reading.date,
      };
      rows.push(validateSignalRow(row));
    }
  }

  return rows;
}
