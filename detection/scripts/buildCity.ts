import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { CityFile, CityFileWard } from "../src/city.js";
import { REAL_CITY } from "../src/params.js";
import { cleanShape, convertZones, KML_PATH, WARDS_PATH, type Area } from "./checkCityData.js";

/*
 * Builds data/city.json, the real Bengaluru city model, from:
 *   - data/wards.geojson                  BBMP ward boundaries (real)
 *   - data/raw/bwssb_subdivisions.kml     BWSSB water supply sub-divisions (real)
 *   - data/raw/osm_food.json              OpenStreetMap food venues (real, ODbL; npm run fetch-osm-food)
 * Neighbours, zones and food flags are BEST MATCHES computed from those shapes.
 * Same inputs, same output, byte for byte: everything is sorted and rounded.
 */

type WardProps = { KGISWardNo: string; KGISWardName: string; KGISWardID: number; LGD_WardCode: number; KGISTownCode: string };
type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number } };

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const bboxesOverlap = (a: number[], b: number[], pad = 0) =>
  a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

function loadWards() {
  const raw = JSON.parse(readFileSync(WARDS_PATH, "utf8")) as FeatureCollection<Polygon | MultiPolygon, WardProps>;
  const towns = new Set(raw.features.map((f) => f.properties.KGISTownCode));
  const ids = raw.features.map((f) => Number(f.properties.KGISWardNo));
  if (towns.size !== 1) throw new Error(`Expected one KGISTownCode, found ${[...towns].join(", ")}: stop and ask`);
  if (new Set(ids).size !== ids.length || ids.some((id) => !Number.isInteger(id))) {
    throw new Error("KGISWardNo is not a unique whole number for every ward: stop and ask");
  }
  return raw.features
    .map((feature) => {
      const shape = cleanShape(feature) as Area;
      return {
        id: Number(feature.properties.KGISWardNo),
        props: feature.properties,
        shape,
        bbox: turf.bbox(shape),
        areaKm2: turf.area(shape) / 1e6,
      };
    })
    .sort((a, b) => a.id - b.id);
}

type Ward = ReturnType<typeof loadWards>[number];

/** Borders touch or come within the tolerance. Checked both ways, then made mutual. */
function findNeighbours(wards: Ward[]): Map<number, Set<number>> {
  const toleranceKm = REAL_CITY.neighbourToleranceMetres / 1000;
  const padDegrees = (REAL_CITY.neighbourToleranceMetres * 2) / 111_000; // generous pre-filter only
  const neighbours = new Map(wards.map((w) => [w.id, new Set<number>()]));
  const buffered = new Map(wards.map((w) => [w.id, turf.buffer(w.shape, toleranceKm, { units: "kilometers" }) as Area]));
  for (let i = 0; i < wards.length; i++) {
    for (let j = i + 1; j < wards.length; j++) {
      const a = wards[i];
      const b = wards[j];
      if (!bboxesOverlap(a.bbox, b.bbox, padDegrees)) continue;
      if (turf.booleanIntersects(buffered.get(a.id)!, b.shape) || turf.booleanIntersects(buffered.get(b.id)!, a.shape)) {
        neighbours.get(a.id)!.add(b.id);
        neighbours.get(b.id)!.add(a.id);
      }
    }
  }
  return neighbours;
}

/** Share of each ward's area inside each zone. Returns the zones sorted biggest share first. */
function zoneShares(ward: Ward, zones: Array<{ id: number; shape: Area; bbox: number[] }>) {
  const shares: Array<{ zoneId: number; share: number }> = [];
  for (const zone of zones) {
    if (!bboxesOverlap(ward.bbox, zone.bbox)) continue;
    const overlap = turf.intersect(turf.featureCollection([ward.shape, zone.shape]));
    if (!overlap) continue;
    const share = turf.area(overlap) / (ward.areaKm2 * 1e6);
    if (share > 0) shares.push({ zoneId: zone.id, share });
  }
  return shares.sort((a, b) => b.share - a.share || a.zoneId - b.zoneId);
}

function loadVenues(): Feature<Point>[] {
  if (!existsSync(REAL_CITY.osmFoodFile)) {
    throw new Error(`Missing ${REAL_CITY.osmFoodFile}. Run npm run fetch-osm-food first; venues are never invented.`);
  }
  const json = JSON.parse(readFileSync(REAL_CITY.osmFoodFile, "utf8")) as { elements: OsmElement[] };
  return json.elements.flatMap((e) => {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    return lat === undefined || lon === undefined ? [] : [turf.point([lon, lat], { osm: `${e.type}/${e.id}` })];
  });
}

function main(): void {
  for (const path of [WARDS_PATH, KML_PATH]) if (!existsSync(path)) throw new Error(`Missing ${path}: stopping`);
  const wards = loadWards();
  const zoneCollection = convertZones();
  const zones = zoneCollection.features.map((f) => ({
    id: f.properties!.KGISSub_DivisionID as number,
    name: f.properties!.Sub_DivisionName as string,
    shape: f as Area,
    bbox: turf.bbox(f),
  }));

  // Neighbours, plus a nearest-centroid link for any ward left alone.
  const neighbours = findNeighbours(wards);
  const centroids = new Map(wards.map((w) => [w.id, turf.centroid(w.shape)]));
  const approximateNeighbours: CityFile["approximateNeighbours"] = [];
  for (const ward of wards) {
    if (neighbours.get(ward.id)!.size > 0) continue;
    let nearest = { id: -1, km: Infinity };
    for (const other of wards) {
      if (other.id === ward.id) continue;
      const km = turf.distance(centroids.get(ward.id)!, centroids.get(other.id)!);
      if (km < nearest.km) nearest = { id: other.id, km };
    }
    neighbours.get(ward.id)!.add(nearest.id);
    neighbours.get(nearest.id)!.add(ward.id);
    approximateNeighbours.push({ wardId: ward.id, linkedTo: nearest.id, centroidDistanceKm: round(nearest.km, 3) });
  }

  // Zones: the sub-division covering the largest share, or null under the minimum share.
  const shareByWard = new Map(wards.map((w) => [w.id, zoneShares(w, zones)]));

  // Food venues per ward (a venue outside every ward is not counted).
  const venues = loadVenues();
  const venueCount = new Map(wards.map((w) => [w.id, 0]));
  let outside = 0;
  for (const venue of venues) {
    const [lon, lat] = venue.geometry.coordinates;
    const home = wards.find((w) => lon >= w.bbox[0] && lon <= w.bbox[2] && lat >= w.bbox[1] && lat <= w.bbox[3]
      && turf.booleanPointInPolygon(venue, w.shape));
    if (home) venueCount.set(home.id, venueCount.get(home.id)! + 1);
    else outside++;
  }
  const foodWardCount = Math.round(wards.length * REAL_CITY.foodVenueTopShare);
  const byDensity = [...wards].sort((a, b) =>
    venueCount.get(b.id)! / b.areaKm2 - venueCount.get(a.id)! / a.areaKm2 || a.id - b.id);
  const foodWards = new Set(byDensity.slice(0, foodWardCount).map((w) => w.id));

  const cityWards: CityFileWard[] = wards.map((w) => {
    const best = shareByWard.get(w.id)![0];
    const [lon, lat] = centroids.get(w.id)!.geometry.coordinates;
    return {
      id: w.id,
      name: w.props.KGISWardName,
      kgisWardId: w.props.KGISWardID,
      lgdWardCode: w.props.LGD_WardCode,
      centroid: [round(lon, 6), round(lat, 6)],
      areaKm2: round(w.areaKm2, 4),
      neighbours: [...neighbours.get(w.id)!].sort((a, b) => a - b),
      zoneId: best && best.share >= REAL_CITY.minZoneShare ? best.zoneId : null,
      zoneShare: best ? round(best.share, 4) : 0,
      venueCount: venueCount.get(w.id)!,
      isFoodVenueWard: foodWards.has(w.id),
    };
  });
  const city: CityFile = {
    sources: {
      wards: `${WARDS_PATH} (BBMP wards, KGISTownCode ${wards[0].props.KGISTownCode})`,
      zones: `${KML_PATH} (BWSSB sub-divisions)`,
      foodVenues: `${REAL_CITY.osmFoodFile} (c) OpenStreetMap contributors, ODbL`,
      rules: { ...REAL_CITY, foodAmenities: [...REAL_CITY.foodAmenities] },
    },
    wards: cityWards,
    zones: zones.map((z) => ({ id: z.id, name: z.name, wardIds: cityWards.filter((w) => w.zoneId === z.id).map((w) => w.id) })),
    approximateNeighbours,
  };
  writeFileSync(REAL_CITY.cityFile, JSON.stringify(city, null, 1) + "\n");
  report(city, shareByWard, venues.length, outside);
}

function report(city: CityFile, shareByWard: Map<number, Array<{ zoneId: number; share: number }>>, venues: number, outside: number): void {
  const counts = city.wards.map((w) => w.neighbours.length);
  const second = city.wards.map((w) => shareByWard.get(w.id)![1]?.share ?? 0);
  const covered = city.wards.map((w) => shareByWard.get(w.id)!.reduce((sum, s) => sum + s.share, 0));
  const nameOf = (id: number) => city.wards.find((w) => w.id === id)!.name;
  console.log("REAL CITY BUILD");
  console.log(`  wards: ${city.wards.length}   zones: ${city.zones.length} (${city.zones.filter((z) => z.wardIds.length === 0).length} with no ward assigned)`);
  console.log(`  neighbours per ward: min ${Math.min(...counts)}, max ${Math.max(...counts)}, ` +
    `average ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
  console.log(`  isolated wards linked to nearest by centroid: ${city.approximateNeighbours.length}`);
  for (const a of city.approximateNeighbours) {
    console.log(`    - ${a.wardId} ${nameOf(a.wardId)} -> ${a.linkedTo} ${nameOf(a.linkedTo)} (${a.centroidDistanceKm} km)`);
  }
  console.log(`  zone: null (no sub-division covers ${REAL_CITY.minZoneShare * 100}%): ${city.wards.filter((w) => w.zoneId === null).length}`);
  console.log("  wards split across zones (share of the ward in its SECOND-biggest zone):");
  for (const [label, from, to] of [["under 1%", 0, 0.01], ["1-10%", 0.01, 0.1], ["10-25%", 0.1, 0.25], ["25-50%", 0.25, 0.51]] as const) {
    console.log(`    ${label.padEnd(9)} ${second.filter((s) => s >= from && s < to).length}`);
  }
  console.log(`  wards less than 90% covered by any sub-division: ${covered.filter((c) => c < 0.9).length}`);
  console.log(`  food venues: ${venues} from OSM, ${outside} outside every ward; ` +
    `${city.wards.filter((w) => w.isFoodVenueWard).length} food venue wards (top ${REAL_CITY.foodVenueTopShare * 100}% by venues per sq km)`);
  const top = [...city.wards].sort((a, b) => b.venueCount / b.areaKm2 - a.venueCount / a.areaKm2 || a.id - b.id).slice(0, 5);
  for (const w of top) {
    console.log(`    - ${w.id} ${w.name}: ${w.venueCount} venues, ${w.areaKm2.toFixed(2)} sq km, ${(w.venueCount / w.areaKm2).toFixed(0)} per sq km`);
  }
  console.log(`  wrote ${REAL_CITY.cityFile}`);
}

try {
  main();
} catch (error) {
  console.error(`build-city failed: ${String(error)}`);
  process.exit(1);
}
