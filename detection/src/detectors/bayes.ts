import type { CityModel } from "../city.js";
import { addDays } from "../dates.js";
import type { DetectorParams } from "../params.js";
import {
  describeScore,
  HEALTH_SIGNALS,
  scoreSignal,
  viewAsOf,
  type HealthSignal,
  type SignalInput,
  type SignalScore,
  type SignalView,
} from "../scoring.js";
import type { Alert } from "../types.js";
import { makeAlert, type DetectResult } from "./common.js";

/*
 * Detector 3: FUSED BAYES. Combines all signals (and the neighbours) into one
 * chance that this ward has an outbreak.
 *
 * 1. For each signal, take its best score over the last W days (W =
 *    bayesWindowDays, today included). Hospital shows up days after
 *    complaints, so the window lets a late signal still count.
 * 2. Turn each best score into a likelihood ratio (how many times more likely
 *    this score is in an outbreak than on a normal day):
 *        LR = min(LR_CAP, exp(GAIN * max(0, score - SCORE_FLOOR)))
 * 3. Neighbours: average the neighbouring wards' best recent scores and add one
 *    more, weaker LR from it (GAIN scaled down by bayesNeighbourWeight).
 * 4. posterior odds = prior odds * all the LRs multiplied together;
 *    probability = odds / (1 + odds).
 */

/** Likelihood ratio for one score. 1 means "no evidence either way". */
export function likelihoodRatio(score: number, params: DetectorParams, gain = params.bayesGain): number {
  return Math.min(params.bayesLrCap, Math.exp(gain * Math.max(0, score - params.bayesScoreFloor)));
}

export interface FusedEvidence {
  lrs: Partial<Record<HealthSignal, number>>;
  /** 1 when there are no neighbours or no neighbour term. */
  neighbourLr: number;
  posteriorOdds: number;
  probability: number;
}

/** The pure maths, separated out so the worked example can be checked by hand. */
export function fuseScores(
  bestScores: Partial<Record<HealthSignal, number>>,
  neighbourAverage: number | null,
  params: DetectorParams,
): FusedEvidence {
  const priorOdds = params.bayesPrior / (1 - params.bayesPrior);
  const lrs: Partial<Record<HealthSignal, number>> = {};
  let posteriorOdds = priorOdds;
  for (const signal of HEALTH_SIGNALS) {
    const score = bestScores[signal];
    if (score === undefined) continue;
    lrs[signal] = likelihoodRatio(score, params);
    posteriorOdds *= lrs[signal];
  }
  const neighbourLr = neighbourAverage === null
    ? 1
    : likelihoodRatio(neighbourAverage, params, params.bayesGain * params.bayesNeighbourWeight);
  posteriorOdds *= neighbourLr;
  return { lrs, neighbourLr, posteriorOdds, probability: posteriorOdds / (1 + posteriorOdds) };
}

/** The highest score per signal over the evidence window, judged with what is known today. */
function bestRecentScores(view: SignalView, wardId: number, windowDates: string[], params: DetectorParams) {
  const best: Partial<Record<HealthSignal, SignalScore>> = {};
  for (const signal of HEALTH_SIGNALS) {
    for (const date of windowDates) {
      const scored = scoreSignal(view, wardId, signal, date, params);
      if (scored && (best[signal] === undefined || scored.score > best[signal].score)) best[signal] = scored;
    }
  }
  return best;
}

/** One ward's fused Bayes evidence for one day. Shared by detect() and wardRisk() (src/runDetector.ts). */
export interface WardAssessment {
  wardId: number;
  probability: number;
  /** Signals whose best recent score passed bayesContributionScore. */
  contributingSignals: HealthSignal[];
  best: Partial<Record<HealthSignal, SignalScore>>;
  neighbourAverage: number | null;
  fused: FusedEvidence;
}

/** Fused Bayes evidence for EVERY ward on `today`, before any alert rule is applied. */
export function assessWards(rows: SignalInput, today: string, city: CityModel, params: DetectorParams): WardAssessment[] {
  const view = viewAsOf(rows, today);
  const windowDates = Array.from({ length: params.bayesWindowDays }, (_, back) => addDays(today, -back));

  // Score every ward once, so neighbours can reuse it.
  const bestByWard = new Map(city.wardIds().map((wardId) => [wardId, bestRecentScores(view, wardId, windowDates, params)]));
  const strongestOf = (wardId: number): number | null => {
    const scores = Object.values(bestByWard.get(wardId) ?? {}).map((s) => s.score);
    return scores.length > 0 ? Math.max(...scores) : null;
  };

  return [...bestByWard].map(([wardId, best]) => {
    const neighbourScores = city.getNeighbours(wardId).map(strongestOf).filter((s): s is number => s !== null);
    const neighbourAverage = neighbourScores.length > 0
      ? neighbourScores.reduce((sum, s) => sum + s, 0) / neighbourScores.length
      : null;
    const bestScores = Object.fromEntries(Object.entries(best).map(([signal, s]) => [signal, s.score]));
    const fused = fuseScores(bestScores, neighbourAverage, params);
    const contributingSignals = HEALTH_SIGNALS.filter((signal) => (best[signal]?.score ?? -Infinity) > params.bayesContributionScore);
    return { wardId, probability: fused.probability, contributingSignals, best, neighbourAverage, fused };
  });
}

export function detect(
  rows: SignalInput,
  today: string,
  city: CityModel,
  params: DetectorParams,
  _state?: null,
): DetectResult<null> {
  const alerts: Alert[] = [];
  for (const { wardId, probability, contributingSignals: contributing, best, neighbourAverage, fused } of assessWards(rows, today, city, params)) {
    // Fire only when BOTH: the probability is above the alert level, AND at least
    // bayesMinSignals (2) different signals contributed. One signal alone, however
    // high, never fires: a single feed can break, be gamed, or be a harmless surge.
    if (probability <= params.bayesAlertProbability || contributing.length < params.bayesMinSignals) continue;

    const evidence = contributing.map((signal) => {
      const s = best[signal] as SignalScore;
      return `${describeScore(s)}: ${s.score.toFixed(1)} spreads above normal, odds x${(fused.lrs[signal] as number).toFixed(1)}`;
    });
    if (neighbourAverage !== null && fused.neighbourLr > 1) {
      evidence.push(`neighbouring wards also high (average score ${neighbourAverage.toFixed(1)}): odds x${fused.neighbourLr.toFixed(1)}`);
    }
    evidence.push(`chance of an outbreak: ${(probability * 100).toFixed(0)}%`);

    alerts.push(
      makeAlert({ wardId, date: today, method: "bayes", score: probability, contributingSignals: contributing, evidence }),
    );
  }
  return { alerts, state: null };
}
