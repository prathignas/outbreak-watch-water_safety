#!/usr/bin/env bash
# npm run dev:all — the whole app locally, real mode:
#   PostGIS on 5433 (./.localdb) -> db:setup if needed -> API on 3001 -> rain + feed once -> frontend on 5173.
# Everything keeps running in the background; logs in .localdb/logs. Stop with: npm run stop:all
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_PORT=5433
API_PORT=3001
WEB_PORT=5173
LOCALDB="$ROOT/.localdb"
PGDATA="$LOCALDB/data"
LOGS="$LOCALDB/logs"

# One source for local settings: the root .env (DEMO_AUTH_TOKEN is the key to type on the gate page).
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

export DATABASE_URL="${DATABASE_URL:-postgres://outbreak@localhost:$DB_PORT/outbreak_watch}"
export DEMO_AUTH_TOKEN="${DEMO_AUTH_TOKEN:-watch-demo}"
export WEBHOOK_SECRET="${WEBHOOK_SECRET:-local-webhook-secret}"
export API_URL="http://localhost:$API_PORT"
export SES_MOCK=true
export PORT=$API_PORT

mkdir -p "$LOGS"

port_busy() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

wait_for() { # url, name
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "✗ $2 did not start; see $LOGS" >&2
  exit 1
}

# 1. Database
if port_busy $DB_PORT; then
  echo "• Port $DB_PORT already has a database running; using it."
else
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "• Creating the local database in .localdb"
    initdb -D "$PGDATA" -U outbreak --auth=trust -E UTF8 >"$LOGS/initdb.log"
  fi
  echo "• Starting PostGIS on port $DB_PORT"
  pg_ctl -D "$PGDATA" -o "-p $DB_PORT" -l "$LOGS/postgres.log" -w start >/dev/null
fi
if ! psql -h localhost -p $DB_PORT -U outbreak -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'outbreak_watch'" | grep -q 1; then
  createdb -h localhost -p $DB_PORT -U outbreak outbreak_watch
fi

# 2. Tables (only the first time)
if [ "$(psql "$DATABASE_URL" -tAc "SELECT to_regclass('public.wards') IS NOT NULL")" = "t" ]; then
  echo "• Tables exist; skipping db:setup (applying any new migrations)"
  npm run migrate --workspace=@outbreak/backend >"$LOGS/migrate.log" 2>&1 || { echo "✗ migrations failed; see $LOGS/migrate.log" >&2; exit 1; }
else
  echo "• Running db:setup"
  npm run db:setup >"$LOGS/db-setup.log" 2>&1 || { echo "✗ db:setup failed; see $LOGS/db-setup.log" >&2; exit 1; }
fi

# 3. API
if port_busy $API_PORT; then
  echo "✗ Port $API_PORT is in use. Run: npm run stop:all" >&2
  exit 1
fi
echo "• Starting the API on $API_URL"
nohup npm run api:local --workspace=@outbreak/backend >"$LOGS/api.log" 2>&1 &
wait_for "$API_URL/wards" "The API"

# 4. Rain and feed, once. Rain needs internet (Open-Meteo); without it there is simply no rain.
echo "• Rain job"
npm run rain:once --workspace=@outbreak/backend >"$LOGS/rain.log" 2>&1 || echo "  ! rain job failed (see $LOGS/rain.log); continuing without rain"
echo "• Synthetic feed"
npm run feed:once --workspace=@outbreak/backend >"$LOGS/feed.log" 2>&1 || { echo "✗ feed failed; see $LOGS/feed.log" >&2; exit 1; }

# 5. Frontend
if port_busy $WEB_PORT; then
  echo "✗ Port $WEB_PORT is in use. Run: npm run stop:all" >&2
  exit 1
fi
echo "• Starting the frontend"
VITE_API_MODE=real VITE_API_BASE_URL="$API_URL" VITE_DEMO_KEY="$DEMO_AUTH_TOKEN" \
  nohup npm run dev --prefix frontend -- --port $WEB_PORT --strictPort >"$LOGS/frontend.log" 2>&1 &
wait_for "http://localhost:$WEB_PORT" "The frontend"

echo ""
echo "✓ Open http://localhost:$WEB_PORT  (demo key: $DEMO_AUTH_TOKEN)"
echo "  Logs: .localdb/logs   Stop: npm run stop:all"
