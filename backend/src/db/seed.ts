import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays, generateHistory } from "@outbreak/detection";
import { type IDatabase, getDatabase } from "./repository.js";
import type { PipelineZone, Ward } from "./types.js";
import { getCity, getCityFile } from "../city.js";
import { DEMO, istDate } from "../config.js";

/*
 * Seed = P1's real city + P1's synthetic history. Nothing is made up here:
 * - wards and water zones: P1's detection/data/city.json (243 BBMP wards, BWSSB sub-divisions);
 *   their shapes: P1's detection/data/wards.geojson and zones.geojson (if the files are present);
 * - signal history: P1's generateHistory(), every row tagged "synthetic";
 * - NO rain rows: rain only ever comes from P2's real Open-Meteo feed (tagged "real").
 */

export function calculateDateOffset(baseDate: string, daysOffset: number): string {
  return addDays(baseDate, daysOffset);
}

/** Finds one of P1's data files: in CITY_DATA_DIR, next to the Lambda bundle, or in the source tree. */
function findDataFile(name: string): string | null {
  const candidates = [
    process.env.CITY_DATA_DIR ? `${process.env.CITY_DATA_DIR}/${name}` : null,
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    fileURLToPath(new URL(`../../../detection/data/${name}`, import.meta.url)),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** GeoJSON features keyed by one property (P1's files use KGISWardNo and KGISSub_DivisionID). */
function shapesBy(file: string, key: string): Map<number, unknown> {
  const path = findDataFile(file);
  if (!path) {
    console.warn(`[Seed] ${file} not found: seeding without shapes (map lookups will be empty).`);
    return new Map();
  }
  const geojson = JSON.parse(readFileSync(path, "utf8")) as { features: Array<{ properties: Record<string, unknown>; geometry: unknown }> };
  return new Map(geojson.features.map((f) => [Number(f.properties[key]), f.geometry]));
}

/** Wards and water zones from P1's city.json (with shapes when the GeoJSON files are there). */
export async function seedCity(db: IDatabase, options: { shapes?: boolean } = {}): Promise<{ wardsCount: number; zonesCount: number }> {
  const city = getCityFile();
  const wardShapes = options.shapes === false ? new Map() : shapesBy("wards.geojson", "KGISWardNo");
  const zoneShapes = options.shapes === false ? new Map() : shapesBy("zones.geojson", "KGISSub_DivisionID");

  const zones: PipelineZone[] = city.zones.map((z) => ({ id: z.id, name: z.name, geometry: zoneShapes.get(z.id) }));
  console.log(`[Seed] Seeding ${zones.length} water zones from city.json...`);
  await db.insertPipelineZones(zones);

  const wards: Ward[] = city.wards.map((w) => ({ id: w.id, name: w.name, zoneId: w.zoneId, geometry: wardShapes.get(w.id) }));
  console.log(`[Seed] Seeding ${wards.length} wards from city.json...`);
  await db.insertWards(wards);
  return { wardsCount: wards.length, zonesCount: zones.length };
}

/**
 * Demo history from P1's generateHistory(): DEMO.historyDays days up to and including `today`,
 * every row tagged "synthetic", each with P1's reportedOn (late rows stay hidden until then).
 */
export async function seedHistory(db: IDatabase, today: string = istDate()): Promise<number> {
  const rows = generateHistory(addDays(today, 1), DEMO.historyDays + 1, DEMO.seed, { city: getCity() });
  if (rows.some((r) => r.sourceTag !== "synthetic")) throw new Error("generateHistory returned a row that is not synthetic");
  console.log(`[Seed] Seeding ${rows.length} synthetic signal rows (${addDays(today, -DEMO.historyDays)} to ${today}, seed ${DEMO.seed})...`);
  return db.insertSignals(rows);
}

export async function seedDatabase(
  db: IDatabase = getDatabase(),
  baseDate?: string,
  options: { shapes?: boolean } = {}
): Promise<{
  wardsCount: number;
  zonesCount: number;
  signalsCount: number;
}> {
  const { wardsCount, zonesCount } = await seedCity(db, options);
  const signalsCount = await seedHistory(db, baseDate ?? istDate());
  console.log("[Seed] Seeding complete. No rain rows written: rain comes only from P2's Open-Meteo feed.");
  return { wardsCount, zonesCount, signalsCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const res = await seedDatabase();
    console.log(`[Seed] Success:`, res);
    process.exit(0);
  } catch (err) {
    console.error("[Seed] Failed:", err);
    process.exit(1);
  }
}
