import { RAIN_SOURCE } from "@outbreak/detection";
import { PipelineValidationError, RainFetchError } from "../errors.js";
import { isValidDateString } from "../date.js";

/*
 * Live rain uses exactly the source P1's backtest rain came from (detection/src/params.ts
 * RAIN_SOURCE, detection/scripts/fetch-rain.ts, detection/data/raw/rain.json):
 * the Open-Meteo **archive** API, the same point, daily precipitation_sum, Asia/Kolkata days,
 * and the default unit (mm). So live rain matches the rain the detector was scored on.
 * The archive API has no forecast days and answers up to today in UTC (checked 2026-10-10),
 * so the adapter asks the forecast API for any later India day (rain-adapter.ts).
 */
export const BENGALURU_LATITUDE = RAIN_SOURCE.latitude;
export const BENGALURU_LONGITUDE = RAIN_SOURCE.longitude;
export const BENGALURU_TIMEZONE = RAIN_SOURCE.timezone;
export const OPEN_METEO_BASE_URL = RAIN_SOURCE.url;
/** Forecast API: fills the days the archive does not have yet (today in India before 05:30 IST, or a null day). */
export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/**
 * Validates pastDays parameter (integer between 0 and 92 inclusive).
 */
export function validatePastDays(pastDays: unknown): number {
  if (
    typeof pastDays !== "number" ||
    !Number.isInteger(pastDays) ||
    Number.isNaN(pastDays) ||
    pastDays < 0 ||
    pastDays > 92
  ) {
    throw new PipelineValidationError(
      `pastDays must be an integer between 0 and 92, received: ${String(pastDays)}`
    );
  }
  return pastDays;
}

/**
 * Options for configuring Open-Meteo rain API requests.
 */
export interface FetchRainOptions {
  /** First day, YYYY-MM-DD (India day). */
  startDate: string;
  /** Last day, YYYY-MM-DD (India day). */
  endDate: string;
  /** Base API URL override (tests only; default: P1's archive API). */
  baseUrl?: string;
  /** Injected fetch function for testing */
  fetchFn?: typeof fetch;
  /** Request timeout in milliseconds (default: 10000ms) */
  timeoutMs?: number;
}

/**
 * Constructs the Open-Meteo request URL: the same query P1's fetch-rain.ts sends.
 */
export function buildOpenMeteoUrl(options: FetchRainOptions): string {
  const { startDate, endDate } = options;
  if (!isValidDateString(startDate) || !isValidDateString(endDate) || startDate > endDate) {
    throw new PipelineValidationError(
      `Rain request needs startDate <= endDate as YYYY-MM-DD, received: ${String(startDate)} to ${String(endDate)}`
    );
  }
  const url = new URL(options.baseUrl ?? OPEN_METEO_BASE_URL);
  url.search = new URLSearchParams({
    latitude: String(BENGALURU_LATITUDE),
    longitude: String(BENGALURU_LONGITUDE),
    start_date: startDate,
    end_date: endDate,
    daily: "precipitation_sum",
    timezone: BENGALURU_TIMEZONE,
  }).toString();
  return url.toString();
}

/**
 * Pure HTTP fetcher for Open-Meteo rainfall measurements.
 * Handles timeouts and network errors gracefully without crashing the application.
 */
export async function fetchOpenMeteoRain(options: FetchRainOptions): Promise<unknown> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (!fetchFn) {
    throw new RainFetchError("Fetch implementation is not available in global scope");
  }

  const url = buildOpenMeteoUrl(options);
  const timeoutMs = options.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new RainFetchError(
        `Open-Meteo API returned status ${response.status} (${response.statusText}): ${errorText}`,
        response.status
      );
    }

    const data = (await response.json()) as unknown;
    return data;
  } catch (err: unknown) {
    if (err instanceof RainFetchError) {
      throw err;
    }
    const isAbort = (err as Error)?.name === "AbortError" || controller.signal.aborted;
    const message = isAbort
      ? `Open-Meteo request timed out after ${timeoutMs}ms`
      : `Failed to fetch rainfall data from Open-Meteo: ${(err as Error)?.message ?? String(err)}`;

    throw new RainFetchError(message, undefined, err);
  } finally {
    clearTimeout(timeoutId);
  }
}
