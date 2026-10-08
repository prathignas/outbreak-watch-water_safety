-- 003_complaint_events.sql
-- Citizen complaints (POST /complaints) are counted once per event id, even across Lambda
-- restarts and retries. One row per accepted complaint. The daily "user" complaint row in
-- `signals` is the count of these rows for that ward and India day.
-- No complaint text is stored here (it is not needed for the count).
CREATE TABLE IF NOT EXISTS complaint_events (
  id           TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),  -- the form's complaintId, or a server-made UUID
  ward_id      INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  date         DATE NOT NULL,                                          -- India day it counts for
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_complaint_events_ward_date ON complaint_events (ward_id, date);
