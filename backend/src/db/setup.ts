import { runMigrations } from "./migrate.js";
import { seedDatabase } from "./seed.js";
import { PostgresDatabase } from "./repository.js";
import { closePool } from "./client.js";
import { loadScenario } from "../demo/scenario.js";
import { handleRequest } from "../api/router.js";
import { istDate } from "../config.js";
import { loadRecentRain } from "../handlers/rainHandler.js";

/**
 * db:setup = run every pending migration, then seed (P1's city + synthetic history), then load
 * the last 92 days of real rain.
 * Uses DATABASE_URL, or DB_SECRET_ARN / DB_SECRET_NAME (the RDS secret) via db/client.ts.
 * Safe to run again: migrations are tracked and the seed only upserts. The demo scenario
 * (backend/src/demo/) is loaded only when there are no alerts yet (a fresh deploy).
 */
export async function setupDatabase(options: { close?: boolean } = {}) {
  try {
    const applied = await runMigrations();
    const db = new PostgresDatabase();
    const seeded = await seedDatabase(db);
    // The last 92 days of real Open-Meteo rain (none written if the fetch fails).
    const rain = await loadRecentRain(db);
    const fresh = (await db.getAlerts({ limit: 1 })).length === 0 && (await db.getActiveDemoOutbreaks()).length === 0;
    const scenario = fresh
      ? await loadScenario(db, istDate(), { api: (r) => handleRequest(r, db), demoKey: process.env.DEMO_AUTH_TOKEN })
      : null;
    return { migrationsApplied: applied, ...seeded, rainRows: rain?.ok ? rain.rowsWritten : 0, scenario };
  } finally {
    if (options.close) await closePool();
  }
}
