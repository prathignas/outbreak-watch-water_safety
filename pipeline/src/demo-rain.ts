/**
 * Local Rain Pipeline Demo (no database): npm run demo:rain
 *
 * Fetches real rain from Open-Meteo (P1's archive API and point), drops any day after today,
 * writes one value per day into all 243 wards of P1's city.json, into an in-memory store.
 * To write into the database instead, use the backend's job: npm run rain:once (backend/).
 */
import { RealCity } from "@outbreak/detection";
import { InMemorySignalStore, runRainJob } from "./index.js";

const wardIds = RealCity.fromFile().wardIds();
const store = new InMemorySignalStore();
const result = await runRainJob({ sink: store, wardIds });

if (!result.ok) {
  console.error(`Rain demo failed, nothing written: ${result.error}`);
  process.exit(1);
}
console.log(`Today (India): ${result.today}. ${result.rowsWritten} rows in memory (${result.days.length} days x ${result.wards} wards).`);
for (const day of result.days) console.log(`  ${day.date}  ${day.mm} mm  (real, Open-Meteo)`);
