# Outbreak Watch (frontend)

Early warning for contaminated water, Bengaluru. A prototype for the AWS hackathon
(Heat and Water track). **Health signals are simulated; rain, ward and water-zone
boundaries are real** (see the Data page and `seed/`).

Stack: Vite + React + TypeScript (strict), Tailwind CSS v4 with design tokens
(`src/styles/tokens.css`), shadcn/ui on Radix, React Router, TanStack Query, MSW,
MapLibre GL (OpenFreeMap tiles), Recharts, Framer Motion, Vitest + Testing Library,
Playwright + axe. Output is a static build in `dist/` for S3 + CloudFront.

## Run it (mock mode, no backend)
```bash
npm install
cp .env.example .env.local     # VITE_API_MODE=mock, VITE_DEMO_KEY=watch-demo
npm run dev                    # http://localhost:5173
```
- **Gate:** enter the demo key (`watch-demo` by default) and your name. Your name appears in
  the activity log.
- **Demo controls:** press `Shift+D` or use the Demo button to inject a water, food or
  person-to-person outbreak in any ward, fast-forward a day, or reset.
- **What the mock runs:** the detection module's own code (`../src`: `generateLiveDay`,
  `runDetector`, `wardRisk`). Nothing is copied. It runs in a Web Worker, with seed 2026 and
  the demo clock starting at 2026-07-08 (the handoff scenario), plus real Open-Meteo rain.
- **State:** kept in that browser tab only. A page reload starts the demo fresh.
- **Bundle cost:** mock mode adds 711 KB to the build (209 KB gzip): the engine worker
  (128 KB), city and rain data (114 KB), and MSW with the slimmed results.

| Script | What |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | type-check + static build in `dist/` |
| `npm run preview` | serve `dist/` |
| `npm test` | Vitest unit tests (API client, mock backend, helpers) |
| `npm run e2e` | Playwright: full story, axe on every screen, screenshots to `e2e/screenshots/` |
| `npm run seed` | copy `seed/` files into `public/` and `src/mock/data/` |

## Switch to the real backend
```bash
VITE_API_MODE=real
VITE_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/<stage>
npm run build
```
- **One setting:** that's the only switch. In real mode MSW and the mock engine are not
  included in the build.
- **Leftover file:** `dist/mockServiceWorker.js` is still copied from `public/` but never
  loaded; P3 may delete it.
- **Real-mode differences:**
  - "Today" is the date in India time.
  - The fast-forward button is hidden.
  - The gate's demo key is checked by the server (`X-Demo-Auth`).
- **Static files** served next to `index.html`: `wards.geojson`, `zones.geojson`, `city.json`
  (from `public/`).

## Routes P3 must provide
All JSON. Field names follow `src/contract/types.ts` (contract v1, unchanged) and
`seed/contract-v2.md` (v2 proposals). The TypeScript shapes are in `src/api/types.ts`.

| Method and path | Headers | Body | Returns |
|---|---|---|---|
| `GET /alerts` | | | `AlertRecord[]`, newest `createdAt` first |
| `GET /alerts/{id}` | | | `AlertRecord` (404 `{message}` if unknown) |
| `POST /alerts/{id}/ack` | `X-Demo-Auth`, `X-Officer-Name` | | updated `AlertRecord`; 409 if not open |
| `POST /alerts/{id}/resolve` | `X-Demo-Auth`, `X-Officer-Name` | | updated `AlertRecord`; 409 if already resolved |
| `POST /alerts/{id}/notes` | `X-Demo-Auth`, `X-Officer-Name` | `{ text }` | updated `AlertRecord` |
| `GET /wards/{id}/signals?from=&to=` | | | `LiveSignalRow[]`: all signal types for that ward, rows known by today |
| `GET /risk?date=YYYY-MM-DD` | | | `WardRisk[]` for every ward (from `wardRisk()`) |
| `GET /rain?from=&to=` | | | `RainRow[]` (`{ date, mm, sourceTag: "real" }`), one per day |
| `GET /backtest` | | | `BacktestResult` without `runs`, including `chanceCheck` |
| `POST /demo/inject` | `X-Demo-Auth`, `X-Officer-Name` | `{ cause: "water"\|"food"\|"p2p", wardId }` | `{ injection, appearsAfterMs }` |
| `POST /demo/reset` | `X-Demo-Auth` | | `{ today, seed, injection }` |
| `POST /demo/advance` | `X-Demo-Auth` | | mock only; P3 does not need it |
| `GET /demo/state` | | | mock only (the demo clock); real mode uses the local India date |

```ts
interface AlertRecord { id: string; status: "open" | "acknowledged" | "resolved"; createdAt: string;
  alert: Alert /* v1, evidence = detector reasons */; causeEvidence: string[] /* classifier reasons */; events: AlertEvent[] }
interface AlertEvent { at: string; by: string; kind: "raised" | "acknowledged" | "resolved" | "note"; text?: string }
interface LiveSignalRow extends SignalRow { reportedOn: string }
interface WardRisk { wardId: number; probability: number; contributingSignals: ("complaint" | "pharmacy" | "hospital")[] }
```
- **Errors:** return `{ "message": "plain words" }` with a 4xx or 5xx status. The UI shows the
  message as is.
- **Auth:** 401 means the demo key is wrong; the UI asks the officer to enter it again.
- **CORS:** allow the CloudFront origin, the `Content-Type`, `X-Demo-Auth` and `X-Officer-Name`
  headers, and GET and POST.

More detail: `docs/FRONTEND.md` (design system, decisions, API requests) and
`seed/contract-v2.md`.
