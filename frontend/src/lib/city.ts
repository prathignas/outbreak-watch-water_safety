/* The city model (handoff/city.json), served as a static file. Shape mirrors CityFile in the
 * detection module (src/city.ts); only the fields the screens use are listed. */
export interface CityWard {
  id: number;
  name: string;
  centroid: [number, number];
  areaKm2: number;
  neighbours: number[];
  zoneId: number | null;
  zoneShare: number;
  venueCount: number;
  isFoodVenueWard: boolean;
}
export interface CityFile {
  wards: CityWard[];
  zones: Array<{ id: number; name: string; wardIds: number[] }>;
}

export function cityLookup(city: CityFile | undefined) {
  const wards = new Map((city?.wards ?? []).map((w) => [w.id, w]));
  const zones = new Map((city?.zones ?? []).map((z) => [z.id, z]));
  return {
    ward: (id: number) => wards.get(id),
    wardName: (id: number) => wards.get(id)?.name ?? `Ward ${id}`,
    zone: (id: number | null | undefined) => (id === null || id === undefined ? undefined : zones.get(id)),
    zoneLabel: (id: number | null | undefined) => {
      if (id === null || id === undefined) return "no water zone";
      const z = zones.get(id);
      return z ? `zone ${z.name}` : `zone ${id}`;
    },
    wards: city?.wards ?? [],
  };
}
