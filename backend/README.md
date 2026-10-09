# @outbreak/backend

The API and the daily detector run for Outbreak Watch. It calls P1's real detection module
(`@outbreak/detection`) and answers every route in `frontend/README.md`.

## Parts
- **`src/api/router.ts`**: the routes and their checks. `records.ts` turns stored alerts into
  contract-v2 `AlertRecord`s. `backtest.ts` serves P1's results file. `auth.ts` checks `X-Demo-Auth`.
- **`src/detector/orchestrator.ts`**: one detector run. It runs P1's
  `runDetector(rows, day, city, RUN_DETECTOR_PARAMS, state)` for every India day not yet run, with
  70 days of rows. It saves each day's alerts and state in one transaction, then emails the
  officer about new alerts and emits CloudWatch metrics (names in `src/metrics.ts`).
- **`src/db/`**:
  - `repository.ts`: Postgres and in-memory versions of one interface.
  - `migrations/` and `migrate.ts`
  - `seed.ts`: P1's `city.json` and `generateHistory()`, all synthetic, no rain.
  - `setup.ts`: migrations, then seed.
- **`src/notifications/ses.ts`**: the alert email. It says "SUSPECTED, NOT CONFIRMED" and
  labels the cause a "triage hint, not a diagnosis".
- **`src/handlers/`**: the Lambda entries: `apiHandler.ts`, `detectorHandler.ts`, `dbSetupHandler.ts`.
- **`src/config.ts`**: every setting, each with where it comes from.

## Scripts
```bash
npm run db:setup        # migrations + seed (DATABASE_URL or DB_SECRET_ARN)
npm run api:local       # the API on http://localhost:3001 (PORT to change), for the frontend in real mode
npm run detector:once   # one detector run, like the schedule (--date, --rerun-from)
npm test                # unit + API tests in memory; set TEST_DATABASE_URL to also test real PostgreSQL
npx tsx scripts/demo-pipeline-flow.ts   # seed -> inject -> detector -> AlertRecord, in memory
```
