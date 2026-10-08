-- 001_initial_schema.sql
-- PostGIS & UUID extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. wards table
CREATE TABLE IF NOT EXISTS wards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  geom GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX IF NOT EXISTS idx_wards_geom ON wards USING GIST (geom);

-- 2. pipeline_zones table (BWSSB water supply zones)
CREATE TABLE IF NOT EXISTS pipeline_zones (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  geom GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_zones_geom ON pipeline_zones USING GIST (geom);

-- 3. signals table
CREATE TABLE IF NOT EXISTS signals (
  ward_id INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('complaint', 'pharmacy', 'hospital', 'rain')),
  date DATE NOT NULL,
  count NUMERIC NOT NULL CHECK (count >= 0),
  source_tag TEXT NOT NULL CHECK (source_tag IN ('real', 'scraped', 'user', 'synthetic')),
  CONSTRAINT uq_signals UNIQUE (ward_id, signal_type, date, source_tag)
);

CREATE INDEX IF NOT EXISTS idx_signals_ward_id ON signals (ward_id);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals (date);
CREATE INDEX IF NOT EXISTS idx_signals_ward_date ON signals (ward_id, date);

-- 4. alerts table
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id INTEGER NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  score NUMERIC(5, 2) NOT NULL CHECK (score >= 0 AND score <= 1),
  method TEXT NOT NULL CHECK (method IN ('threshold', 'cusum', 'bayes')),
  contributing_signals TEXT[] NOT NULL,
  cause_probs JSONB NOT NULL,
  suspected_zone_id INTEGER REFERENCES pipeline_zones(id) ON DELETE SET NULL,
  evidence TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerts UNIQUE (ward_id, date, method)
);

CREATE INDEX IF NOT EXISTS idx_alerts_ward_id ON alerts (ward_id);
CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts (date);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_date_status ON alerts (date, status);

-- 5. alert_events table
CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert_id ON alert_events (alert_id);
