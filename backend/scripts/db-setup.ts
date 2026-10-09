/*
 * npm run db:setup  (from the repo root or backend/)
 * Runs the migrations, then the seed, against DATABASE_URL or the RDS secret (DB_SECRET_ARN).
 */
import "dotenv/config";
import { setupDatabase } from "../src/db/setup.js";

if (!process.env.DATABASE_URL && !process.env.DB_SECRET_ARN && !process.env.DB_SECRET_NAME) {
  console.error("db:setup needs DATABASE_URL, or DB_SECRET_ARN (the RDS secret from the stack output DatabaseSecretArn).");
  process.exit(1);
}

try {
  const result = await setupDatabase({ close: true });
  console.log("[db:setup] Done:", result);
} catch (err) {
  console.error("[db:setup] Failed:", err);
  process.exit(1);
}
