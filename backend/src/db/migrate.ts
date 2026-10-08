import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, query } from "./client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(): Promise<string[]> {
  const pool = await getPool();
  const client = await pool.connect();
  const appliedMigrations: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Next to this file in the source tree; next to the bundle in a Lambda (CDK copies them there).
    const migrationsDir = process.env.MIGRATIONS_DIR || join(__dirname, "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const checkRes = await client.query(
        `SELECT id FROM _migrations WHERE name = $1`,
        [file]
      );

      if (checkRes.rows.length === 0) {
        console.log(`[Migrations] Applying ${file}...`);
        const sql = readFileSync(join(migrationsDir, file), "utf8");

        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");

        appliedMigrations.push(file);
        console.log(`[Migrations] Applied ${file} successfully.`);
      } else {
        console.log(`[Migrations] ${file} already applied.`);
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Migrations] Error running migrations:", err);
    throw err;
  } finally {
    client.release();
  }

  return appliedMigrations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const applied = await runMigrations();
    console.log(`[Migrations] Done. Applied: ${applied.join(", ") || "none"}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
