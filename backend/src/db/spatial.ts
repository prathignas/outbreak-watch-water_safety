/**
 * Spatial helper functions for PostGIS and in-memory geometry computations.
 */

export interface Point {
  lng: number;
  lat: number;
}

/**
 * Checks if a point [lng, lat] is inside a polygon ring using the ray-casting algorithm.
 */
export function isPointInRing(point: Point, ring: number[][]): boolean {
  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Checks if a point is inside a GeoJSON MultiPolygon (or Polygon: P1's ward and zone files use Polygon).
 */
export function isPointInMultiPolygon(point: Point, multiPolygon: any): boolean {
  if (!multiPolygon) return false;
  const polygons = multiPolygon.type === "MultiPolygon" ? multiPolygon.coordinates : multiPolygon.type === "Polygon" ? [multiPolygon.coordinates] : [];

  for (const polygon of polygons) {
    if (polygon.length > 0 && isPointInRing(point, polygon[0])) {
      // Point inside exterior ring; verify not in any interior rings (holes)
      let inHole = false;
      for (let h = 1; h < polygon.length; h++) {
        if (isPointInRing(point, polygon[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }

  return false;
}
