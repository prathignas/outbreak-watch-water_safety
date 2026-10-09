import { setupDatabase } from "../db/setup.js";

/**
 * One-off Lambda: runs the migrations, then the seed (P1's city + synthetic history),
 * against the RDS secret. Invoke it once after `cdk deploy` (infra/README.md). Safe to re-run.
 */
export async function handler(): Promise<{ statusCode: number; result: Awaited<ReturnType<typeof setupDatabase>> }> {
  const result = await setupDatabase();
  console.log("[DbSetupLambda] Done:", result);
  return { statusCode: 200, result };
}
