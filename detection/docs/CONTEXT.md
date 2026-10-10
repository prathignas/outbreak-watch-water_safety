# CONTEXT

## What we are building
A community outbreak early-warning system for Bengaluru, for the WeMakeDevs +
AWS "Environmental Hacks" hackathon, Heat and Water track.

It watches daily signals for every ward: citizen complaints, pharmacy sales,
hospital admissions and rainfall. When a ward's numbers are much higher than
normal, it raises an alert, gives a likely cause (water, food,
person-to-person, seasonal) as a "triage hint", and emails the right officer.
The officer sees it on a map and acknowledges it.

Why it matters: in the Indore Bhagirathpura contamination (Dec 2025), the
signs were there but were noticed late.

## The end-to-end flow
1. Signals come in: citizen complaint form, a real rain feed, and pharmacy and
   hospital webhooks filled with synthetic data.
2. Each signal is saved as a daily count for one ward and one signal type,
   tagged real, scraped, user or synthetic.
3. The detector compares today with normal for that ward and weekday, and
   checks neighbouring wards.
4. If unusual, it creates an alert with a score and cause probabilities.
5. The officer gets an email and sees the alert on the map.
6. A backtest on 3 years of simulated outbreaks shows how early and how
   accurately each detection method works, including one case where the
   fancy method does not help.

## How it runs on AWS
- Lambda runs all the code (Node 20, TypeScript).
- API Gateway gives the frontend its URLs.
- EventBridge runs the detector every 5 minutes.
- RDS Postgres with PostGIS stores everything and answers map questions.
- S3 stores raw data and the website. CloudFront serves the website.
- SES sends the officer email. CloudWatch keeps logs.
- CDK deploys it all with one command.

## Honesty rules
- Pharmacy and hospital data are private, so they are synthetic and tagged.
- The Indore replay is labelled "reconstruction" and uses only sourced dates.
- Results come from the algorithm and are never tuned by hand to look good.
- Never invent sources or facts. Mark unknowns as TODO.

## Team (2 people)
- Person 1 (me): /detection. Simulator, baselines, detectors, backtest,
  cause classifier, and the function the Lambda calls.
- Person 2: infra, data ingestion, and the React frontend.
- We share one repo, one folder each, and a contract file (docs/contract.md)
  listing table columns and API routes. Nobody changes it without telling
  the other.

## Out of scope
Telegram, WebSockets, Cognito login, extra charts.

## How I want you to work with me
- My goal is to understand the whole system end to end and explain it to
  anyone. I am not trying to learn the code line by line.
- You write the code. Build one piece at a time, run the tests, show me the
  output, then stop and wait for me.
- After each piece, explain in plain simple English:
  1. What it is
  2. Why we need it
  3. Where it sits in the flow, and what goes in and comes out
  4. How we built it and the key choice we made
  5. A short answer I can give if a judge asks about it
  6. What my teammate needs from this piece
- For the detector, also show one worked example with real numbers, so I can
  explain the idea in words.
- Log every AI tool use in docs/ai-tools.md.
