import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WardRisk } from "@/api/types";
import { cityLookup, type CityFile } from "@/lib/city";
import { pct, STATUS_LABEL, type WardStatus } from "@/lib/format";
import { bboxOf, wardIdOf, type GeoCollection } from "@/lib/geo";

/* OpenFreeMap: no key, no limits, attribution added by MapLibre (terms checked 2026-10-06).
 * If its style cannot load, fall back to plain OSM raster tiles with OSM attribution. */
const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const OSM_FALLBACK: StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface CityMapProps {
  wards: GeoCollection;
  zones: GeoCollection;
  city: CityFile;
  statuses: Map<number, WardStatus>;
  risk: WardRisk[] | undefined;
  suspectedZones: number[];
  /** Wards whose alert just appeared: they pulse once. */
  newAlertWards?: number[];
  selectedWard?: number | null;
  onSelectWard?: (wardId: number) => void;
  theme: "light" | "dark";
  label: string;
}

export function CityMap({ wards, zones, city, statuses, risk, suspectedZones, newAlertWards = [], selectedWard, onSelectWard, theme, label }: CityMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const lookup = cityLookup(city);
  const riskById = useMemo(() => new Map((risk ?? []).map((r) => [r.wardId, r.probability])), [risk]);
  const onSelect = useRef(onSelectWard);
  onSelect.current = onSelectWard;

  const wardData = useMemo<GeoCollection>(() => ({
    type: "FeatureCollection",
    features: wards.features.map((f) => {
      const id = wardIdOf(f);
      return { ...f, properties: { wardId: id, name: lookup.wardName(id), status: statuses.get(id) ?? "calm" } };
    }),
  }), [wards, statuses, lookup]);
  const markerData = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: city.wards.filter((w) => statuses.get(w.id) === "alert").map((w) => ({ type: "Feature" as const, properties: { wardId: w.id }, geometry: { type: "Point" as const, coordinates: w.centroid } })),
  }), [city, statuses]);

  // Create the map (again when the theme changes, so tile style and colours follow it).
  useEffect(() => {
    if (!box.current) return;
    setReady(false);
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE[theme],
      bounds: bboxOf(wards.features) as [number, number, number, number],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: false },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    let fellBack = false;
    map.on("error", (e) => {
      const message = String((e as unknown as { error?: Error }).error?.message ?? "");
      if (!fellBack && !map.isStyleLoaded() && /style|fetch|load/i.test(message)) {
        fellBack = true;
        setReady(false);
        map.setStyle(OSM_FALLBACK);
      }
    });
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "ow-popup", offset: 12 });
    // Layers are (re)added on every style load, so they survive the OSM fallback.
    map.on("style.load", () => {
      if (map.getSource("wards")) return;
      const c = { calm: css("--map-calm"), watch: css("--map-watch"), alert: css("--map-alert"), line: css("--map-line"), outline: css("--alert-outline"),
        watchInk: css("--watch-ink"), zone: css("--muted"), aqua: css("--aqua"), teal: css("--teal"), ink: css("--ink"), bg: css("--bg") };
      map.addSource("wards", { type: "geojson", data: wardData as never });
      map.addSource("zones", { type: "geojson", data: zones as never });
      map.addSource("markers", { type: "geojson", data: markerData });
      map.addLayer({ id: "ward-fill", type: "fill", source: "wards", paint: {
        "fill-color": ["match", ["get", "status"], "alert", c.alert, "watch", c.watch, c.calm],
        "fill-opacity": ["match", ["get", "status"], "calm", 0.55, 0.85] } });
      map.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": c.line, "line-width": 0.6 } });
      map.addLayer({ id: "watch-outline", type: "line", source: "wards", filter: ["==", ["get", "status"], "watch"],
        paint: { "line-color": c.watchInk, "line-width": 1.5, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "zone-line", type: "line", source: "zones", paint: { "line-color": c.zone, "line-width": 1, "line-opacity": 0.7 } });
      map.addLayer({ id: "suspect-glow", type: "line", source: "zones", filter: ["in", ["get", "KGISSub_DivisionID"], ["literal", suspectedZones]],
        paint: { "line-color": c.aqua, "line-width": 10, "line-blur": 6, "line-opacity": 0.7 } });
      map.addLayer({ id: "suspect-line", type: "line", source: "zones", filter: ["in", ["get", "KGISSub_DivisionID"], ["literal", suspectedZones]],
        paint: { "line-color": c.teal, "line-width": 2.5 } });
      map.addLayer({ id: "alert-outline", type: "line", source: "wards", filter: ["==", ["get", "status"], "alert"], paint: { "line-color": c.outline, "line-width": 2.5 } });
      map.addLayer({ id: "selected", type: "line", source: "wards", filter: ["==", ["get", "wardId"], selectedWard ?? -1], paint: { "line-color": c.ink, "line-width": 3 } });
      map.addLayer({ id: "alert-marker", type: "circle", source: "markers", paint: { "circle-radius": 6, "circle-color": c.outline, "circle-stroke-color": c.bg, "circle-stroke-width": 2 } });
      if (fellBack && theme === "dark") map.setPaintProperty("osm", "raster-brightness-max", 0.45);
      setReady(true);
    });
    map.on("mousemove", "ward-fill", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      const id = Number(f.properties.wardId);
      const w = lookup.ward(id);
      const status = f.properties.status as WardStatus;
      const p = riskById.get(id);
      popup.setLngLat(e.lngLat).setHTML(
        `<b>${esc(lookup.wardName(id))}</b><br>Ward ${id}, ${esc(lookup.zoneLabel(w?.zoneId))}<br>${STATUS_LABEL[status]}${p !== undefined ? `, relative risk ${pct(p)}` : ""}`,
      ).addTo(map);
    });
    map.on("mouseleave", "ward-fill", () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("click", "ward-fill", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f) onSelect.current?.(Number(f.properties.wardId));
    });
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // Recreated only for a theme change; data updates are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, wards, zones]);

  // Push data changes without recreating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("wards") as GeoJSONSource | undefined)?.setData(wardData as never);
    (map.getSource("markers") as GeoJSONSource | undefined)?.setData(markerData);
    const filter = ["in", ["get", "KGISSub_DivisionID"], ["literal", suspectedZones]];
    map.setFilter("suspect-glow", filter as never);
    map.setFilter("suspect-line", filter as never);
    map.setFilter("selected", ["==", ["get", "wardId"], selectedWard ?? -1]);
  }, [ready, wardData, markerData, suspectedZones, selectedWard]);

  // A new alert pulses once on its ward (skipped under reduced motion by CSS).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || newAlertWards.length === 0) return;
    const markers = newAlertWards.flatMap((id) => {
      const w = lookup.ward(id);
      if (!w) return [];
      const el = document.createElement("div");
      el.className = "ow-pulse";
      el.setAttribute("aria-hidden", "true");
      return [new maplibregl.Marker({ element: el }).setLngLat(w.centroid).addTo(map)];
    });
    const t = setTimeout(() => markers.forEach((m) => m.remove()), 1400);
    return () => {
      clearTimeout(t);
      markers.forEach((m) => m.remove());
    };
  }, [ready, newAlertWards, lookup]);

  return <div ref={box} className="h-full min-h-[22.5rem] w-full overflow-hidden rounded-card" role="region" aria-label={label} tabIndex={0} />;
}

