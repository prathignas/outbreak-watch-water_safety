# Outbreak Watch

Early warning for contaminated drinking water in Bengaluru.

Built for **Environmental Hacks 2026** (WeMakeDevs x AWS), Heat and Water track.

## Planned folders

- `packages/contract`: the shared types that every part of the system agrees on.
- `detection`: outbreak detection on daily ward signals (baselines, detectors, cause triage).
- `pipeline`: data feeds that bring rain, pharmacy, hospital and complaint signals in.
- `backend`: the API, database and the daily detector run.
- `infra`: AWS infrastructure as code.
- `frontend`: the web app for health officers (map, alerts, proof).
