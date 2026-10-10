# STATUS-A (Person 1: detection)

## Backtest rules (written 2026-10-08, BEFORE any backtest was run)

These rules were fixed before seeing a single backtest number. They must not be
changed to make results look better; any change gets a dated note here.

### Episodes
- Only alerts from the **same method** are merged.
- Two alerts join the same episode if they are in the same ward or in
  **adjacent wards** (CityModel.getNeighbours), and the later one is at most
  `BACKTEST.episodeGapDays` days (= `ALERT_COOLDOWN_DAYS`, 7) after the
  earlier one. Merging is transitive (A joins B, B joins C: one episode).
- An episode starts on its first alert day. Its **start wards** are the wards
  that alerted on that first day.
- Episodes are built separately inside the tuning years and inside the test
  years, so no episode spans both.
- **All counting is by episodes, never by alert-days.**

### Matching rule
An episode **matches** an outbreak if both are true:
1. it starts on or after the outbreak's true start date and on or before its
   true end date + `ALERT_MATCH_GRACE_DAYS` (9) days, and
2. at least one of its start wards is an affected ward of that outbreak, or a
   neighbour of an affected ward.

- An outbreak is **detected** if at least one episode matches it.
- **Delay** = (start of the first matching episode) - (true start), in days.
- A **false-alarm episode** matches no outbreak.
- The city-wide **seasonal wave** is reported separately. False alarms are given
  two ways:
  - **with the wave counted as an outbreak**: episodes matching the wave are not false alarms;
  - **with the wave excluded**: episodes matching only the wave count as false alarms.
- False-alarm rate = false-alarm episodes / (number of wards x years in the split).

### Calibration (keeps the comparison fair)
- Done separately for every seed, difficulty and city, using **only the tuning
  years (2022-2023)**: tuning-year alerts and tuning-year outbreaks only.
- Each method has one alert setting: threshold level (threshold), decision
  limit h (CUSUM), alert probability (Bayes). Everything else stays at its
  params default.
- Each setting is searched over a fixed grid (`BACKTEST.grids` in params).
- Pick the setting whose false-alarm episodes per ward-year (**wave counted as
  an outbreak**, since a seasonal rise is real illness) are **closest to
  `FALSE_ALARM_BUDGET_PER_WARD_PER_YEAR` without going over**. Ties go to
  the more sensitive setting. If no setting on the grid gets under budget,
  take the strictest one and flag it `budgetReached: false`.
- The setting is then **locked** and run **once** on the test years (2024-2025).
- So all three methods get the same false-alarm allowance. The comparison is
  "how many outbreaks, how fast, at the same alarm cost".

### "Fusion does not help here"
For each outbreak type and difficulty, if threshold or CUSUM has a median
detection rate >= Bayes **and** a median delay <= Bayes (or Bayes detects
none), that row is flagged "fusion does not help here", with the numbers.

---

## Piece status (2026-10-08)
| Piece | State |
|---|---|
| 1-3 types, params, city grid, grounded simulator | done |
| 4 detectors (threshold, CUSUM, Bayes) | done |
| 5 real Bengaluru city model (`data/city.json`) | done |
| 6 cause classifier | **not started** (`causeProbs` is still `{ unknown: 1 }`) |
| 7 backtest | **built and tested; only a PRELIMINARY --quick run on the grid city so far** |

Run it: `npm run backtest -- --city grid|real --seeds 20` (`--quick` = 2 seeds).
Writes `results/backtest.json`, `results/backtest.csv`, `results/backtest.txt`.
The final 20-seed run waits until the classifier is finished.

## Contract v2 proposals (not in types.ts or docs/contract.md yet; needs Person 2's OK)

```ts
/** results/backtest.json, written by npm run backtest. Defined in src/backtest/run.ts. */
interface BacktestResult {
  preliminary: boolean;            // true for --quick or fewer than 20 seeds
  city: "grid" | "real";
  wardCount: number;
  seeds: number[];
  difficulties: Array<"easy" | "realistic" | "hard">;
  rules: { tuningYears: number[]; testYears: number[]; falseAlarmBudgetPerWardYear: number;
           episodeGapDays: number; matchGraceDays: number; calibratedOn: string };
  summary: Array<{                 // one row per method x difficulty x cause
    method: "threshold" | "cusum" | "bayes";
    difficulty: "easy" | "realistic" | "hard";
    cause: "water" | "food" | "p2p" | "seasonal";
    detectionRate: Spread | null;  // share of test-year outbreaks detected
    medianDelayDays: Spread | null;
    outbreaksPerSeed: number;
  }>;
  falseAlarms: Array<{             // one row per method x difficulty
    method: string; difficulty: string;
    waveCounted: Spread | null;    // false-alarm episodes per ward-year, wave = outbreak
    waveExcluded: Spread | null;   // same, wave not an outbreak
    lockedSetting: Spread | null;
    budgetMissedSeeds: number;
  }>;
  fusionDoesNotHelp: Array<{ difficulty: string; cause: string; simplerMethod: "threshold" | "cusum"; text: string }>;
  runs: unknown[];                 // per-seed detail and calibration curves, for auditing
}
interface Spread { median: number; p10: number; p90: number; n: number } // across seeds
```
Suggested route for the frontend: `GET /backtest` serving this file unchanged.

## PRELIMINARY backtest: grid city, --quick (seeds 42, 43), 2026-10-08

**PRELIMINARY. Two seeds only, grid city, classifier not built. Not a result.**
Values: median [10th-90th percentile] across seeds. Test years 2024-2025, settings locked on 2022-2023.

| Difficulty | Method | Locked setting | FA/ward-yr (wave = outbreak) | FA/ward-yr (wave excluded) | Water | Food | P2P | Seasonal* |
|---|---|---|---|---|---|---|---|---|
| easy | threshold | 4.5 | 0.99 | 1.05 | 50%, 2.0 d | **75%, 1.0 d** | 67%, 4.5 d | 100%, 24 d |
| easy | cusum | 7.5 | 0.94 | 0.96 | **63%, 2.0 d** | 44%, 1.3 d | 67%, 6.0 d | 100%, 40 d |
| easy | bayes | 0.112 | 1.08 | 1.10 | 44%, 2.0 d | 44%, 2.5 d | **75%, 5.0 d** | 100%, 42 d |
| realistic | threshold | 3.75 | 1.02 | 1.20 | 44%, 13.3 d | 44%, 2.5 d | 58%, 3.5 d | 100%, 21 d |
| realistic | cusum | 9.0 | 0.97 | 1.03 | 44%, 2.8 d | 38%, 1.5 d | 67%, 7.5 d | 100%, 40 d |
| realistic | bayes | 0.166 | 1.11 | 1.16 | 13%, 1.5 d | **50%, 1.3 d** | 67%, 7.5 d | 100%, 40 d |
| hard | threshold | 4.25 | 0.91 | 1.24 | **94%, 4.3 d** | 38%, 4.0 d | 67%, 17.5 d | 100%, 0.5 d |
| hard | cusum | 13.0 | 0.91 | 1.04 | 56%, 4.3 d | 38%, 2.8 d | **83%, 8.0 d** | 100%, 5.3 d |
| hard | bayes | 0.267 | 1.04 | 1.17 | 50%, 11.3 d | 38%, 2.0 d | 58%, 6.0 d | 100%, 27 d |

Cells: detection rate, median delay. Per seed there are 8 water, 8 food, 6 p2p and 2 seasonal test outbreaks.
\* Seasonal = the city-wide wave, reported separately. Full spreads are in `results/backtest.txt`.

"Fusion does not help here" was flagged 12 times by the fixed rule. The full list is in `results/backtest.txt`:
water at easy and hard, food at easy, and seasonal at every difficulty.

### Open issue found in the preliminary run (rule NOT changed; decision needed)
The fixed matching rule needs an episode to **start** after the outbreak's true start.
- On the easy setting, the seasonal wave produces one merged episode covering 199 of 200 wards for about two months. Local outbreaks inside it count as **missed**, because the episode that covers them started earlier.
- Rain-surge episodes that start a few days before a water outbreak swallow it the same way.
- This is why water detection is *higher* on hard (94% threshold) than on easy (50%).
- The seasonal wave is also "detected" by unrelated noise episodes that happen to start inside its window (0.5 d delay on hard).

Possible fixes, for Person 1 to choose before the final run. Any change gets a dated note here.
1. Also count an ongoing episode as matching if it **spreads into** an affected ward (a new ward-alert) during the outbreak window.
2. Do not merge across neighbouring wards while a city-wide wave is active.
3. Keep the rule as is and report this as a known limitation.
