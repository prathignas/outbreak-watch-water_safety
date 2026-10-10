import { describe, it, expect } from "vitest";
import { calibrate, evaluateSplit, splitRange } from "../src/backtest/evaluate.js";
import { BACKTEST } from "../src/params.js";
import { mergeEpisodes } from "../src/backtest/episodes.js";
import { runOne } from "../src/backtest/run.js";
import { buildTraces, type DetectorTraces } from "../src/backtest/traces.js";
import { GridCity } from "../src/city.js";
import * as bayes from "../src/detectors/bayes.js";
import * as cusum from "../src/detectors/cusum.js";
import * as threshold from "../src/detectors/threshold.js";
import { DATA_SPLIT, DETECTOR_PARAMS } from "../src/params.js";
import { SignalIndex } from "../src/scoring.js";
import { simulate, type OutbreakAnswer } from "../src/simulator.js";
import { DETECTION_METHODS, type DetectionMethod } from "../src/types.js";

/** Five wards in a row: 0-1-2-3-4. Ward 0 and ward 2 are NOT neighbours. */
const row = new GridCity({ columns: 5, rows: 1, zoneColumns: 1, zoneRows: 1, foodVenueShare: 0, randomSeed: 1 });
/** A small city so whole simulations run in a test. */
const small = new GridCity({ columns: 6, rows: 4, zoneColumns: 2, zoneRows: 2, foodVenueShare: 0.25, randomSeed: 3 });

describe("episode merging (hand-made, gap 7 days)", () => {
  it("merges same and adjacent wards within the gap, splits far wards and long gaps", () => {
    const episodes = mergeEpisodes(
      [
        { wardId: 0, date: "2024-03-01" },
        { wardId: 0, date: "2024-03-05" }, // same ward, 4 days later: same episode
        { wardId: 1, date: "2024-03-10" }, // next-door ward, 5 days after 03-05: same episode
        { wardId: 2, date: "2024-03-12" }, // next to ward 1, 2 days later: same episode (transitive)
        { wardId: 4, date: "2024-03-10" }, // far from all of them: its own episode
        { wardId: 0, date: "2024-03-30" }, // 18 days after the last nearby alert: new episode
      ],
      row,
      7,
    );
    expect(episodes).toEqual([
      { startDate: "2024-03-01", endDate: "2024-03-12", startWards: [0], wards: [0, 1, 2], alertCount: 4 },
      { startDate: "2024-03-10", endDate: "2024-03-10", startWards: [4], wards: [4], alertCount: 1 },
      { startDate: "2024-03-30", endDate: "2024-03-30", startWards: [0], wards: [0], alertCount: 1 },
    ]);
  });

  it("joins two episodes when an alert links them", () => {
    const separate = mergeEpisodes([{ wardId: 0, date: "2024-03-01" }, { wardId: 2, date: "2024-03-01" }], row, 7);
    expect(separate).toHaveLength(2);
    const joined = mergeEpisodes(
      [{ wardId: 0, date: "2024-03-01" }, { wardId: 2, date: "2024-03-01" }, { wardId: 1, date: "2024-03-03" }],
      row,
      7,
    );
    expect(joined).toEqual([{ startDate: "2024-03-01", endDate: "2024-03-03", startWards: [0, 2], wards: [0, 1, 2], alertCount: 3 }]);
  });

  it("gap is inclusive: 7 days apart joins, 8 days apart does not", () => {
    expect(mergeEpisodes([{ wardId: 3, date: "2024-03-01" }, { wardId: 3, date: "2024-03-08" }], row, 7)).toHaveLength(1);
    expect(mergeEpisodes([{ wardId: 3, date: "2024-03-01" }, { wardId: 3, date: "2024-03-09" }], row, 7)).toHaveLength(2);
  });
});

describe("matching rule v2 (alert-days)", () => {
  const outbreak: OutbreakAnswer = {
    id: "x", cause: "food", split: "test", originWardId: 0, zoneId: null,
    affectedWards: [{ wardId: 0, weight: 1 }], startDate: "2024-03-01", peakDate: "2024-03-01", endDate: "2024-03-04",
    signalDelayDays: { complaint: 0, pharmacy: 1, hospital: 3 },
    firstSignalDate: { complaint: "2024-03-01", pharmacy: "2024-03-02", hospital: "2024-03-04" }, triggerRainDate: null,
  };
  const wave: OutbreakAnswer = {
    ...outbreak, id: "wave", cause: "seasonal", originWardId: null,
    affectedWards: [0, 1, 2, 3, 4].map((wardId) => ({ wardId, weight: 1 })),
    startDate: "2024-06-01", peakDate: "2024-06-14", endDate: "2024-07-30",
  };

  it("matches in an affected ward or its neighbour, from true start to end + 9 days", () => {
    const evalOf = (wardId: number, date: string) => evaluateSplit([{ wardId, date }], [outbreak], row, 1).outbreaks[0];
    expect(evalOf(0, "2024-03-01")).toMatchObject({ detected: true, delayDays: 0 });
    expect(evalOf(1, "2024-03-05")).toMatchObject({ detected: true, delayDays: 4 }); // neighbour
    expect(evalOf(1, "2024-03-13")).toMatchObject({ detected: true, delayDays: 12 }); // end 03-04 + 9 = 03-13
    expect(evalOf(1, "2024-03-14").detected).toBe(false); // too late
    expect(evalOf(0, "2024-02-29").detected).toBe(false); // before the true start
    expect(evalOf(2, "2024-03-02").detected).toBe(false); // two wards away
  });

  it("an outbreak inside a long earlier episode is still detected, at its first matching alert-day", () => {
    // Ward 1 alerts every 5 days from 2024-02-10: one long episode starting well before the outbreak.
    const alerts = ["2024-02-10", "2024-02-15", "2024-02-20", "2024-02-25", "2024-03-01"].map((date) => ({ wardId: 1, date }));
    alerts.push({ wardId: 0, date: "2024-03-02" });
    const result = evaluateSplit(alerts, [outbreak], row, 1);
    expect(result.episodes).toBe(1); // all one episode, started 2024-02-10
    // Version 1 called this missed (the episode started before the outbreak). Version 2: detected on 03-01 in neighbour ward 1.
    expect(result.outbreaks[0]).toMatchObject({ detected: true, delayDays: 0, firstAlert: { wardId: 1, date: "2024-03-01" } });
    expect(result.falseAlarmsWaveCounted).toBe(0); // the episode contains a matching alert-day
  });

  it("an unrelated episode counts as a false alarm", () => {
    const result = evaluateSplit(
      [{ wardId: 0, date: "2024-03-02" }, { wardId: 4, date: "2024-03-02" }, { wardId: 4, date: "2024-03-05" }],
      [outbreak], row, 1);
    expect(result.episodes).toBe(2);
    expect(result.outbreaks[0].detected).toBe(true);
    expect(result.falseAlarmsWaveCounted).toBe(1); // ward 4 is two wards from ward 0: its episode matches nothing
    expect(result.falseAlarmRateWaveCounted).toBe(1 / 5); // 1 episode / (5 wards x 1 year)
  });

  it("counts wave-only episodes as false alarms only when the wave is excluded, and marks overlap", () => {
    const local = { ...outbreak, id: "in-wave", startDate: "2024-06-20", peakDate: "2024-06-20", endDate: "2024-06-23" };
    const result = evaluateSplit([{ wardId: 4, date: "2024-06-05" }], [wave, local, outbreak], row, 1);
    expect(result.falseAlarmsWaveCounted).toBe(0); // matches the wave
    expect(result.falseAlarmsWaveExcluded).toBe(1); // but no local outbreak
    expect(result.outbreaks.map((o) => [o.id, o.overlapsWave])).toEqual([["wave", false], ["in-wave", true], ["x", false]]);
  });
});

// One simulation of the small city, shared by the tests below.
const sims = new Map<string, ReturnType<typeof simulate>>();
const simOf = (difficulty: "easy" | "realistic" | "hard", seed = 42) => {
  const key = `${difficulty}-${seed}`;
  if (!sims.has(key)) sims.set(key, simulate({ city: small, seed, difficulty }));
  return sims.get(key)!;
};

describe("fast replay equals the real detectors", () => {
  for (const difficulty of ["realistic", "hard"] as const) {
    it(`gives exactly the same alert-days over 4 years (${difficulty}, with reporting lags)`, () => {
      const sim = simOf(difficulty);
      const traces = buildTraces(sim, small, DETECTOR_PARAMS);
      const index = new SignalIndex(sim.rows());
      const real: Record<DetectionMethod, string[]> = { threshold: [], cusum: [], bayes: [] };
      let state = cusum.emptyCusumState();
      for (const today of sim.dates) {
        for (const a of threshold.detect(index, today, small, DETECTOR_PARAMS).alerts) real.threshold.push(`${a.wardId}|${a.date}`);
        const result = cusum.detect(index, today, small, DETECTOR_PARAMS, state);
        state = result.state;
        for (const a of result.alerts) real.cusum.push(`${a.wardId}|${a.date}`);
        for (const a of bayes.detect(index, today, small, DETECTOR_PARAMS).alerts) real.bayes.push(`${a.wardId}|${a.date}`);
      }
      const settings = { threshold: DETECTOR_PARAMS.thresholdScore, cusum: DETECTOR_PARAMS.cusumLimit, bayes: DETECTOR_PARAMS.bayesAlertProbability };
      for (const method of DETECTION_METHODS) {
        const replay = traces.alertDays(method, settings[method], 0, sim.dates.length - 1).map((a) => `${a.wardId}|${a.date}`);
        expect(real[method].length, method).toBeGreaterThan(0);
        expect(replay.sort(), method).toEqual(real[method].sort());
      }
    }, 120_000);
  }
});

describe("calibration never uses test-year data", () => {
  it("only ever asks for tuning-year days and is given only tuning outbreaks", () => {
    const sim = simOf("realistic");
    const traces = buildTraces(sim, small, DETECTOR_PARAMS);
    const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
    const requested: string[] = [];
    const watched: DetectorTraces = {
      ...traces,
      alertDays: (method, setting, from, to) => {
        requested.push(traces.dates[from], traces.dates[to]);
        const alerts = traces.alertDays(method, setting, from, to);
        requested.push(...alerts.map((a) => a.date));
        return alerts;
      },
    };
    const tuningOutbreaks = sim.answerKey.outbreaks.filter((o) => o.split === "tuning");
    for (const method of DETECTION_METHODS) {
      const result = calibrate(method, watched, tuning, tuningOutbreaks, small, BACKTEST.falseAlarmBudgets[0]);
      expect(DATA_SPLIT.tuningYears).toContain(Number(result.datesUsed.from.slice(0, 4)));
      expect(DATA_SPLIT.tuningYears).toContain(Number(result.datesUsed.to.slice(0, 4)));
    }
    expect(requested.length).toBeGreaterThan(0);
    for (const date of requested) expect(DATA_SPLIT.tuningYears, date).toContain(Number(date.slice(0, 4)));
    for (const outbreak of tuningOutbreaks) expect(DATA_SPLIT.tuningYears).toContain(Number(outbreak.startDate.slice(0, 4)));
  });

  it("gives the same locked settings when every test-year number is wildly changed", () => {
    const sim = simOf("realistic");
    const poisoned = { ...sim, rows: function* () {
      for (const r of sim.rows()) yield DATA_SPLIT.testYears.includes(Number(r.date.slice(0, 4))) ? { ...r, count: r.count * 50 + 7 } : r;
    } };
    const lockedOf = (s: typeof sim) => {
      const traces = buildTraces(s, small, DETECTOR_PARAMS);
      const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
      const outbreaks = s.answerKey.outbreaks.filter((o) => o.split === "tuning");
      return BACKTEST.falseAlarmBudgets.flatMap((budget) => DETECTION_METHODS.map((m) => calibrate(m, traces, tuning, outbreaks, small, budget).setting));
    };
    expect(lockedOf(poisoned)).toEqual(lockedOf(sim));
  }, 60_000);

  it("refuses a test-year outbreak", () => {
    const sim = simOf("realistic");
    const traces = buildTraces(sim, small, DETECTOR_PARAMS);
    const tuning = splitRange(traces.dates, "tuning", DATA_SPLIT.tuningYears);
    const testOutbreak = sim.answerKey.outbreaks.find((o) => o.split === "test")!;
    expect(() => calibrate("threshold", traces, tuning, [testOutbreak], small, 1)).toThrow(/test-year/);
  });
});

describe("repeatability", () => {
  it("the same seed gives the same result, a different seed a different one", () => {
    const first = runOne(small, 42, "realistic");
    expect(runOne(small, 42, "realistic")).toEqual(first);
    expect(runOne(small, 43, "realistic")).not.toEqual(first);
  }, 120_000);
});

describe("classifier evaluation", () => {
  it("scores only test-year outbreaks, with a Bayes setting locked on tuning years, at first alert and +3 days", async () => {
    const { evaluateClassifierOnce } = await import("../src/backtest/classifierEval.js");
    const results = evaluateClassifierOnce(small, 42, "realistic");
    expect(results.map((r) => r.budget)).toEqual(BACKTEST.falseAlarmBudgets);
    for (const result of results) {
      expect(BACKTEST.grids.bayes).toContain(result.lockedSetting);
      for (const o of result.outcomes) {
        expect(o.id.startsWith("2024") || o.id.startsWith("2025"), o.id).toBe(true);
        if (o.firstAlert) {
          expect(DATA_SPLIT.testYears).toContain(Number(o.firstAlert.date.slice(0, 4)));
          expect(o.predicted.firstAlert).not.toBeNull();
        } else {
          expect(o.predicted).toEqual({ firstAlert: null, plus3Days: null });
        }
      }
    }
  }, 60_000);
});
