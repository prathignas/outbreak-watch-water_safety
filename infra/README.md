# @outbreak/infra

AWS CDK (TypeScript) for Outbreak Watch. Region: `ap-south-1` (Mumbai) unless `AWS_REGION` says otherwise.

## What it creates

| Resource | Name | What it does |
|---|---|---|
| RDS PostgreSQL 16 (`db.t4g.micro`) | `outbreak_watch` database | Wards, zones, signals, alerts, alert events, detector state. PostGIS is turned on by migration 001. |
| Secrets Manager | `outbreak/db/credentials` | Database user and password. The Lambdas read it at run time. |
| Lambda (esbuild bundle of `backend/src/handlers/apiHandler.ts`) | `outbreak-watch-backend-api` | The REST API in `frontend/README.md`. The demo inject and reset also run the detector. |
| Lambda (bundle of `detectorHandler.ts`) | `outbreak-watch-detector` | Runs P1's `runDetector` for every India day that has not run yet, saves alerts and state, emails the officer. |
| Lambda (bundle of `dbSetupHandler.ts`) | `outbreak-watch-db-setup` | Migrations, then seed. Run it once after the first deploy. |
| EventBridge | `outbreak-watch-every-5-minutes` | Starts the detector every 5 minutes. A day that already ran is skipped, so this is cheap. |
| API Gateway (REST) | `Outbreak Watch Public & Officer API` | Proxies everything to the API Lambda. CORS allows `Content-Type`, `X-Demo-Auth` and `X-Officer-Name`. |
| SES email identities | from `SES_FROM_EMAIL` and `OFFICER_EMAIL` | Alert emails. |
| SSM parameters | `/outbreak/ses-from-email`, `/outbreak/officer-email` | A copy of the two addresses, for reference. |
| CloudWatch | dashboard `OutbreakWatch-Operational-Dashboard`, alarm `OutbreakWatch-DetectorErrors`, 30-day log groups | The dashboard reads the metric names in `backend/src/metrics.ts`, the same list the detector emits. |
| AWS Budgets | `OutbreakWatch-Monthly-Budget` | $15 a month; emails at 80%. |

**What goes into each bundle.** P1's `city.json` is imported, so esbuild puts it inside every
bundle. After bundling, CDK copies these files next to each bundle:
- every bundle: `backend/src/db/migrations/`
- API: `detection/results/backtest.json` without `runs`
- DB setup: `detection/data/wards.geojson` and `zones.geojson`

esbuild runs on your machine; Docker is not needed.

## Settings (read at deploy time, never written in the code)

| Setting | CDK context (`-c name=value`) | or env var | Needed? |
|---|---|---|---|
| Sender email | `sesFromEmail` | `SES_FROM_EMAIL` | For emails |
| Officer email | `officerEmail` | `OFFICER_EMAIL` | For emails |
| Budget alert email | `budgetEmail` | `BUDGET_EMAIL` | No (default: the officer email) |
| Demo password | `demoAuthToken` | `DEMO_AUTH_TOKEN` | No: if not given, it is read from the SSM parameter `/outbreak/demo-auth-token` |
| Webhook secret | `webhookSecret` | `WEBHOOK_SECRET` | No: if not given, it is read from the SSM parameter `/outbreak/webhook-secret` |
| Webhook secret header name | `webhookSecretHeader` | `WEBHOOK_SECRET_HEADER` | No (default `X-Webhook-Secret`) |
| Allowed web origin | `corsOrigin` | `CORS_ALLOW_ORIGIN` | No (default `*`; set it to the CloudFront URL) |

- **The SES sandbox.** Both email addresses must be **verified**. After deploy, AWS sends each
  address a link; click it. Until both are verified, alerts are still saved, but the email
  fails and the alert's log shows "Alert email could not be sent".
- **No email settings.** `cdk synth` and `cdk deploy` still work. They print a warning and
  create no identities and no budget email.
- **Passing settings through npm.** Use env vars, not `-c`, with `npm run synth` and
  `npm run deploy`. npm takes `-c` for itself.

## Deploy (from the repo root)

```bash
npm install
# 1. Once per account and region: the demo password (choose your own value)
aws ssm put-parameter --region ap-south-1 --name /outbreak/demo-auth-token --type String --value '<your demo key>'
#    and the webhook secret (callers of /webhooks/* send it in the X-Webhook-Secret header)
aws ssm put-parameter --region ap-south-1 --name /outbreak/webhook-secret --type String --value "$(openssl rand -hex 24)"
# 2. Deploy
SES_FROM_EMAIL=<sender address> OFFICER_EMAIL=<officer address> npm run deploy
# 3. Once, after the first deploy: create the tables and seed (the stack prints this as DbSetupCommand)
aws lambda invoke --function-name outbreak-watch-db-setup --region ap-south-1 --cli-read-timeout 310 db-setup.json && cat db-setup.json
# 4. Click the two SES verification links
```
- **The API URL.** It is the stack output `ApiUrl`. The frontend uses it as `VITE_API_BASE_URL`.
- **Changing the password.** Update the SSM parameter, then deploy again.
- **Setup from your own machine.** This works too, because the database is public:
  `DB_SECRET_ARN=<DatabaseSecretArn output> AWS_REGION=ap-south-1 npm run db:setup`.

## P2's ingestion jobs
| Lambda | When | What |
|---|---|---|
| `outbreak-watch-rain` | every hour | Real rain from Open-Meteo (P1's archive API and point, Asia/Kolkata, mm), last 7 days up to today, one value per day into all 243 wards, tagged `real`. A failed fetch writes nothing and fails the run. |
| `outbreak-watch-feed` | 06:00 IST daily (`cron(30 0 * * ? *)`) | P1's `rowsArrivingOn(today, DEMO_SEED, RealCity)`: the synthetic rows that arrive today, late rows for earlier days included, tagged `synthetic`. |

- **Raw copies.** Bucket output `RawBucketName`: `raw/rain/<day>/`, `raw/feed/<day>/`,
  `raw/webhook-pharmacy/<day>/`, `raw/webhook-hospital/<day>/`. Kept 365 days. Each Lambda
  may only `PutObject` under its own prefix. Complaints are not copied (citizen text).
- **Run by hand:**
  ```bash
  aws lambda invoke --function-name outbreak-watch-rain --region ap-south-1 rain.json && cat rain.json
  aws lambda invoke --function-name outbreak-watch-feed --region ap-south-1 --cli-binary-format raw-in-base64-out --payload '{"day":"2026-10-09"}' feed.json && cat feed.json
  ```
- **Dashboard.** Rain, feed and webhook widgets; names in `backend/src/metrics.ts`
  (`PIPELINE_METRICS`). Alarm `OutbreakWatch-RainFetchFailing` after 3 failed hours.

## Reset the demo
```bash
curl -X POST "$API_URL/demo/reset" -H "X-Demo-Auth: <your demo key>"
```
The reset clears alerts, events, signals and detector state. It then re-seeds and runs the detector.

## Commands
```bash
npm run synth     # from the repo root; bundles the Lambdas and writes infra/cdk.out
npm run deploy
npm run destroy
npm test          # root: synth first, then every workspace's tests
```

## Limits (known, not fixed yet)
- **The RDS database is public.** `publiclyAccessible: true` and port 5432 is open to
  `0.0.0.0/0`, so the Lambdas can reach it without a VPC or NAT gateway. The password is in
  Secrets Manager and the connection uses TLS, but the port is reachable from the internet.
  Fix later: put the Lambdas in the VPC and close the port.
- **TLS is not enforced.** `rds.force_ssl` is not set (an earlier README said it was). The
  backend connects with TLS, but the server does not refuse plain connections.
- **The demo password is plain text.** It is a String SSM parameter and a Lambda environment
  variable. It is a demo key, not a login.
- **The webhook secret is plain text.** `/webhooks/pharmacy` and `/webhooks/hospital` need the
  header `X-Webhook-Secret` (name: `WEBHOOK_SECRET_HEADER`) with the value of the SSM parameter
  `/outbreak/webhook-secret`; without it they answer 401 and write nothing. Like the demo key,
  it is a String parameter and a Lambda environment variable, not a SecureString.
