import { describe, it, expect } from "vitest";
import { GridCity } from "../src/city.js";
import {
  classifyAlert,
  classifyAlerts,
  classifyAlertsDetailed,
  onsetFromSeries,
  scoreCauses,
  softmax,
  TRIAGE_LABEL,
  type CauseFeatures,
  type ClassifierContext,
  type RainPoint,
} from "../src/classifier.js";
import { addDays, dateRange } from "../src/dates.js";
import { unknownCause } from "../src/detectors/common.js";
import { CLASSIFIER_PARAMS } from "../src/params.classifier.js";
import { SignalIndex, type IndexedRow } from "../src/scoring.js";
import { CAUSE_TYPES, SYNTHETIC_SIGNAL_TYPES, type Alert, type CauseType } from "../src/types.js";

/*
 * Tiny hand-built cases on the default 200-ward GridCity (15 pipeline zones).
 * Every normal day is 4, so with 8 weeks of history baseline = 4, spread = 2 and
 * score = (count - 4) / 2. We set pharmacy scores by hand; complaints and
 * hospital stay flat. Rain comes from a hand-made rain series.
 */
const city = new GridCity();
const TODAY = "2024-07-15";
const NORMAL = 4;
const countForScore = (score: number) => NORMAL + 2 * score;
const FIRST_DAY = addDays(TODAY, -(56 + CLASSIFIER_PARAMS.onsetWindowDays));

/** pharmacy scores: ward -> (days before today -> score). Day 0 = today. */
type ScorePlan = Map<number, Map<number, number>>;

function buildRows(plan: ScorePlan): IndexedRow[] {
  const rows: IndexedRow[] = [];
  for (const date of dateRange(FIRST_DAY, TODAY)) {
    const back = -Math.round((Date.parse(date) - Date.parse(TODAY)) / 86_400_000);
    for (const wardId of city.wardIds()) {
      for (const signalType of SYNTHETIC_SIGNAL_TYPES) {
        const score = signalType === "pharmacy" ? plan.get(wardId)?.get(back) ?? 0 : 0;
        rows.push({ wardId, signalType, date, count: countForScore(score), sourceTag: "synthetic" });
      }
    }
  }
  return rows;
}

/** Same pharmacy rise in every listed ward. rise[0] = today, rise[1] = yesterday, ... */
function plan(wards: number[], rise: number[], into: ScorePlan = new Map()): ScorePlan {
  for (const wardId of wards) into.set(wardId, new Map(rise.map((score, back) => [back, score])));
  return into;
}

const alertFor = (wardId: number, date = TODAY): Alert => ({
  wardId,
  date,
  score: 0.9,
  method: "bayes",
  contributingSignals: ["pharmacy", "complaint"],
  causeProbs: unknownCause(),
  suspectedZoneId: null,
  evidence: ["detector evidence"],
});

const dryRain: RainPoint[] = dateRange(addDays(TODAY, -30), TODAY).map((date) => ({ date, mm: 0 }));
const rainWithStorm = dryRain.map((d) => (d.date === addDays(TODAY, -3) ? { ...d, mm: 42.5 } : d));

function context(rows: IndexedRow[], recentAlerts: Alert[], rain = dryRain): ClassifierContext {
  return { city, rows: new SignalIndex(rows), rain, recentAlerts };
}

const topCause = (probs: Record<CauseType, number>): CauseType =>
  CAUSE_TYPES.reduce((best, c) => (probs[c] > probs[best] ? c : best));
const sumOf = (probs: Record<CauseType, number>) => CAUSE_TYPES.reduce((s, c) => s + probs[c], 0);

const foodWards = city.wardIds().filter((w) => city.isFoodVenueWard(w));
const isMiddle = (w: number) => city.getNeighbours(w).length === 4;
// A food ward whose neighbours are not food wards, and a plain ward in the middle of the grid.
const foodWard = foodWards.find((w) => isMiddle(w))!;
const plainWard = city.wardIds().find((w) => isMiddle(w) && !city.isFoodVenueWard(w) &&
  city.getNeighbours(w).every((n) => !city.isFoodVenueWard(n)))!;

describe("cause classifier: hand-built cases", () => {
  it("a clean zone-wide fast rise after heavy rain scores water highest and names the zone", () => {
    const zoneId = 6;
    const zoneWards = city.getWardsInZone(zoneId); // 12 wards
    const target = zoneWards.find((w) => !city.isFoodVenueWard(w))!;
    const rows = buildRows(plan(zoneWards, [6, 3])); // normal, then score 3 yesterday, 6 today
    const alerts = zoneWards.map((w) => alertFor(w));
    const hint = classifyAlert(alertFor(target), context(rows, alerts, rainWithStorm));

    expect(hint.label).toBe(TRIAGE_LABEL);
    expect(hint.features).toMatchObject({ zoneId, zoneWardCount: 12, zoneAlertingCount: 12, onsetDays: 1 });
    expect(hint.features.heavyRain).toEqual({ date: addDays(TODAY, -3), mm: 42.5 });
    expect(topCause(hint.causeProbs)).toBe("water");
    expect(hint.suspectedZoneId).toBe(zoneId);
    // Worked example: zone excess = 12/12 - 12/200 = 0.94; water = 2.5 x 0.94 + 1 (sudden) + 0.5 (rain) = 3.85
    expect(hint.points.water).toBeCloseTo(3.85, 6);
    // Other points: food 1 (sudden), p2p 0.25, seasonal 3.5 x 0.2 = 0.7, unknown 2.
    // P(water) = e^3.85 / (e^3.85 + e^1 + e^0.25 + e^0.7 + e^2) = 47.0 / 60.4 = 0.778
    const expected = Math.exp(3.85) / (Math.exp(3.85) + Math.exp(1) + Math.exp(0.25) + Math.exp(0.7) + Math.exp(2));
    expect(hint.causeProbs.water).toBeCloseTo(expected, 6);
    expect(hint.causeProbs.water).toBeCloseTo(0.778, 3);
    expect(hint.evidence.some((e) => e.startsWith(`12 of 12 wards in water zone ${zoneId}`))).toBe(true);
  });

  it("a single food venue ward with a sharp one-day jump scores food highest", () => {
    const rows = buildRows(plan([foodWard], [8]));
    const hint = classifyAlert(alertFor(foodWard), context(rows, [alertFor(foodWard)]));

    expect(hint.features).toMatchObject({ isFoodVenueWard: true, nearbyAlertingCount: 0, onsetDays: 0 });
    expect(topCause(hint.causeProbs)).toBe("food");
    expect(hint.suspectedZoneId).toBeNull();
    // food = 1.5 (food ward) + 1.5 (only this ward) + 1 (sudden) = 4
    expect(hint.points.food).toBeCloseTo(4, 6);
  });

  it("a slow rise that creeps into the neighbours scores p2p highest", () => {
    // Ward climbs over 9 days; its neighbours sit at score 2 for 8 days but never alert.
    const rows = buildRows(plan(city.getNeighbours(plainWard), [2, 2, 2, 2, 2, 2, 2, 2],
      plan([plainWard], [5, 4.5, 4, 3.5, 3, 2.5, 2, 1, 0.5])));
    const hint = classifyAlert(alertFor(plainWard), context(rows, [alertFor(plainWard)]));

    // Smoothed (3-day average) top = 4.5; the first day reaching 85% of it (3.83) is yesterday;
    // the first raw day above 1.5 was 5 days before that.
    expect(hint.features.onsetDays).toBe(5);
    expect(hint.features.neighboursElevated).toBe(4); // each averaged 16 / 14 = 1.14 > 0.75
    expect(topCause(hint.causeProbs)).toBe("p2p");
    // gradual = 1 - (6 - 5) / (6 - 2) = 0.75; p2p = 2 x 0.75 + 1 x (4/4) (spread) + 0.25 (not food ward) = 2.75
    expect(hint.points.p2p).toBeCloseTo(2.75, 1);
  });

  it("nearly every ward rising gently scores seasonal highest", () => {
    const rising = city.wardIds().filter((w) => w % 20 !== 0); // 190 of 200 wards
    const rows = buildRows(plan(rising, [3, 2.75, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.5]));
    const alerts = rising.filter((w) => w % 3 === 0).map((w) => alertFor(w)); // about a third alert
    const target = rising.find((w) => w % 3 === 0 && !city.isFoodVenueWard(w))!;
    const hint = classifyAlert(alertFor(target), context(rows, alerts));

    expect(hint.features.cityAlertShare).toBeGreaterThan(0.3);
    expect(hint.features.cityElevatedShare).toBeGreaterThan(0.9);
    expect(topCause(hint.causeProbs)).toBe("seasonal");
    // A city-wide wave fills every zone equally, so no single zone is blamed.
    expect(hint.suspectedZoneId).toBeNull();
  });

  it("weak, mixed evidence scores unknown highest", () => {
    // A plain ward with a mild 4-day rise, one alerting neighbour, no rain, no spread.
    const neighbour = city.getNeighbours(plainWard)[0];
    const rows = buildRows(plan([plainWard], [2.5, 2, 2, 2, 1.6]));
    const hint = classifyAlert(alertFor(plainWard), context(rows, [alertFor(plainWard), alertFor(neighbour)]));

    // Smoothed top 2.17; the first day reaching 85% of it (1.84) is the 3rd risen day, 2 days after the first.
    expect(hint.features.onsetDays).toBe(2);
    expect(topCause(hint.causeProbs)).toBe("unknown");
    expect(hint.evidence.some((e) => e.startsWith("evidence is mixed"))).toBe(true);
  });

  it("an alert with no clear rise at all stays unknown", () => {
    const rows = buildRows(new Map());
    const hint = classifyAlert(alertFor(plainWard), context(rows, []));
    expect(hint.features.onsetDays).toBeNull();
    expect(topCause(hint.causeProbs)).toBe("unknown");
  });
});

describe("cause classifier: probabilities and plumbing", () => {
  it("probabilities always sum to 1 and stay in 0..1, across many random feature sets", () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const zoneWardCount = 1 + Math.floor(random() * 20);
      const features: CauseFeatures = {
        alertingWardCount: Math.floor(random() * 200),
        cityAlertShare: random(),
        cityElevatedShare: random(),
        zoneId: random() < 0.2 ? null : 3,
        zoneWardCount,
        zoneAlertingCount: Math.floor(random() * (zoneWardCount + 1)),
        zoneAlertShare: random(),
        isFoodVenueWard: random() < 0.5,
        nearbyAlertingCount: Math.floor(random() * 5),
        onsetDays: random() < 0.2 ? null : Math.floor(random() * 14),
        peakScore: random() * 10,
        neighbourCount: 1 + Math.floor(random() * 6),
        neighboursElevated: Math.floor(random() * 4),
        heavyRain: random() < 0.3 ? { date: TODAY, mm: 30 } : null,
      };
      const probs = softmax(scoreCauses(features).points);
      expect(sumOf(probs)).toBeCloseTo(1, 12);
      for (const c of CAUSE_TYPES) {
        expect(probs[c]).toBeGreaterThanOrEqual(0);
        expect(probs[c]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("softmax worked example: points 2 and 0 give e^2 / (e^2 + 4)", () => {
    const probs = softmax({ water: 2, food: 0, p2p: 0, seasonal: 0, unknown: 0 });
    expect(probs.water).toBeCloseTo(Math.exp(2) / (Math.exp(2) + 4), 12); // 0.649
    expect(sumOf(probs)).toBeCloseTo(1, 12);
  });

  it("onset: peak, then walk back over risen days, allowing one quiet day", () => {
    expect(onsetFromSeries([0, 0, 2, 4, 8], 1.5)).toEqual({ onsetDays: 2, peakScore: 8 });
    expect(onsetFromSeries([0, 2, 0, 3, 5], 1.5)).toEqual({ onsetDays: 3, peakScore: 5 }); // one dip allowed
    expect(onsetFromSeries([2, 0, 0, 3, 5], 1.5)).toEqual({ onsetDays: 1, peakScore: 5 }); // two quiet days stop it
    expect(onsetFromSeries([0, 1, 0.5], 1.5)).toEqual({ onsetDays: null, peakScore: 1 });
    expect(onsetFromSeries([null, null], 1.5)).toEqual({ onsetDays: null, peakScore: null });
  });

  it("onset: one noisy day on a plateau no longer resets the peak (fix of 2026-10-06)", () => {
    // A 2-day climb to a plateau of 6. Smoothed top 6, line 85% = 5.1, first reached on day 5: onset 3.
    const plateau = [0, 0, 3, 6, 6, 6, 6, 6, 6];
    const noisy = [0, 0, 3, 6, 6, 6, 6, 9, 6]; // one noisy high day late on
    expect(onsetFromSeries(plateau, 1.5).onsetDays).toBe(3);
    expect(onsetFromSeries(noisy, 1.5).onsetDays).toBe(3); // the old rule made the 9 the peak: onset 5
    expect(onsetFromSeries(noisy, 1.5).peakScore).toBe(9);
  });

  it("classifyAlerts fills causeProbs and suspectedZoneId only, and does not change its input", () => {
    const zoneWards = city.getWardsInZone(6);
    const rows = buildRows(plan(zoneWards, [6, 3]));
    const alerts = zoneWards.map((w) => alertFor(w));
    const before = structuredClone(alerts);
    const out = classifyAlerts(alerts, { city, rows, rain: rainWithStorm, recentAlerts: [] });

    expect(alerts).toEqual(before);
    expect(out).toHaveLength(alerts.length);
    out.forEach((alert, i) => {
      const { causeProbs, suspectedZoneId, ...rest } = alert;
      const { causeProbs: _p, suspectedZoneId: _z, ...restBefore } = before[i];
      expect(rest).toEqual(restBefore); // evidence stays the detector's own, unchanged
      expect(sumOf(causeProbs)).toBeCloseTo(1, 12);
      expect(topCause(causeProbs)).toBe("water"); // a food ward in the zone gets food 2.5, still below water 3.85
      expect(suspectedZoneId).toBe(6);
    });
  });

  it("classifyAlertsDetailed returns the classifier's reasons separately as causeEvidence", () => {
    const zoneWards = city.getWardsInZone(6);
    const rows = buildRows(plan(zoneWards, [6, 3]));
    const alerts = zoneWards.map((w) => alertFor(w));
    const out = classifyAlertsDetailed(alerts, { city, rows, rain: rainWithStorm, recentAlerts: [] });
    out.forEach(({ alert, causeEvidence }, i) => {
      expect(alert.evidence).toEqual(alerts[i].evidence);
      expect(alert).toEqual(classifyAlerts(alerts, { city, rows, rain: rainWithStorm, recentAlerts: [] })[i]);
      expect(causeEvidence.at(-1)).toContain(`${TRIAGE_LABEL}, not a diagnosis`);
      expect(causeEvidence.some((e) => e.startsWith("12 of 12 wards in water zone 6"))).toBe(true);
    });
  });

  it("ignores alerts, rows and rain from after the alert's date", () => {
    const rows = buildRows(plan([foodWard], [8]));
    const base = classifyAlert(alertFor(foodWard), context(rows, [alertFor(foodWard)]));

    // Tomorrow: the whole zone alerts, it pours, and every ward's numbers explode.
    const tomorrow = addDays(TODAY, 1);
    const futureRows = [...rows, ...city.wardIds().flatMap((wardId) => SYNTHETIC_SIGNAL_TYPES.map((signalType) =>
      ({ wardId, signalType, date: tomorrow, count: 999, sourceTag: "synthetic" as const })))];
    const zoneAlerts = city.getWardsInZone(city.getZoneOfWard(foodWard)!).map((w) => alertFor(w, tomorrow));
    const futureRain = [...dryRain, { date: tomorrow, mm: 90 }];
    const withFuture = classifyAlert(alertFor(foodWard), context(futureRows, [alertFor(foodWard), ...zoneAlerts], futureRain));

    expect(withFuture.causeProbs).toEqual(base.causeProbs);
    expect(withFuture.features).toEqual(base.features);
  });
});
