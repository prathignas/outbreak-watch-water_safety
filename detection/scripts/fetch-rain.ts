import { writeFileSync } from "node:fs";
import { RAIN_SOURCE } from "../src/params.js";
import { DEFAULT_RAIN_PATH, parseOpenMeteoRain } from "../src/realRain.js";

/** Re-downloads real Bengaluru daily rain from Open-Meteo. Stops loudly on any failure. */
async function main(): Promise<void> {
  const url = new URL(RAIN_SOURCE.url);
  url.search = new URLSearchParams({
    latitude: String(RAIN_SOURCE.latitude),
    longitude: String(RAIN_SOURCE.longitude),
    start_date: RAIN_SOURCE.startDate,
    end_date: RAIN_SOURCE.endDate,
    daily: "precipitation_sum",
    timezone: RAIN_SOURCE.timezone,
  }).toString();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo answered ${response.status} ${response.statusText}`);
  const json: unknown = await response.json();
  const rain = parseOpenMeteoRain(json); // throws on gaps or missing values
  writeFileSync(DEFAULT_RAIN_PATH, JSON.stringify(json));
  console.log(`Saved ${rain.length} days (${rain[0].date} to ${rain.at(-1)?.date}) to ${RAIN_SOURCE.file}`);
}

try {
  await main();
} catch (error) {
  console.error(`Rain fetch FAILED, nothing was invented or saved: ${String(error)}`);
  process.exit(1);
}
