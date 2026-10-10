# Status: P3 backend and infra, connected to P1 and the frontend

Date: 2026-10-09. The plan, written before any change, is `docs/INTEGRATION-PLAN.md`.
There is one commit per step (`git log`).

## What changed, file by file

### detection/ (P1): replaced, not edited
- **Swapped in.** P3's placeholder (a fake `runDetector` and a 6-ward `city.json`) is deleted.
  P1's real module takes its place, copied unchanged from P1's repo.
- **Only two changes.**
  - `package.json`: renamed to `@outbreak/detection`, with an `exports` map.
  - New `src/index.ts`: it only re-exports. No logic was touched.
- **The check.** `src/` and `tests/` are byte-identical to P1's repo (apart from `index.ts`),
  and all 116 tests pass. The brief said 99; P1's suite has grown to 116.

### packages/contract/
- `src/index.ts` re-exports P1's `types.ts` unchanged, plus P1's `LiveSignalRow` and
  `WardRisk`. It adds the contract-v2 `AlertRecord`, `AlertEvent` and `RainRow` (written from
  `contract-v2.md` section 4b, because no code file had them yet).
- The tests read P1's handoff samples instead of hand-made fixtures.

### backend/
- **`src/detector/orchestrator.ts`**: one detector run.
  - It loads the saved state and 70 days of rows (only rows with `reported_on <= today`).
  - It calls `runDetector(rows, day, city, RUN_DETECTOR_PARAMS, state)` for every India day
    not yet run.
  - Each day's alerts and state are saved in one transaction, and the classifier's reasons are
    stored as `causeEvidence`. Then it emails the officer.
  - A day that already ran is not run again (P1's code throws on that), so the 5-minute
    schedule is safe. An advisory lock stops two runs overlapping.
  - The test checks that the backend gives exactly P1's handoff sample.
- **`src/db/repository.ts`**: the same interface, with a Postgres version and an in-memory
  version. New in it:
  - `reported_on`, and batched upserts (82,000 rows in about a second)
  - `cause_evidence`
  - detector state: save, load, forget from a day
  - removing untouched alerts after a re-run
  - events for many alerts at once
  - the real-rain query
- **`src/db/migrations/002_contract_v2.sql`** (001 is unchanged):
  - `signals.reported_on`
  - `wards.zone_id`
  - ids `>= 0`
  - `alerts.score` as `DOUBLE PRECISION` (it used to round P1's score)
  - `alerts.cause_evidence`
  - a check on `alert_events.event`
  - `detector_state` (one row per method and day) and `detector_state_cusum` (one row per
    ward and signal)
- **`src/db/seed.ts`, `setup.ts`, `scripts/db-setup.ts`**: the seed writes:
  - P1's 243 wards and 43 zones, with shapes from P1's GeoJSON
  - 112 days plus today from `generateHistory()`, all `synthetic`
  - **no rain**

  `npm run db:setup` runs the migrations, then the seed.
- **`src/api/router.ts`**: every route in `frontend/README.md`, with its exact shapes.
  - New routes: `/alerts/{id}/notes`, `/risk`, `/rain`, `/wards/{id}/signals`.
  - The actor in `alert_events` is the `X-Officer-Name` header; a wrong status change is 409.
  - `/backtest` serves P1's file (or 503). Inject uses P1's `generateLiveDay`; reset returns
    `{ today, seed, injection }`.
  - Errors are `{ message }`, and CORS allows `X-Officer-Name`.
  - `records.ts` maps stored alerts to `AlertRecord`, and `backtest.ts` loads P1's file.
- **`src/api/auth.ts`**: no default password. Header names are read in any letter case.
- **`src/notifications/ses.ts`**: "triage hint, not a diagnosis" wording, plus the classifier's
  reasons. There are no made-up fallback addresses.
- **`src/config.ts`, `city.ts`, `metrics.ts`, `db/types.ts`**: settings (each says where its
  number comes from), the bundled city, one list of metric names, and P3's storage types.
- **`src/handlers/dbSetupHandler.ts`**: the one-off setup Lambda.
- **Scripts.**
  - New: `scripts/local-api.ts` and `run-detector.ts`.
  - `demo-pipeline-flow.ts` and `test-ses.ts` now use P1's code and data, with no fake numbers.
- **Tests.** P3's tests now use the real shapes:
  - `api`, `integration`, the 28-step `e2e-workflow`, `orchestrator` and `database`
  - new `postgres.test.ts`, which runs the same checks against a real database when
    `TEST_DATABASE_URL` is set
  - 52 tests in all.

### infra/
- **The stack (`src/outbreak-stack.ts`).**
  - **Lambdas.** API and detector are `NodejsFunction` (esbuild), plus a new
    `outbreak-watch-db-setup` Lambda. Each bundle includes `city.json`, the migrations and
    P1's backtest file without `runs`.
  - **Emails.** Read from context or env; no hard-coded addresses.
  - **Demo password.** From env, or from SSM at deploy time.
  - **Dashboard.** Reads the names in `backend/src/metrics.ts`, with the same dimension the
    detector logs.
  - **Errors.** API Gateway's own error responses also carry CORS headers.
  - **Region.** Defaults to `ap-south-1`.
- **Removed.** `infra/lambda/*.mjs`, which would have failed at run time: the asset had no
  `node_modules`.
- **`README.md`**: settings, the SES sandbox steps, deploy, reset and limits.
- **`scripts/slim-backtest.mjs`**: strips `runs` from P1's backtest file at bundle time.

### Root and frontend/
- **Root `package.json`.**
  - Scripts: `db:setup`, `typecheck` (`tsc --noEmit`), and `test` (synth first, then every
    workspace).
  - The Windows-only `@rolldown/binding-win32-x64-msvc` is removed. The lockfile is
    regenerated: the old one came from Windows and had the wrong esbuild binaries.
- **`README.md` and `docs/contract.md`.** Rewritten to match the code; the 12 open decisions
  are answered.
- **`frontend/`.** Added. Its `@engine` alias now points at `../detection/src`. One bug fix:
  the alert page crashed when there was no rain data.

## Proof (all run on 2026-10-09)
- **Fresh `git clone`.** `npm install` works, and so does `npm run typecheck`. Then
  `TEST_DATABASE_URL=... npm test`:

  | Package | Tests |
  |---|---|
  | contract | 6 |
  | detection | 116 |
  | pipeline | 1 |
  | infra | 11 |
  | backend | 52 |

  All pass.
- **`cdk synth`.** It passes, with esbuild running on this machine (no Docker).
- **The bundled Lambda files** (`infra/cdk.out/asset.*/index.mjs`), run against a local
  PostGIS:
  - **db-setup:** 243 wards, 43 zones, 82,377 rows.
  - **API:** `/backtest` 200, `/risk` 200, preflight 204, inject 200, `/alerts` 200.
  - **Detector:** the scheduled run did nothing, because today had already run.
- **The local end-to-end run.** PostgreSQL 18 + PostGIS 3.6 from Homebrew; this machine has
  no Docker. The steps: `db:setup`, then `POST /demo/inject {"cause":"water","wardId":18}`
  (zone 14), then `npm run detector:once`. That gave one new alert, for ward 21 (zone 14).
  Its `GET /alerts/{id}`:
  - score `0.9341303936249804`, contributing signals: complaint, pharmacy, hospital
  - P1's detector evidence, for example: "complaints 5.3x normal for a Sunday (8 vs usual 1.5,
    on 2026-10-04): 5.3 spreads above normal, odds x31.4" … "chance of an outbreak: 93%"
  - P1's classifier reasons, ending with "triage hint, not a diagnosis: most likely food (49%);
    an officer must confirm"
  - events: raised by "Daily detector run", then the email note
- **The frontend in real mode.** Run against the local API, going through Home, Map, Alerts
  (ack, note, resolve), Proof and Data, with no page errors and no failed requests.
  Screenshots are in `docs/screenshots-real-mode/`.

## What I could not fix, and why
1. **No deploy to AWS.** I used no AWS credentials. `cdk synth` passes and the bundled Lambda
   code works against PostGIS, but the first real `cdk deploy`, `CREATE EXTENSION postgis` on
   RDS, and SES delivery are untested.
2. **New days get no synthetic rows.** The seed writes history up to the day it runs. After
   that, new days get synthetic rows only if P2's pipeline (or the webhooks) writes them. With
   no new rows, the detector still runs each day but has less and less recent data.
   `POST /demo/reset` re-seeds up to today.
3. **Things for P1** (P1's code, which I did not touch):
   - ~~The classifier always prints "no heavy rain in the last 10 days (real rain data)", even
     when there are no rain rows at all.~~ Fixed (wording only): it now says "rain data not
     available" when there are no rain rows.
   - On the first alert the cause hint is often wrong. Here, a water outbreak was hinted
     "food 49%". P1's own docs say the same.
4. **Leftover injected rows.** Each inject re-runs the detector from its start day. A second
   inject replaces rows only from its own start day, so an earlier outbreak's rows before that
   day stay until the next reset.
5. **Limits listed in `infra/README.md`:**
   - the RDS database is public
   - `rds.force_ssl` is not set
   - the demo key is plain text
   - ~~the webhooks have no authentication~~ (fixed: secret header, see STATUS-P2-FIX)
6. **`npm audit`** reports 1 high item: `brace-expansion` inside `aws-cdk-lib`. It is only used
   when running CDK on a developer machine, not in the Lambdas.
7. **P3's `npm run audit:security`** flags one line in P1's `data/raw/osm_food.json`. It is a
   public Google Drive link in OpenStreetMap data, not a secret, and I left P1's data alone.
8. **Old frontend scripts.** `frontend/design/*` (one-off mockup scripts) still import
   `../../src`; they are not used by the app or its build.

## For P2

> **Done since (see `docs/STATUS-P2-FIX.md`):** P2's pipeline is connected. Every write goes
> through it (`backend/src/ingest.ts`); the webhooks need `X-Webhook-Secret`; complaints come
> from the new form at `/report` as `{ complaintId, wardId, description }`; and the detector
> now recomputes today on every 5-minute run. The notes below are kept as written, with the
> outdated lines marked.

**The signals row.** Write one row per ward, signal type and day:
```ts
{ wardId: number,                 // BBMP ward number from city.json (1-243); 0 is allowed
  signalType: "complaint" | "pharmacy" | "hospital" | "rain",
  date: "YYYY-MM-DD",             // the India day the count is FOR
  count: number,                  // daily total; rain = millimetres (decimal)
  sourceTag: "real" | "scraped" | "user" | "synthetic",
  reportedOn: "YYYY-MM-DD" }      // the India day the row REACHED us; never before `date`
```

**The India day rule.** Every date is the Asia/Kolkata date. Convert first, then take the day.
For example, 02:00 IST on 9 October is 20:30 UTC on 8 October, and it counts for `2026-10-09`.

**`reported_on` rules.**
- It is the day you deliver the row (India time), and it is never earlier than `date`.
- For a real-time feed, it equals `date`.
- If the same ward, signal, date and source tag arrives again, the row is **updated** (new
  count, new `reported_on`); it is not added twice.
- The detector does not see a row before its `reported_on`.

**Rain.**
- Write one **real** Open-Meteo value per day into **every** ward's row: 243 rows, the same mm
  each, `sourceTag: "real"`, `reportedOn = date`.
- Never write made-up rain. If there is no value for a day, write nothing for that day.
- `GET /rain` reads it back as one value per day.

**Where to write.**
- **Code in this repo:**
  ```ts
  import { getDatabase } from "@outbreak/backend";
  await getDatabase().insertSignals(rows);
  ```
  It uses `DATABASE_URL` or `DB_SECRET_ARN` and is batched; `reportedOn` defaults to `date`.
- **Plain SQL** on the `signals` table:
  ```sql
  INSERT INTO signals (ward_id, signal_type, date, count, source_tag, reported_on)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (ward_id, signal_type, date, source_tag)
  DO UPDATE SET count = EXCLUDED.count, reported_on = EXCLUDED.reported_on;
  ```
- **HTTP:** `POST /webhooks/pharmacy` or `POST /webhooks/hospital` (now with the header
  `X-Webhook-Secret`), with body
  `[{ wardId, count, date?, reportedOn? }]` (tagged `synthetic`; dates default to today in
  India). For the demo feed, P1's `rowsArrivingOn(date, 2026, { city })` gives exactly the
  rows that arrive on a day.
- **Complaints:** ~~`POST /complaints { wardId, count? }`~~ now `{ complaintId, wardId, description }`
  from the form; each submission is one complaint. It is the only source of `user` rows.

**When the detector reads.** ~~It works each India day only once.~~ Now, once today has run,
every 5-minute run recomputes today from yesterday's saved state, so rows that arrive during
the day are used the same day. Rows only count from their `reportedOn` day, as P1 designed.

## Commands

**Deploy to AWS** (from the repo root; `infra/README.md` has more detail):
```bash
npm install
aws ssm put-parameter --region ap-south-1 --name /outbreak/demo-auth-token --type String --value '<your demo key>'
SES_FROM_EMAIL=<verified sender> OFFICER_EMAIL=<verified officer> npm run deploy
aws lambda invoke --function-name outbreak-watch-db-setup --region ap-south-1 --cli-read-timeout 310 db-setup.json && cat db-setup.json
# then click the two SES verification emails; the API URL is the stack output ApiUrl
cd frontend && VITE_API_MODE=real VITE_API_BASE_URL=<ApiUrl without the trailing slash> npm run build
```

**Reset the demo:**
```bash
curl -X POST "<ApiUrl>demo/reset" -H "X-Demo-Auth: <your demo key>"
```

**Run it all locally** (PostgreSQL with PostGIS):
```bash
DATABASE_URL=postgres://user@localhost:5432/outbreak_watch npm run db:setup
DATABASE_URL=... DEMO_AUTH_TOKEN=<key> SES_MOCK=true npm run api:local --workspace=@outbreak/backend
cd frontend && VITE_API_MODE=real VITE_API_BASE_URL=http://localhost:3001 npm run dev
```
