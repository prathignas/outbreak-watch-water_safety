import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

/*
 * Step 1 of the real city: check the two boundary files and convert the BWSSB
 * KML to GeoJSON. Prints a report; exits non-zero if anything would make the
 * build unsafe (missing files, more than one town, odd ward count, bad shapes).
 */

export const WARDS_PATH = "data/wards.geojson";
export const KML_PATH = "data/raw/bwssb_subdivisions.kml";
export const ZONES_PATH = "data/zones.geojson";

export type Area = Feature<Polygon | MultiPolygon>;

/** Converts the KML, keeping only Sub_DivisionName and KGISSub_DivisionID, sorted by id so output never changes. */
export function convertZones(): FeatureCollection<Polygon | MultiPolygon> {
  const doc = new DOMParser().parseFromString(readFileSync(KML_PATH, "utf8"), "text/xml");
  const converted = kml(doc as unknown as Document);
  const features = converted.features.map((feature): Area => {
    const props = feature.properties ?? {};
    let geometry = feature.geometry;
    // togeojson turns a KML MultiGeometry of polygons into a GeometryCollection; flatten it.
    if (geometry?.type === "GeometryCollection") {
      const polygons = geometry.geometries.flatMap((g) =>
        g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [],
      );
      geometry = { type: "MultiPolygon", coordinates: polygons };
    }
    return {
      type: "Feature",
      properties: { KGISSub_DivisionID: Number(props.KGISSub_DivisionID), Sub_DivisionName: String(props.Sub_DivisionName ?? "") },
      geometry: geometry as Polygon | MultiPolygon,
    };
  }).map(cleanShape);
  features.sort((a, b) => a.properties!.KGISSub_DivisionID - b.properties!.KGISSub_DivisionID);
  return { type: "FeatureCollection", features };
}

/** Drops altitude and repeated points. The raw files have both; neither changes the shape. */
export function cleanShape<T extends Feature>(feature: T): T {
  return fixRingRoles(turf.cleanCoords(turf.truncate(feature, { precision: 7, coordinates: 2 })) as T);
}

/**
 * GeoJSON reads every ring after the first as a hole. A few wards store a
 * detached piece (an exclave) that way, so it would be subtracted instead of
 * added. A ring that lies outside the first ring becomes its own part; a ring
 * inside it stays a hole. A ring that only partly overlaps is a real error.
 */
export function fixRingRoles<T extends Feature>(feature: T): T {
  const geometry = feature.geometry;
  if (geometry?.type !== "Polygon" || geometry.coordinates.length < 2) return feature;
  const [outer, ...rest] = geometry.coordinates;
  const outerShape = turf.polygon([outer]);
  const holes: typeof rest = [];
  const parts: (typeof rest)[] = [];
  for (const ring of rest) {
    const ringShape = turf.polygon([ring]);
    if (turf.booleanWithin(ringShape, outerShape)) holes.push(ring);
    else if (turf.booleanDisjoint(ringShape, outerShape)) parts.push([ring]);
    else throw new Error(`A ring of ${JSON.stringify(feature.properties)} partly overlaps its outer ring`);
  }
  if (parts.length === 0) return feature;
  return { ...feature, geometry: { type: "MultiPolygon", coordinates: [[outer, ...holes], ...parts] } };
}

/** How many shapes needed fixRingRoles (for the report). */
export function needsRingFix(feature: Feature): boolean {
  return fixRingRoles(turf.cleanCoords(turf.truncate(feature, { precision: 7, coordinates: 2 }))).geometry.type
    !== feature.geometry?.type;
}

/** Returns a reason the shape is empty or invalid, or null if it is fine. */
export function shapeProblem(feature: Feature): string | null {
  const g = feature.geometry;
  if (!g) return "no geometry";
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return `geometry is ${g.type}`;
  if (g.coordinates.length === 0) return "empty geometry";
  if (!turf.booleanValid(feature)) return "invalid (e.g. self-crossing or unclosed ring)";
  if (turf.area(feature) <= 0) return "zero area";
  return null;
}

function main(): void {
  for (const path of [WARDS_PATH, KML_PATH]) {
    if (!existsSync(path)) throw new Error(`Missing ${path}: stopping`);
  }
  const wards = JSON.parse(readFileSync(WARDS_PATH, "utf8")) as FeatureCollection;
  const zones = convertZones();
  writeFileSync(ZONES_PATH, JSON.stringify(zones) + "\n");

  const wardProps = [...new Set(wards.features.flatMap((f) => Object.keys(f.properties ?? {})))];
  const zoneProps = [...new Set(zones.features.flatMap((f) => Object.keys(f.properties ?? {})))];
  const towns = new Map<string, number>();
  for (const f of wards.features) towns.set(String(f.properties?.KGISTownCode), (towns.get(String(f.properties?.KGISTownCode)) ?? 0) + 1);
  const wardNos = wards.features.map((f) => f.properties?.KGISWardNo);
  const unique = new Set(wardNos).size === wardNos.length;
  const zoneIds = zones.features.map((f) => f.properties!.KGISSub_DivisionID);

  console.log("CITY DATA CHECK");
  console.log(`  wards: ${wards.features.length}   zones (BWSSB sub-divisions): ${zones.features.length}`);
  console.log(`  ward properties: ${wardProps.join(", ")}`);
  console.log(`  zone properties kept: ${zoneProps.join(", ")}`);
  console.log(`  KGISTownCode values: ${[...towns].map(([code, n]) => `${code} (${n})`).join(", ")}`);
  console.log(`  KGISWardNo unique: ${unique}`);
  console.log(`  KGISSub_DivisionID unique: ${new Set(zoneIds).size === zoneIds.length}`);
  const rawBadWards = wards.features.filter((f) => shapeProblem(f) !== null).length;
  const rawZones = kml(new DOMParser().parseFromString(readFileSync(KML_PATH, "utf8"), "text/xml") as unknown as Document);
  const rawBadZones = rawZones.features.filter((f) => f.geometry?.type === "Polygon" && shapeProblem(f as Area) !== null).length;
  const exclaveWards = wards.features.filter((f) => needsRingFix(f));
  console.log(`  raw files: ${rawBadWards} ward shapes and ${rawBadZones}+ zone shapes fail strict validity, ` +
    "because of repeated points (and altitude values in the KML)");
  console.log(`  wards whose extra rings are detached pieces, not holes (fixed into MultiPolygons): ${exclaveWards.length}` +
    (exclaveWards.length ? ` (${exclaveWards.map((f) => `${f.properties?.KGISWardNo} ${f.properties?.KGISWardName}`).join(", ")})` : ""));
  const problems = [
    ...wards.features.map((f) => [`ward ${f.properties?.KGISWardNo} ${f.properties?.KGISWardName}`, shapeProblem(cleanShape(f))] as const),
    ...zones.features.map((f) => [`zone ${f.properties?.KGISSub_DivisionID} ${f.properties?.Sub_DivisionName}`, shapeProblem(f)] as const),
  ].filter(([, problem]) => problem !== null);
  const empties = [...wards.features, ...zones.features].filter((f) => !f.geometry || turf.area(f as Area) <= 0).length;
  console.log(`  empty shapes: ${empties}`);
  console.log(`  still invalid after removing repeated points and altitude: ${problems.length === 0 ? "none" : problems.length}`);
  for (const [name, problem] of problems) console.log(`    - ${name}: ${problem}`);
  console.log(`  wrote ${ZONES_PATH}`);

  const stops: string[] = [];
  if (towns.size > 1) stops.push("more than one KGISTownCode");
  if (wards.features.length < 190 || wards.features.length > 250) stops.push("ward count outside 190-250");
  if (!unique) stops.push("KGISWardNo not unique");
  if (stops.length > 0) {
    console.log(`\n  STOP: ${stops.join("; ")}. Ask before building.`);
    process.exit(2);
  }
}

if (process.argv[1]?.endsWith("checkCityData.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`check-city-data failed: ${String(error)}`);
    process.exit(1);
  }
}
