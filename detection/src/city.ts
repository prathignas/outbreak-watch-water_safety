import { readFileSync } from "node:fs";
import { GRID_CITY } from "./params.js";
import { seededRandom, shuffle } from "./random.js";

/**
 * Everything the detector and cause classifier need to know about the city's layout.
 * Kept as an interface so a real PostGIS-backed version can replace GridCity
 * later without changing any detector code.
 */
export interface CityModel {
  /** Every ward id in the city. */
  wardIds(): number[];
  /** Wards that share a border with this ward. */
  getNeighbours(wardId: number): number[];
  /** The water pipeline zone this ward is supplied by, or null if unknown. */
  getZoneOfWard(wardId: number): number | null;
  /** Every ward supplied by this pipeline zone (empty if the zone does not exist). */
  getWardsInZone(zoneId: number): number[];
  /** True if the ward has a busy food market or street, where food outbreaks are likelier. */
  isFoodVenueWard(wardId: number): boolean;
}

export type GridCityConfig = typeof GRID_CITY;

/**
 * A pretend city laid out as a grid, for the simulator, tests and backtest.
 * Ward id = row * columns + column, so with 20 columns ward 0 is top-left,
 * ward 19 is top-right, and ward 20 is directly below ward 0.
 *
 * Pipeline zones: the grid is cut into zoneColumns x zoneRows rectangles.
 * A rectangle is always one connected block, and the cut is the same every run.
 * When rows or columns do not divide evenly, the last band takes the leftovers.
 */
export class GridCity implements CityModel {
  private readonly columns: number;
  private readonly rows: number;
  private readonly neighbours: number[][];
  private readonly zoneOfWard: number[];
  private readonly wardsInZone: Map<number, number[]>;
  private readonly foodVenueWards: Set<number>;

  constructor(config: GridCityConfig = GRID_CITY) {
    this.columns = config.columns;
    this.rows = config.rows;
    const wardCount = this.columns * this.rows;

    this.neighbours = [];
    this.zoneOfWard = [];
    this.wardsInZone = new Map();

    const zoneWidth = Math.floor(this.columns / config.zoneColumns);
    const zoneHeight = Math.floor(this.rows / config.zoneRows);

    for (let wardId = 0; wardId < wardCount; wardId++) {
      const row = Math.floor(wardId / this.columns);
      const column = wardId % this.columns;

      const wardNeighbours: number[] = [];
      if (row > 0) wardNeighbours.push(wardId - this.columns); // up
      if (row < this.rows - 1) wardNeighbours.push(wardId + this.columns); // down
      if (column > 0) wardNeighbours.push(wardId - 1); // left
      if (column < this.columns - 1) wardNeighbours.push(wardId + 1); // right
      this.neighbours.push(wardNeighbours);

      const zoneRow = Math.min(Math.floor(row / zoneHeight), config.zoneRows - 1);
      const zoneColumn = Math.min(Math.floor(column / zoneWidth), config.zoneColumns - 1);
      const zoneId = zoneRow * config.zoneColumns + zoneColumn;
      this.zoneOfWard.push(zoneId);
      const zoneWards = this.wardsInZone.get(zoneId) ?? [];
      zoneWards.push(wardId);
      this.wardsInZone.set(zoneId, zoneWards);
    }

    const foodVenueCount = Math.round(wardCount * config.foodVenueShare);
    const allWards = Array.from({ length: wardCount }, (_, wardId) => wardId);
    const shuffled = shuffle(allWards, seededRandom(config.randomSeed));
    this.foodVenueWards = new Set(shuffled.slice(0, foodVenueCount));
  }

  wardIds(): number[] {
    return Array.from({ length: this.neighbours.length }, (_, wardId) => wardId);
  }

  getNeighbours(wardId: number): number[] {
    this.assertWard(wardId);
    return [...this.neighbours[wardId]];
  }

  getZoneOfWard(wardId: number): number | null {
    this.assertWard(wardId);
    return this.zoneOfWard[wardId];
  }

  getWardsInZone(zoneId: number): number[] {
    return [...(this.wardsInZone.get(zoneId) ?? [])];
  }

  isFoodVenueWard(wardId: number): boolean {
    this.assertWard(wardId);
    return this.foodVenueWards.has(wardId);
  }

  /** A wrong ward id is a bug in the caller, so fail loudly instead of guessing. */
  private assertWard(wardId: number): void {
    if (!Number.isInteger(wardId) || wardId < 0 || wardId >= this.neighbours.length) {
      throw new RangeError(`Unknown ward id: ${wardId}`);
    }
  }
}

/** One ward in data/city.json (built by scripts/buildCity.ts). */
export interface CityFileWard {
  /** KGISWardNo from the BBMP ward file. */
  id: number;
  name: string;
  kgisWardId: number;
  lgdWardCode: number;
  /** [longitude, latitude]. */
  centroid: [number, number];
  areaKm2: number;
  /** Includes any nearest-centroid link listed in approximateNeighbours. */
  neighbours: number[];
  /** BWSSB sub-division (KGISSub_DivisionID) covering the largest share, or null under REAL_CITY.minZoneShare. */
  zoneId: number | null;
  /** Share of the ward inside its biggest sub-division (0 to 1), even when zoneId is null. */
  zoneShare: number;
  /** OpenStreetMap food venues inside the ward. */
  venueCount: number;
  isFoodVenueWard: boolean;
}

/** The whole of data/city.json. */
export interface CityFile {
  sources: Record<string, unknown>;
  wards: CityFileWard[];
  zones: Array<{ id: number; name: string; wardIds: number[] }>;
  /** Wards with no border neighbour, linked to their nearest ward by centroid instead. */
  approximateNeighbours: Array<{ wardId: number; linkedTo: number; centroidDistanceKm: number }>;
}

export const DEFAULT_CITY_PATH = new URL("../data/city.json", import.meta.url);

/**
 * Real Bengaluru: 243 BBMP wards, BWSSB water sub-divisions and OpenStreetMap
 * food venues, read from data/city.json. Same interface as GridCity, so the
 * simulator and detectors run on it unchanged.
 */
export class RealCity implements CityModel {
  private readonly wards: Map<number, CityFileWard>;
  private readonly wardsInZone: Map<number, number[]>;

  constructor(readonly data: CityFile) {
    this.wards = new Map(data.wards.map((ward) => [ward.id, ward]));
    this.wardsInZone = new Map(data.zones.map((zone) => [zone.id, [...zone.wardIds]]));
  }

  static fromFile(path: string | URL = DEFAULT_CITY_PATH): RealCity {
    return new RealCity(JSON.parse(readFileSync(path, "utf8")) as CityFile);
  }

  wardIds(): number[] {
    return [...this.wards.keys()];
  }

  getNeighbours(wardId: number): number[] {
    return [...this.ward(wardId).neighbours];
  }

  getZoneOfWard(wardId: number): number | null {
    return this.ward(wardId).zoneId;
  }

  getWardsInZone(zoneId: number): number[] {
    return [...(this.wardsInZone.get(zoneId) ?? [])];
  }

  isFoodVenueWard(wardId: number): boolean {
    return this.ward(wardId).isFoodVenueWard;
  }

  wardName(wardId: number): string {
    return this.ward(wardId).name;
  }

  private ward(wardId: number): CityFileWard {
    const ward = this.wards.get(wardId);
    if (!ward) throw new RangeError(`Unknown ward id: ${wardId}`);
    return ward;
  }
}
