/*
 * npx tsx scripts/demo-pipeline-flow.ts
 * The whole pipeline in one go, in memory (no database needed), with P1's real code:
 * seed (P1's city + generateHistory) -> POST /demo/inject (P1's generateLiveDay, all rows
 * synthetic) -> the scheduled detector run (P1's runDetector) -> the AlertRecord the app shows.
 */
import { MemoryDatabase, setDatabase } from "../src/db/repository.js";
import { executeDetector } from "../src/detector/orchestrator.js";
import { seedDatabase } from "../src/db/seed.js";
import { handleRequest } from "../src/api/router.js";
import { istDate } from "../src/config.js";

process.env.SES_MOCK = "true";
process.env.DEMO_AUTH_TOKEN ||= "local-demo-key";

const db = new MemoryDatabase();
setDatabase(db);
const headers = { "X-Demo-Auth": process.env.DEMO_AUTH_TOKEN, "X-Officer-Name": "Pipeline demo" };
const wardId = Number(process.argv[2] ?? 18);

console.log("STEP 1: seed (P1's city.json + generateHistory, synthetic, no rain)");
console.log(await seedDatabase(db));

console.log(`STEP 2: POST /demo/inject (water, ward ${wardId}), detector left to the schedule`);
const inject = await handleRequest({ method: "POST", path: "/demo/inject", headers, body: { cause: "water", wardId, runDetector: false } }, db);
console.log(inject.statusCode, JSON.parse(inject.body).injection);

console.log("STEP 3: the scheduled detector run");
const run = await executeDetector({ db });
console.log({ ...run, alerts: run.alerts.map((a) => `${a.wardId} on ${a.date} (${a.score.toFixed(3)})`) });

const zone = new Set(JSON.parse(inject.body).injection.affectedWards.map((w: { wardId: number }) => w.wardId));
const hit = run.alerts.find((a) => zone.has(a.wardId) && a.date === istDate()) ?? run.alerts.find((a) => zone.has(a.wardId));
if (!hit) {
  console.log("No alert in the outbreak's wards yet (it can take a day or two).");
} else {
  console.log("STEP 4: GET /alerts/{id}");
  console.log(JSON.stringify(JSON.parse((await handleRequest({ method: "GET", path: `/alerts/${hit.id}` }, db)).body), null, 2));
}
