# STATUS-B (second Claude Code session: classifier, live feed, Indore, maths)

Files owned by this session: `src/classifier.ts`, `src/params.classifier.ts`,
`src/live.ts`, `src/params.live.ts`, `scenarios/`, `docs/MATH.md`, this file,
`tests/classifier.test.ts`, `tests/live.test.ts`, `scripts/eval-classifier.ts`.
Nothing in types.ts, params.ts, package.json, city.ts, backtest, data/ or results/ was edited.

## Piece status (2026-10-08)
| Piece | State |
|---|---|
| 6 cause classifier (`classifyAlert`, `classifyAlerts`) | done, 11 tests pass; evaluated: **weak** except for food (below) |
| 8a live feed (`generateLiveDay`, `generateHistory`, `rowsArrivingOn`, `describeInjection`) | done, 11 tests pass |
| 9 `scenarios/indore.json` + `docs/MATH.md` | done; 2 Indore sources only partly verified (TODO in file) |

Full suite: **11 files, 99 tests, all pass**; `tsc --noEmit` clean.

## Needed scripts (please add to package.json; this session may not edit it)
```json
"eval-classifier": "tsx scripts/eval-classifier.ts"
```
Flags: `--difficulty=easy|realistic|hard`, `--method=threshold|cusum|bayes`. Full run ~2.5 min.

## Classifier evaluation (GridCity, seed 42, default detector settings)
Settings were written before the evaluation ran. One change was made before
any evaluation, from a hand-built test: `unknownBase` 1.5 → 2 (at 1.5, a lone
ward with no rise tied with food). Nothing was changed after seeing results.

First alert per planted outbreak, top cause correct / outbreaks the detector found
(water 8, food 8, p2p 6, seasonal 2 per split; small numbers, read with care):

| difficulty | detector | split | water | food | p2p | seasonal | overall |
|---|---|---|---|---|---|---|---|
| realistic | bayes | tuning | 0/8 | **8/8** | 1/5 | 1/2 | 10/23 = 43% |
| realistic | bayes | test | 0/8 | **5/6** | 2/5 | 1/2 | 8/21 = 38% |
| realistic | threshold | test | 0/8 | 2/8 | 0/6 | 2/2 | 4/24 = 17% |
| realistic | cusum | test | 0/8 | 1/8 | 0/6 | 2/2 | 3/24 = 13% |
| easy | bayes | test | 3/8 | 7/8 | 0/5 | 1/2 | 11/23 = 48% |
| hard | bayes | test | 0/8 | 2/3 | 0/3 | 1/2 | 3/16 = 19% |

Realistic, Bayes, test years, full confusion (first alert per outbreak):
```
true \ predicted   water  food  p2p  seasonal  unknown  missed
water                  0     3    0         2        3       0
food                   0     5    0         1        0       2
p2p                    0     0    2         0        3       1
seasonal               0     1    0         1        0       0
```
Every matched alert (not just the first), realistic/Bayes/test: water 373/596 = 63%,
food 25/40 = 63%, p2p 9/28 = 32%, seasonal 895/905 = 99%. The seasonal 99% is
inflated: any alert during the 60-day wave that matches no local outbreak is
counted as "seasonal", including alerts that are really noise.

### What this means, honestly
- **Food works** (with Bayes): a lone food venue ward with a one-day jump is distinctive.
- **Water fails on the first alert.** When the origin ward first alerts, the rest
  of the zone has not crossed the line yet, so "share of the zone alerting" is
  near zero; the alert looks like a lone sudden ward (→ food/unknown). Later
  alerts in the same outbreak are named water 58-82% of the time with Bayes.
- **p2p is almost never identified.** Its neighbours only reach ~1.3x normal and
  the classifier usually sees the rise before it has looked "gradual".
- **Threshold and CUSUM make it worse**: their many false alarms inflate the
  city-wide alerting share, so local outbreaks get called "seasonal".
- Water outbreaks whose first alert named the right zone: 0-3 of 8.
- Circularity: the features mirror how the simulator plants outbreaks, so even
  these numbers are optimistic for real life.

### Two flaws seen in the live demo (NOT fixed; needs your decision)
A clean injected water outbreak (`generateLiveDay`, July 2026) was detected on
day 2, suspected zone right from day 3, but the top cause was seasonal/unknown:
1. **Month-step season**: `SEASONAL_EFFECT` jumps from June 1.3 to July 1.4, so
   ~35% of all wards look "quietly elevated" vs their 8-week baseline, which
   feeds the seasonal rule. (Same effect at every month boundary in the backtest.)
2. **Onset drift**: "days from first rise to peak so far" keeps growing while
   the outbreak plateaus (a noisy plateau day sets a new peak), so a 3-day water
   ramp reads as "gradual" after a week.
Possible fixes (would need re-evaluation on tuning years, then one test run):
measure zone share from rows (wards elevated) as well as alerts; measure onset as
days to first reach e.g. 80% of the peak; compare city elevation with a
month-boundary-aware baseline. Not done, because changing the classifier after
seeing results would spoil the test-year numbers above.

## Live feed (Piece 8a)
- `generateLiveDay(date, seed, options?)` → 600 rows on GridCity (200 wards x
  complaint/pharmacy/hospital), `sourceTag: "synthetic"`, plus `reportedOn`
  (date + realistic reporting lag). No rain rows.
- Deterministic: each (seed, date, ward, signal) has its own hashed generator.
- Options: `injectOutbreak`, `wardId`, **`startDate`** (added: pass the same
  start on later days to continue the outbreak; defaults to `date`), `city`, `difficulty`.
- `generateHistory(endDate, days, seed)`: rows for the `days` days before endDate.
  `LIVE.recommendedHistoryDays` = 70 (8 weeks baseline + 14 classifier days).
- `rowsArrivingOn(date, seed, options)`: what the webhooks deliver that day,
  late rows included. Likely what P2's daily Lambda wants.
- Not modelled in live data: harmless rain/festival surges (rain is P2's real
  feed; FESTIVALS in params only covers 2022-2025).
- Test: injected water outbreak alerted by Bayes within the derived bound of
  6 days (pharmacy delay 2 + lag 1 + ramp 3); no zone alert in the week before.

## Notes for Person 2 / contract
- `classifyAlerts(alerts, context)` changes only `causeProbs` and
  `suspectedZoneId`, as asked. The classifier's own evidence strings come from
  `classifyAlert(alert, context).evidence`; if the officer should see them, the
  contract needs a field (e.g. `triageEvidence: string[]`) or agreement to append
  them to `evidence`. Proposal only.
- Context needs: `city`, recent rows (70 days), real rain `{date, mm}[]`, and the
  last ~14 days of alerts.
- `LiveSignalRow` = `SignalRow` + `reportedOn`. Store `reportedOn` if late data matters.

## Indore (Piece 9)
`scenarios/indore.json` has `"claim": "case study only; no detection result is computed"`.
Verified by fetching: FPJ (21 Dec first death), Scroll (24 Dec, but Scroll does not
cite a court record; the 06-01-2026 HC order was checked and has no such date),
Wikipedia (27 Dec), DT Next and WaterToday (4 Jan: 9,416 screened, 20 new, 142
hospitalised). **Biotecnika returned 403: its 27 Dec claim is unverified (TODO).**
WaterToday credits The Hindu only for a photo (TODO: find The Hindu's article).
