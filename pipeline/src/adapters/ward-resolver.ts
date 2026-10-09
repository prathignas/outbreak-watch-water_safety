/**
 * Geographic coordinates (WGS84).
 */
export interface GeoLocation {
  latitude: number;
  longitude: number;
}

/**
 * Interface for resolving coordinates to an integer ward ID.
 * Decouples complaint ingestion from future PostGIS / spatial database implementations.
 */
export interface WardResolver {
  /**
   * Resolves coordinates to a ward ID.
   * Returns positive integer ward ID if found, or null if outside covered boundaries.
   */
  resolveWard(location: GeoLocation): Promise<number | null> | number | null;
}

/**
 * In-memory implementation of WardResolver for testing and local development.
 */
export class InMemoryWardResolver implements WardResolver {
  private readonly points = new Map<string, number>();
  private readonly boundingBoxes: Array<{
    wardId: number;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }> = [];

  /**
   * Maps an exact latitude/longitude coordinate pair to a ward ID.
   */
  setPoint(latitude: number, longitude: number, wardId: number): this {
    this.points.set(`${latitude},${longitude}`, wardId);
    return this;
  }

  /**
   * Defines a rectangular bounding box mapping to a ward ID.
   */
  addBoundingBox(
    wardId: number,
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number
  ): this {
    this.boundingBoxes.push({ wardId, minLat, maxLat, minLng, maxLng });
    return this;
  }

  resolveWard(location: GeoLocation): number | null {
    // 1. Direct point match
    const pointMatch = this.points.get(`${location.latitude},${location.longitude}`);
    if (pointMatch !== undefined) {
      return pointMatch;
    }

    // 2. Bounding box match
    for (const box of this.boundingBoxes) {
      if (
        location.latitude >= box.minLat &&
        location.latitude <= box.maxLat &&
        location.longitude >= box.minLng &&
        location.longitude <= box.maxLng
      ) {
        return box.wardId;
      }
    }

    return null;
  }
}
