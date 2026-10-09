# Contract v2 (detection module <-> ingestion/infra/frontend)

**Status: PROPOSAL from Person 1, 2026-10-08, revised the same day with Person 1's decisions on the
frontend's questions (items 6 and 9-13 below).** Nothing here is in `src/types.ts` yet.
`types.ts` (contract v1) is unchanged. Please agree before anyone builds on it.
`docs/contract.md` (v1, owned by Person 2) is not in this repo, so "v1" below means
`src/types.ts` plus what the earlier STATUS files promised.

---

## What changed from v1 (plain English)
1. **Rows now say when they arrived.** Each signal row carries `reportedOn`: the day the row
   reached us. Hospital numbers often arrive 1-3 days late. The detector must not see a row
   before it arrived, or the backtest numbers would not be honest. Database: add a
   `reported_on` column.
2. **A late correction replaces the row.** If the same ward, signal, date and source arrives
   again, it updates the old row (new count, new `reported_on`). It does not add a second row.
3. **One function to call.** The Lambda calls
   `runDetector(rows, today, city, params, state)` once a day. It returns the alerts to send
   and a small state object to save until tomorrow.
4. **A state table.** The detector remembers a few things between days: which wards alerted
   recently (cooldown), recent alerts (context for the cause hint), and for CUSUM one running
   sum per ward and signal. P3 stores this as one JSON value (or, for CUSUM, a small table, below).
5. **The cooldown is inside `runDetector`.** A ward that alerted in the last 7 days is not
   alerted again. The frontend no longer needs to remove daily duplicates.
6. **The `Alert` shape is unchanged.** `causeProbs` and `suspectedZoneId` are now filled by the
   cause classifier (triage hint). `Alert.evidence` keeps only the **detector's** reasons. The
   classifier's reasons come separately: `runDetector` returns them in `causeEvidence`, and the API
   puts them in `AlertRecord.causeEvidence`. (This replaces an earlier draft that appended them
   to `evidence`.)
7. **New read-only endpoint `GET /backtest`.** It serves the FINAL backtest results file for
   the "how well does it work" page.
8. **Ward ids are the real BBMP ward numbers.** Ward id = `KGISWardNo` (1-243) and zone id =
   `KGISSub_DivisionID` (BWSSB sub-division), from `data/city.json` (handoff/city.json).
9. **Alerts are served as `AlertRecord`.** An `AlertRecord` wraps the contract `Alert` with an
   id, a status (open, acknowledged, resolved), a creation time, the classifier's reasons, and a
   list of events (who did what, when). Officers acknowledge, resolve and add notes through
   `/alerts/{id}/...` routes (section 4b).
10. **`X-Officer-Name` header.** Free text, demo only, sent on officer and demo routes. It is the
    name shown in the activity timeline. There is no login.
11. **`GET /risk?date=`** gives every ward's relative risk for the map. It comes from
    `wardRisk()`, which uses the same Bayes code as `runDetector`. It is not an alert.
12. **`GET /rain?from=&to=`** gives daily city-wide rainfall (real, Open-Meteo).
13. **No `/summary` route.** The frontend works out open alerts, alerts today and so on from
    `GET /alerts`. `GET /backtest` now also carries `chanceCheck`: the chance level per method,
    difficulty, budget and outbreak type.

---

## 1. Signal rows

```ts
// v1 (unchanged, src/types.ts)
interface SignalRow { wardId: number; signalType: SignalType; date: string; count: number; sourceTag: SourceTag }

// v2 proposal
interface LiveSignalRow extends SignalRow {
  /** YYYY-MM-DD: the day this row reached our system (>= date). For real-time feeds, equal to date. */
  reportedOn: string;
}
```

### Database (`signals` table)
```sql
ALTER TABLE signals ADD COLUMN reported_on DATE;            -- new
UPDATE signals SET reported_on = date WHERE reported_on IS NULL;
ALTER TABLE signals ALTER COLUMN reported_on SET NOT NULL;
-- unique key stays the same:
--   UNIQUE (ward_id, signal_type, date, source_tag)

-- a later arrival for the same key UPDATES the row:
INSERT INTO signals (ward_id, signal_type, date, count, source_tag, reported_on)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (ward_id, signal_type, date, source_tag)
DO UPDATE SET count = EXCLUDED.count, reported_on = EXCLUDED.reported_on;
```
- `reported_on` = the day the webhook or form delivered the row (Asia/Kolkata date), never earlier than `date`.
- **Rain** (real, Open-Meteo): one row per ward per day, same mm everywhere, `source_tag = 'real'`, `reported_on = date`.
- **Effect of an update:** a corrected row becomes visible from its new `reported_on`. Re-running
  an old day therefore sees the corrected row only if it arrived by then. This is the honest behaviour.

### What the Lambda loads each day
```sql
SELECT ward_id, signal_type, date, count, source_tag, reported_on
FROM signals
WHERE date >= $today::date - 70 AND date <= $today AND reported_on <= $today;
```
Load 70 days (`LIVE.recommendedHistoryDays`: 8-week baseline + 14 days for the classifier).
Map columns to `{ wardId, signalType, date, count, sourceTag, reportedOn }`. `runDetector`
also hides any row with `reportedOn > today` itself, so the filter is a safety net, not the only guard.

---

## 2. `runDetector` (final signature)

```ts
// src/runDetector.ts
function runDetector(
  rows: LiveSignalRow[],          // also accepts a SignalIndex; rain rows included
  today: string,                  // YYYY-MM-DD, Asia/Kolkata
  city: CityModel,                // RealCity.fromFile("city.json")
  params?: RunDetectorParams,     // default RUN_DETECTOR_PARAMS (Bayes, locked FINAL setting, cooldown 7)
  state?: DetectorState,          // yesterday's state; omit on the very first run
): {
  alerts: Alert[];                         // evidence = the detector's reasons only
  causeEvidence: Record<string, string[]>; // classifier's reasons per sent alert, keyed by ward id
  state: DetectorState;
  heldBack: number[];
};
```
- `alerts`: send these (email + map). Each one has the classifier's `causeProbs` and
  `suspectedZoneId`, and the detector's evidence lines.
- `causeEvidence[String(alert.wardId)]`: the classifier's reasons for that alert. Store them as
  `AlertRecord.causeEvidence`. The last line always reads "triage hint, not a diagnosis: most
  likely X (NN%); an officer must confirm".
- `state`: save it, and pass it in tomorrow.
- `heldBack`: wards that alerted again inside their cooldown (still active, no new email).
- **Days must move forward.** Calling it again for the same or an earlier day with a newer
  state throws. To re-run a day, use the state saved before that day.
- It never reads rows dated after `today` (that throws inside) and ignores rows reported after `today`.
- It is deterministic: the same input always gives the same output.

### `wardRisk` (for `GET /risk`)
```ts
function wardRisk(rows, today, city, params?): Array<{
  wardId: number;
  probability: number;                       // fused Bayes chance of an outbreak, 0-1
  contributingSignals: Array<"complaint" | "pharmacy" | "hospital">;
}>;   // one entry for EVERY ward
```
- It uses exactly the same code path as `runDetector`'s Bayes detector (`bayes.assessWards`),
  with no alert line, no 2-signal rule and no cooldown.
- A test checks that the wards above the alert line with 2+ signals are exactly `runDetector`'s
  sent and held-back alerts, with identical probabilities.
- Label it on the map as **"relative risk (simulated health data)"**.

```ts
interface RunDetectorParams {
  method: "threshold" | "cusum" | "bayes";   // default "bayes"
  detector: DetectorParams;                   // src/params.ts
  classifier: ClassifierParams;               // src/params.classifier.ts
  cooldownDays: number;                       // default 7
}
```

## 3. Detector state (plain JSON)

```ts
interface DetectorState {
  version: 1;
  method: "threshold" | "cusum" | "bayes";
  lastRunDate: string | null;                       // the day this state is "as of"
  cusum: CusumState | null;                         // only for method "cusum"
  lastAlertDate: Record<string, string>;            // ward id -> last raw alert day (cooldown); only wards still in cooldown
  recentAlerts: Array<{ wardId: number; date: string }>; // last 14 days of raw alerts (classifier context)
}

/** CUSUM: one record per ward and signal. */
interface CusumState {
  cells: Record<string, {      // key "wardId:signal", e.g. "57:pharmacy"
    sum: number;               // running sum (resets to 0 after an alarm)
    nextDate: string;          // next day still to be added (waits for late rows)
  }>;
}
```
Size: Bayes is a few KB. CUSUM is 243 wards x 3 signals = 729 small records.

### Table to store it (P3)
Recommended: one row per method, the whole state as JSON. It is written once a day.
```sql
CREATE TABLE detector_state (
  method      TEXT PRIMARY KEY,          -- 'bayes' (live default), 'cusum', 'threshold'
  as_of_date  DATE NOT NULL,             -- = state.lastRunDate
  state       JSONB NOT NULL,            -- the DetectorState object, unchanged
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- optional history, to re-run a past day: same columns, PRIMARY KEY (method, as_of_date)
```
If P3 prefers CUSUM as rows, here is the same data, one record per ward and signal:
```sql
CREATE TABLE cusum_state (
  ward_id     INTEGER NOT NULL,
  signal_type TEXT    NOT NULL CHECK (signal_type IN ('complaint','pharmacy','hospital')),
  sum         DOUBLE PRECISION NOT NULL,
  next_date   DATE    NOT NULL,
  PRIMARY KEY (ward_id, signal_type)
);
```
Read and write the state in the same transaction as inserting the day's alerts, so a failed
run does not move the state forward.

## 4. Alerts (unchanged shape)
`Alert` is exactly as in `src/types.ts`. What's new is the content:
- `causeProbs` comes from the classifier. It is a triage hint and always sums to 1.
- `suspectedZoneId` = a BWSSB `KGISSub_DivisionID`, or null.
- `evidence` = the detector's reasons only. The classifier's reasons are in `AlertRecord.causeEvidence`.
- `score` is the detector's probability (Bayes) or a 0-1 severity (threshold, CUSUM).

## 4b. Alert records and officer routes
```ts
interface AlertRecord {
  id: string;                    // stable, e.g. "bayes-39-2026-07-08" (method-wardId-date)
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;             // ISO date-time the record was created (the daily run)
  alert: Alert;                  // contract v1 shape, unchanged; evidence = detector reasons
  causeEvidence: string[];       // classifier reasons (runDetector causeEvidence[wardId])
  events: AlertEvent[];          // oldest first
}
interface AlertEvent {
  at: string;                    // ISO date-time
  by: string;                    // X-Officer-Name, or "Daily detector run" for "raised"
  kind: "raised" | "acknowledged" | "resolved" | "note";
  text?: string;                 // for notes
}
```
| Route | Body | Returns |
|---|---|---|
| `GET /alerts` | | `AlertRecord[]`, newest `createdAt` first |
| `GET /alerts/{id}` | | `AlertRecord` (404 if unknown) |
| `POST /alerts/{id}/ack` | | updated `AlertRecord` (adds an "acknowledged" event) |
| `POST /alerts/{id}/resolve` | | updated `AlertRecord` (adds a "resolved" event) |
| `POST /alerts/{id}/notes` | `{ text: string }` | updated `AlertRecord` (adds a "note" event) |

- Officer and demo routes need `X-Demo-Auth` (shared demo key) and `X-Officer-Name` (free text, demo only).
- Allowed status changes: open -> acknowledged -> resolved, and open -> resolved. Anything else returns 409.

## 4c. Map and rain routes
| Route | Returns |
|---|---|
| `GET /risk?date=YYYY-MM-DD` | `Array<{ wardId; probability; contributingSignals }>` for every ward (from `wardRisk`) |
| `GET /rain?from=YYYY-MM-DD&to=YYYY-MM-DD` | `Array<{ date; mm; sourceTag: "real" }>`, one city-wide row per day (Open-Meteo) |
| `GET /wards/{id}/signals?from=&to=` | `LiveSignalRow[]` for that ward, all signal types |
| `POST /demo/inject` | body `{ cause: "water" \| "food" \| "p2p"; wardId }`; returns `{ injection, appearsAfterMs }` (demo only) |
| `POST /demo/reset` | resets demo state (demo only) |
| `POST /demo/advance` | **mock mode only**, moves the demo clock one day; P3 does not need to build it |

## 5. Backtest results

### `BacktestResult` (file `results/backtest.json`, type in `src/backtest/run.ts`)
```ts
interface BacktestResult {
  status: "FINAL" | "PRELIMINARY";
  preliminary: boolean;
  city: "grid" | "real";
  wardCount: number;
  seeds: number[];
  difficulties: Array<"easy" | "realistic" | "hard">;
  rules: {
    matchingRule: string;                // v2 rule in plain words
    tuningYears: number[];               // [2022, 2023]
    testYears: number[];                 // [2024, 2025]
    falseAlarmBudgets: number[];         // [1, 0.25] episodes per ward-year
    episodeGapDays: number;              // 7
    matchGraceDays: number;              // 9
    calibratedOn: string;
  };
  summary: Array<{                       // method x difficulty x budget x cause x subset
    method: "threshold" | "cusum" | "bayes";
    difficulty: "easy" | "realistic" | "hard";
    budget: number;
    cause: "water" | "food" | "p2p" | "seasonal";
    subset: "all" | "outsideWave";       // outsideWave = local outbreaks not touching the seasonal wave
    detectionRate: Spread | null;
    medianDelayDays: Spread | null;
    outbreaksPerSeed: number;
  }>;
  falseAlarms: Array<{                   // method x difficulty x budget
    method: string; difficulty: string; budget: number;
    waveCounted: Spread | null;          // false-alarm episodes per ward-year, wave = outbreak
    waveExcluded: Spread | null;         // only local outbreaks clear an episode
    lockedSetting: Spread | null;
    budgetMissedSeeds: number;
  }>;
  fusionDoesNotHelp: Array<{ difficulty: string; budget: number; cause: string; subset: string;
                             simplerMethod: "threshold" | "cusum"; text: string }>;
  chanceCheck: {                         // added 2026-10-08 by `npm run add-chance`, same seeds
    method: string;                      // how phantoms are made, in plain words
    seeds: number[];
    rows: Array<{                        // method x difficulty x budget x cause
      method: string; difficulty: string; budget: number;
      cause: "water" | "food" | "p2p" | "seasonal";
      status: "computed" | "not computed";   // seasonal is always "not computed"
      phantomDetectionRate: Spread | null;   // chance level
      phantomsPerSeed: number;
      note: string | null;
    }>;
  };
  runs: unknown[];                       // per-seed detail for auditing (large; the frontend can ignore it)
}
interface Spread { median: number; p10: number; p90: number; n: number }   // across seeds
```

### `GET /backtest`
- **Response:** `200 application/json` with the body above, without `runs`, to keep it small:
  `{ status, city, wardCount, seeds, difficulties, rules, summary, falseAlarms, fusionDoesNotHelp, chanceCheck }`.
- **Source:** the file `results/backtest.json`, uploaded to S3 as is (drop `runs`). It is read-only and never computed live.
- **Optional:** `GET /backtest/classifier` serves `results/classifier.json` the same way
  (`ClassifierResult` in `src/backtest/classifierEval.ts`, without `runs`).
- **Frontend rule:** show `status` prominently. Never show PRELIMINARY numbers as results.
  Always show the "fusion does not help here" list next to the table. Show the chance level
  beside every result, and "not computed" where `status` is "not computed".
