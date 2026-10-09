# Pipeline (@outbreak/pipeline)

**Owner:** P2

Data ingestion for Outbreak Watch. Every signal row that enters the database goes through
this package: real rain, P1's daily synthetic feed, the pharmacy and hospital webhooks, and
citizen complaints from the form. Rows are checked, put on the India (Asia/Kolkata) day,
de-duplicated, and written through the backend's existing `insertSignals`.

Types come only from `@outbreak/contract` (P1's real types plus contract v2). Values come
from `@outbreak/detection` (P1's `rowsArrivingOn`, `RAIN_SOURCE`).

## The row

```ts
// @outbreak/contract ReportedSignalRow
{ wardId,        // P1's city.json ward id; 0 is allowed (ids are >= 0)
  signalType,    // "complaint" | "pharmacy" | "hospital" | "rain"
  date,          // India day the count is FOR
  count,         // daily total; rain = mm (decimal)
  sourceTag,     // "real" | "scraped" | "user" | "synthetic"
  reportedOn }   // India day the row REACHED us; never before date
```
A repeat of the same `(wardId, signalType, date, sourceTag)` replaces the row: new `count`,
new `reportedOn`.

## Sources

| Source | Code | Tag | Rule |
|---|---|---|---|
| Rain | `jobs/rain-job.ts`, `adapters/rain-*.ts` | `real` | Open-Meteo **archive** API, same as P1's `rain.json` (`RAIN_SOURCE`: 12.9716, 77.5946, `Asia/Kolkata`, `precipitation_sum`, mm). Last 7 days up to today; nothing after today. One value per day into every ward given (the backend passes all 243). `reportedOn = date`. A failed or malformed fetch writes **nothing** (no zeros, no guesses). A day Open-Meteo has no value for gets no row. |
| Daily synthetic feed | `jobs/feed-job.ts`, `adapters/live-day-adapter.ts` | `synthetic` | P1's real `rowsArrivingOn(day, seed, { city })`. Late rows are normal: `date` may be earlier than `reportedOn`. Each row must have `reportedOn === day`. Only complaint, pharmacy, hospital. |
| Webhooks | `adapters/pharmacy-*.ts`, `hospital-*.ts`, `daily-ward-count-*.ts` | `synthetic` | Body `[{ wardId, count, date?, reportedOn? }]` (or one object, or `{ records }`). `date` and `reportedOn` default to the day received; `reportedOn` after that day, before `date`, a non-synthetic tag or another signal type is refused. One bad row refuses the batch. |
| Complaints | `adapters/complaint-*.ts` | `user` | The frontend form sends `{ complaintId, wardId, description }`. The backend stamps the time (server clock decides the day). Each event id counts once (`DatabaseComplaintEventStore`, table `complaint_events`), so retries and Lambda restarts never double count. No id: the backend makes one, so each submission counts once. Complaint text is required but not stored. |

## Writing to the database

- `PostgresSignalSink(db)` calls the backend's `insertSignals` (pass `getDatabase()` from
  `@outbreak/backend`). No SQL of its own. It is typed by shape, so this package does not
  import the backend.
- `DatabaseComplaintEventStore(db)` uses the backend's `recordComplaintEvent`,
  `hasComplaintEvent`, `countComplaintEvents` (migration 003).
- `RawArchive`: an untouched copy of each Open-Meteo answer, feed batch and webhook batch, under
  `raw/<source>/<YYYY-MM-DD>/`. The backend gives S3 (`RAW_BUCKET`) or a local folder
  (`RAW_ARCHIVE_DIR`). A failed copy is logged and never stops the data.

The backend glue is `backend/src/ingest.ts` (routes) and `backend/src/handlers/rainHandler.ts`,
`feedHandler.ts` (Lambdas).

## Commands

```bash
npm test --workspace=@outbreak/pipeline           # unit tests (no network, no database)
npm run demo:rain --workspace=@outbreak/pipeline  # live Open-Meteo, 243 wards, in memory only
# Into the database (backend/):
DATABASE_URL=... npm run rain:once --workspace=@outbreak/backend
DATABASE_URL=... npm run feed:once --workspace=@outbreak/backend -- --day 2026-10-09
```

## Known issues

1. **Shared key.** The daily feed and the pharmacy/hospital webhooks both write
   `(ward, type, date, synthetic)`. Whichever writes last wins. Use one of them per environment.
2. **Complaint count race.** The daily count is "count of stored ids", written after each
   complaint. Two complaints for the same ward in the same instant can, rarely, leave the row
   one short until the next complaint for that ward and day.
3. **Postgres NUMERIC.** `count` comes back from `pg` as a string; the backend's `getSignals`
   converts it with `parseFloat`.
