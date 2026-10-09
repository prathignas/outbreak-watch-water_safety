import { readFileSync, writeFileSync } from "node:fs";
import * as turf from "@turf/turf";
import { RealCity } from "../../src/city.js";
import { addDays, dateRange } from "../../src/dates.js";
import { describeInjection, generateHistory, generateLiveDay } from "../../src/live.js";
import { LIVE } from "../../src/params.live.js";
import { emptyDetectorState, runDetector, RUN_DETECTOR_PARAMS, wardRisk, type DetectorState } from "../../src/runDetector.js";
import { SignalIndex, type IndexedRow } from "../../src/scoring.js";

/*
 * Data for the design mockups only. Same scenario as handoff/sample-run-detector.json
 * (seed 2026, water outbreak in ward 18 from 2026-07-06), plus REAL Open-Meteo rain
 * for 2026 (seed/rain-2026.json). Every number on the mockups comes from this file.
 */
const SEED = 2026, START = "2026-07-06", TODAY = "2026-07-08";
const city = RealCity.fromFile();
const inject = { injectOutbreak: "water" as const, wardId: 18, startDate: START, city };
const injection = describeInjection(START, SEED, inject)!;
const rainJson = JSON.parse(readFileSync("frontend/seed/rain-2026.json", "utf8"));
const rain: Array<{ date: string; mm: number }> = rainJson.daily.time.map((d: string, i: number) => ({ date: d, mm: rainJson.daily.precipitation_sum[i] }));
const firstDay = addDays(START, -LIVE.recommendedHistoryDays - 56);
const rainRows: IndexedRow[] = rain.filter((r) => r.date >= firstDay && r.date <= TODAY)
  .flatMap((r) => city.wardIds().map((wardId) => ({ wardId, signalType: "rain" as const, date: r.date, count: r.mm, sourceTag: "real" as const, reportedOn: r.date })));
const rows: IndexedRow[] = [
  ...generateHistory(START, LIVE.recommendedHistoryDays + 56, SEED, { city }),
  ...dateRange(START, TODAY).flatMap((d) => generateLiveDay(d, SEED, inject)),
  ...rainRows,
];
const index = new SignalIndex(rows);

let state: DetectorState = emptyDetectorState();
const alerts: unknown[] = [];
for (const today of dateRange(addDays(TODAY, -7), TODAY)) {
  const out = runDetector(index, today, city, RUN_DETECTOR_PARAMS, state);
  state = out.state;
  alerts.push(...out.alerts.map((a) => ({ ...a, causeEvidence: out.causeEvidence[String(a.wardId)] })));
}
// Relative risk for every ward: wardRisk(), the same Bayes code path as runDetector.
const probability = Object.fromEntries(wardRisk(index, TODAY, city).map((r) => [r.wardId, r.probability]));

// Ward shapes, simplified and projected for SVG.
const wards = JSON.parse(readFileSync("data/wards.geojson", "utf8"));
const zones = JSON.parse(readFileSync("data/zones.geojson", "utf8"));
const bbox = turf.bbox(wards);
const W = 1000, H = Math.round(W * ((bbox[3] - bbox[1]) / (bbox[2] - bbox[0])) / Math.cos((13 * Math.PI) / 180));
const px = ([x, y]: number[]) => `${(((x - bbox[0]) / (bbox[2] - bbox[0])) * W).toFixed(1)},${(((bbox[3] - y) / (bbox[3] - bbox[1])) * H).toFixed(1)}`;
const pathOf = (g: any) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
  .map((poly: number[][][]) => poly.map((ring) => "M" + ring.map(px).join("L") + "Z").join("")).join("");
const simp = (f: any) => turf.simplify(f, { tolerance: 0.0004, highQuality: true });
const wardPaths = wards.features.map((f: any) => ({ id: Number(f.properties.KGISWardNo), d: pathOf(simp(f).geometry) }));
const zonePaths = zones.features.map((f: any) => ({ id: f.properties.KGISSub_DivisionID, name: f.properties.Sub_DivisionName, d: pathOf(simp(f).geometry) }));

// 8 weeks of daily counts + same-weekday median of the previous 8 weeks, for ward 39 (the strongest alert).
const series = (wardId: number) => Object.fromEntries((["complaint", "pharmacy", "hospital"] as const).map((signal) => {
  const days = dateRange(addDays(TODAY, -55), TODAY);
  const view = index.asOf(TODAY);
  return [signal, days.map((date) => {
    const hist = Array.from({ length: 8 }, (_, w) => view.count(wardId, signal, addDays(date, -7 * (w + 1)))).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
    const med = hist.length ? (hist.length % 2 ? hist[(hist.length - 1) / 2] : (hist[hist.length / 2 - 1] + hist[hist.length / 2]) / 2) : null;
    const row = rows.find((r) => r.wardId === wardId && r.signalType === signal && r.date === date) as IndexedRow | undefined;
    return { date, count: view.count(wardId, signal, date) ?? null, normal: med, reportedOn: row?.reportedOn ?? null };
  })];
}));
const todayRows = rows.filter((r) => r.date === TODAY && r.signalType !== "rain");
const missingToday = new Set(todayRows.filter((r) => (r.reportedOn ?? r.date) > TODAY).map((r) => r.wardId)).size;

writeFileSync("frontend/design/mockup-data.json", JSON.stringify({
  today: TODAY, injection, alerts, probability, missingToday, wardsTotal: city.wardIds().length,
  rain: rain.filter((r) => r.date >= addDays(TODAY, -13) && r.date <= TODAY),
  city: city.data.wards.map((w) => ({ id: w.id, name: w.name, zoneId: w.zoneId, neighbours: w.neighbours, centroid: w.centroid })),
  zoneNames: Object.fromEntries(city.data.zones.map((z) => [z.id, z.name])),
  map: { W, H, wardPaths, zonePaths }, series39: series(39),
}));
console.log("alerts", (alerts as any[]).map((a) => `${a.date} w${a.wardId} ${a.score.toFixed(2)} z${a.suspectedZoneId}`).join(" | "));
console.log("missing today", missingToday, "map", W, H);
