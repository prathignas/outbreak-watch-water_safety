/*
 * npm run rain:once   (backend/)
 * One run of the hourly rain Lambda against DATABASE_URL: real Open-Meteo rain, last 7 days
 * up to today, into all 243 wards. Optional RAW_ARCHIVE_DIR=<folder> keeps the raw answer.
 */
import "dotenv/config";
import { handler } from "../src/handlers/rainHandler.js";
import { closePool } from "../src/db/client.js";

try {
  console.log(JSON.stringify(await handler(), null, 2));
} catch (err) {
  console.error(String(err));
  process.exitCode = 1;
} finally {
  await closePool();
}
