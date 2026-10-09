# Outbreak Watch: frontend design and plan

Status: **built (2026-10-09)**. Design v2 approved by Person 1, plus card touch feedback (section 3.5). Run instructions and the route list are in `README.md`.
The first design (flat operations console, 2026-10-08) was rejected by Person 1. Only its visual
style and layout were thrown away; the data, API, mocks, logic, honesty rules and test plan stay.
Mockups: `design/mockups-v2/*.png`, built by `design/build-mockups-v2.mjs` from
`design/mockup-data.json` (a real detection-module run).

## 0. Skills and tools (checked 2026-10-08)
| Asked for | Available? | Used for |
|---|---|---|
| frontend-design | yes | design review |
| UI-UX skill (ui-ux-pro-max) | yes | accessibility and chart checks during the build |
| superdesign | **missing** | mockups are hand-built HTML, screenshotted with Playwright |
| better-icons | **missing** | one icon family: Lucide, 22 px in the nav, 20 px elsewhere, 1.75 stroke |
| no-ai-slop | **missing** | the brief's rules are the checklist (section 10) |
| GitHub tool (read docs only) | **missing** (`gh` not installed) | library docs are read on the web; nothing is pushed |

### Where the brief and the global CLAUDE.md differ
- **Fonts:** CLAUDE.md wants a display font paired with a body font, and never Inter. Chosen:
  **Manrope** for display (headings, gauges, key numbers, with tabular figures) and **Atkinson
  Hyperlegible** for body. The body font was designed for low-vision legibility, which suits a
  civic tool watched on compressed video.
- **MagicUI:** not used. The soft gauges, count-up numbers and shimmer are small in-house
  components on Framer Motion, so there is one motion system.
- **Framer Motion:** used for page transitions, count-up numbers, the logo ripple, and the
  new-alert glow. All of it is off under `prefers-reduced-motion`.
- **shadcn/ui:** used for accessible primitives (dialog, tabs, tooltip, select, switch, toast),
  restyled as soft UI.

## 1. Seed data (unchanged from v1, plus two updates)
`frontend/seed/` holds copies of the real files: `types.ts` (contract v1, copied unchanged to
`src/contract/types.ts`), `contract-v2.md`, `city.json`, `wards.geojson`, `zones.geojson`,
`backtest.json` (FINAL, now with `chanceCheck`), `chance.json`, `classifier.json`,
`handoff/sample-*.json`, and real Open-Meteo rain for 2022-2025 and April-September 2026.
Sources are verified in `data/SOURCES.md`:
- **Wards:** byte-identical to DataMeet's `Bangalore/BBMP.geojson`. Licence CC BY-SA 2.5 India.
- **BWSSB KML:** byte-identical to the OpenCity resource. Listed as Public Domain.

## 2. Design direction (plain English)
**A calm smart-home app for city water.** Soft UI (neumorphism):
- Cards and buttons are the same misty blue-grey as the background, raised by two soft shadows:
  light from the top-left, darker to the bottom-right.
- Anything active or pressed sinks in, shown with an inset shadow.
- Corners are large and round. The page is airy, with few things per screen.

The colours come from water: mist, deep navy-teal ink, and aqua and teal accents.

**The one bold element is the ring gauge.** It is a thermostat-style dial: "City water health
today" on Home, and the alert's chance of an outbreak on Alerts. Everything else stays quiet.

**Soft UI's known weakness is low contrast, so these rules always hold:**
- Every text and icon colour passes WCAG AA (section 3).
- A button is never shown by shadow alone. It always has an icon and a label, and the primary
  action also has a teal fill.
- Status is never shown by colour alone. It always has a label and an icon. On the map, alert
  wards also get an outline and a marker (section 3.3).

**Honesty stays part of the design:**
- the honesty pill under the header, which also says "Mock mode" when mocks are on;
- Real, User and Simulated badges;
- "Triage hint, not a diagnosis" on every cause view;
- the chance level beside every Proof result, or "not computed";
- "relative risk (simulated health data)" on the map and the gauge.

## 3. Design system (`src/styles/tokens.css`, one file, mirrored in `tailwind.config.ts`)
### 3.1 Colour. Contrast is measured against the background (`--bg`) and the inset well.
| Token | Light | Dark | Use and contrast |
|---|---|---|---|
| `--bg` | `#E4EDF2` | `#13232D` | page and every raised surface (soft UI: the same colour) |
| `--inset` | `#DAE5EB` | `#0F1D26` | pressed wells, gauge track, input fields |
| `--ink` | `#183846` | `#E3EEF2` | text and icons: 10.5:1 / 13.6:1 (9.7:1 on inset) |
| `--muted` | `#3D5866` | `#A9C0CA` | secondary text: 6.4:1 / 8.5:1 (5.9:1 on inset) |
| `--teal` | `#0A6670` | `#45CAD6` | accent text and icons, links, focus ring, primary button fill: 5.6:1 / 8.2:1 |
| `--on-teal` | `#FFFFFF` | `#0B1A22` | text on the primary button: 6.7:1 / 9.0:1 |
| `--aqua` | `#2BB3C0` | `#3CC6D2` | glow and decoration only, never text (2.1:1 on light) |
| `--gauge` | `#1A8F9B` | `#3CC6D2` | gauge arcs, progress bars: 3.0:1 on inset (light) / 8.3:1 |
| `--pill-bg` / `--pill-ink` | `#F5E6C4` / `#6E4A00` | `#2A2A22` / `#F1C46A` | honesty pill: 6.4:1 / 8.8:1 |
| `--shadow-hi` | `rgb(255 255 255 / .85)` | `rgb(40 62 76 / .55)` | the light top-left shadow |
| `--shadow-lo` | `rgb(140 166 184 / .50)` | `rgb(4 10 14 / .75)` | the dark bottom-right shadow |

### 3.2 Shadows (always two layers; pressed = inset)
| Token | Value (light; dark uses the dark shadow colours) |
|---|---|
| `--raise-sm` | `-3px -3px 8px var(--shadow-hi), 3px 3px 8px var(--shadow-lo)` (chips, small buttons) |
| `--raise-md` | `-6px -6px 14px var(--shadow-hi), 6px 6px 14px var(--shadow-lo)` (cards, nav buttons) |
| `--raise-lg` | `-10px -10px 24px var(--shadow-hi), 10px 10px 24px var(--shadow-lo)` (gauge, map card) |
| `--press` | `inset 4px 4px 10px var(--shadow-lo), inset -4px -4px 10px var(--shadow-hi)` (active nav, pressed button, selected chip, input wells) |
| `--glow` | `0 0 0 2px var(--aqua), 0 0 18px 4px rgb(43 179 192 / .45)` (suspected zone, new alert, focus on dark) |

- **Hover:** the button lifts 2 px (raise-md becomes raise-lg).
- **Click:** it presses in (`--press`) for 120 ms.
- **Focus:** a 3 px `--teal` ring, never a shadow.

### 3.3 Status and cause colours (fixed everywhere; never colour alone)
| Status | Rule | Chip (fill / ink) | Map fill (light / dark) | Extra cue |
|---|---|---|---|---|
| Calm | relative risk under 10% | `#CDEFF2` / `#0A5560` | `#E4F4F6` / `#1A3540` | icon `waves` |
| Watch | 10% to below the alert line (0.715) | `#F6E2B0` / `#6E4A00` | `#EFD08A` / `#8F6B26` | icon `eye`, dotted ward outline |
| Alert | open alert, or at or above the alert line | `#F8CFC4` / `#8A2E1A` | `#D2553C` / `#E06A50` | icon `siren`, 2 px coral outline plus a marker pin |

- The 10% watch line is a display choice: **ASSUMPTION - needs source**. It is shown in the legend.
- **Map fills are soft by request,** so neighbouring fills are below 3:1 against each other
  (watch against calm is 1.2:1). Status is therefore also carried by the outline and the marker,
  the tooltip text, and the legend.
- Chips pass AA for text: ink on fill is 7-9:1.

| Cause | Light | Dark | Label |
|---|---|---|---|
| water | `#2C6FBF` | `#6AA8EE` | Water |
| food | `#B85F12` | `#F09A4A` | Food |
| p2p | `#7A55C7` | `#B39AF0` | Person to person |
| seasonal | `#2E8257` | `#5CC28E` | Seasonal |
| unknown | `#5F717B` | `#9AABB3` | Unknown |

All of them are at least 3.8:1 on light and 6.5:1 on dark, enough for bars and dots. Cause
names are always written in `--ink` next to the colour.

### 3.4 Type
| Token | Font | Size / line | Weight | Use |
|---|---|---|---|---|
| `--text-sm` | Atkinson Hyperlegible | 15 / 22 | 400 | badges, legend, chart labels (the minimum anywhere) |
| `--text-body` | Atkinson Hyperlegible | 16 / 26 | 400 | body, evidence lines |
| `--text-lead` | Atkinson Hyperlegible | 18 / 28 | 700 | card titles, ward names |
| `--text-h2` | Manrope | 24 / 32 | 700 | section titles |
| `--text-h1` | Manrope | 32 / 40 | 700 | page titles, brand name |
| `--num-md` | Manrope (tabular) | 40 / 44 | 700 | tile numbers |
| `--num-lg` | Manrope (tabular) | 56 / 60 | 700 | gauge centres |

Text is in sentence case everywhere. There are no all-caps labels.

### 3.5 Spacing, radius, grid, motion
- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64 only.
- **Radius:** 12 px for chips and badges, 20 px for buttons and inputs, 24 px for cards, 28 px
  for large cards (map, gauge), 999 px for pill buttons, circles for gauges.
- **Desktop grid** (1280 and up):
  - Nav rail: 120 px wide.
  - Content: a 12-column grid with 32 px gutters, 48 px outer margins, and a 1640 px max width.
- **Phone** (under 768):
  - The rail becomes a bottom bar (Home, Map, Alerts, Proof, Data).
  - Demo moves into the header menu.
  - One column with 16 px margins.
- **Motion:**
  - Page change: fade plus a 12 px slide, 200 ms ease-out.
  - Button lift and press: 120 ms.
  - Card touch (added on approval): on press, tap, or Enter/Space on a focused card, the card gives a tiny shake (rotation under 1 degree, 2 px sideways, 300 ms, once) and a short shine sweeps along its edge (a light highlight on the rounded border, 450 ms). Under reduced motion: no shake, and the edge highlight shows without moving.
  - Numbers count up over 600 ms when a page opens.
  - Logo water ripple: once on load, 900 ms.
  - New alert: one soft glow, 1.2 s.
  - Skeleton shimmer: 1.4 s loop.
  - Everything is replaced by instant changes under `prefers-reduced-motion`.

### 3.6 Charts (Recharts)
- Smooth monotone lines (`type="monotone"`) with a gradient fill fading to transparent.
- "Normal for this weekday" as a soft dashed curve. The alert day as a soft vertical glow band.
- No gridlines except a very faint baseline.
- Rain bars have fully rounded ends.
- Tooltips are soft rounded cards.
- Rows not reported yet are shown as a gap in the line with a dotted cap, and noted in text
  under the chart.

## 4. Brand
- **Logo:** a water drop with a small pulse line inside (an inline SVG drawn in-house, not a stock icon).
- **Name:** "Outbreak Watch". **Tagline:** "Early warning for contaminated water, Bengaluru".
- It appears in the nav rail (the drop alone, with the name under it) and large on Home.

## 5. Pages
```
Desktop shell
+------+------------------------------------------------------------------+
| drop | Page title                              8 Jul 2026  theme  name |
| Home | (Prototype pill: simulated health signals; real rain and maps)   |
|  Map |                                                                  |
|Alerts|   page content on the 12-column grid                             |
|Proof |                                                                  |
| Data |                                                                  |
|      |                                                                  |
| Demo |                                                                  |
+------+------------------------------------------------------------------+
```
1. **Home:**
   - The logo, name and tagline, with the honesty pill under the header.
   - Left, a large raised card: the circular gauge "City water health today" (share of wards
     calm), with the counts of calm, watch and alert wards beneath it.
   - Right, four soft tiles: Open alerts; Wards on watch; Rain today (Real badge); How well it
     works (links to Proof, with chance level shown).
2. **Map:**
   - The ward map fills a large rounded card.
   - Soft fills by relative risk, thin water-zone outlines, and the suspected zone glowing aqua.
   - A floating soft legend.
   - Tap or click a ward to open a small card (name, zone, status, link to its alert).
3. **Alerts:**
   - Left (4 columns): a vertical list of soft alert cards. Each shows the ward, zone, a small
     ring gauge with the chance, a triage-hint chip, and the date. Status and cause filters are
     soft chips.
   - Right (8 columns): the detail.
     - Header: a big ring dial for the chance of an outbreak, and Acknowledge, Resolve and Add
       note as soft pill buttons with icon and label.
     - Body: smooth signal charts (8 weeks), likely-cause bars with rounded ends and the
       "Triage hint, not a diagnosis" label, the classifier's reasons (`causeEvidence`), the
       detector's evidence as short lines, a mini zone map, rain, and the activity timeline.
   - On a phone the detail is its own page.
4. **Proof:**
   - One soft card per method.
   - Detection rates as rounded progress bars and ring gauges, with the chance level beside
     each, or "not computed".
   - Median days to detect, and false alarms per ward-year.
   - The "fusion does not help" cases marked.
   - The honest notes in plain sentences, with budget 0.25 as the headline and "results on
     simulated outbreaks".
5. **Data:**
   - The real-versus-simulated table as soft rows with badges.
   - Sources with links and licences.
   - What is a best match.
6. **Demo** (rail button and `Shift+D`):
   - inject water, food or p2p in a chosen ward;
   - reset;
   - fast-forward a day, in mock mode only and hidden when `VITE_API_MODE=real`.
7. **Other states:** shimmer skeletons, empty states with one action, errors with a retry, a 404
   page, and the gate (demo key and officer name).

## 6. API client and mock engine
- **Contract types:** `src/contract/types.ts` is an unchanged copy. The v2 shapes (`AlertRecord`,
  `AlertEvent`, `LiveSignalRow`, `WardRisk`, rain rows, `BacktestResult`) live in
  `src/api/types.ts`, each marked "contract v2 proposal".
- **Client:** `src/api/client.ts` reads `VITE_API_MODE` and `VITE_API_BASE_URL`. It adds
  `X-Demo-Auth` and `X-Officer-Name`, and gives typed errors and timeouts.
- **Queries:** TanStack Query for everything; live data polls every 10 s.
- **Summary figures** (open alerts, alerts today, wards on watch) are computed in the frontend from
  `GET /alerts` and `GET /risk`. There is no `/summary` route.
- **Mock mode** (MSW, in-memory, persists nothing; the banner says "Mock mode"):
  - **Engine:** the mock runs the detection module's own code (`generateLiveDay`,
    `generateHistory`, `runDetector`, `wardRisk`), imported from `../src`. No code is copied.
  - **Off the main thread:** the engine runs in a Web Worker, so the UI never freezes.
  - **Repeatable:** seeds are deterministic (seed 2026, demo clock starting 2026-07-08).
  - **Stubs:** only file reading is stubbed: `node:fs` and `node:url` are aliased to small stubs
    in `vite.config.ts`. `city.json` and rain are passed in as data.
  - **Bundle size:** the size the engine adds to the mock bundle will be measured and reported
    at build time.
  - **Inject:** produces rows shaped like `handoff/sample-live-day-injected.json` and an alert
    produced by `runDetector`, after a short delay, with the suspected zone set.
- **Map:** MapLibre GL with OpenFreeMap (Positron for light, Dark for dark). Terms checked: no
  key, no limits, attribution automatic. OSM raster tiles are the fallback.

## 7. Tests (unchanged plan)
- Vitest: the API client and the mock state.
- Playwright end-to-end: gate, inject, see it on the map and in the queue, open it, read the
  evidence, acknowledge, resolve, reset.
- axe on every screen, with zero serious issues.
- Screenshots at 1920x1080 (light and dark) and 390x844.

## 8. API requests for P3 (decided by Person 1, 2026-10-08; full shapes in `docs/contract-v2.md`)
1. **`AlertRecord`** = `{ id, status: "open"|"acknowledged"|"resolved", createdAt, alert: Alert,
   causeEvidence: string[], events: AlertEvent[] }`.
   - `AlertEvent` = `{ at, by, kind: "raised"|"acknowledged"|"resolved"|"note", text? }`.
   - Routes: `GET /alerts`, `GET /alerts/{id}`, `POST /alerts/{id}/ack`, `/resolve`, `/notes`.
2. **`X-Officer-Name` header:** free text, demo only, shown as "by" in the events.
3. **`GET /risk?date=`:** `{ wardId, probability, contributingSignals }[]` for every ward, from the
   new `wardRisk()` in the detection module. It uses the same Bayes code path as `runDetector`, and
   tests check that they agree. Labelled "relative risk (simulated health data)".
4. **`GET /rain?from=&to=`:** daily city-wide rainfall rows, `sourceTag: "real"`. **No `/summary`
   route:** the frontend computes the summary from `GET /alerts`.
5. **`GET /backtest`:** now includes `chanceCheck`. Chance is computed with the same 20 seeds,
   per method, difficulty, outbreak type and budget. Seasonal is "not computed", because the wave
   touches every ward. Proof shows "not computed" rather than hiding it.
6. **Evidence:** `Alert.evidence` = detector reasons, `AlertRecord.causeEvidence` = classifier
   reasons. `runDetector` now returns `causeEvidence` per ward.
7. **`POST /demo/advance`:** mock only. The button is hidden in real mode.

## 9. Mockup data
`design/prepare-mockup-data.ts` runs the detection module on the handoff scenario (seed 2026, water
outbreak in ward 18 from 6 Jul 2026) with real 2026 rain, and records:
- the alerts (detector evidence and `causeEvidence` kept separate);
- `wardRisk` for every ward;
- 8 weeks of signals for ward 39.

## 10. Review checklist
- No emoji, sparkles, "AI-powered", lorem ipsum, made-up numbers, hero banner, gradient text,
  stock illustrations, or meaningless badges.
- Every number comes from the seed data or the API.
- Every text and icon passes AA. No button is shown by shadow alone (it always has an icon and a
  label). No status is shown by colour alone.
- Spacing comes from the scale only and sits on the 12-column grid. No text touches an edge.
- No all-caps labels or eyebrow labels. Copy is plain and specific.

## 11. Build notes (2026-10-09)
- **Mock engine:** the mock imports the detection module from `../src` through the `@engine`
  alias, with no copied code.
  - **Stubs:** only `node:fs` and `node:url` are stubbed (`src/stubs/`). The engine gets
    `city.json` and rain as data.
  - **Worker:** it runs in a Web Worker (`src/mock/engine.worker.ts`).
  - **Size:** mock mode adds 711 KB raw (209 KB gzip) to the build. A real-mode build does
    not include it.
- **Mock-only routes** (not for P3): `GET /demo/state` (demo clock) and `POST /demo/advance`.
- **Mock demo choices** (`MOCK` in `src/mock/backend.ts`):
  - Seed 2026, starting 2026-07-08, as in the handoff samples.
  - 112 days of history, and the detector has run for 7 days when the demo opens.
  - **Injection:** an injected outbreak is placed 3 days back, so its signals are already
    arriving, and its alerts appear after 2.5 s. One injection at a time.
  - `createdAt` uses a 06:00 India-time daily run.
- **Cooldown:** live alerts from `runDetector` already include its 7-day cooldown, so a ward
  is not re-alerted daily.
- **Map:** OpenFreeMap, with OSM raster as fallback. MapLibre is excluded from Vite's
  pre-bundling, which broke its worker in dev. The ward list beside the map is the keyboard
  and screen-reader alternative to the canvas.
- **Charts:** a 3-day trailing average line with every daily count as a dot. "Normal for this
  weekday" is the median of the same weekday in the previous 8 weeks (at least 4), the same
  rule as `src/baseline.ts`.
- **Alert line:** `ALERT_LINE` in `src/lib/format.ts` is tested to equal
  `RUN_DETECTOR.bayesAlertProbability` (0.715).
- **Rain credit:** "Weather data by Open-Meteo.com" (CC BY 4.0) is linked next to every rain value.

### Not matching the contract (all listed in section 8; none guessed silently)
1. **`AlertRecord`, `AlertEvent`, `LiveSignalRow`, `WardRisk`, rain rows, `chanceCheck`:**
   contract v2 proposals, not in `src/contract/types.ts` (unchanged v1).
2. **`GET /demo/state`:** a mock-only route this app adds for the demo clock. It is not in
   contract-v2; real mode does not call it.
3. **City model:** `CityFile` (`city.json`) is read as a static file. Its shape mirrors the
   detection module, but contract-v2 lists it only as a handoff file, not as a typed contract.
