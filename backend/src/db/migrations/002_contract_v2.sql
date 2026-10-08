-- 002_contract_v2.sql
-- Everything contract v2 needs (detection/handoff/contract-v2.md). Migration 001 is unchanged.

-- 1. signals: the day each row reached our system (contract-v2 section 1).
--    A later arrival for the same (ward, signal, date, source) UPDATES count and reported_on.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS reported_on DATE;
UPDATE signals SET reported_on = date WHERE reported_on IS NULL;
ALTER TABLE signals ALTER COLUMN reported_on SET NOT NULL;
ALTER TABLE signals ADD CONSTRAINT chk_signals_reported_on CHECK (reported_on >= date);
-- The detector loads: date in the last 70 days AND reported_on <= today.
CREATE INDEX IF NOT EXISTS idx_signals_date_reported ON signals (date, reported_on);

-- 2. wards: ward ids are BBMP ward numbers (>= 0), each with its BWSSB water zone (or null).
ALTER TABLE wards ADD CONSTRAINT chk_wards_id CHECK (id >= 0);
ALTER TABLE pipeline_zones ADD CONSTRAINT chk_pipeline_zones_id CHECK (id >= 0);
ALTER TABLE wards ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES pipeline_zones(id) ON DELETE SET NULL;

-- 3. alerts: keep P1's score exactly (NUMERIC(5,2) rounded 0.7349 to 0.73),
--    and store the classifier's reasons (AlertRecord.causeEvidence, contract-v2 section 4b).
ALTER TABLE alerts ALTER COLUMN score TYPE DOUBLE PRECISION;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS cause_evidence TEXT[] NOT NULL DEFAULT '{}';

-- 4. alert_events: only the events the backend writes.
ALTER TABLE alert_events ADD CONSTRAINT chk_alert_events_event
  CHECK (event IN ('created', 'emailed', 'email_failed', 'acknowledged', 'resolved', 'note_added'));
CREATE INDEX IF NOT EXISTS idx_alert_events_alert_at ON alert_events (alert_id, at);

-- 5. detector_state (contract-v2 section 3): runDetector's DetectorState, saved after each day
--    in the same transaction as that day's alerts. One row per method and day; the last
--    30 days are kept so a demo injection can re-run recent days from the state before them.
CREATE TABLE IF NOT EXISTS detector_state (
  method      TEXT NOT NULL CHECK (method IN ('threshold', 'cusum', 'bayes')),
  as_of_date  DATE NOT NULL,                       -- = state.lastRunDate
  state       JSONB NOT NULL,                      -- DetectorState, except the CUSUM cells (below)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (method, as_of_date)
);

-- CUSUM running sums: one row per ward and signal (contract-v2 section 3, "cusum_state").
-- Empty while the live method is Bayes (params.live.ts).
CREATE TABLE IF NOT EXISTS detector_state_cusum (
  method       TEXT NOT NULL,
  as_of_date   DATE NOT NULL,
  ward_id      INTEGER NOT NULL,
  signal_type  TEXT NOT NULL CHECK (signal_type IN ('complaint', 'pharmacy', 'hospital')),
  sum          DOUBLE PRECISION NOT NULL,
  next_date    DATE NOT NULL,
  PRIMARY KEY (method, as_of_date, ward_id, signal_type),
  FOREIGN KEY (method, as_of_date) REFERENCES detector_state (method, as_of_date) ON DELETE CASCADE
);
