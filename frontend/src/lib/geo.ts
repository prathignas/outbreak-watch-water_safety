import { useQuery } from "@tanstack/react-query";

/* Ward (DataMeet BBMP) and BWSSB zone shapes, loaded once from the static files. */
export interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
}
export interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

async function load(file: string): Promise<GeoCollection> {
  const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
  if (!res.ok) throw new Error(`Could not load ${file}.`);
  return (await res.json()) as GeoCollection;
}

export const useWardsGeo = () => useQuery({ queryKey: ["geo", "wards"], queryFn: () => load("wards.geojson"), staleTime: Infinity });
export const useZonesGeo = () => useQuery({ queryKey: ["geo", "zones"], queryFn: () => load("zones.geojson"), staleTime: Infinity });

export const wardIdOf = (f: GeoFeature) => Number(f.properties.KGISWardNo);
export const zoneIdOf = (f: GeoFeature) => Number(f.properties.KGISSub_DivisionID);

export function rings(f: GeoFeature): number[][][] {
  return f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
}

export function bboxOf(features: GeoFeature[]): [number, number, number, number] {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) for (const ring of rings(f)) for (const [x, y] of ring) {
    w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

/** Simple equirectangular projection into a W x H box, corrected for latitude. */
export function projector(bbox: [number, number, number, number], width: number, pad = 8) {
  const [w, s, e, n] = bbox;
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const scale = (width - 2 * pad) / ((e - w) * kx);
  const height = (n - s) * scale + 2 * pad;
  return {
    height,
    path: (f: GeoFeature) => rings(f).map((ring) => "M" + ring.map(([x, y]) => `${(pad + (x - w) * kx * scale).toFixed(1)},${(pad + (n - y) * scale).toFixed(1)}`).join("L") + "Z").join(""),
    point: ([x, y]: [number, number]) => [pad + (x - w) * kx * scale, pad + (n - y) * scale] as const,
  };
}
