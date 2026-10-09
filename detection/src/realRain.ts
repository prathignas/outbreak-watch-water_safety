import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays } from "./dates.js";

/** One day of real Bengaluru rain. */
export interface RainDay {
  /** YYYY-MM-DD, Asia/Kolkata calendar day. */
  date: string;
  /** Millimetres of rain that day. */
  mm: number;
}

export const DEFAULT_RAIN_PATH = fileURLToPath(new URL("../data/raw/rain.json", import.meta.url));

/**
 * Checks an Open-Meteo daily response and turns it into a list of rain days.
 * Throws on anything odd (missing days, gaps, nulls, negative rain): we never
 * fill holes with made-up rain.
 */
export function parseOpenMeteoRain(json: unknown): RainDay[] {
  const daily = (json as { daily?: { time?: unknown; precipitation_sum?: unknown } } | null)?.daily;
  const dates = daily?.time;
  const amounts = daily?.precipitation_sum;
  if (!Array.isArray(dates) || !Array.isArray(amounts)) {
    throw new Error("Rain file is not an Open-Meteo daily response with time and precipitation_sum");
  }
  if (dates.length === 0 || dates.length !== amounts.length) {
    throw new Error(`Rain file has ${dates.length} dates but ${amounts.length} rain values`);
  }

  return dates.map((date, index) => {
    const mm = amounts[index];
    if (typeof mm !== "number" || !Number.isFinite(mm) || mm < 0) {
      throw new Error(`Rain on ${date} is missing or invalid (${mm}); refusing to invent a value`);
    }
    if (index > 0 && date !== addDays(dates[index - 1], 1)) {
      throw new Error(`Rain dates jump from ${dates[index - 1]} to ${date}; a day is missing`);
    }
    return { date: String(date), mm };
  });
}

/** Loads the real rain we downloaded from Open-Meteo (see data/SOURCES.md). */
export function loadRealRain(path: string = DEFAULT_RAIN_PATH): RainDay[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read real rain file at ${path}. Run "npm run fetch-rain". (${String(error)})`);
  }
  return parseOpenMeteoRain(JSON.parse(text));
}
