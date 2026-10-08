-- 004_demo_outbreaks.sql
-- Outbreaks planted with POST /demo/inject. The daily feed reads the active ones and keeps
-- generating them, so the next feed run does not overwrite the injected ward with baseline rows.
-- POST /demo/reset empties the table.
CREATE TABLE IF NOT EXISTS demo_outbreaks (
  id          SERIAL PRIMARY KEY,
  ward_id     INTEGER NOT NULL,
  cause       TEXT NOT NULL,
  start_date  DATE NOT NULL,
  seed        INTEGER NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
