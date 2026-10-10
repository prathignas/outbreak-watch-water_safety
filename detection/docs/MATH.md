# The maths, in plain English

Every worked example below is checked by a test (file named in brackets). All
data is synthetic or hand-built; nothing here is a result on real illness data.

## 1. Baseline: what is "normal"? (`tests/baseline.test.ts`)
For one ward, signal and day, take the same weekday in the last 8 weeks.
**Normal** = the median of those days (one old spike cannot drag it up).
**Spread** = 1.4826 × the median distance from that median (the MAD), but
never below √normal (count noise is about √mean) and never below 1.
**Score** = (today − normal) / spread = "how many spreads above normal".

*Example:* history 38, 41, 40, 95; today 120. Normal = 40.5. MAD spread =
1.4826 × 1.5 = 2.22, below the floor √40.5 = 6.36, so spread = 6.36.
Score = (120 − 40.5) / 6.36 = **12.49**. With fewer than 4 past days, no score.

## 2. Threshold (`tests/detectors.test.ts`)
Alert if any one health signal's score **today** is above 3.
*Example:* normal 4, spread 2, pharmacy today 12 → score (12 − 4)/2 = 4 > 3 →
alert, "pharmacy sales 3.0x normal for a Monday".

## 3. CUSUM: a small rise that keeps going (`tests/detectors.test.ts`)
Each day: sum = max(0, sum + score − 0.5). Alert when sum > 4, then reset to 0.
*Example:* four days at score 2 add 1.5 each: 1.5, 3.0, **4.5 > 4 → alert**,
reset, then 1.5. One mild day alone fades: 1.5, 1.0, 0.5, 0.

## 4. Fused Bayes with neighbours (`tests/detectors.test.ts`)
For each signal take its best score over the last 5 days (hospital is late).
Each score becomes a likelihood ratio LR = min(cap, e^(0.8 × (score − 1))); a
score of 1 or less gives LR = 1 ("no evidence"). The neighbours' average score
gives one more LR with the gain cut to a quarter. Then
odds = prior odds × all LRs, probability = odds / (1 + odds).

*Example* (test settings: prior 0.01, no cap): scores 5, 4, 0.5 → LRs 24.5,
11.0, 1. Odds = 0.0101 × 24.5 × 11.0 = 2.73 → **73%**. If the neighbours
average score 5: neighbour LR = e^(0.25 × 0.8 × 4) = 2.23, odds 6.08 → **86%**.
(Defaults are prior 0.002, cap 100, alert above 80%.)

## 5. The two-signal rule (`tests/detectors.test.ts`)
Bayes fires only if the probability is over the line **and** at least 2
different signals scored above 2. *Example:* complaints alone at score 5 give
20%; even with the line lowered to 10%, no alert: one feed can break or be gamed.

## 6. Cause classifier, a triage hint (`tests/classifier.test.ts`)
Features: share of alerting wards in the ward's pipeline zone, above the
city-wide share; food venue ward; whether only this ward is affected; days from
first rise to peak (sudden ≤ 2 days, gradual ≥ 6); neighbours above normal over
2 weeks; share of wards alerting or quietly elevated city-wide; real heavy rain
(≥ 15.6 mm) in the last 10 days. Each cause collects points from simple rules;
"unknown" always has 2 points, +1 if the top two causes are within 0.5. Points
become probabilities by softmax: p = e^points / Σ e^points (always sums to 1).

*Example (water):* all 12 wards of zone 6 alerting, rise in 1 day, 42.5 mm rain
3 days ago. Zone share above city = 1 − 12/200 = 0.94. Water = 2.5 × 0.94 + 1
(sudden) + 0.5 (rain) = 3.85; food 1, p2p 0.25, seasonal 0.7, unknown 2.
P(water) = e^3.85 / (e^3.85 + e^1 + e^0.25 + e^0.7 + e^2) = **78%**, zone 6 suspected.
*Example (food):* a lone food venue ward, one-day jump: 1.5 + 1.5 + 1 = 4 points.

What it does **not** show: on simulated outbreaks (FINAL, real city, Bayes, budget
0.25, realistic) it names food 84% of the time, water 21% at the first alert and 47%
three days later, and p2p only 10-13% (`npm run eval-classifier`; see docs/STATUS.md).

## 7. Backtest fairness rules (docs/STATUS.md; first set before any run, matching rule v2 since 2026-10-08)
- Settings are chosen on **tuning years 2022-23 only**, then locked and run
  **once** on test years 2024-25.
- Every method gets the **same false-alarm allowance**. Its one alert setting is picked from
  a fixed grid to come closest to the budget without going over. This is done separately for
  two budgets: 1 and 0.25 false-alarm episodes per ward per year.
- Alerts are grouped into **episodes** (nearby alerts within 7 days merge). An outbreak is
  **detected** at the first alert-day in or next to an affected ward, from its true start to
  9 days after its end. A **false alarm** is an episode with no such alert-day.
- **Chance check:** the same rule applied to "phantom" outbreaks where nothing happens. At
  budget 1 it "detects" 59-100% of them, so budget-1 numbers are not skill. At budget 0.25 it
  detects 18-36%, and real detection is well above that.
- The seasonal wave is reported separately, and a "fusion does not help here" flag is raised
  wherever a simpler method is as good as Bayes.
- No future data: every read goes through a view fixed to "today" that throws
  on any later date, and late-reported rows stay invisible until they arrive.
