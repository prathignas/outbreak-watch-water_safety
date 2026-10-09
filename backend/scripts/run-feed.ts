/*
 * npm run feed:once [-- --day YYYY-MM-DD]   (backend/)
 * One run of the daily synthetic-feed Lambda against DATABASE_URL: P1's rows that arrive on
 * that day (default today in India). Optional RAW_ARCHIVE_DIR=<folder> keeps the raw batch.
 */
import "dotenv/config";
import { handler } from "../src/handlers/feedHandler.js";
import { closePool } from "../src/db/client.js";

const i = process.argv.indexOf("--day");
try {
  console.log(JSON.stringify(await handler({ day: i > 0 ? process.argv[i + 1] : undefined }), null, 2));
} catch (err) {
  console.error(String(err));
  process.exitCode = 1;
} finally {
  await closePool();
}
