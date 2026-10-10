# Contract

The one place where P1, P2 and P3 agree on data shapes. The TypeScript
version is `packages/contract/src/index.ts` (package `@outbreak/contract`).
It re-exports P1's `detection/src/types.ts` unchanged (nothing is copied by hand)
and adds the contract-v2 shapes (`AlertRecord`, `AlertEvent`, `RainRow`;
`LiveSignalRow` and `WardRisk` are P1's own types). **Contract v2 is in
`detection/handoff/contract-v2.md`; where this page and v2 differ, v2 wins.** If this page and
that file disagree, the file wins and this page gets fixed. Change either
only with all three people agreeing.

## Signals: the core rule

- **One signals row = the daily total for one ward and one signal type.**
- **The day is the Indian date (IST, Asia/Kolkata), written `YYYY-MM-DD`.**
  Example: a complaint at 2:00 am IST on 9 October is 8:30 pm UTC on
  8 October, but it counts for `2026-10-09`. Always convert to IST first,
  then take the date.
- Signal types: `complaint`, `pharmacy`, `hospital`, `rain`.
- Source tags: `real`, `scraped`, `user`, `synthetic`. Pharmacy and hospital
  numbers are synthetic and must say so.
- **Rain:** the count is millimetres of rain that day, a decimal (e.g.
  `12.4`). It is one city-wide value per day, written into every ward's
  rain row with source tag `real`.

## Alerts

An `Alert` is what the detector returns: ward, date, score (0 to 1),
method (`threshold`, `cusum`, `bayes`), contributing signals, cause
probabilities (`water`, `food`, `p2p`, `seasonal`, `unknown`, adding up to
1), suspected water zone (or null) and plain-English evidence.

**An Alert has no id and no status.** The database adds those when P3 saves
it:
- `id`
- `status`: `open` | `acknowledged` | `resolved` (starts as `open`)
- `created_at`: when it was saved

## The four handoffs

| # | From | To | What |
|---|---|---|---|
| 1 | P1 (detection) | P2 (pipeline) | P1 provides `rowsArrivingOn(day, seed, { city })`: the synthetic rows that reach us on one IST day (late rows for earlier days included) |
| 2 | P2 (pipeline) | database | P2 writes `signals` rows through the backend's `insertSignals`: synthetic rows from handoff 1 (daily feed), webhook rows (synthetic), real Open-Meteo rain, and complaint totals from the form (user). Every row has `reportedOn` |
| 3 | P3 (backend) | P1 (detection) | P3 reads 70 days of `signals` rows (with `reported_on <= today`) and the saved state, and calls P1's `runDetector(rows, today, city, RUN_DETECTOR_PARAMS, state)`, which returns `{ alerts, causeEvidence, state, heldBack }` and touches no database or network |
| 4 | P3 (backend) | database + officer | P3 saves the alerts (database adds id, status, created time), records an `alert_events` row, and emails the officer |

`generateLiveDay`, `generateHistory`, `runDetector` and `wardRisk` are in
`detection/src/live.ts` and `detection/src/runDetector.ts`, exported from `@outbreak/detection`.

## Database tables

Column names are `snake_case` in the database and `camelCase` in
TypeScript (`ward_id` ↔ `wardId`). Maps use PostGIS.

### wards
| Column | Type | Meaning |
|---|---|---|
| id | integer, primary key | Ward id used everywhere |
| name | text | Ward name for the map |
| geom | MultiPolygon | Ward boundary |

### pipeline_zones
Water supply zones (BWSSB sub-divisions).

| Column | Type | Meaning |
|---|---|---|
| id | integer, primary key | Zone id (what `suspected_zone_id` points at) |
| name | text | Zone name |
| geom | MultiPolygon | Zone boundary |

### signals
| Column | Type | Meaning |
|---|---|---|
| ward_id | integer, references wards | Which ward |
| signal_type | text | `complaint`, `pharmacy`, `hospital` or `rain` |
| date | date | Indian date (IST) |
| count | NUMERIC | Daily total (rain: millimetres, decimal) |
| source_tag | text | `real`, `scraped`, `user` or `synthetic` |
| reported_on | date | Indian date the row reached us (>= date). Migration 002 |

**UNIQUE (ward_id, signal_type, date, source_tag).** A later arrival for the
same key **updates** the row (new count, new reported_on).

### alerts
| Column | Type | Meaning |
|---|---|---|
| id | primary key | Added by the database |
| ward_id | integer, references wards | Ward that looks unusual |
| date | date | Indian date the alert is for |
| score | double precision, 0 to 1 | How sure we are something is wrong (P1's number, not rounded) |
| method | text | `threshold`, `cusum` or `bayes` |
| contributing_signals | text[] | Signals that pushed the score up |
| cause_probs | jsonb | `{water, food, p2p, seasonal, unknown}`, adds up to 1 |
| suspected_zone_id | integer, nullable, references pipeline_zones | Suspected water zone |
| evidence | text[] | The detector's plain-English reasons |
| cause_evidence | text[] | The classifier's reasons (`AlertRecord.causeEvidence`). Migration 002 |
| status | text | `open`, `acknowledged` or `resolved` |
| created_at | timestamptz | When saved |

**UNIQUE (ward_id, date, method)**, so re-running the detector does not
create duplicate alerts.

### alert_events
History of everything that happened to an alert.

| Column | Type | Meaning |
|---|---|---|
| id | primary key | Event id |
| alert_id | references alerts | Which alert |
| event | text | `created`, `emailed`, `email_failed`, `acknowledged`, `resolved`, `note_added` |
| actor | text | `Daily detector run`, or the officer (the `X-Officer-Name` header) |
| note | text, nullable | Optional comment |
| at | timestamptz | When |

### detector_state and detector_state_cusum (migration 002)
P1's `DetectorState`, saved after each day in the same transaction as that day's alerts.
`detector_state`: one row per (method, as_of_date), the state as JSON (last 30 days kept, so
recent days can be re-run). `detector_state_cusum`: the CUSUM running sums, one row per ward
and signal (empty while the live method is Bayes).

## API routes

The exact list, shapes and headers are in `frontend/README.md`; this is a summary.
Routes marked 🔒 need `X-Demo-Auth` (and send `X-Officer-Name`). Errors are `{ message }`.

| Method | Path | Who | What |
|---|---|---|---|
| GET | /alerts | public | `AlertRecord[]`, newest first |
| GET | /alerts/{id} | public | One `AlertRecord` |
| POST | /alerts/{id}/ack | 🔒 officer | open -> acknowledged (409 otherwise) |
| POST | /alerts/{id}/resolve | 🔒 officer | open or acknowledged -> resolved (409 otherwise) |
| POST | /alerts/{id}/notes | 🔒 officer | `{ text }` -> note event |
| GET | /risk?date= | public | `WardRisk[]` from P1's `wardRisk` (relative risk, not an alert) |
| GET | /rain?from=&to= | public | `RainRow[]`, real Open-Meteo rows only |
| GET | /wards/{id}/signals?from=&to= | public | `LiveSignalRow[]` known by today |
| GET | /backtest | public | P1's `results/backtest.json` without `runs`; 503 if missing |
| POST | /complaints | public | `{ complaintId, wardId, description }` from the form: one complaint (the only source of `user` rows); a repeated `complaintId` counts once |
| POST | /webhooks/pharmacy, /webhooks/hospital | 🔒 `X-Webhook-Secret` | `[{ wardId, count, date?, reportedOn? }]`, tagged `synthetic`; dates default to today in India |
| GET | /wards, /wards/{id}/risk | public | Wards with zone; one ward's `wardRisk` entry |
| POST | /demo/inject | 🔒 demo | `{ cause, wardId }`: P1's `generateLiveDay` with an injected outbreak |
| POST | /demo/reset | 🔒 demo | Clear alerts, events, signals, detector state; re-seed |

## Decisions (were open; settled by contract v2 and the P3 integration fix)

1. Signatures: `runDetector(rows, today, city, params, state)` and `generateLiveDay(date, seed, options)`, from `@outbreak/detection`.
2. `generateLiveDay` makes no rain. P2 writes real Open-Meteo rain (one value per day into every ward, tag `real`).
3. 70 days of history (`LIVE.recommendedHistoryDays`); the default method is Bayes (`params.live.ts`).
4. Alert `id`: UUID.
5. `GET /alerts` and `GET /alerts/{id}` are public; changes need `X-Demo-Auth`.
6. Webhooks: a shared secret in the `X-Webhook-Secret` header (name: `WEBHOOK_SECRET_HEADER`; value from SSM `/outbreak/webhook-secret`).
7. Shapes: `frontend/README.md` and `detection/handoff/contract-v2.md`.
8. `wards` has `zone_id` (migration 002). There is no `WardSummary`; the map uses `GET /risk`.
9. `GET /backtest` serves P1's file; no table.
10. No `venues` or `baselines` tables. `complaint_events` (migration 003) stores only complaint ids, ward and day, so a retry is counted once; no complaint text is stored.
11. Event values: see `alert_events` above.
12. `signals` UNIQUE includes `source_tag`. Health rows are `synthetic` (seed, feed, webhooks) or `user` (complaint form), rain is `real`. The daily feed and the pharmacy/hospital webhooks share the key `(ward, type, date, synthetic)`: whichever writes last wins.
