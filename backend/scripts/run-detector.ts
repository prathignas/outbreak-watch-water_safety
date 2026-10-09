/*
 * npm run detector:once   (backend/)
 * One detector run, exactly what the scheduled Lambda does, against DATABASE_URL.
 * Optional: --date YYYY-MM-DD (last day to run), --rerun-from YYYY-MM-DD.
 */
import "dotenv/config";
import { handler } from "../src/handlers/detectorHandler.js";
import { closePool } from "../src/db/client.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

try {
  const { result } = await handler({ date: arg("--date"), rerunFrom: arg("--rerun-from") });
  console.log(JSON.stringify({ ...result, alerts: result.alerts.map((a) => ({ id: a.id, wardId: a.wardId, date: a.date, score: a.score })) }, null, 2));
} finally {
  await closePool();
}
