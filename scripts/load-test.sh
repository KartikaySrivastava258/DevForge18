#!/usr/bin/env bash
# Load test of the API: starts the production server (`npm start`, NODE_ENV=production) on a throwaway database,
# waits until it is ready, runs load/api.js with k6, then stops the server and removes the database.
#
#   npm run build && npm run test:load             # needs k6 on PATH (pinned version: see docs/load-testing.md)
#   K6=/path/to/k6 LOAD_PORT=18090 npm run test:load
#
# Extra arguments are passed to k6, e.g. `npm run test:load -- --summary-export build/load-summary.json`.
# The server trusts X-Forwarded-For (TRUST_PROXY=true) so that each virtual user can stand for a different
# student's address, as behind the Nginx proxy in production; see docs/load-testing.md for why.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${LOAD_PORT:-18090}
K6=${K6:-k6}
BASE="http://127.0.0.1:${PORT}"
command -v "$K6" > /dev/null || { echo "k6 not found (set K6=/path/to/k6); see docs/load-testing.md" >&2; exit 1; }
[ -f "$ROOT/build/content.json" ] && [ -f "$ROOT/build/web/index.html" ] || { echo "Run npm run build first" >&2; exit 1; }

WORK=$(mktemp -d)
cleanup() {
  status=$?
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2> /dev/null || true; wait "$SERVER_PID" 2> /dev/null || true; fi
  if [ "$status" -ne 0 ] && [ -f "$WORK/server.log" ]; then echo "--- server log (last 40 lines)"; tail -n 40 "$WORK/server.log"; fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

echo "== starting the server on $BASE (database in $WORK)"
(
  cd "$ROOT"
  NODE_ENV=production HOST=127.0.0.1 PORT="$PORT" PUBLIC_ORIGIN="$BASE" COOKIE_SECURE=false TRUST_PROXY=true \
    DATABASE_PATH="$WORK/load.db" exec node --disable-warning=ExperimentalWarning server/src/main.ts  # = npm start
) > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/ready" > /dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2> /dev/null || { echo "server exited" >&2; exit 1; }
  sleep 0.5
done
curl -fsS "$BASE/api/ready" > /dev/null

echo "== machine: $(nproc) CPU(s) ($(awk -F': ' '/model name/ {print $2; exit}' /proc/cpuinfo)), $(awk '/MemTotal/ {printf "%.1f GiB", $2/1048576}' /proc/meminfo), Node $(node --version), $("$K6" version | head -n 1)"
status=0
"$K6" run -e BASE_URL="$BASE" "$@" "$ROOT/load/api.js" || status=$?
echo "== server: peak memory $(awk '/VmHWM/ {printf "%.0f MiB", $2/1024}' "/proc/$SERVER_PID/status"), CPU time $(ps -o times= -p "$SERVER_PID" | tr -d ' ') s"
exit "$status"
