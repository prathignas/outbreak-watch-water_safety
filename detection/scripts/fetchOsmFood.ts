import { readFileSync, writeFileSync } from "node:fs";
import * as turf from "@turf/turf";
import type { FeatureCollection } from "geojson";
import { REAL_CITY } from "../src/params.js";

/*
 * Downloads food venues (restaurants, fast food, cafes, food courts) inside the
 * ward area from the OpenStreetMap Overpass API and saves the raw reply.
 * Data (c) OpenStreetMap contributors, ODbL. Stops loudly on any failure:
 * nothing is invented or saved.
 */

export function overpassQuery(bbox: number[]): string {
  const [west, south, east, north] = bbox;
  const amenities = REAL_CITY.foodAmenities.join("|");
  return `[out:json][timeout:180];nwr["amenity"~"^(${amenities})$"](${south},${west},${north},${east});out center tags;`;
}

async function main(): Promise<void> {
  const wards = JSON.parse(readFileSync("data/wards.geojson", "utf8")) as FeatureCollection;
  const query = overpassQuery(turf.bbox(wards));
  console.log(`query: ${query}`);
  const response = await fetch(REAL_CITY.overpassUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "hackathon-outbreak-warning/1.0" },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status} ${response.statusText}`);
  const text = await response.text();
  const json = JSON.parse(text) as { elements?: unknown[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
  if (!Array.isArray(json.elements)) throw new Error("Overpass reply has no elements list");
  if (json.remark) throw new Error(`Overpass reported a problem: ${json.remark}`);
  writeFileSync(REAL_CITY.osmFoodFile, text);
  console.log(`Saved ${json.elements.length} food venues (OSM data as of ${json.osm3s?.timestamp_osm_base}) to ${REAL_CITY.osmFoodFile}`);
}

try {
  await main();
} catch (error) {
  console.error(`OSM food fetch FAILED, nothing was invented or saved: ${String(error)}`);
  process.exit(1);
}
