# STATUS (detection module, merged)

This file replaces `STATUS-A.md` (backtest session) and `STATUS-B.md` (classifier,
live feed and Indore session). Both are kept unchanged in `docs/archive/`.

## Piece status (2026-10-08, final session)
| Piece | State |
|---|---|
| 1-3 types, params, grid city, grounded simulator | done |
| 4 detectors (threshold, CUSUM, Bayes) | done |
| 5 real Bengaluru city model (`data/city.json`) | done |
| 6 cause classifier (triage hint) | done; fixes in this session (below) |
| 7 backtest | done; matching rule v2, two budgets, FINAL 20-seed run on the real city (below) |
| 8a live feed (`generateLiveDay`, `generateHistory`, `rowsArrivingOn`) | done |
| 8b `runDetector` (detector + classifier + cooldown for the Lambda) | done (`src/runDetector.ts`, 5 tests) |
| 9 Indore case study (`scenarios/indore.json`, `docs/MATH.md`) | done; 2 sources still TODO (see archive/STATUS-B.md) |

## npm scripts
| Script | What |
|---|---|
| `npm test` | all tests |
| `npm run backtest -- --city real\|grid --seeds 20 [--quick]` | backtest, writes `results/backtest.{json,csv,txt}` |
| `npm run eval-classifier` | classifier accuracy (added in step A, as asked in STATUS-B "Needed scripts") |
| `npm run build-city`, `check-city-data`, `fetch-osm-food`, `fetch-rain` | data building |
| `npm run detect-demo -- --city=grid\|real`, `sim-summary` | sanity printouts |
| `npm run chance-check -- --city real --seeds 5` | chance check (diagnostic), writes `results/chance.json` |
| `npm run handoff` | rebuilds `handoff/` |

## Backtest rules
The original rules, written before any run, are in `docs/archive/STATUS-A.md`.
They still hold, except for what is listed under "Changes after preliminary look".
- Episodes: alerts of one method, in the same or adjacent wards, at most 7 days apart
  (`BACKTEST.episodeGapDays` = `ALERT_COOLDOWN_DAYS`), merge into one episode.
- Calibration: per seed, difficulty, city, method and budget, on **tuning years 2022-2023 only**.
  It picks the alert setting whose false-alarm episodes per ward-year (wave counted as an
  outbreak) come closest to the budget without going over. The setting is locked, then run
  **once** on test years 2024-2025.
- "Fusion does not help here": flagged when threshold or CUSUM has a median detection rate
  >= Bayes and a median delay <= Bayes (or Bayes detects none), for the same budget,
  difficulty, cause and subset.

## Changes after preliminary look
Each change was decided by Person 1 after the PRELIMINARY run and is recorded with its reason.
None of them is a tuning of a number to improve results.

### 1. Backtest matching rule v2 (2026-10-08): a measurement bug, not tuning
- **Before (v1):** an outbreak was detected only if an EPISODE *started* inside the
  outbreak's window, in or next to an affected ward.
- **Problem seen:** the seasonal wave (and rain surges) make long episodes. An outbreak that
  happened inside one was counted as missed, even though the detector was alerting in that
  ward during the outbreak. This made easy look worse than hard.
- **Now (v2):**
  - **Detected:** an outbreak is detected at the FIRST alert-day of a method in an affected
    ward or a neighbour of one, between the true start and the true end + 9 grace days.
    Episode start no longer matters for detection.
  - **False alarm:** an episode that contains no alert-day matching any outbreak. It is
    counted with the wave as an outbreak, and with the wave excluded (only local outbreaks
    can clear an episode).
  - **The seasonal wave is reported separately.** Local outbreak results are given twice:
    for all local outbreaks, and for only those whose days do not touch the wave's days.
  - **Two false-alarm budgets:** 1 and 0.25 episodes per ward-year
    (`BACKTEST.falseAlarmBudgets`), each calibrated separately, still on 2022-2023 only.
- **Tests:**
  - An outbreak inside a long earlier episode is still detected.
  - An unrelated episode is a false alarm.
  - Wave-only episodes count as false alarms only when the wave is excluded.
  - Overlap with the wave is flagged.
- **Code:** `src/backtest/evaluate.ts`, `src/backtest/run.ts`, `tests/backtest.test.ts`.

### 2. Classifier and simulator fixes (2026-10-08): defects, not tuning
Both flaws were reported in `docs/archive/STATUS-B.md` before this session. Neither fix was
judged by looking at evaluation results.

**a. Onset speed** (`onsetFromSeries` in `src/classifier.ts`)
- **Before:** the single highest day in the window was the peak. On a noisy plateau, any
  later high day became the new peak, so a 3-day water ramp slowly read as "gradual".
- **Now:**
  1. Scores are smoothed with a 3-day trailing average (`onsetSmoothingDays`).
  2. The peak is the FIRST day that average reaches 85% of its highest value in the window
     (`onsetPeakShare`).
  3. As before, we walk back over raw days above the rise line, allowing one quiet day.
- **New settings:** both are ASSUMPTION - needs source. They were chosen only against
  hand-built series: the existing classifier tests plus a new "noisy plateau" test.
  70% was tried first and rejected, because it cut off a steady climb too early.
- **Test changes:** the hand-built p2p case now reads onset 5 (was 6) and the mixed case
  onset 2 (was 4). Both still give the same top cause.
- **New test:** one noisy day on a plateau gives the same onset as no noise (the old rule
  gave 5 instead of 3).

**b. Seasonal step on the 1st of each month** (`src/season.ts`, used by `simulator.ts` and `live.ts`)
- **Before:** `SEASONAL_EFFECT[month]` stepped on the 1st (June 1.3 to July 1.4 overnight).
  About 35% of wards then looked "quietly elevated" against their 8-week baseline, and the
  classifier read that as seasonal.
- **Now:** each month's value sits on the middle day of the month, with a straight line in
  between (December wraps to January). The monthly values are unchanged.
- **Consequence:** the simulated data differs slightly from earlier runs, so all FINAL
  numbers come from the new simulator.
- **Tests:** `tests/season.test.ts`.

**c. Classifier evaluation** (`src/backtest/classifierEval.ts`, `npm run eval-classifier`)
- **Settings:** the Bayes alert setting is calibrated on tuning years only, the same way as
  the backtest, for each budget. Classifier settings are not chosen in the evaluation.
- **Scope:** test years only, 20 seeds, every difficulty, Bayes detector.
- **What is scored:** each outbreak's first matching alert-day (rule v2), and the same ward
  again 3 days later. Both use only alerts and rows known by that day.
- **Output:** `results/classifier.json` and `results/classifier.txt`.

**d. Classifier reasons in `Alert.evidence`**
`classifyAlerts` now appends the classifier's plain-English reasons after the detector's own
lines. This uses the existing field, so no contract change is needed.

## runDetector (step D)
`runDetector(rows, today, city, params, state)` returns `{ alerts, state, heldBack }`.
- **Detector:** runs the chosen detector (default Bayes) with the same `detect()` code
  that the backtest replay is tested against, alert-day for alert-day
  (`tests/backtest.test.ts`, "fast replay equals the real detectors").
- **Classifier:** fills `causeProbs` and `suspectedZoneId`, and appends its reasons to `evidence`.
- **Cooldown:** a ward that alerted in the last 7 days (`BACKTEST.episodeGapDays`) is held
  back, not re-alerted. It is listed in `heldBack`.
- **State:** plain JSON (`DetectorState`). CUSUM keeps one record per ward and signal.
  Schema: `docs/contract-v2.md`.
- **Tests (`tests/runDetector.test.ts`):**
  - Same input gives the same output.
  - An outbreak injected with generateHistory + generateLiveDay is alerted within the derived
    6 days, with nothing in the zone before it starts.
  - No ward re-alerts inside its cooldown.
  - Rows dated after today are never read.
  - Days must move forward.
- **Known gap between backtest and live:** if an outbreak's first alert-day is in a ward that
  already alerted in the previous 7 days, the backtest counts it as detected that day. Live,
  the ward is already flagged, so no new email is sent.

### 3. Live Bayes setting (2026-10-08, after the FINAL runs)
- **Setting:** `RUN_DETECTOR.bayesAlertProbability` = 10^0.4 / (1 + 10^0.4) = **0.715**.
  It is the median Bayes setting locked on tuning years only over 20 seeds, at a budget of 0.25
  (FINAL, real city, realistic).
- **Why budget 0.25 and not 1:** the chance check below shows that at budget 1 most
  "detections" are chance.
- **Fairness:** this is a deployment choice. It does not change any reported result.
- **To confirm:** Person 1 should confirm this choice.

### 4. Chance check added (2026-10-08, after the FINAL runs; a diagnostic, not a rule change)
- **Why:** the FINAL backtest showed near-100% detection with 0-day median delays at budget 1.
  A 0-day delay is barely possible, because Bayes needs 2 signals and pharmacy lags 1-2 days.
- **What it does:** `npm run chance-check` (`scripts/chance-check.ts`, `results/chance.json`)
  moves every test-year local outbreak to a window where no real outbreak (or the wave) touches
  its wards. It then scores the same locked alerts against these phantoms with the same matching rule.
- **What a hit means:** any phantom "detection" is chance.

## FINAL results (real city, 243 wards, 20 seeds 42-61, test years 2024-2025)
Files: `results/backtest.json`, `.csv` and `.txt`, and `results/classifier.json` and `.txt`.
All are marked `"status": "FINAL"`. Medians across seeds; the 10th-90th percentiles are in the `.txt` files.
Per seed there are 8 water, 8 food, 6 p2p and 2 seasonal test outbreaks. "Outside the wave" is
about 5 water, 6 food and 5 p2p.

**Budget 1** (detected, median delay; local outbreaks: all / outside the wave)

| Difficulty | Method | FA/ward-yr (wave = outbreak) | FA/ward-yr (wave excluded) | Water | Food | P2P | Seasonal wave |
|---|---|---|---|---|---|---|---|
| easy | threshold | 1.02 | 1.09 | 100% 0.5d / 100% 1.0d | 100% 1.0d / 100% 1.0d | 100% 2.3d / 100% 2.5d | 100% 0.0d |
| easy | cusum | 0.98 | 1.00 | 100% 1.0d / 100% 1.0d | 100% 0.8d / 100% 1.0d | 100% 2.5d / 100% 3.0d | 100% 0.0d |
| easy | bayes | 0.75 | 0.76 | 100% 0.5d / 100% 1.0d | 100% 0.8d / 100% 1.0d | 100% 1.5d / 100% 2.5d | 100% 0.0d |
| realistic | threshold | 1.05 | 1.15 | 100% 0.3d / 100% 1.0d | 100% 1.0d / 100% 1.0d | 100% 1.8d / 100% 2.0d | 100% 0.0d |
| realistic | cusum | 0.86 | 0.91 | 100% 0.0d / 100% 0.3d | 100% 1.0d / 100% 1.0d | 100% 1.0d / 100% 1.3d | 100% 0.0d |
| realistic | bayes | 0.77 | 0.81 | 100% 0.0d / 100% 0.0d | 100% 0.5d / 100% 1.0d | 100% 2.0d / 100% 2.0d | 100% 0.0d |
| hard | threshold | 1.03 | 1.18 | 100% 0.8d / 100% 1.0d | 94% 1.0d / 100% 2.0d | 100% 2.0d / 100% 2.0d | 100% 0.0d |
| hard | cusum | 0.84 | 0.92 | 100% 0.0d / 100% 0.5d | 100% 1.0d / 100% 2.0d | 100% 2.0d / 100% 2.3d | 100% 0.0d |
| hard | bayes | 0.82 | 0.90 | 100% 0.0d / 100% 0.0d | 94% 0.5d / 93% 1.0d | 100% 2.8d / 100% 3.8d | 100% 0.0d |

**Budget 0.25** (detected, median delay; local outbreaks: all / outside the wave)

| Difficulty | Method | FA/ward-yr (wave = outbreak) | FA/ward-yr (wave excluded) | Water | Food | P2P | Seasonal wave |
|---|---|---|---|---|---|---|---|
| easy | threshold | 0.23 | 0.27 | 100% 1.0d / 100% 1.0d | 100% 1.0d / 100% 1.0d | 100% 4.0d / 100% 4.0d | 100% 0.8d |
| easy | cusum | 0.22 | 0.25 | 100% 2.0d / 100% 2.0d | 100% 1.5d / 100% 2.0d | 100% 5.0d / 100% 5.0d | 100% 0.0d |
| easy | bayes | 0.20 | 0.21 | 100% 1.3d / 100% 1.5d | 100% 1.5d / 100% 1.5d | 100% 4.8d / 100% 5.0d | 100% 0.0d |
| realistic | threshold | 0.22 | 0.36 | 100% 1.8d / 100% 2.0d | 88% 1.3d / 87% 1.5d | 83% 5.8d / 78% 7.5d | 100% 0.3d |
| realistic | cusum | 0.23 | 0.28 | 100% 2.0d / 100% 3.0d | 88% 3.0d / 82% 3.5d | 100% 8.0d / 100% 8.0d | 100% 0.0d |
| realistic | bayes | 0.24 | 0.28 | 100% 1.5d / 100% 2.5d | 88% 2.0d / 86% 2.8d | 83% 7.5d / 100% 7.5d | 100% 0.8d |
| hard | threshold | 0.22 | 0.36 | 63% 3.0d / 50% 3.0d | 25% 4.0d / 17% 5.3d | 33% 13.0d / 29% 12.0d | 100% 6.5d |
| hard | cusum | 0.27 | 0.37 | 100% 3.8d / 100% 5.5d | 56% 2.8d / 50% 4.5d | 83% 10.3d / 78% 12.0d | 100% 0.0d |
| hard | bayes | 0.26 | 0.39 | 100% 2.5d / 100% 4.0d | 50% 3.0d / 40% 5.0d | 67% 8.3d / 67% 9.8d | 100% 1.5d |


### Chance check (5 seeds, `results/chance.json`): local outbreaks detected, real vs phantom
| Budget | Difficulty | Threshold real / chance | CUSUM real / chance | Bayes real / chance |
|---|---|---|---|---|
| 1 | easy | 100% / 86% | 100% / 64% | 100% / 59% |
| 1 | realistic | 100% / 100% | 100% / 77% | 100% / 82% |
| 1 | hard | 95% / 100% | 100% / 82% | 100% / 82% |
| 0.25 | easy | 100% / 27% | 100% / 27% | 100% / 27% |
| 0.25 | realistic | 77% / 18% | 95% / 27% | 91% / 23% |
| 0.25 | hard | 41% / 36% | 77% / 32% | 68% / 27% |

**How to read it:**
- **At budget 1** the matching window (affected wards + neighbours, start to end + 9 days)
  is so likely to catch an unrelated alert that real and chance detection are about the same.
  Budget-1 detection rates and delays **must not be quoted as skill**.
- **At budget 0.25,** detection is well above chance, except for threshold at hard (41% vs 36%).
- **The seasonal wave touches every ward,** so any alert anywhere "detects" it. The 100%
  seasonal detection is not meaningful at either budget.

### Classifier accuracy (Bayes, test years, 20 seeds; top cause correct / classified, pooled)
| Budget | Difficulty | When | Water | Food | P2P | Seasonal | All | Water zone named |
|---|---|---|---|---|---|---|---|---|
| 1 | easy | first alert | 35% | 59% | 0% | 50% | 36% | 33% |
| 1 | easy | +3 days | 66% | 57% | 2% | 90% | 49% | 61% |
| 1 | realistic | first alert | 11% | 58% | 0% | 48% | 27% | 13% |
| 1 | realistic | +3 days | 29% | 48% | 2% | 65% | 32% | 43% |
| 1 | hard | first alert | 2% | 51% | 0% | 18% | 18% | 11% |
| 1 | hard | +3 days | 7% | 46% | 1% | 30% | 20% | 26% |
| 0.25 | easy | first alert | 36% | 84% | 1% | 20% | 42% | 36% |
| 0.25 | easy | +3 days | 78% | 77% | 24% | 90% | 65% | 73% |
| 0.25 | realistic | first alert | 21% | 84% | 10% | 20% | 38% | 23% |
| 0.25 | realistic | +3 days | 47% | 78% | 13% | 60% | 50% | 60% |
| 0.25 | hard | first alert | 4% | 48% | 1% | 18% | 14% | 14% |
| 0.25 | hard | +3 days | 17% | 56% | 5% | 35% | 25% | 40% |

Chance level for 5 causes is 20%. A detected outbreak counts once per seed: 160 water, 160 food,
about 120 p2p and 40 seasonal over 20 seeds, fewer when missed. Missed counts and full
confusion tables are in `results/classifier.txt`.

### Where fusion does not help (all 43 cases flagged by the fixed rule)
  - fusion does not help here: water, easy, budget 1: threshold detects 100% (median delay 0.5 d, false alarms 1.02/ward-yr) vs bayes 100% (median delay 0.5 d, false alarms 0.75/ward-yr)
  - fusion does not help here: water (outside the wave), easy, budget 1: threshold detects 100% (median delay 1.0 d, false alarms 1.02/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: water (outside the wave), easy, budget 1: cusum detects 100% (median delay 1.0 d, false alarms 0.98/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: food, easy, budget 1: cusum detects 100% (median delay 0.8 d, false alarms 0.98/ward-yr) vs bayes 100% (median delay 0.8 d, false alarms 0.75/ward-yr)
  - fusion does not help here: food (outside the wave), easy, budget 1: threshold detects 100% (median delay 1.0 d, false alarms 1.02/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: food (outside the wave), easy, budget 1: cusum detects 100% (median delay 1.0 d, false alarms 0.98/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: p2p (outside the wave), easy, budget 1: threshold detects 100% (median delay 2.5 d, false alarms 1.02/ward-yr) vs bayes 100% (median delay 2.5 d, false alarms 0.75/ward-yr)
  - fusion does not help here: seasonal, easy, budget 1: threshold detects 100% (median delay 0.0 d, false alarms 1.02/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: seasonal, easy, budget 1: cusum detects 100% (median delay 0.0 d, false alarms 0.98/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.75/ward-yr)
  - fusion does not help here: water, easy, budget 0.25: threshold detects 100% (median delay 1.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 1.3 d, false alarms 0.20/ward-yr)
  - fusion does not help here: water (outside the wave), easy, budget 0.25: threshold detects 100% (median delay 1.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 1.5 d, false alarms 0.20/ward-yr)
  - fusion does not help here: food, easy, budget 0.25: threshold detects 100% (median delay 1.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 1.5 d, false alarms 0.20/ward-yr)
  - fusion does not help here: food, easy, budget 0.25: cusum detects 100% (median delay 1.5 d, false alarms 0.22/ward-yr) vs bayes 100% (median delay 1.5 d, false alarms 0.20/ward-yr)
  - fusion does not help here: food (outside the wave), easy, budget 0.25: threshold detects 100% (median delay 1.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 1.5 d, false alarms 0.20/ward-yr)
  - fusion does not help here: p2p, easy, budget 0.25: threshold detects 100% (median delay 4.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 4.8 d, false alarms 0.20/ward-yr)
  - fusion does not help here: p2p (outside the wave), easy, budget 0.25: threshold detects 100% (median delay 4.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 5.0 d, false alarms 0.20/ward-yr)
  - fusion does not help here: p2p (outside the wave), easy, budget 0.25: cusum detects 100% (median delay 5.0 d, false alarms 0.22/ward-yr) vs bayes 100% (median delay 5.0 d, false alarms 0.20/ward-yr)
  - fusion does not help here: seasonal, easy, budget 0.25: cusum detects 100% (median delay 0.0 d, false alarms 0.22/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.20/ward-yr)
  - fusion does not help here: water, realistic, budget 1: cusum detects 100% (median delay 0.0 d, false alarms 0.86/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: food (outside the wave), realistic, budget 1: threshold detects 100% (median delay 1.0 d, false alarms 1.05/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: food (outside the wave), realistic, budget 1: cusum detects 100% (median delay 1.0 d, false alarms 0.86/ward-yr) vs bayes 100% (median delay 1.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: p2p, realistic, budget 1: threshold detects 100% (median delay 1.8 d, false alarms 1.05/ward-yr) vs bayes 100% (median delay 2.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: p2p, realistic, budget 1: cusum detects 100% (median delay 1.0 d, false alarms 0.86/ward-yr) vs bayes 100% (median delay 2.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: p2p (outside the wave), realistic, budget 1: threshold detects 100% (median delay 2.0 d, false alarms 1.05/ward-yr) vs bayes 100% (median delay 2.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: p2p (outside the wave), realistic, budget 1: cusum detects 100% (median delay 1.3 d, false alarms 0.86/ward-yr) vs bayes 100% (median delay 2.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: seasonal, realistic, budget 1: threshold detects 100% (median delay 0.0 d, false alarms 1.05/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: seasonal, realistic, budget 1: cusum detects 100% (median delay 0.0 d, false alarms 0.86/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.77/ward-yr)
  - fusion does not help here: water (outside the wave), realistic, budget 0.25: threshold detects 100% (median delay 2.0 d, false alarms 0.22/ward-yr) vs bayes 100% (median delay 2.5 d, false alarms 0.24/ward-yr)
  - fusion does not help here: food, realistic, budget 0.25: threshold detects 88% (median delay 1.3 d, false alarms 0.22/ward-yr) vs bayes 88% (median delay 2.0 d, false alarms 0.24/ward-yr)
  - fusion does not help here: food (outside the wave), realistic, budget 0.25: threshold detects 87% (median delay 1.5 d, false alarms 0.22/ward-yr) vs bayes 86% (median delay 2.8 d, false alarms 0.24/ward-yr)
  - fusion does not help here: p2p, realistic, budget 0.25: threshold detects 83% (median delay 5.8 d, false alarms 0.22/ward-yr) vs bayes 83% (median delay 7.5 d, false alarms 0.24/ward-yr)
  - fusion does not help here: seasonal, realistic, budget 0.25: threshold detects 100% (median delay 0.3 d, false alarms 0.22/ward-yr) vs bayes 100% (median delay 0.8 d, false alarms 0.24/ward-yr)
  - fusion does not help here: seasonal, realistic, budget 0.25: cusum detects 100% (median delay 0.0 d, false alarms 0.23/ward-yr) vs bayes 100% (median delay 0.8 d, false alarms 0.24/ward-yr)
  - fusion does not help here: water, hard, budget 1: cusum detects 100% (median delay 0.0 d, false alarms 0.84/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.82/ward-yr)
  - fusion does not help here: p2p, hard, budget 1: threshold detects 100% (median delay 2.0 d, false alarms 1.03/ward-yr) vs bayes 100% (median delay 2.8 d, false alarms 0.82/ward-yr)
  - fusion does not help here: p2p, hard, budget 1: cusum detects 100% (median delay 2.0 d, false alarms 0.84/ward-yr) vs bayes 100% (median delay 2.8 d, false alarms 0.82/ward-yr)
  - fusion does not help here: p2p (outside the wave), hard, budget 1: threshold detects 100% (median delay 2.0 d, false alarms 1.03/ward-yr) vs bayes 100% (median delay 3.8 d, false alarms 0.82/ward-yr)
  - fusion does not help here: p2p (outside the wave), hard, budget 1: cusum detects 100% (median delay 2.3 d, false alarms 0.84/ward-yr) vs bayes 100% (median delay 3.8 d, false alarms 0.82/ward-yr)
  - fusion does not help here: seasonal, hard, budget 1: threshold detects 100% (median delay 0.0 d, false alarms 1.03/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.82/ward-yr)
  - fusion does not help here: seasonal, hard, budget 1: cusum detects 100% (median delay 0.0 d, false alarms 0.84/ward-yr) vs bayes 100% (median delay 0.0 d, false alarms 0.82/ward-yr)
  - fusion does not help here: food, hard, budget 0.25: cusum detects 56% (median delay 2.8 d, false alarms 0.27/ward-yr) vs bayes 50% (median delay 3.0 d, false alarms 0.26/ward-yr)
  - fusion does not help here: food (outside the wave), hard, budget 0.25: cusum detects 50% (median delay 4.5 d, false alarms 0.27/ward-yr) vs bayes 40% (median delay 5.0 d, false alarms 0.26/ward-yr)
  - fusion does not help here: seasonal, hard, budget 0.25: cusum detects 100% (median delay 0.0 d, false alarms 0.27/ward-yr) vs bayes 100% (median delay 1.5 d, false alarms 0.26/ward-yr)

Many of these are ties: every method finds 100% with the same median delay.
- **At budget 1** they are mostly meaningless, because detection there is at chance level.
- **At budget 0.25 the cases that matter are:**
  - threshold is faster than Bayes on food (realistic: 1.3 d vs 2.0 d) and p2p (5.8 d vs 7.5 d)
    at the same detection rate;
  - CUSUM beats Bayes on food at hard (56% vs 50%);
  - CUSUM finds more p2p than Bayes at hard (83% vs 67%). The fixed rule did not flag this,
    because Bayes is faster (8.3 d vs 10.3 d).
- **Where Bayes clearly helps:** water at hard, budget 0.25 (100% vs threshold 63%, and faster
  than CUSUM, 2.5 d vs 3.8 d).
- **False alarms are close but not equal:** at budget 1, Bayes ends up with fewer test-year false
  alarms (0.75-0.82) than the others (0.84-1.05). Its grid steps are coarse near the budget.

## Honest notes for the writeup
1. **Everything is simulated.** Pharmacy, hospital and complaint data are synthetic. Outbreaks
   are planted by our own simulator, and the classifier's rules mirror how the simulator plants
   them, so all numbers are optimistic for real life.
2. **Matching rule:** the v2 rule was decided after the preliminary look, to fix a measurement
   bug. At budget 1 it is too generous: detections there are at chance level. Quote budget 0.25,
   always next to its chance level.
3. **Bayes is not uniformly better.** At budget 0.25 it is best for water at hard, about tied
   elsewhere, and slower than threshold for food and p2p at realistic. CUSUM is the strongest
   for p2p and food at hard.
4. **The classifier is a weak triage hint:**
   - food is named correctly most of the time (about 50-85%);
   - water is named poorly on the first alert (2-36%) and better 3 days later (7-78%);
   - p2p is almost never named (0-24%);
   - seasonal: 18-50% on the first alert, 30-90% three days later.
   It must be labelled "triage hint, not a diagnosis".
5. **The seasonal wave is not really "detected".** It touches every ward, so any alert counts.
6. **Cooldown gap:** live, a ward that already alerted in the last 7 days is not re-alerted.
   The backtest does not model this hold-back.
7. **Assumptions:** the onset fix (3-day average, 85% share) and the smooth season are new
   ASSUMPTIONs, chosen on hand-built cases. All other parameter sources are unchanged
   (see `src/params*.ts`).
8. **Indore:** two sources are still unverified (`docs/archive/STATUS-B.md`). Indore is a case
   study only; no detection result is claimed for it.

### 5. Decisions on the frontend's questions (2026-10-08, Person 1)
- **Evidence split (supersedes change 2d):**
  - `Alert.evidence` keeps only the detector's reasons. The classifier's reasons are returned
    separately: `classifyAlertsDetailed()` gives `{ alert, causeEvidence }`, and `runDetector`
    returns `causeEvidence` keyed by ward id.
  - The API will put them in `AlertRecord.causeEvidence` (`docs/contract-v2.md` section 4b).
  - The handoff sample was regenerated.
- **`wardRisk(rows, today, city, params)`** in `src/runDetector.ts` gives the Bayes chance for
  EVERY ward. It uses the same code path as `runDetector`: `bayes.detect` now runs on a shared
  `bayes.assessWards()`, and nothing is copied.
  - **Tests:** wards above the alert line with 2+ signals are exactly `runDetector`'s sent and
    held-back alerts, with identical probabilities. `wardRisk` never reads future rows.
  - **Unchanged:** the replay-equality tests still pass, so no detection setting or result changed.
  - **API:** served as `GET /risk?date=` and labelled "relative risk (simulated health data)".
- **Chance level per outbreak type, same 20 seeds** (`npm run add-chance`, `src/backtest/chance.ts`):
  - It is computed per method, difficulty, outbreak type and budget, and added to
    `results/backtest.json` as `chanceCheck`. The table is in `results/chance-by-type.txt`.
  - Seasonal is "not computed", because the wave touches every ward.
  - **Confirmed identical:** the script recomputed the locked setting and every real test-year
    outcome for all 360 method and budget runs (20 seeds x 3 difficulties x 3 methods x 2 budgets).
    All matched the stored FINAL results exactly. The file is written only if everything except
    `chanceCheck` is unchanged, and it was.
  - The 5-seed `results/chance.json` is now superseded by `chanceCheck`.
- **Sources verified** (`data/SOURCES.md`): both checked byte for byte against the published files.
  - `data/wards.geojson` is identical to DataMeet `Bangalore/BBMP.geojson` (from KGIS/KSRSAC).
    Its licence is **CC BY-SA 2.5 India**, as stated in that folder's Readme. This is not CC BY 4.0:
    the repo default applies only "unless explicitly stated". Because of ShareAlike, `city.json`
    must be shared under the same licence.
  - The BWSSB KML is identical to the OpenCity resource (KSRSAC, credit Vaidyanathan R, listed as
    Public Domain).

Chance level at budget 0.25, realistic, Bayes (20 seeds):
| | Water | Food | P2P |
|---|---|---|---|
| Detected | 100% | 88% | 83% |
| By chance | 13% | 25% | 33% |

Full table in `results/chance-by-type.txt`.
