#!/usr/bin/env bash
# npm run stop:all — stops what dev:all started: frontend (5173), API (3001), and the ./.localdb database.
# A database on 5433 that dev:all did not start (another data folder) is left running.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.localdb/data"

for port in 5173 3001; do
  pids=$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$pids" ]; then
    kill $pids && echo "• Stopped the server on port $port"
  fi
done

if [ -f "$PGDATA/postmaster.pid" ]; then
  pg_ctl -D "$PGDATA" -m fast stop >/dev/null && echo "• Stopped the local database"
fi
echo "✓ Stopped"
