import { describe, it, expect } from "vitest";
import { GridCity } from "../src/city.js";
import { addDays, dateRange } from "../src/dates.js";
import * as bayes from "../src/detectors/bayes.js";
import * as cusum from "../src/detectors/cusum.js";
import * as threshold from "../src/detectors/threshold.js";
import { DETECTOR_PARAMS, type DetectorParams } from "../src/params.js";
import { LeakageError, scoreWard, SignalIndex, type IndexedRow } from "../src/scoring.js";
import { CAUSE_TYPES, SIGNAL_TYPES, type SignalType } from "../src/types.js";

/*
 * Tiny hand-built data. Every normal day is 4, so for any day with 8 weeks of
 * history: baseline = 4, spread = max(MAD 0, sqrt(4) = 2, 1) = 2,
 * and score = (count - 4) / 2. So count 8 -> score 2, 12 -> 4, 14 -> 5.
 */
const TODAY = "2024-03-04"; // a Monday
const NORMAL = 4;
const countForScore = (score: number) => NORMAL + 2 * score;

const oneWard = new GridCity({ columns: 1, rows: 1, zoneColumns: 1, zoneRows: 1, foodVenueShare: 0, randomSeed: 1 });
const threeInARow = new GridCity({ columns: 3, rows: 1, zoneColumns: 1, zoneRows: 1, foodVenueShare: 0, randomSeed: 1 });

/** Flat normal data for the given wards, from 8 weeks before TODAY to `lastDate`. */
function flatRows(wardIds: number[], lastDate = addDays(TODAY, 7)): IndexedRow[] {
  const rows: IndexedRow[] = [];
  for (const date of dateRange(addDays(TODAY, -56), lastDate)) {
    for (const wardId of wardIds) {
      for (const signalType of SIGNAL_TYPES) {
        rows.push({ wardId, signalType, date, count: signalType === "rain" ? 0 : NORMAL, sourceTag: "synthetic" });
      }
    }
  }
  return rows;
}

function setCount(rows: IndexedRow[], wardId: number, signal: SignalType, date: string, count: number): void {
  const row = rows.find((r) => r.wardId === wardId && r.signalType === signal && r.date === date);
  if (!row) throw new Error(`no row ${wardId} ${signal} ${date}`);
  row.count = count;
}

const ALL_DETECTORS = { threshold: threshold.detect, cusum: cusum.detect, bayes: bayes.detect };

describe("scoreWard", () => {
  it("scores against same-weekday history and gives the plain ratio", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "pharmacy", TODAY, 12);
    const scores = scoreWard(rows, 0, TODAY);
    expect(scores.pharmacy).toMatchObject({ score: 4, ratio: 3, count: 12, baseline: 4 });
    expect(scores.complaint?.score).toBe(0);
    expect(scores.rain).not.toBeNull(); // rain is scored, as context
  });

  it("returns null (no baseline) when history is too short", () => {
    const rows = flatRows([0]).filter((r) => r.date >= addDays(TODAY, -21)); // only 3 earlier Mondays
    expect(scoreWard(rows, 0, TODAY).pharmacy).toBeNull();
  });
});

describe("threshold detector", () => {
  it("fires on one high signal", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "pharmacy", TODAY, countForScore(4)); // 4 > 3
    const { alerts } = threshold.detect(rows, TODAY, oneWard, DETECTOR_PARAMS);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].contributingSignals).toEqual(["pharmacy"]);
    expect(alerts[0].evidence[0]).toContain("pharmacy sales 3.0x normal for a Monday");
  });

  it("does not fire on a normal day", () => {
    expect(threshold.detect(flatRows([0]), TODAY, oneWard, DETECTOR_PARAMS).alerts).toEqual([]);
  });

  it("does not fire on rain alone", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "rain", TODAY, 80);
    expect(scoreWard(rows, 0, TODAY).rain!.score).toBeGreaterThan(DETECTOR_PARAMS.thresholdScore);
    expect(threshold.detect(rows, TODAY, oneWard, DETECTOR_PARAMS).alerts).toEqual([]);
  });
});

describe("CUSUM detector", () => {
  // k = 0.5, h = 4. A mild day has score 2, so it adds 2 - 0.5 = 1.5.
  const params: DetectorParams = { ...DETECTOR_PARAMS, cusumSlack: 0.5, cusumLimit: 4 };
  const days = dateRange(TODAY, addDays(TODAY, 4));

  function run(rows: IndexedRow[]) {
    let state = cusum.emptyCusumState();
    return days.map((day) => {
      const result = cusum.detect(rows, day, oneWard, params, state);
      state = result.state;
      return { day, fired: result.alerts.length > 0, sum: state.cells["0:complaint"].sum };
    });
  }

  it("does not fire on one mild day, and the sum fades", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "complaint", days[0], countForScore(2));
    const out = run(rows);
    expect(out.map((d) => d.fired)).toEqual([false, false, false, false, false]);
    expect(out.map((d) => d.sum)).toEqual([1.5, 1, 0.5, 0, 0]);
  });

  it("fires after several mild days, then resets", () => {
    const rows = flatRows([0]);
    for (const day of days.slice(0, 4)) setCount(rows, 0, "complaint", day, countForScore(2));
    const out = run(rows);
    // 1.5, 3.0, 4.5 > 4 -> alarm and reset to 0, then 1.5, then a normal day: 1.0
    expect(out.map((d) => d.fired)).toEqual([false, false, true, false, false]);
    expect(out.map((d) => d.sum)).toEqual([1.5, 3, 0, 1.5, 1]);
  });

  it("adds a late-reported day once it arrives instead of skipping it", () => {
    const rows = flatRows([0]);
    const late = rows.find((r) => r.wardId === 0 && r.signalType === "hospital" && r.date === TODAY)!;
    late.count = countForScore(2);
    late.reportedOn = addDays(TODAY, 2);
    let state = cusum.emptyCusumState();
    const sums = days.slice(0, 3).map((day) => {
      state = cusum.detect(rows, day, oneWard, params, state).state;
      return state.cells["0:hospital"];
    });
    expect(sums[0]).toEqual({ sum: 0, nextDate: TODAY }); // waiting for TODAY
    expect(sums[1]).toEqual({ sum: 0, nextDate: TODAY }); // still waiting
    expect(sums[2].sum).toBe(0.5); // 1.5 for TODAY, then -0.5, -0.5 for two normal days
  });
});

describe("Bayes detector: worked example", () => {
  const exampleParams: DetectorParams = {
    ...DETECTOR_PARAMS,
    bayesGain: 0.8,
    bayesScoreFloor: 1,
    bayesLrCap: 1e9,
    bayesPrior: 0.01,
    bayesNeighbourWeight: 0,
    bayesAlertProbability: 0.5,
    bayesContributionScore: 2,
  };

  it("reproduces the hand calculation", () => {
    const fused = bayes.fuseScores({ complaint: 5, pharmacy: 4, hospital: 0.5 }, null, exampleParams);
    expect(fused.lrs.complaint).toBeCloseTo(Math.exp(3.2), 6); // 24.53
    expect(fused.lrs.complaint).toBeCloseTo(24.5, 1);
    expect(fused.lrs.pharmacy).toBeCloseTo(11.0, 1); // exp(2.4) = 11.02
    expect(fused.lrs.hospital).toBe(1); // 0.5 is below the floor
    // prior odds 0.01 / 0.99 = 0.0101; x 24.53 x 11.02 = 2.731
    expect(fused.posteriorOdds).toBeCloseTo(2.731, 2);
    expect(fused.probability).toBeCloseTo(0.732, 2);
  });

  it("fires on the same numbers fed in as real rows", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "complaint", TODAY, countForScore(5)); // 14
    setCount(rows, 0, "pharmacy", TODAY, countForScore(4)); // 12
    setCount(rows, 0, "hospital", TODAY, countForScore(0.5)); // 5
    const { alerts } = bayes.detect(rows, TODAY, oneWard, exampleParams);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].score).toBeCloseTo(0.732, 2);
    expect(alerts[0].contributingSignals).toEqual(["complaint", "pharmacy"]);
  });

  it("does NOT fire with only complaints high, even when the probability passes the line", () => {
    const fused = bayes.fuseScores({ complaint: 5, pharmacy: 0, hospital: 0 }, null, exampleParams);
    expect(fused.probability).toBeCloseTo(0.198, 2); // 0.0101 x 24.53 = 0.248 odds

    const rows = flatRows([0]);
    setCount(rows, 0, "complaint", TODAY, countForScore(5));
    expect(bayes.detect(rows, TODAY, oneWard, exampleParams).alerts).toEqual([]);
    // Drop the alert level below 0.198: still no alert, because only 1 signal contributed.
    expect(bayes.detect(rows, TODAY, oneWard, { ...exampleParams, bayesAlertProbability: 0.1 }).alerts).toEqual([]);
  });

  it("counts a hospital rise from earlier in the window", () => {
    const rows = flatRows([0]);
    setCount(rows, 0, "complaint", TODAY, countForScore(5));
    setCount(rows, 0, "hospital", addDays(TODAY, -3), countForScore(4)); // 3 days ago, inside W = 5
    const { alerts } = bayes.detect(rows, TODAY, oneWard, exampleParams);
    expect(alerts[0].contributingSignals).toEqual(["complaint", "hospital"]);
  });

  it("neighbour smoothing raises the probability when neighbours are also high", () => {
    const withNeighbours: DetectorParams = { ...exampleParams, bayesNeighbourWeight: 0.25, bayesAlertProbability: 0.8 };
    const middleOnly = flatRows([0, 1, 2]);
    for (const [signal, score] of [["complaint", 5], ["pharmacy", 4], ["hospital", 0.5]] as const) {
      setCount(middleOnly, 1, signal, TODAY, countForScore(score));
    }
    // Neighbours quiet: average score 0, no boost, 0.732 < 0.8, no alert for ward 1.
    expect(bayes.detect(middleOnly, TODAY, threeInARow, withNeighbours).alerts.map((a) => a.wardId)).not.toContain(1);

    const cluster = structuredClone(middleOnly);
    setCount(cluster, 0, "complaint", TODAY, countForScore(5));
    setCount(cluster, 2, "complaint", TODAY, countForScore(5));
    // Neighbour average 5 -> LR = exp(0.25 x 0.8 x (5 - 1)) = exp(0.8) = 2.23; odds 2.731 x 2.23 = 6.08 -> 0.859
    const fused = bayes.fuseScores({ complaint: 5, pharmacy: 4, hospital: 0.5 }, 5, withNeighbours);
    expect(fused.neighbourLr).toBeCloseTo(Math.exp(0.8), 6);
    expect(fused.probability).toBeCloseTo(0.859, 2);
    const alert = bayes.detect(cluster, TODAY, threeInARow, withNeighbours).alerts.find((a) => a.wardId === 1);
    expect(alert?.score).toBeCloseTo(0.859, 2);
    expect(alert?.evidence.some((e) => e.startsWith("neighbouring wards also high"))).toBe(true);
  });
});

describe("no future data", () => {
  it("changing rows dated today or later does not change the score for an earlier date", () => {
    const rows = flatRows([0]);
    const yesterday = addDays(TODAY, -1);
    const before = scoreWard(rows, 0, yesterday);
    const changed = rows.map((r) => (r.date >= TODAY ? { ...r, count: r.count * 10 + 99 } : r));
    expect(scoreWard(changed, 0, yesterday)).toEqual(before);
  });

  it("changing today's row changes today's count but not its baseline", () => {
    const rows = flatRows([0]);
    const changed = rows.map((r) => (r.date === TODAY && r.signalType === "pharmacy" ? { ...r, count: 50 } : r));
    expect(scoreWard(changed, 0, TODAY).pharmacy?.baseline).toBe(scoreWard(rows, 0, TODAY).pharmacy?.baseline);
    expect(scoreWard(changed, 0, TODAY).pharmacy?.count).toBe(50);
  });

  it("never reads a row dated after the scoring date (future counts explode if touched)", () => {
    const poisoned = flatRows([0]).map((row) =>
      row.date <= TODAY
        ? row
        : { ...row, get count(): number { throw new Error(`read future row ${row.date}`); } },
    );
    expect(() => scoreWard(poisoned, 0, TODAY)).not.toThrow();
    for (const detect of Object.values(ALL_DETECTORS)) {
      expect(() => detect(poisoned, TODAY, oneWard, DETECTOR_PARAMS)).not.toThrow();
    }
  });

  it("a view refuses to look past its own day", () => {
    const view = new SignalIndex(flatRows([0])).asOf(TODAY);
    expect(() => view.count(0, "pharmacy", addDays(TODAY, 1))).toThrow(LeakageError);
    expect(() => view.asOf(addDays(TODAY, 1))).toThrow(LeakageError);
  });

  it("detector results for today ignore a huge spike tomorrow", () => {
    const rows = flatRows([0]);
    const spiked = rows.map((r) => (r.date > TODAY ? { ...r, count: 999 } : r));
    for (const detect of Object.values(ALL_DETECTORS)) {
      expect(detect(spiked, TODAY, oneWard, DETECTOR_PARAMS)).toEqual(detect(rows, TODAY, oneWard, DETECTOR_PARAMS));
    }
  });

  it("hides rows not yet reported", () => {
    const rows = flatRows([0]);
    const late = rows.find((r) => r.signalType === "hospital" && r.date === TODAY)!;
    late.reportedOn = addDays(TODAY, 1);
    expect(scoreWard(rows, 0, TODAY).hospital).toBeNull();
  });
});

describe("common alert shape", () => {
  it("all three detectors accept the same input and return the same shape", () => {
    const rows = flatRows([0, 1, 2]);
    for (const signal of ["complaint", "pharmacy", "hospital"] as const) {
      for (const day of dateRange(addDays(TODAY, -4), TODAY)) setCount(rows, 1, signal, day, countForScore(6));
    }
    for (const [method, detect] of Object.entries(ALL_DETECTORS)) {
      const result = detect(rows, TODAY, threeInARow, DETECTOR_PARAMS);
      expect(Object.keys(result).sort()).toEqual(["alerts", "state"]);
      expect(result.alerts.length, method).toBeGreaterThan(0);
      for (const alert of result.alerts) {
        expect(alert.method).toBe(method);
        expect(alert.date).toBe(TODAY);
        expect(alert.score).toBeGreaterThan(0);
        expect(alert.score).toBeLessThanOrEqual(1);
        expect(alert.contributingSignals.length).toBeGreaterThan(0);
        expect(alert.contributingSignals).not.toContain("rain");
        expect(alert.evidence.length).toBeGreaterThan(0);
        expect(Object.keys(alert.causeProbs).sort()).toEqual([...CAUSE_TYPES].sort());
        expect(alert.causeProbs.unknown).toBe(1);
        expect(alert.suspectedZoneId).toBeNull();
      }
    }
  });
});
