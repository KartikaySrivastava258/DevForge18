#!/usr/bin/env bash
# Smoke test of the production stack in deploy/: builds the image, starts Docker Compose (app + Nginx), waits
# until the app is healthy and checks, through Nginx only, what a real deployment depends on.
#
#   bash scripts/compose-smoke.sh            # build, start, test, then remove everything it created
#   KEEP=1 bash scripts/compose-smoke.sh     # leave the stack running afterwards (remove it with the printed command)
#
# Environment: DEVFORGE_HTTP_PORT (host port for Nginx, default 8080), COMPOSE_PROJECT_NAME (default devforge-smoke).
# Cleanup removes only what this project created: its containers, its volume and its locally built image.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${DEVFORGE_HTTP_PORT:-8080}
ORIGIN="http://localhost:${PORT}"
BASE="http://127.0.0.1:${PORT}"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-devforge-smoke}
export DEVFORGE_HTTP_PORT=$PORT PUBLIC_ORIGIN=$ORIGIN
compose() { docker compose -f "$ROOT/deploy/docker-compose.yml" "$@"; }

TMP=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- compose ps"; compose ps -a || true
    echo "--- logs (last 80 lines per service)"; compose logs --no-color --tail 80 || true
  fi
  if [ "${KEEP:-0}" = 1 ]; then
    echo "Stack left running. Remove it with: COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME docker compose -f deploy/docker-compose.yml down -v --rmi local"
  else
    compose down -v --rmi local --remove-orphans > /dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }
check() { # check <description> <command...>
  local what=$1; shift
  if "$@"; then pass "$what"; else fail "$what"; fi
}
# fetch <name> <curl args...>: saves headers to $TMP/<name>.h and body to $TMP/<name>.b, prints the status code.
fetch() {
  local name=$1; shift
  curl -sS -o "$TMP/$name.b" -D "$TMP/$name.h" -w '%{http_code}' "$@"
}
header() { # header <name> <header>: the header's value (last occurrence), without the trailing CR
  grep -i "^$2:" "$TMP/$1.h" | tail -n 1 | cut -d: -f2- | sed 's/^ *//; s/\r$//'
}

echo "== build and start ($COMPOSE_PROJECT_NAME, Nginx on host port $PORT)"
compose build app
compose up -d --wait --wait-timeout 120

echo "== container settings"
app_id=$(compose ps -q app)
nginx_id=$(compose ps -q nginx)
check "app container has a read-only root filesystem" \
  test "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$app_id")" = true
check "app container runs with no-new-privileges" \
  grep -q 'no-new-privileges:true' <<< "$(docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$app_id")"
check "app container runs as a non-root user" \
  test "$(docker inspect -f '{{.Config.User}}' "$app_id")" = node
check "Nginx container has a read-only root filesystem" \
  test "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$nginx_id")" = true
check "Nginx container runs with no-new-privileges" \
  grep -q 'no-new-privileges:true' <<< "$(docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$nginx_id")"
check "app port is not published to the host" \
  test "$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$app_id")" = "{}"
check "app has no host port mapping at all" \
  test -z "$(docker port "$app_id")"
check "only Nginx's port 80 is published, on host port $PORT" \
  grep -q ":${PORT}$" <<< "$(docker port "$nginx_id" 80/tcp)"
check "Docker reports the app healthy" \
  test "$(docker inspect -f '{{.State.Health.Status}}' "$app_id")" = healthy

echo "== HTTP through Nginx ($BASE)"
code=$(fetch health "$BASE/api/health")
check "/api/health answers 200" test "$code" = 200
check "/api/health body is {\"status\":\"ok\"}" grep -q '"status":"ok"' "$TMP/health.b"
check "API responses are not cached (Cache-Control: no-store)" test "$(header health cache-control)" = no-store

code=$(fetch ready "$BASE/api/ready")
check "/api/ready answers 200 with 18 tracks (database and content loaded)" \
  test "$code" = 200 -a "$(jq -r .tracks "$TMP/ready.b")" = 18

code=$(fetch tracks "$BASE/api/tracks")
check "/api/tracks answers 200" test "$code" = 200
check "/api/tracks lists 18 tracks" test "$(jq '.tracks | length' "$TMP/tracks.b")" = 18

CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
code=$(fetch spa "$BASE/tracks/docker")
check "SPA route /tracks/docker answers 200" test "$code" = 200
check "SPA route is HTML" grep -qi '^content-type: text/html' "$TMP/spa.h"
check "SPA route body is the app shell" grep -q '<div id="root">' "$TMP/spa.b"
check "SPA route carries the strict CSP unchanged" test "$(header spa content-security-policy)" = "$CSP"
check "exactly one CSP header (Nginx adds none of its own)" test "$(grep -ci '^content-security-policy:' "$TMP/spa.h")" = 1
check "X-Content-Type-Options: nosniff" test "$(header spa x-content-type-options)" = nosniff
check "X-Frame-Options: DENY" test "$(header spa x-frame-options)" = DENY
check "Referrer-Policy: strict-origin-when-cross-origin" test "$(header spa referrer-policy)" = strict-origin-when-cross-origin
check "Cross-Origin-Opener-Policy: same-origin" test "$(header spa cross-origin-opener-policy)" = same-origin
check "Permissions-Policy set" grep -q 'camera=()' <<< "$(header spa permissions-policy)"
check "Server header does not reveal the Nginx version" test "$(header spa server)" = nginx
check "HTML shell is revalidated (Cache-Control: no-cache)" test "$(header spa cache-control)" = no-cache

asset=$(grep -o 'src="/assets/[^"]*\.js"' "$TMP/spa.b" | head -n 1 | sed 's/^src="//; s/"$//')
check "app shell references a hashed script under /assets/" test -n "$asset"
code=$(fetch asset -H 'Accept-Encoding: gzip' "$BASE${asset:-/assets/missing.js}")
check "hashed asset $asset answers 200" test "$code" = 200
check "hashed asset is cached for a year and immutable" \
  test "$(header asset cache-control)" = "public, max-age=31536000, immutable"
check "hashed asset is served as JavaScript" grep -q 'javascript' <<< "$(header asset content-type)"
check "Nginx compresses the script (Content-Encoding: gzip)" test "$(header asset content-encoding)" = gzip

code=$(fetch metrics "$BASE/metrics")
check "/metrics is not reachable through Nginx (404)" test "$code" = 404
code=$(fetch traversal --path-as-is "$BASE/../../etc/passwd")
check "path traversal is refused" test "$code" != 200 -o "$(grep -c 'root:' "$TMP/traversal.b")" = 0

echo "== CSRF protection through Nginx"
body='{"email":"nobody@example.com","password":"irrelevant-password"}'
code=$(fetch csrf1 -X POST -H 'Content-Type: application/json' --data "$body" "$BASE/api/auth/login")
check "POST without the CSRF header is rejected with 403" test "$code" = 403
check "rejection names the CSRF check" test "$(jq -r .error.code "$TMP/csrf1.b" 2> /dev/null)" = csrf_failed
code=$(fetch csrf2 -X POST -H 'Content-Type: application/json' -H 'X-DevForge-CSRF: 1' \
  -H 'Origin: https://evil.example' --data "$body" "$BASE/api/auth/login")
check "POST with the header but a foreign Origin is rejected with 403" test "$code" = 403
code=$(fetch csrf3 -X POST -H 'Content-Type: application/json' -H 'X-DevForge-CSRF: 1' \
  -H 'Sec-Fetch-Site: cross-site' --data "$body" "$BASE/api/auth/login")
check "POST marked Sec-Fetch-Site: cross-site is rejected with 403" test "$code" = 403

echo "== Sign-up and session through Nginx (writes to the read-only container's /data volume)"
email="smoke-$(date +%s)@example.com"
jar="$TMP/cookies"
code=$(fetch register -c "$jar" -X POST -H 'Content-Type: application/json' -H 'X-DevForge-CSRF: 1' -H "Origin: $ORIGIN" \
  --data "{\"email\":\"$email\",\"displayName\":\"Smoke Test\",\"password\":\"correct horse battery staple 42\"}" \
  "$BASE/api/auth/register")
check "registration with the CSRF header and same Origin answers 201" test "$code" = 201
check "session cookie is HttpOnly and SameSite=Lax" \
  grep -qi '^set-cookie: df_session=.*HttpOnly.*SameSite=Lax' "$TMP/register.h"
code=$(fetch me -b "$jar" "$BASE/api/auth/me")
check "the session cookie signs the user in (/api/auth/me)" test "$code" = 200 -a "$(jq -r .user.email "$TMP/me.b")" = "$email"

echo "== Operator commands documented in docs/deployment.md, run inside the read-only app container"
admin="admin-$(date +%s)@example.com"
admin_pw="smoke-admin-password-$RANDOM-$RANDOM"
check "user:create makes an admin (password from DEVFORGE_NEW_PASSWORD)" \
  compose exec -T -e DEVFORGE_NEW_PASSWORD="$admin_pw" app node --disable-warning=ExperimentalWarning \
  scripts/create-user.ts --email "$admin" --name "Smoke Admin" --role admin
code=$(fetch login -c "$TMP/admin-jar" -X POST -H 'Content-Type: application/json' -H 'X-DevForge-CSRF: 1' -H "Origin: $ORIGIN" \
  --data "{\"email\":\"$admin\",\"password\":\"$admin_pw\"}" "$BASE/api/auth/login")
check "the admin signs in through Nginx" test "$code" = 200
code=$(fetch admin-users -b "$TMP/admin-jar" "$BASE/api/admin/users")
check "the admin can list users (2 so far)" test "$code" = 200 -a "$(jq -r .total "$TMP/admin-users.b")" = 2
code=$(fetch student-admin -b "$jar" "$BASE/api/admin/users")
check "a student is refused the admin API (403)" test "$code" = 403
check "db:backup writes an integrity-checked copy into the data volume" \
  compose exec -T app node --disable-warning=ExperimentalWarning scripts/db-backup.ts /data/backups/smoke.db

echo "== Restart keeps data (named volume)"
compose restart app > /dev/null
compose up -d --wait --wait-timeout 120 > /dev/null
code=$(fetch me2 -b "$jar" "$BASE/api/auth/me")
check "the session survives an app restart" test "$code" = 200 -a "$(jq -r .user.email "$TMP/me2.b" 2> /dev/null)" = "$email"

echo "== Edge rate limit (Nginx limit_req: 100 r/s per address, burst 200)"
seq 1500 | xargs -P 50 -I{} curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health" > "$TMP/burst.txt"
limited=$(grep -c '^429$' "$TMP/burst.txt" || true)
check "a burst of 1,500 requests is partly refused with 429 ($limited refused)" test "$limited" -gt 0
check "no 5xx during the burst" test "$(grep -c '^5' "$TMP/burst.txt" || true)" = 0

echo
if [ "$failures" -ne 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All compose smoke checks passed"
