# Integration plan: P3 backend and infra -> P1 detection and the real frontend

Written before any fix. It lists every mismatch found between `backend/`, `infra/`,
`packages/contract/` and the sources of truth:

- `detection/src/types.ts`, `detection/src/runDetector.ts`, `detection/src/live.ts`,
  `detection/src/params.live.ts` (P1's real code, copied in from P1's repo)
- `detection/handoff/contract-v2.md` and `detection/handoff/README.md`
- `detection/data/city.json` (243 wards, 43 water zones)
- `frontend/README.md` and `frontend/src/api/` (what the app sends and expects)

## How the repo was put together

- P3's zip had a **placeholder** `detection/` (a fake `runDetector` and a 6-ward `city.json`) and
  **no frontend**. P1's real module and the frontend were in a separate folder.
- I replaced `detection/` with P1's real code (unchanged, apart from new exports) and added
  `frontend/`. The frontend's `@engine` alias now points at `../detection/src`.
- `pipeline/` (P2) is not touched.

## A. Detector

| # | Mismatch | Fix (step) |
|---|---|---|
| A1 | `detection/` is a placeholder. Its `runDetector({ date, history, method })` uses made-up spike rules and a fixed cause split (water 0.7, food 0.1, ...). The real one is `runDetector(rows, today, city, params, state)`. It is synchronous and returns `{ alerts, causeEvidence, state, heldBack }`. | Delete the placeholder; use P1's package as `@outbreak/detection` (1) |
| A2 | P1's package is named `hackathon` and has no entry file, so `@outbreak/detection` cannot be imported. | Rename it and add `src/index.ts` with exports only (1) |
| A3 | `packages/contract` is a hand copy of `types.ts`. It has no `LiveSignalRow`, `AlertRecord` or v2 `AlertEvent`. P3's own storage types (`DbAlert`, the DB `AlertEvent`, `Ward`) are mixed in. | Re-export P1's `types.ts` and `LiveSignalRow`; add the contract-v2 `AlertRecord` and `AlertEvent`; move P3 storage types into `backend/` (1) |
| A4 | The orchestrator loads 21 days. P1 needs 70 (`LIVE.recommendedHistoryDays`). | Load 70 days before the first day it runs (1) |
| A5 | No detector state is stored, so cooldown, classifier context and CUSUM sums are lost every run. | `detector_state` table; load before the run, save in the same transaction as the alerts (1) |
| A6 | The classifier's reasons (`causeEvidence`) are thrown away. | New `alerts.cause_evidence` column (1) |
| A7 | The detector runs every 5 minutes. P1's `runDetector` throws if it runs the same day twice ("days must move forward"). | Run only the days after the saved state; when today is done, do nothing (1) |
| A8 | P3 picks its own detection settings. | Use `RUN_DETECTOR_PARAMS` (from `params.live.ts`) (1) |
| A9 | `docs/contract.md` still describes `runDetector({ date, history })`. | Point it to contract-v2 (7) |

## B. Database

| # | Mismatch | Fix (step) |
|---|---|---|
| B1 | `signals` has no `reported_on`, and the upsert does not update it. | Migration 002 adds it; the upsert updates `count` and `reported_on` (2) |
| B2 | No `detector_state` table. | Migration 002 (1, 2) |
| B3 | `alerts.score` is `NUMERIC(5,2)`, which rounds P1's probability (0.7349 is stored as 0.73). | Migration 002: `DOUBLE PRECISION` (2) |
| B4 | No `alerts.cause_evidence`. | Migration 002 (1) |
| B5 | Ward ids must be positive in zod and route checks; ward id 0 is rejected. | `>= 0` everywhere (2) |
| B6 | The seed is fake. Complaints are 0 or 1, tagged `user`. Pharmacy is 6-9 and hospital 0-1, made by formula. **Rain is made up (4.5 mm every third day) and tagged `real`**. It covers 14 days only and uses the 6-ward placeholder city. | Seed wards and zones from P1's `city.json`, with shapes from P1's GeoJSON; history from `generateHistory()`, tagged `synthetic`; no rain rows (2) |
| B7 | Ward and zone shapes are `Polygon` in P1's GeoJSON; the columns are `MultiPolygon`. | `ST_Multi(...)` on insert (2) |
| B8 | `insertSignals` sends one query per row. A seed is about 80,000 rows. | Batch upsert (2) |
| B9 | The `migrate` and `seed` scripts use `ts-node/esm`, which is not installed. There is no single setup command. | `npm run db:setup` = migrations, then seed (2) |
| B10 | The reset does not clear the detector state. | Clear `detector_state` too (3) |

## C. API vs `frontend/README.md`

| # | Mismatch | Fix (step) |
|---|---|---|
| C1 | `GET /alerts` returns `{ disclaimer, count, limit, offset, alerts: DbAlert[] }` with a default limit of 50. The app wants a plain `AlertRecord[]`, newest first. | Return `AlertRecord[]` (3) |
| C2 | `GET /alerts/{id}` returns `{ alert, events }`, with events as `{ event, actor, note }`. The app wants an `AlertRecord` with events as `{ at, by, kind, text }`. | Map the DB events to v2 events (3) |
| C3 | ack and resolve return `{ alert, event }`. The actor comes from the body, not `X-Officer-Name`. There are no 409 rules (a resolved alert can be acknowledged). | Return `AlertRecord`; actor = `X-Officer-Name`; 409 on a wrong status change (3) |
| C4 | Missing: `POST /alerts/{id}/notes`, `GET /risk?date=`, `GET /rain?from=&to=`, `GET /wards/{id}/signals?from=&to=`. | Add them; `/risk` calls P1's `wardRisk` (3) |
| C5 | CORS headers lack `X-Officer-Name` (Lambda response and API Gateway preflight). | Add it to both (3, 4) |
| C6 | `GET /backtest` returns **hand-typed numbers** (0.94, 0.88, 0.76, ...). | Serve `detection/results/backtest.json` without `runs`; 503 if missing (3) |
| C7 | `POST /demo/inject` takes `{ wardId, date }`. It writes **fixed spike values**, **complaints tagged `user`** and **rain tagged `real`**. The app sends `{ cause, wardId }` and wants `{ injection, appearsAfterMs }`. | Use `generateLiveDay(..., { injectOutbreak, wardId, startDate })`; all rows `synthetic` (3) |
| C8 | `POST /demo/reset` returns `{ success, reset: {...} }`. The app wants `{ today, seed, injection }`. | Return that shape (3) |
| C9 | `GET /wards` and `GET /wards/{id}/risk` label wards "alert" or "warning" using **made-up cut-offs** (0.7 and 0.4). | Drop the cut-offs; `/wards/{id}/risk` uses `wardRisk` (3) |
| C10 | `auth.ts` has a hard-coded default demo password. | No default; read `DEMO_AUTH_TOKEN` only (4) |
| C11 | Errors are `{ error, message, disclaimer }`. This is fine (`message` is there), but 401 must mean "wrong demo key". | Keep it; check the codes (3) |

## D. Infra (CDK)

| # | Mismatch | Fix (step) |
|---|---|---|
| D1 | The Lambdas are `lambda.Function` with `infra/lambda/*.mjs` doing `import("@outbreak/backend")`. The asset has no `node_modules`, so this fails at run time. | `NodejsFunction` (esbuild) with entries `apiHandler.ts` and `detectorHandler.ts`; delete `infra/lambda/` (4) |
| D2 | `city.json`, the backtest file and the migrations are not shipped with the Lambdas. | Bundle them (4) |
| D3 | The DB is never set up on AWS. | One-off `db-setup` Lambda, plus the exact command to run it (4) |
| D4 | SES addresses are hard-coded `@outbreakwatch.org` in the stack. The README says `.local` and the code falls back to `.internal`. | CDK context or env `SES_FROM_EMAIL` and `OFFICER_EMAIL`; no fallbacks (4) |
| D5 | The budget alert goes to the hard-coded officer address. | Context or env (`BUDGET_EMAIL`, else `OFFICER_EMAIL`) (4) |
| D6 | Metric names do not match. The code emits `detector_runs`, `alerts_generated`, `duplicate_alerts` and `detector_errors` with dimension `Service=DetectorLambda`. The dashboard reads `DetectorRuns`, `AlertsFired` and `SignalsEvaluated` with no dimension. `signals_evaluated` is logged but not declared as a metric. | One shared list of names, used by both (4) |
| D7 | The demo password is hard-coded in the stack (`outbreak-demo-officer-secret`). The README shows yet another value. | Read it from SSM (or env) at deploy time (4) |
| D8 | RDS is public, with port 5432 open to `0.0.0.0/0`. | Keep it for now; list it under limits (4) |
| D9 | The root `package.json` has `@rolldown/binding-win32-x64-msvc`. | Remove (4) |
| D10 | The infra README claims `rds.force_ssl` is set; it is not. | Correct the README (4) |

## E. Honesty rules

| # | Problem | Fix |
|---|---|---|
| E1 | Fake `real` rain in the seed and inject. | Removed. Rain only from P2's Open-Meteo feed (2, 3) |
| E2 | Fake `user` complaints in the seed and inject. | Removed. `user` only from `POST /complaints` (2, 3) |
| E3 | Fake backtest numbers. | Removed. Only P1's results file (3) |
| E4 | Ward status cut-offs nobody computed. | Removed (3) |
| E5 | The email says "SUSPECTED CAUSE" without "triage hint, not a diagnosis". | Reword the email and add the classifier's reasons (3) |

## Order of work (one commit each)
1. Replace the fake detector (A1-A8, B2, B4).
2. Database (B1, B3, B5-B9).
3. API to match `frontend/README.md` (C1-C9, C11, B10, E1-E5).
4. Infra (D1-D10, C10).
5. Honesty sweep (E1-E5 across all routes and docs).
6. Checks: install, tsc, tests, local end-to-end, frontend in real mode, `cdk synth`.
7. `docs/STATUS-P3-FIX.md`.

---

# P2

Written before any change to P2's code (commit "P2 pipeline/ as received"). P2's zip
had `pipeline/` plus old starter copies of `detection/`, `backend/`, `infra/`, `packages/`
and root files; only `pipeline/` was copied in. P2's own 174 tests pass as received,
but they test P2's guessed shapes, not P1's and P3's real ones.

Sources of truth checked: `detection/src/types.ts`, `detection/src/live.ts`,
`detection/src/params.ts` (`RAIN_SOURCE`), `detection/scripts/fetch-rain.ts`,
`detection/data/raw/rain.json`, `detection/handoff/contract-v2.md`,
`backend/src/db/repository.ts`, `backend/src/api/router.ts`, `infra/src/outbreak-stack.ts`,
`frontend/src/api/`.

## P2-A. Contract and rows

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-A1 | Rows have no `reportedOn`. Contract v2 needs it on every row ("the day the row reached us", never before `date`), and the backend's `insertSignals` stores it as `reported_on`. | Add `ReportedSignalRow` (= `SignalRow` + `reportedOn`) to `@outbreak/contract`; every pipeline row carries it; check `reportedOn >= date` (1) |
| P2-A2 | `validateWardId` rejects ward id 0 (`wardId <= 0`). The DB and API allow `>= 0`. | `>= 0` (1) |
| P2-A3 | The engine's in-memory key and README say the upsert updates `count` only. Contract v2 says a repeat updates `count` and `reported_on`. | Sink and docs: update both (1, 4) |
| P2-A4 | `index.ts` re-exports `SignalRow` itself; nothing uses P1's `LiveSignalRow`. | Types only from `@outbreak/contract` (1) |

## P2-B. Live synthetic feed (`LiveDayAdapter`)

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-B1 | It needs an injected `generateLiveDay(date)` and only the tests' fake is ever passed. P1's real function is `generateLiveDay(date, seed, options)` and returns `LiveSignalRow[]`. The rows that **arrive** on a day are `rowsArrivingOn(date, seed, { city })`. | Default to P1's real `rowsArrivingOn(day, seed, { city: RealCity })` (2) |
| P2-B2 | It rejects any row whose `date` is not the day processed. P1's late rows have `date` earlier than `reportedOn`, so every lagged row would be thrown away. | Check `reportedOn === day` instead; allow `date <= reportedOn` (2) |
| P2-B3 | `reportedOn` is dropped by `normalizeSignalRow`. | Keep it (1, 2) |

## P2-C. Rain

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-C1 | Wrong API. P2 calls the **forecast** API (`api.open-meteo.com/v1/forecast`, `past_days=7&forecast_days=1`). P1's `rain.json` came from the **archive** API (`archive-api.open-meteo.com/v1/archive`, `start_date`/`end_date`), see `RAIN_SOURCE` in `detection/src/params.ts` and `scripts/fetch-rain.ts`. Same point (12.9716, 77.5946), `timezone=Asia/Kolkata`, `daily=precipitation_sum`, default unit mm. Checked on 2026-10-09: the archive API has values up to today. | Use `RAIN_SOURCE.url`, latitude, longitude, timezone; ask by `start_date`/`end_date`; check `daily_units.precipitation_sum === "mm"` (3) |
| P2-C2 | Rain is written to demo wards `[40, 41, 42]` (`demo-rain.ts`). | All 243 wards from P1's `city.json` (3) |
| P2-C3 | A forecast day is dropped only if after "today"; with `forecast_days=1` today's forecast value was kept as if observed. | Archive API has no forecast; still drop anything after today (3) |
| P2-C4 | No `reportedOn`. | `reportedOn = date` (contract v2 rule for rain) (3) |
| P2-C5 | On a failed fetch it throws; nothing logs it, and nobody runs it on a schedule. | Job: log, count a metric, write nothing (3, 7) |

## P2-D. Database sink

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-D1 | No Postgres sink. README guesses SQL without `reported_on`. | `PostgresSignalSink` that calls the backend's existing `insertSignals` (4) |

## P2-E. Backend routes (two paths for the same data)

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-E1 | `router.ts` has its own zod checks and insert logic for `/complaints` and `/webhooks/*`. P2's parsers are not used anywhere. | Routes call P2's adapters + engine + Postgres sink; remove the duplicate code (5) |
| P2-E2 | Complaint de-dupe: P2's `InMemoryComplaintEventStore` forgets everything when a Lambda restarts, so a retry is counted twice and a later count can be lower than the stored one. The router's own code reads today's row and adds 1 (a retry is counted twice too). | New migration `003`: `complaint_events` table; store backed by it. If no id is sent, the server makes one (each submission counts once) (5) |
| P2-E3 | **There is no complaint form in the frontend.** Nothing in `frontend/src` calls `POST /complaints`. The backend documents `{ wardId, count? }`; P2's parser wants `{ id, timestamp, content, wardId or lat/lng }`. | Agreed with the owner: add a small form in `frontend/` that sends `{ complaintId, wardId, description }`; the parser accepts it; the server stamps the time (5) |
| P2-E4 | P2's webhook parser has no `reportedOn`, and needs `date`. The backend's documented webhook body is `[{ wardId, count, date?, reportedOn? }]` (dates default to today in India). | Parser accepts that body exactly (5) |
| P2-E5 | Webhooks have no authentication (listed as a limit in `infra/README.md`). | Secret header, name and value from env / SSM (6) |

## P2-F. AWS

| # | Mismatch | Fix (step) |
|---|---|---|
| P2-F1 | Nothing runs the rain or feed job. | Rain Lambda (EventBridge, hourly), feed Lambda (daily, IST morning), `NodejsFunction` like the others (7) |
| P2-F2 | No raw copies kept. | S3 bucket, `raw/<source>/<YYYY-MM-DD>/...`; each Lambda can only write its own prefix (7) |
| P2-F3 | No metrics for the new jobs. | Names in `backend/src/metrics.ts`, read by the dashboard (7) |

## P2-G. P3 fixes to re-check

| # | Problem | Fix (step) |
|---|---|---|
| P2-G1 | **Not done.** The 5-minute detector run does nothing once today has run, so rows that arrive later in the day (late webhooks, the morning feed, complaints) are not seen until tomorrow. | Re-run today from the state saved at the end of yesterday; update today's alerts; no second email (8a) |
| P2-G2 | **Not done.** The classifier says "no heavy rain in the last 10 days (real rain data)" even when there are no rain rows. | Say "rain data not available" when there are no rain rows (wording only) (8b) |

## Order of work (one commit each)
1. Contract (P2-A). 2. Live feed (P2-B). 3. Rain (P2-C). 4. Postgres sink (P2-D).
5. One path in the backend (P2-E1 to E4). 6. Webhook secret (P2-E5). 7. AWS (P2-F).
8. P3 fixes (P2-G). 9. Honesty sweep. Then checks and `docs/STATUS-P2-FIX.md`.
