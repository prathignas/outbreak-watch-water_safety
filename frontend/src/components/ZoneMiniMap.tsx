import { useId, useMemo } from "react";
import type { CityFile } from "@/lib/city";
import type { WardStatus } from "@/lib/format";
import { bboxOf, projector, wardIdOf, zoneIdOf, type GeoCollection } from "@/lib/geo";

const fill: Record<WardStatus, string> = { calm: "var(--map-calm)", watch: "var(--map-watch)", alert: "var(--map-alert)" };

/** The suspected zone's wards and their neighbours, with the zone glowing aqua (no basemap). */
export function ZoneMiniMap({ zoneId, wards, zones, city, statuses, label }: {
  zoneId: number; wards: GeoCollection; zones: GeoCollection; city: CityFile; statuses: Map<number, WardStatus>; label: string;
}) {
  const fid = useId().replace(/:/g, "");
  const view = useMemo(() => {
    const inZone = new Set(city.wards.filter((w) => w.zoneId === zoneId).map((w) => w.id));
    const around = new Set([...inZone].flatMap((id) => city.wards.find((w) => w.id === id)?.neighbours ?? []));
    const shown = wards.features.filter((f) => inZone.has(wardIdOf(f)) || around.has(wardIdOf(f)));
    const zone = zones.features.find((f) => zoneIdOf(f) === zoneId);
    if (!shown.length) return null;
    const proj = projector(bboxOf(shown), 520, 12);
    return { proj, shown, zone, inZone };
  }, [zoneId, wards, zones, city]);
  if (!view) return null;
  const { proj, shown, zone, inZone } = view;
  return (
    <svg viewBox={`0 0 520 ${proj.height.toFixed(0)}`} className="h-auto max-h-[280px] w-full" role="img" aria-label={label}>
      <defs><filter id={`glow-${fid}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" /></filter></defs>
      {shown.map((f) => {
        const id = wardIdOf(f);
        const s = statuses.get(id) ?? "calm";
        return <path key={id} d={proj.path(f)} fill={inZone.has(id) ? fill[s] : "var(--map-out)"} stroke="var(--map-line)" strokeWidth="1" />;
      })}
      {zone && <><path d={proj.path(zone)} fill="none" stroke="var(--aqua)" strokeWidth="9" opacity="0.6" filter={`url(#glow-${fid})`} /><path d={proj.path(zone)} fill="none" stroke="var(--teal)" strokeWidth="2.5" /></>}
      {shown.filter((f) => statuses.get(wardIdOf(f)) === "alert" && inZone.has(wardIdOf(f))).map((f) => {
        const w = city.wards.find((x) => x.id === wardIdOf(f));
        if (!w) return null;
        const [x, y] = proj.point(w.centroid);
        return <g key={w.id}><path d={proj.path(f)} fill="none" stroke="var(--alert-outline)" strokeWidth="2.5" /><circle cx={x} cy={y} r="6" fill="var(--alert-outline)" stroke="var(--bg)" strokeWidth="2" /></g>;
      })}
    </svg>
  );
}
