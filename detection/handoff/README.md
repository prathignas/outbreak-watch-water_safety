# Handoff pack: detection module -> P2 (ingestion, frontend) and P3 (infra)

Everything here is either real map data (`city.json`) or **synthetic** samples made by our
generator. No real pharmacy or hospital data is in this folder.

| File | What it is | Who uses it |
|---|---|---|
| `city.json` | The real Bengaluru city model: 243 BBMP wards (id = `KGISWardNo`), name, centre point, area, neighbours, BWSSB water zone (`zoneId` = `KGISSub_DivisionID`, or null), food venues from OpenStreetMap | P2: map labels and zone overlays. Lambda: `RealCity.fromFile("city.json")` |
| `contract-v2.md` | The **proposed** contract: rows with `reportedOn`, `runDetector` signature, state table, `GET /backtest` | Everyone. Please read "What changed from v1" first and reply before building on it |
| `sample-live-day-normal.json` | One ordinary day from `generateLiveDay`: 729 rows (243 wards x complaint/pharmacy/hospital), each with `reportedOn` | P2: shape of what the pharmacy/hospital webhooks deliver |
| `sample-live-day-injected.json` | Day 3 of an injected water outbreak (ward 18 Bagalakunte, zone 14), plus the `injection` answer key | P2: demo day. Shows which wards go up |
| `sample-run-detector.json` | `runDetector` run day by day over that outbreak, the full output of the first day it alerted in the zone, and the state to store | P2: alert shape for email and map. P3: state shape |

## How P2 uses it (ingestion + frontend)
1. **Store rows** in `signals` with the new `reported_on` column (contract-v2 section 1). If the
   same ward, signal, date and source arrives again, **update** the row; never add a duplicate.
   - Pharmacy and hospital webhooks: in the demo, call `rowsArrivingOn(date, seed, options)`
     (`src/live.ts`). It returns exactly the rows that "arrive" that day, late ones included.
   - Rain: the real Open-Meteo value for the day, `source_tag = 'real'`, one row per ward.
   - Seed the database first with `generateHistory(firstLiveDay, 70, seed)`.
2. **Show alerts.** Each alert in `sample-run-detector.json` -> `firstDetection.alerts` has:
   - `wardId`: join to `city.json` for the name and position;
   - `score`: chance of an outbreak, from the Bayes detector;
   - `causeProbs` + `suspectedZoneId`: the **triage hint** (always label it "triage hint, not a diagnosis");
   - `evidence`: plain-English lines. The detector's come first, then the classifier's. Show them as a list.
3. **Backtest page.** `GET /backtest` serves `results/backtest.json` without `runs`. Show
   `status` (FINAL), both budgets, and the "fusion does not help here" list. The page must also
   show the chance check (`results/chance.json`); see "Honest notes" below.

## How P3 uses it (infra)
1. **Daily Lambda (EventBridge):**
   ```ts
   const city = RealCity.fromFile("city.json");
   const rows = await loadRows(today);            // last 70 days, reported_on <= today (contract-v2 section 1)
   const saved = await loadState("bayes");        // detector_state.state, or undefined on day one
   const { alerts, state } = runDetector(rows, today, city, RUN_DETECTOR_PARAMS, saved);
   await saveAlertsAndState(alerts, state);       // one transaction
   await emailOfficers(alerts);                   // SES
   ```
2. **State table:** `detector_state (method PK, as_of_date, state JSONB)` (contract-v2 section 3).
   Bayes state is a few KB. Run days in order: re-running the same day with a newer state throws.
3. **No AWS code is in this module.** It is pure TypeScript and needs only Node 20.

## Honest notes to keep with these files
- **The samples are synthetic.** They contain no rain rows (our real rain file ends in 2025),
  so the classifier line reads "rain data not available". In production P2's hourly job
  supplies real rain, and the line then says whether there was heavy rain.
- **The sample alert is only a hint.** It names zone 14 correctly 2 days after the start, but
  its top cause is "unknown" (55%). On the first alert the classifier is often unsure. See
  `docs/STATUS.md` for accuracy.
- **Live setting:** `RUN_DETECTOR.bayesAlertProbability` = 0.715. This is the median Bayes
  setting locked on tuning years for a budget of 0.25 false alarms per ward-year. At budget 1
  the backtest's "detections" were mostly chance (`results/chance.json`).
