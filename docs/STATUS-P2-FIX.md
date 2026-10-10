# Status: P2's pipeline, connected to P1, P3 and the frontend

Date: 2026-10-09. The plan, written before any code change, is the "P2" part of
`docs/INTEGRATION-PLAN.md`. There is one commit per step (`git log`).

## What I started from
- P2's zip had `pipeline/` plus old starter copies of `detection/`, `backend/`, `infra/`,
  `packages/` and root files. Only `pipeline/` was copied in. The first commit is P2's
  folder exactly as it came. The temporary unzip folder was deleted.
- P2's 174 tests passed, but they tested P2's own guessed shapes, not P1's and P3's real ones.
  Nothing in the backend used P2's code.

## What changed, file by file

### packages/contract/
- `src/index.ts`: new type `ReportedSignalRow` (a `SignalRow` plus `reportedOn`). This is
  the row every source now writes. It also re-exports P1's `CityModel` type. With that, the
  pipeline takes all its types from `@outbreak/contract`.

### pipeline/ (P2's files, fixed in place)
- **`validation.ts`**: ward id `>= 0` (0 allowed). New `validateReportedOn`: a valid day,
  never before `date`. Every row must have `reportedOn`.
- **`normalize.ts`, `sink.ts`, `engine.ts`**: carry `reportedOn`. If a row has none, it
  gets its own date (the contract's rule for a real-time feed).
- **`adapters/live-day-adapter.ts`**:
  - It now calls P1's real `rowsArrivingOn(day, seed, { city })`. There is no fake by
    default; the override is for tests only.
  - It keeps late rows (`date` earlier than `reportedOn`). The check is "`reportedOn` is the
    day processed".
  - It takes only complaint, pharmacy and hospital rows, and only `synthetic`.
- **`adapters/rain-fetcher.ts`**:
  - P1's exact source, from `RAIN_SOURCE` in `detection/src/params.ts`: the Open-Meteo
    **archive** API, 12.9716 / 77.5946, `Asia/Kolkata`, `precipitation_sum`, default unit mm.
  - It asks by `start_date`/`end_date`, like P1's `fetch-rain.ts`.
  - P2 had used the forecast API instead.
- **`adapters/rain-parser.ts`**: refuses an answer that is not in mm, or not in Asia/Kolkata
  days. Rain rows get `reportedOn = date`.
- **`adapters/rain-adapter.ts`**:
  - It covers the last 7 days up to today (India) and drops anything after today.
  - On a failed fetch or a bad answer it throws, and nothing is written.
- **`adapters/daily-ward-count-parser.ts`, `-adapter.ts`** (the webhooks): accept the
  backend's documented body `[{ wardId, count, date?, reportedOn? }]`.
  - `date` and `reportedOn` default to the day received.
  - It refuses: `reportedOn` after the day received, a row for another signal type, and any
    tag but `synthetic`.
- **`adapters/complaint-adapter.ts`**: a `receivedOn` option sets `reportedOn`.
- **`adapters/complaint-store.ts`**: new `DatabaseComplaintEventStore`. Complaint ids are
  kept in the database (table `complaint_events`), so de-duplication survives Lambda restarts.
- **`demo-rain.ts`**: all 243 wards from `city.json` instead of demo ids 40-42.
- **New files:**
  - `postgres-sink.ts`: `PostgresSignalSink`. It calls the backend's existing
    `insertSignals` and has no SQL of its own.
  - `raw-archive.ts`: keeps raw copies, filed by day.
  - `jobs/rain-job.ts`: the hourly rain job.
  - `jobs/feed-job.ts`: the daily synthetic feed.
- **`package.json`**: depends on `@outbreak/detection` (for `rowsArrivingOn` and
  `RAIN_SOURCE`); new `exports` map.
- **`README.md`**: rewritten to match the code.
- **Tests**: P2's tests were updated to the real shapes; none were deleted. New tests cover:
  - P1's real `rowsArrivingOn` on the 243-ward city
  - the rain job: 243 wards, and nothing written on failure
  - the Postgres sink
  - one write path (the form's body, de-dupe across a "restart", the webhook body)
  - the feed job

  174 tests became 201.

### backend/
- **`src/ingest.ts` (new): the one write path.**
  - `/complaints` and `/webhooks/*` go through P2's parsers and adapters, then the engine,
    then `PostgresSignalSink`, then `insertSignals`.
  - Coordinates are turned into a ward with PostGIS.
  - Complaints: the server's clock sets the day. A missing id becomes a server-made UUID, so
    each submission counts once. The old `{ count }` field is refused, not ignored.
- **`src/api/router.ts`**:
  - The old zod schemas and insert code for these routes are removed.
  - P2's validation errors become 400 `{ message }`.
  - Webhooks need the secret, keep a raw copy and log metrics.
  - `/risk` adds up sources first (see `combineSources` below).
- **`src/api/auth.ts`**: `verifyWebhookSecret`.
  - The header name comes from `WEBHOOK_SECRET_HEADER` (default `X-Webhook-Secret`).
  - The value comes from `WEBHOOK_SECRET`. There is no default, so with no secret set every
    webhook call gets 401.
  - The comparison is constant-time.
- **`src/db/migrations/003_complaint_events.sql`** (new): complaint id, ward and day. No
  complaint text is stored.
- **`src/db/repository.ts`**: `recordComplaintEvent`, `hasComplaintEvent`,
  `countComplaintEvents` (Postgres and in-memory). The demo reset also clears
  `complaint_events`.
- **`src/detector/orchestrator.ts`** (step 8a):
  - Once today has run, each 5-minute run forgets today's state, reloads the state saved at
    the end of yesterday, and recomputes today.
  - Existing alerts are updated, not emailed again.
- **`src/detector/combineSources.ts`** (new; a bug found during the local check):
  - P1's `SignalIndex` keys rows by ward, signal and day, not by source tag. So a `user`
    complaint row and the `synthetic` one for the same ward and day overwrote each other, and
    which one won depended on row order.
  - Now they are added up before `runDetector` and `wardRisk`. P1's code is unchanged.
- **`src/handlers/rainHandler.ts`, `feedHandler.ts`** (new): the two Lambdas. Each logs
  metrics and throws when the job fails, so the failure shows in CloudWatch.
- **`src/rawArchive.ts`** (new): raw copies go to S3 when `RAW_BUCKET` is set, or to a local
  folder when `RAW_ARCHIVE_DIR` is set.
- **`src/metrics.ts`**: `PIPELINE_METRICS` (names and dimensions) and `emitMetrics`.
- **`scripts/run-rain.ts`, `run-feed.ts`** (new): `npm run rain:once`, `npm run feed:once`.
- **Tests**: the API tests use the form's body, plus new tests for:
  - the webhook secret
  - recomputing today
  - a late rise that arrives during the day
  - the rain sentence
  - `combineSources`
  - real-database checks: the sink upsert, and complaint de-dupe after a "restart"

  52 tests became 62.

### detection/ (P1): two small changes, no detection logic changed
- `src/index.ts` (exports only): also exports `RAIN_SOURCE`.
- `src/classifier.ts` (step 8b, wording only):
  - When the classifier gets no rain rows, the cause line says **"rain data not available"**
    instead of "no heavy rain in the last 10 days (real rain data)".
  - An optional count of rain days is used only for that sentence.
- `handoff/sample-run-detector.json` was regenerated with P1's own `npm run handoff`. Only
  those two sentences changed. The handoff README note was updated. P1's 116 tests pass.

### infra/
- **`src/outbreak-stack.ts`**:
  - **Two new `NodejsFunction`s:**
    - `outbreak-watch-rain`, run by EventBridge `rate(1 hour)`
    - `outbreak-watch-feed`, run by `cron(30 0 * * ? *)`, which is 06:00 IST
  - **A private S3 bucket** for raw copies: encrypted, TLS only, objects kept 365 days.
  - **Least privilege.** Each Lambda may only `s3:PutObject` under its own prefix:
    - `raw/rain/`
    - `raw/feed/`
    - `raw/webhook-pharmacy/`, `raw/webhook-hospital/` (the API Lambda)
  - **Webhook secret.** Read from SSM `/outbreak/webhook-secret` (or env) at deploy time.
  - **Dashboard.** Rain, feed and webhook widgets, with the same names and dimensions the
    Lambdas log. There is also a rain-fetch alarm.
- **`README.md`**: the new settings, the `put-parameter` command for the secret, the jobs,
  invoke commands, limits.
- **Tests**: schedules, bucket, per-prefix permissions, dashboard names, webhook secret
  (11 tests became 15).

### frontend/ (the complaint form was agreed with the owner)
- The frontend had **no complaint form**; nothing called `POST /complaints`.
- New `pages/Report.tsx` (route `/report`, a "Report" tab):
  - a ward list and a description box
  - it sends `{ complaintId, wardId, description }`; `complaintId` is made once per report,
    so a retry counts once
- `api/client.ts`: `submitComplaint`. In mock mode, MSW answers "not saved".
- `components/SignalChart.tsx`: adds up the sources for each day, and shows the source tags
  that are really there (it always said "Simulated").
- `pages/Data.tsx` and the honesty note: complaints are simulated, except reports from the
  Report form (`User`). Rain is fetched hourly, and nothing is written when a fetch fails.
- `components/Shell.tsx`: the phone top bar was 8 px wider than the screen on every page. Fixed.

### Root and docs
- Root `typecheck` now includes `pipeline`.
- `README.md` and `docs/contract.md`: the new Lambdas, one write path, webhook secret, the
  form, what is real.

## Proof (all run on 2026-10-09)
- **Fresh `git clone` of the last commit.** `npm install` and `npm run typecheck` work. Then
  `TEST_DATABASE_URL=postgres://outbreak@localhost:5433/outbreak_test npm test` runs
  `cdk synth` first, then every workspace:

  | Package | Tests |
  |---|---|
  | contract | 6 |
  | detection | 116 |
  | pipeline | 201 |
  | infra | 15 |
  | backend | 62 (including 8 against the real database) |

  All 400 pass.
- **Local database** (PostgreSQL 18 + PostGIS on port 5433, as before):
  1. **`npm run db:setup`**: migration 003 applied; 243 wards, 43 zones, 82,377 synthetic
     rows, and no rain.
  2. **`npm run rain:once`**: real Open-Meteo values, 30 Sep to 7 Oct (14.3, 1.2, 0, 0.1,
     0.6, 8.3, 6.4, 0.3 mm). That is 1,944 rows. For today: **243 rows, 243 wards, all 0.3
     mm, all `real`, `reported_on` 2026-10-09.** The raw answer was saved to the local archive
     folder.
  3. **`npm run feed:once -- --day 2026-10-09`**: first, every synthetic row reported today
     was deleted, to prove the feed writes them. The feed then wrote 733 rows, **355 of them
     late**. For example: ward 2, hospital, `date` 2026-10-04, `reported_on` 2026-10-09. Late
     rows by type: hospital 239, pharmacy 116, complaint 0.
  4. **`POST /complaints`** with the form's body
     `{"complaintId":"7b6c…","wardId":18,"description":"Tap water smells of sewage since Monday"}`:
     201, and a row `ward 18 | complaint | 2026-10-09 | 1 | user | 2026-10-09`. The same body
     again gives 200 `duplicate: true`, and the count stays 1. The webhook without the secret
     gave 401; with it, 200.
  5. **`npm run detector:once`**: it loaded 58,196 rows, exactly the database count for its
     window: 1,944 `real` rain + 1 `user` complaint + 56,251 `synthetic`.
  6. **Water outbreak.** `POST /demo/inject {"cause":"water","wardId":18,"runDetector":false}`,
     then `npm run detector:once`. One alert, ward 21 (water zone 14, the same zone as ward 18):
     - score 0.934, signals: complaint, pharmacy, hospital
     - P1's evidence, e.g. "complaints 5.3x normal for a Sunday …", "chance of an outbreak: 93%"
     - the classifier now says "no heavy rain in the last 10 days (real rain data)", because
       real rain rows are there
     - events: raised by "Daily detector run", then the email note (SES mock)

     A second detector run said "recomputing it from yesterday's saved state": still 1 alert
     and 1 email event.
- **The real Lambda bundles** (`infra/cdk.out/asset.*/index.mjs`) for rain and feed, run
  against the local database: rain wrote 1,944 rows and the feed wrote 733 (355 late).
- **`cdk synth`** passes. The template has 5 Lambdas (api, detector, db-setup, rain, feed),
  3 schedules and 1 bucket.
- **Frontend in real mode** (`VITE_API_MODE=real`, local API), driven with Playwright:
  - **Report form**: its real request is `{ complaintId, wardId: 18, description }` → 201, a
    `user` row.
  - **Pages**: Map, Alerts, alert detail (the "Real" rain chart from Open-Meteo, and the rain
    sentence), Data (sources including User), Home (rain today: Real, 0.3 mm).
  - **Phone**: the Report page at 375 px, with no sideways scroll.
  - **No console errors and no failed API requests.** One map-style request from
    openfreemap.org was cancelled because the script left the Map page quickly; staying on
    the Map page for 8 s gives no failures.
  - **Screenshots**: `docs/screenshots-real-mode/p2-*.png`.
- **The frontend's own Playwright suite** (mock mode): 20 of 21 pass. The failure is noted below.

## What is not fixed, and why
1. **Not deployed to AWS.** I used no AWS credentials, so these are untested on real AWS:
   - the rain and feed Lambdas running on their schedules
   - writing to S3
   - the SSM webhook secret
   - the dashboard widgets and the alarm with real data
   - Open-Meteo reached from Lambda (outbound internet from a Lambda outside the VPC should
     work, but it has not been seen)

   Everything from P3's list is also still untested (first deploy, PostGIS on RDS, SES).
2. **Feed vs webhooks share a key.** The daily feed and `/webhooks/pharmacy|hospital` both
   write `(ward, type, date, synthetic)`; whichever writes last wins. Use one per environment.
3. **Feed vs demo inject.** The next morning's feed re-writes P1's normal late rows for the
   days just before it, which removes part of an injected outbreak from those days. Run
   `POST /demo/reset` or inject again after the feed.
4. **Complaint count race.** Two complaints for the same ward in the same instant can, rarely,
   leave the daily row one short until the next complaint for that ward and day. The ids
   themselves are never lost.
5. **Complaints are not copied to S3.** The task listed the Open-Meteo answer and feed and
   webhook batches. Complaints hold citizen text, so they are left out on purpose.
6. **Complaint text is required, as in P2's rules.** The old documented body `{ wardId }` is
   now refused (400). The form always sends a description.
7. **The webhook secret is plain text** (an SSM String and a Lambda environment variable),
   like the demo key.
8. **One frontend accessibility test fails, and it already did before my changes.** It is
   `e2e/a11y.spec.ts`, light theme, Home: colour contrast 4.26 instead of 4.5 on the honesty
   note. I ran the same test on the frontend code from before this work, and it fails the
   same way. I left it alone.
9. **The first-alert cause hint is often wrong.** Here a water outbreak was hinted "food
   49%". This is P1's known limit, not changed.
10. **P3's earlier limits still apply:** the database is public, `rds.force_ssl` is not set,
    and the demo key is plain text.

## Commands

**Locally** (PostgreSQL with PostGIS):
```bash
npm install
export DATABASE_URL=postgres://outbreak@localhost:5433/outbreak_watch
npm run db:setup
npm run rain:once --workspace=@outbreak/backend                        # real rain, all 243 wards
npm run feed:once --workspace=@outbreak/backend -- --day 2026-10-09   # rows arriving that day (default: today)
# keep raw copies in a folder: add RAW_ARCHIVE_DIR=/some/folder
npm run detector:once --workspace=@outbreak/backend
# API and app:
DEMO_AUTH_TOKEN=<demo key> WEBHOOK_SECRET=<secret> SES_MOCK=true npm run api:local --workspace=@outbreak/backend
cd frontend && VITE_API_MODE=real VITE_API_BASE_URL=http://localhost:3001 npm run dev   # form at /report
# a webhook:
curl -X POST localhost:3001/webhooks/hospital -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: <secret>" -d '[{"wardId":30,"count":4}]'
```
Without a database (rain into memory only): `npm run demo:rain --workspace=@outbreak/pipeline`.

**On AWS** (from the repo root, region ap-south-1):
```bash
aws ssm put-parameter --region ap-south-1 --name /outbreak/demo-auth-token --type String --value '<demo key>'
aws ssm put-parameter --region ap-south-1 --name /outbreak/webhook-secret --type String --value "$(openssl rand -hex 24)"
SES_FROM_EMAIL=<sender> OFFICER_EMAIL=<officer> npm run deploy
aws lambda invoke --function-name outbreak-watch-db-setup --region ap-south-1 --cli-read-timeout 310 db-setup.json && cat db-setup.json
# The schedules then run by themselves: rain every hour, feed at 06:00 IST. To run them now:
aws lambda invoke --function-name outbreak-watch-rain --region ap-south-1 rain.json && cat rain.json
aws lambda invoke --function-name outbreak-watch-feed --region ap-south-1 \
  --cli-binary-format raw-in-base64-out --payload '{"day":"2026-10-09"}' feed.json && cat feed.json
# Raw copies: the RawBucketName stack output, under raw/<source>/<day>/
```

## Follow-up fixes

1. **One writer for pharmacy/hospital:** the daily feed (`backend/src/handlers/feedHandler.ts`) now POSTs those rows to `/webhooks/pharmacy` and `/webhooks/hospital` (`API_URL` + webhook secret, both passed to the feed Lambda in the stack); complaint rows still go through the feed job.
2. **Injected outbreaks survive the feed:** migration `004_demo_outbreaks.sql`; `/demo/inject` saves the outbreak, `/demo/reset` clears it, and the feed keeps generating each active one (test: `backend/tests/demo-outbreaks.test.ts`).
3. **Home axe failure:** the colours were fine (pill text 6.43:1 light, 8.84:1 dark). axe was running during the entrance fade, which made it fail intermittently. `e2e/a11y.spec.ts` now waits for finite animations to finish.
4. That wait exposed a real issue: `CountUp` put `aria-label` on a plain span. It now uses screen-reader-only text instead.
