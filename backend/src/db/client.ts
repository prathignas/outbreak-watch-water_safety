import pg from "pg";
const { Pool } = pg;
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let globalPool: pg.Pool | null = null;
let resolvedDbUrl: string | null = null;

export interface DbConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

/**
 * Resolves database connection string either from DATABASE_URL env var
 * or from AWS Secrets Manager if DB_SECRET_NAME / DB_SECRET_ARN is provided.
 */
export async function getDatabaseUrl(): Promise<string> {
  if (resolvedDbUrl) {
    return resolvedDbUrl;
  }

  if (process.env.DATABASE_URL) {
    resolvedDbUrl = process.env.DATABASE_URL;
    return resolvedDbUrl;
  }

  const secretId = process.env.DB_SECRET_NAME || process.env.DB_SECRET_ARN;
  if (secretId) {
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || "ap-south-1",
    });
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    if (res.SecretString) {
      const secret = JSON.parse(res.SecretString);
      // RDS standard secret format
      const host = secret.host || secret.endpoint;
      const port = secret.port || 5432;
      const username = secret.username;
      const password = encodeURIComponent(secret.password);
      const dbname = secret.dbname || secret.database || "outbreak_watch";
      resolvedDbUrl = `postgres://${username}:${password}@${host}:${port}/${dbname}`;
      return resolvedDbUrl;
    }
  }

  throw new Error(
    "Missing database configuration: Either DATABASE_URL or DB_SECRET_ARN environment variable must be specified."
  );
}

/**
 * Returns a reused pg.Pool across Lambda warm invocations.
 */
export async function getPool(): Promise<pg.Pool> {
  if (globalPool) {
    return globalPool;
  }

  const dbUrl = await getDatabaseUrl();
  const isAwsOrSsl =
    dbUrl.includes("amazonaws.com") ||
    process.env.NODE_ENV === "production" ||
    process.env.PGSSLMODE === "require";

  globalPool = new Pool({
    connectionString: dbUrl,
    max: parseInt(process.env.DB_POOL_MAX || "3", 10), // Safe concurrency limit for Lambda
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: isAwsOrSsl ? { rejectUnauthorized: false } : undefined,
  });

  globalPool.on("error", (err) => {
    console.error("[PostgreSQL] Unexpected error on idle client", err);
  });

  return globalPool;
}

/**
 * Executes a parameterized SQL query safely.
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const pool = await getPool();
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    return res;
  } catch (err: any) {
    console.error("[PostgreSQL] Query failed:", {
      text,
      durationMs: Date.now() - start,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Closes the connection pool (used during graceful shutdown or tests).
 */
export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
    resolvedDbUrl = null;
  }
}
