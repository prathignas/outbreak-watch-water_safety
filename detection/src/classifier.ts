import type { CityModel } from "./city.js";
import { addDays } from "./dates.js";
import { DETECTOR_PARAMS, type DetectorParams } from "./params.js";
import { CLASSIFIER_PARAMS, type ClassifierParams } from "./params.classifier.js";
import { HEALTH_SIGNALS, scoreSignal, SignalIndex, viewAsOf, type SignalInput, type SignalView } from "./scoring.js";
import { CAUSE_TYPES, type Alert, type CauseType } from "./types.js";

/*
 * The cause classifier: a TRIAGE HINT, not a diagnosis.
 *
 * For one alert it looks at the shape of what is happening around it and
 * guesses which kind of outbreak it most looks like: water (a pipeline
 * zone), food (one venue), p2p (person to person), seasonal (city-wide), or
 * unknown. An officer still has to check.
 *
 * How it works:
 *   1. Measure a few plain features (below), using only data up to the
 *      alert's date (every read goes through a SignalView, which refuses the future).
 *   2. Each cause collects points from simple rules ("food venue ward" -> food +1.5).
 *   3. "unknown" always starts with some points, and gets more if the top two
 *      causes are close, so weak or mixed evidence stays "unknown".
 *   4. Points become probabilities with a softmax: p = exp(points) / sum of exp(points).
 */

export const TRIAGE_LABEL = "triage hint" as const;

/** One day of real rain (same shape as RainDay in realRain.ts, so P2's feed fits directly). */
export interface RainPoint {
  date: string;
  mm: number;
}

export interface ClassifierContext {
  city: CityModel;
  /** Recent rows: enough for the baselines (8 weeks) plus the last 2 weeks. Plain rows, an index or a view. */
  rows: SignalInput;
  /** Real daily rain. Days after the alert's date are ignored. */
  rain: readonly RainPoint[];
  /** Alerts from the same day and the last few days (any method). Alerts after the alert's date are ignored. */
  recentAlerts: readonly Alert[];
  params?: ClassifierParams;
  detectorParams?: DetectorParams;
}

/** The measured features, kept so tests, the evaluation and the evidence text can show them. */
export interface CauseFeatures {
  /** Distinct wards with an alert in the active window, city-wide. */
  alertingWardCount: number;
  /** alertingWardCount / all wards. */
  cityAlertShare: number;
  /** Share of all wards whose average score over the last few days is above the "quietly elevated" line. */
  cityElevatedShare: number;
  /** The pipeline zone looked at: the ward's own, or (if it has none) its neighbours' busiest. */
  zoneId: number | null;
  zoneWardCount: number;
  /** Alerting wards inside that zone. */
  zoneAlertingCount: number;
  /** zoneAlertingCount / zoneWardCount (0 when there is no zone). */
  zoneAlertShare: number;
  isFoodVenueWard: boolean;
  /** Other alerting wards that are neighbours or in the same zone. 0 means "only this ward". */
  nearbyAlertingCount: number;
  /** Days from first rise to peak so far, or null when there is no clear rise. */
  onsetDays: number | null;
  peakScore: number | null;
  neighbourCount: number;
  /** Neighbours whose average score over the spread window is above the line. */
  neighboursElevated: number;
  /** The heaviest real rain in the lookback window, if it was heavy; otherwise null. */
  heavyRain: RainPoint | null;
  /** How many days of real rain data the lookback window had. Wording only: 0 means "rain data not available". */
  rainDaysSeen?: number;
}

export interface TriageHint {
  label: typeof TRIAGE_LABEL;
  causeProbs: Record<CauseType, number>;
  suspectedZoneId: number | null;
  /** Plain-English reasons, ending with the top cause and the triage-hint warning. */
  evidence: string[];
  features: CauseFeatures;
  /** Points per cause before the softmax, for checking by hand. */
  points: Record<CauseType, number>;
}

/** Clamp to 0..1. */
const unit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * The ward's "how unusual is today" number used for onset, spread and city checks.
 * Pharmacy sales have by far the most counts per day (30 vs 2-3), so their score
 * is the steadiest; if pharmacy is missing that day we fall back to the average
 * of whatever other health signals are in.
 */
function dailyScore(view: SignalView, wardId: number, date: string, params: DetectorParams): number | null {
  const pharmacy = scoreSignal(view, wardId, "pharmacy", date, params);
  if (pharmacy) return pharmacy.score;
  const others = HEALTH_SIGNALS.filter((s) => s !== "pharmacy")
    .map((signal) => scoreSignal(view, wardId, signal, date, params)?.score)
    .filter((score): score is number => score !== undefined);
  return others.length > 0 ? others.reduce((sum, s) => sum + s, 0) / others.length : null;
}

function meanScore(view: SignalView, wardId: number, dates: string[], params: DetectorParams): number | null {
  const scores = dates.map((date) => dailyScore(view, wardId, date, params)).filter((s): s is number => s !== null);
  return scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
}

/** The last `days` dates ending on `today`, oldest first. */
const lastDays = (today: string, days: number): string[] =>
  Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));

/**
 * Onset speed: how many days the ward took to climb from its first rise to its peak.
 * Food is usually 0-1 days, water 1-3, person-to-person several.
 *
 * Rule (fixed 2026-10-06, see docs/STATUS.md): the old version used the single
 * highest day as the peak, so on a noisy plateau any later high day became the
 * new peak and a 3-day water ramp slowly read as "gradual". Now:
 *   1. Smooth: each day's value is the average of it and the days before it,
 *      onsetSmoothingDays days in all (trailing, so no future data).
 *   2. Peak day = the FIRST day the smoothed value reaches onsetPeakShare of the
 *      highest smoothed value in the window. One noisy day only moves the
 *      smoothed top a little, and the peak stays at the first day near the top.
 *   3. Walk back from the peak over raw days above riseScore, allowing one quiet
 *      or missing day inside the climb. onsetDays = peak day - first risen day.
 * "No clear rise" when no raw day is above riseScore. peakScore = highest raw score.
 */
export function onsetFromSeries(
  series: Array<number | null>,
  riseScore: number,
  smoothingDays: number = CLASSIFIER_PARAMS.onsetSmoothingDays,
  peakShare: number = CLASSIFIER_PARAMS.onsetPeakShare,
): { onsetDays: number | null; peakScore: number | null } {
  const raw = series.filter((s): s is number => s !== null);
  if (raw.length === 0) return { onsetDays: null, peakScore: null };
  const peakScore = Math.max(...raw);
  if (peakScore <= riseScore) return { onsetDays: null, peakScore };

  const smoothed = series.map((_, i) => {
    const window = series.slice(Math.max(0, i - smoothingDays + 1), i + 1).filter((s): s is number => s !== null);
    return window.length > 0 ? window.reduce((sum, s) => sum + s, 0) / window.length : null;
  });
  const top = Math.max(...smoothed.filter((s): s is number => s !== null));
  const peak = smoothed.findIndex((s) => s !== null && s >= peakShare * top);

  let firstRise = peak;
  let gapUsed = false;
  for (let i = peak - 1; i >= 0; i--) {
    const score = series[i];
    if (score !== null && score > riseScore) {
      firstRise = i;
      gapUsed = false;
    } else if (!gapUsed) {
      gapUsed = true; // allow one quiet or missing day inside the climb
    } else {
      break;
    }
  }
  return { onsetDays: peak - firstRise, peakScore };
}

/** Everything that is the same for every alert on one day, worked out once. */
interface DayCache {
  cityElevatedShare: Map<string, number>;
}

function measure(alert: Alert, context: ClassifierContext, view: SignalView, cache: DayCache): CauseFeatures {
  const { city } = context;
  const params = context.params ?? CLASSIFIER_PARAMS;
  const detectorParams = context.detectorParams ?? DETECTOR_PARAMS;
  const today = alert.date;
  const allWards = city.wardIds();

  // Currently alerting wards: any alert in the active window, never one from after today.
  const activeFrom = addDays(today, -(params.activeAlertDays - 1));
  const alerting = new Set<number>([alert.wardId]);
  for (const other of context.recentAlerts) {
    if (other.date >= activeFrom && other.date <= today) alerting.add(other.wardId);
  }

  // Feature: share of all wards alerting city-wide. A seasonal wave lifts everyone.
  const cityAlertShare = alerting.size / allWards.length;

  // Feature: share of all wards quietly elevated (not necessarily alerting). Seasonal
  // rises are gentle, so many wards creep up without crossing an alert line.
  let cityElevatedShare = cache.cityElevatedShare.get(today);
  if (cityElevatedShare === undefined) {
    const dates = lastDays(today, params.cityElevatedDays);
    const elevated = allWards.filter((wardId) => (meanScore(view, wardId, dates, detectorParams) ?? 0) > params.cityElevatedScore);
    cityElevatedShare = elevated.length / allWards.length;
    cache.cityElevatedShare.set(today, cityElevatedShare);
  }

  // Feature: share of alerting wards inside one pipeline zone, and how many wards that is.
  // Contaminated water follows the pipes, so many alerts in one zone points at water.
  // A ward with no zone (possible in the real city) borrows its neighbours' busiest zone.
  const neighbours = city.getNeighbours(alert.wardId);
  const ownZone = city.getZoneOfWard(alert.wardId);
  const candidateZones = ownZone !== null
    ? [ownZone]
    : [...new Set(neighbours.map((n) => city.getZoneOfWard(n)).filter((z): z is number => z !== null))];
  let zoneId: number | null = null;
  let zoneWardCount = 0;
  let zoneAlertingCount = 0;
  for (const candidate of candidateZones) {
    const wards = city.getWardsInZone(candidate);
    const count = wards.filter((w) => alerting.has(w)).length;
    if (zoneId === null || count > zoneAlertingCount) {
      zoneId = candidate;
      zoneWardCount = wards.length;
      zoneAlertingCount = count;
    }
  }
  const zoneAlertShare = zoneWardCount > 0 ? zoneAlertingCount / zoneWardCount : 0;

  // Feature: food venue ward, and whether only this one ward is affected.
  // A bad meal hits the people who ate it: one busy market ward, nobody around it.
  const sameZone = zoneId !== null ? city.getWardsInZone(zoneId) : [];
  const nearby = new Set([...neighbours, ...sameZone]);
  nearby.delete(alert.wardId);
  const nearbyAlertingCount = [...nearby].filter((w) => alerting.has(w)).length;

  // Feature: onset speed (days from first rise to peak), from the ward's own scores.
  const onsetDates = lastDays(today, params.onsetWindowDays);
  const { onsetDays, peakScore } = onsetFromSeries(
    onsetDates.map((date) => dailyScore(view, alert.wardId, date, detectorParams)),
    params.riseScore,
    params.onsetSmoothingDays,
    params.onsetPeakShare,
  );

  // Feature: spread to neighbours over the last 2 weeks. Person-to-person illness
  // creeps into bordering wards, so their average stays a little above normal.
  const spreadDates = lastDays(today, params.spreadWindowDays);
  const neighboursElevated = neighbours.filter(
    (n) => (meanScore(view, n, spreadDates, detectorParams) ?? 0) > params.neighbourMeanScore,
  ).length;

  // Feature: heavy real rain in the last few days. Heavy rain can push sewage into pipes.
  const rainFrom = addDays(today, -(params.rainLookbackDays - 1));
  let heavyRain: RainPoint | null = null;
  let rainDaysSeen = 0;
  for (const day of context.rain) {
    if (day.date >= rainFrom && day.date <= today) rainDaysSeen++;
    if (day.date < rainFrom || day.date > today || day.mm < params.heavyRainMm) continue;
    if (!heavyRain || day.mm > heavyRain.mm) heavyRain = { date: day.date, mm: day.mm };
  }

  return {
    alertingWardCount: alerting.size,
    cityAlertShare,
    cityElevatedShare,
    zoneId,
    zoneWardCount,
    zoneAlertingCount,
    zoneAlertShare,
    isFoodVenueWard: city.isFoodVenueWard(alert.wardId),
    nearbyAlertingCount,
    onsetDays,
    peakScore,
    neighbourCount: neighbours.length,
    neighboursElevated,
    heavyRain,
    rainDaysSeen,
  };
}

/** Rule points per cause, plus the in-between numbers the evidence text needs. */
export function scoreCauses(features: CauseFeatures, params: ClassifierParams = CLASSIFIER_PARAMS) {
  const w = params.weights;

  // City-wide: 0..1, whichever of "many alerting" or "many quietly elevated" is stronger.
  const cityWide = unit(Math.max(
    features.cityAlertShare / params.cityWideAlertShare,
    features.cityElevatedShare / params.cityWideElevatedShare,
  ));
  // Zone concentration: the zone's alerting share ABOVE the city-wide share, so a
  // city-wide wave (every zone busy) does not look like one broken pipe.
  const zoneExcess = features.zoneAlertingCount >= params.minZoneWards
    ? unit(features.zoneAlertShare - features.cityAlertShare)
    : 0;
  // Onset: 1 = sudden (<= fastOnsetDays), 0 = gradual (>= slowOnsetDays). No clear rise: neither.
  const sudden = features.onsetDays === null
    ? 0
    : unit((params.slowOnsetDays - features.onsetDays) / (params.slowOnsetDays - params.fastOnsetDays));
  const gradual = features.onsetDays === null ? 0 : 1 - sudden;
  const spread = features.neighbourCount > 0 ? features.neighboursElevated / features.neighbourCount : 0;
  const singleWard = features.nearbyAlertingCount === 0 ? 1 : 0;
  const food = features.isFoodVenueWard ? 1 : 0;
  const rain = features.heavyRain ? 1 : 0;

  const points: Record<CauseType, number> = {
    water: w.water.zoneConcentration * zoneExcess + w.water.suddenOnset * sudden + w.water.heavyRain * rain,
    food: w.food.foodVenueWard * food + w.food.singleWard * singleWard + w.food.suddenOnset * sudden,
    // Spread only counts when it is not explained by a zone-wide or city-wide event.
    p2p: w.p2p.gradualOnset * gradual + w.p2p.neighbourSpread * spread * (1 - zoneExcess) * (1 - cityWide) +
      w.p2p.notFoodVenueWard * (1 - food),
    seasonal: w.seasonal.cityWide * cityWide + w.seasonal.gradualOnset * gradual,
    unknown: params.unknownBase,
  };

  // Mixed evidence: if the two strongest causes are close, nobody should sound sure.
  const ranked = (["water", "food", "p2p", "seasonal"] as const).map((c) => points[c]).sort((a, b) => b - a);
  const mixed = ranked[0] - ranked[1] < params.mixedMargin;
  if (mixed) points.unknown += params.mixedBonus;

  return { points, cityWide, zoneExcess, sudden, gradual, spread, mixed };
}

/** Softmax: turns points into probabilities that add up to 1. */
export function softmax(points: Record<CauseType, number>, temperature = 1): Record<CauseType, number> {
  const top = Math.max(...CAUSE_TYPES.map((c) => points[c]));
  const weights = CAUSE_TYPES.map((c) => Math.exp((points[c] - top) / temperature));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(CAUSE_TYPES.map((c, i) => [c, weights[i] / total])) as Record<CauseType, number>;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

function explain(features: CauseFeatures, scored: ReturnType<typeof scoreCauses>, probs: Record<CauseType, number>,
  suspectedZoneId: number | null): string[] {
  const f = features;
  const lines: string[] = [];
  if (f.zoneId !== null) {
    lines.push(`${f.zoneAlertingCount} of ${f.zoneWardCount} wards in water zone ${f.zoneId} are alerting ` +
      `(${pct(f.zoneAlertShare)}; city-wide ${pct(f.cityAlertShare)})`);
  } else {
    lines.push("ward has no known water zone");
  }
  lines.push(f.isFoodVenueWard ? "this is a busy food venue ward" : "this is not a food venue ward");
  lines.push(f.nearbyAlertingCount === 0
    ? "no neighbouring or same-zone ward is alerting: only this ward is affected"
    : `${f.nearbyAlertingCount} neighbouring or same-zone wards are also alerting`);
  if (f.onsetDays === null) {
    lines.push("no clear rise in this ward's own numbers yet");
  } else {
    const speed = scored.sudden >= 0.75 ? "sudden" : scored.gradual >= 0.75 ? "gradual" : "medium speed";
    lines.push(`rose from normal to its peak in ${f.onsetDays} day${f.onsetDays === 1 ? "" : "s"} (${speed})`);
  }
  lines.push(`${f.neighboursElevated} of ${f.neighbourCount} neighbouring wards have been above normal over the last 2 weeks`);
  lines.push(`${pct(f.cityAlertShare)} of all wards alerting, ${pct(f.cityElevatedShare)} quietly above normal`);
  lines.push(f.heavyRain
    ? `heavy rain recently: ${f.heavyRain.mm.toFixed(1)} mm on ${f.heavyRain.date} (real rain data)`
    : f.rainDaysSeen === 0
      ? "rain data not available"
      : "no heavy rain in the last 10 days (real rain data)");
  if (suspectedZoneId !== null) lines.push(`suspected water zone: ${suspectedZoneId}`);
  if (scored.mixed) lines.push("evidence is mixed: the two likeliest causes are close");

  const top = CAUSE_TYPES.reduce((best, c) => (probs[c] > probs[best] ? c : best));
  lines.push(`${TRIAGE_LABEL}, not a diagnosis: most likely ${top} (${pct(probs[top])}); an officer must confirm`);
  return lines;
}

function classifyWith(alert: Alert, context: ClassifierContext, view: SignalView, cache: DayCache): TriageHint {
  const params = context.params ?? CLASSIFIER_PARAMS;
  const features = measure(alert, context, view, cache);
  const scored = scoreCauses(features, params);
  const causeProbs = softmax(scored.points, params.temperature);
  // The zone holding the alerting wards, only when it clearly stands out from the rest of the city.
  const suspectedZoneId = features.zoneId !== null && features.zoneAlertingCount >= params.minZoneWards &&
    scored.zoneExcess >= params.suspectZoneShare
    ? features.zoneId
    : null;
  return {
    label: TRIAGE_LABEL,
    causeProbs,
    suspectedZoneId,
    evidence: explain(features, scored, causeProbs, suspectedZoneId),
    features,
    points: scored.points,
  };
}

/** Classifies one alert. Returns the full triage hint (probabilities, zone, evidence, features). */
export function classifyAlert(alert: Alert, context: ClassifierContext): TriageHint {
  return classifyWith(alert, context, viewAsOf(context.rows, alert.date), { cityElevatedShare: new Map() });
}

/** An alert with the classifier's hint filled in, plus the classifier's own plain-English reasons. */
export interface ClassifiedAlert {
  /** causeProbs and suspectedZoneId filled; evidence is the DETECTOR's reasons only, unchanged. */
  alert: Alert;
  /** The classifier's reasons, ending with the "triage hint, not a diagnosis" line (AlertRecord.causeEvidence). */
  causeEvidence: string[];
}

/**
 * Classifies alerts. Decision of 2026-10-06 (second revision, docs/STATUS.md):
 * Alert.evidence keeps ONLY the detector's reasons; the classifier's reasons are
 * returned separately as causeEvidence (AlertRecord.causeEvidence in the API).
 * The input alerts are not changed; new copies are returned. The alerts being
 * classified also count as "recent alerts" for each other.
 */
export function classifyAlertsDetailed(alerts: readonly Alert[], context: ClassifierContext): ClassifiedAlert[] {
  // Build the lookup once (plain row lists would otherwise be re-indexed per alert).
  const index = Array.isArray(context.rows) ? new SignalIndex(context.rows) : context.rows;
  const shared: ClassifierContext = { ...context, rows: index, recentAlerts: [...context.recentAlerts, ...alerts] };
  const cache: DayCache = { cityElevatedShare: new Map() };
  return alerts.map((alert) => {
    const hint = classifyWith(alert, shared, viewAsOf(index, alert.date), cache);
    return { alert: { ...alert, causeProbs: hint.causeProbs, suspectedZoneId: hint.suspectedZoneId }, causeEvidence: hint.evidence };
  });
}

/** Fills causeProbs and suspectedZoneId only (evidence unchanged). See classifyAlertsDetailed for the reasons. */
export function classifyAlerts(alerts: readonly Alert[], context: ClassifierContext): Alert[] {
  return classifyAlertsDetailed(alerts, context).map((c) => c.alert);
}
