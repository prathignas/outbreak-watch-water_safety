/*
 * npm run api:local   (backend/)
 * The API Lambda's router behind a plain local HTTP server, for running the frontend in real
 * mode against a local database:  DATABASE_URL=... DEMO_AUTH_TOKEN=... PORT=3001 npm run api:local
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
// One .env for local dev: the repo root's (the demo key typed on the gate page is DEMO_AUTH_TOKEN).
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
import { createServer } from "node:http";
import { handler } from "../src/handlers/apiHandler.js";

const port = Number(process.env.PORT ?? 3001);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    // The same event shape API Gateway (REST, proxy) sends to the Lambda.
    const result = (await handler({
      httpMethod: req.method,
      path: url.pathname,
      headers: req.headers,
      queryStringParameters: url.searchParams.size ? Object.fromEntries(url.searchParams) : null,
      body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null,
      isBase64Encoded: false,
    })) as { statusCode: number; headers?: Record<string, string>; body?: string };
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body ?? "");
    const key = req.headers["x-demo-auth"];
    const why = result.statusCode === 401 ? ` [x-demo-auth ${key === undefined ? "MISSING" : `sent, ${String(key).length} chars, starts "${String(key).slice(0, 2)}"`}; origin ${req.headers.origin ?? "-"}]` : "";
    console.log(`${req.method} ${url.pathname}${url.search} -> ${result.statusCode}${why}`);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "local server error" }));
  }
}).listen(port, () => console.log(`Outbreak Watch API (local) on http://localhost:${port}`));
