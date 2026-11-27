#!/usr/bin/env bash
# Acceptance check for "Static frontend + API gateway-style routing".
# Usage: bash check.sh path/to/your/project   (the folder with nginx.conf, site/ and, if you use it, snippets/)
# Needs Docker and curl. Starts two small echo services (users, orders) on a private Docker network, tests your
# configuration with `nginx -t`, runs it in Nginx 1.24 (the version the Nginx lessons use) with site/ as the
# document root, and sends real requests: single-page-app fallback, caching and compression headers, API routing
# with the /api/v1 prefix removed, JSON 404s, request-size limits, rate limiting and security headers on every
# response. Removes everything it started.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
# Nginx 1.24.0 on Alpine, the version the Nginx lessons were recorded with (tag pushed 2024-04-18).
nginx_image="nginx:1.24.0-alpine@sha256:77e5d4a6ad906c5d3793764085706577fa705b1dc6f244ea0241c4b5e2155385"
# Node.js 22.23.5 on Alpine, for the echo services (tag pushed 2026-11-12).
node_image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
id="devforge-check-ngx-spa-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/nginx.conf" ] || { fail "$dir/nginx.conf is missing"; finish; }
[ -f "$dir/site/index.html" ] || { fail "$dir/site/index.html is missing (keep the built frontend in site/)"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }
asset_js="$(cd "$dir/site" && ls assets/app.*.js 2> /dev/null | head -n 1)"
asset_css="$(cd "$dir/site" && ls assets/app.*.css 2> /dev/null | head -n 1)"
[ -n "$asset_js" ] && [ -n "$asset_css" ] || { fail "site/assets/ must contain the built app.<hash>.js and app.<hash>.css"; finish; }

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
  docker ps -aq --filter "label=devforge-check=$id" | xargs -r docker rm -f -v > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
}
trap cleanup EXIT

# The echo service: answers every request on port 8000 with what it received, one "name=value" per line.
echo_js=$(cat <<'EOF'
const http = require("node:http");
const name = process.env.NAME;
http.createServer((req, res) => {
  let bytes = 0;
  req.on("data", (c) => { bytes += c.length; });
  req.on("end", () => {
    const h = req.headers;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end([`service=${name}`, `method=${req.method}`, `uri=${req.url}`, `host=${h.host || ""}`,
      `x-forwarded-for=${h["x-forwarded-for"] || ""}`, `x-forwarded-proto=${h["x-forwarded-proto"] || ""}`,
      `body-bytes=${bytes}`].join("\n") + "\n");
  });
}).listen(8000, () => console.log("ready"));
process.on("SIGTERM", () => process.exit(0));
EOF
)

docker network create --label "devforge-check=$id" "$id" > /dev/null || { fail "could not create a Docker network"; finish; }
for svc in users orders; do
  docker run -d --name "$id-$svc" --label "devforge-check=$id" --network "$id" --network-alias "$svc" -e NAME="$svc" \
    "$node_image" node -e "$echo_js" > /dev/null || { fail "could not start the $svc service in Docker"; finish; }
done
for svc in users orders; do
  for _ in $(seq 1 50); do docker logs "$id-$svc" 2>&1 | grep_quiet ready && break; sleep 0.2; done
done

# copy_in CONTAINER — the configuration, the site and the optional snippets, where compose.yaml mounts them.
copy_in() {
  docker cp "$dir/nginx.conf" "$1:/etc/nginx/nginx.conf" > /dev/null
  docker cp "$dir/site/." "$1:/usr/share/nginx/html/" > /dev/null
  if [ -d "$dir/snippets" ]; then docker cp "$dir/snippets/." "$1:/etc/nginx/snippets/" > /dev/null; fi
}
docker create --name "$id-test" --label "devforge-check=$id" --network "$id" "$nginx_image" nginx -t > /dev/null
copy_in "$id-test"
if out="$(docker start -a "$id-test" 2>&1)"; then pass "nginx -t accepts nginx.conf"; else fail "nginx -t rejects nginx.conf: $(echo "$out" | grep -m 1 emerg)"; finish; fi

docker create --name "$id-nginx" --label "devforge-check=$id" --network "$id" -p 127.0.0.1::80 "$nginx_image" > /dev/null
copy_in "$id-nginx"
docker start "$id-nginx" > /dev/null
addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"
for _ in $(seq 1 50); do [ -n "$addr" ] && curl -s -o /dev/null -m 2 "http://$addr/" && break; sleep 0.2; addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"; done
if [ -z "$addr" ] || ! curl -s -o /dev/null -m 2 "http://$addr/"; then
  fail "Nginx did not answer on port 80 inside its container: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"
  finish
fi

# get PATH [curl options…] — sets $code, $body (file $tmp/body) and $headers (lower-case names, no CR).
get() {
  local path="$1"; shift
  code="$(curl -s -m 20 -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$@" "http://$addr$path")"
  body="$(tr -d '\0' < "$tmp/body")"
  headers="$(tr -d '\r' < "$tmp/headers" | sed 's/^\([^:]*\):/\L\1:/')"
}
header() { echo "$headers" | sed -n "s/^$1: //p" | tail -n 1; }
field() { echo "$body" | sed -n "s/^$1=//p" | head -n 1; }
index_marker="$(grep -o '<title>[^<]*</title>' "$dir/site/index.html" | head -n 1)"
is_index() { [ -n "$index_marker" ] && grep -qF "$index_marker" "$tmp/body"; }
# Security headers are collected from every response below and judged at the end.
sec_missing=""
sec() { # LABEL — after get
  local nosniff frame
  nosniff="$(header x-content-type-options)"; frame="$(header x-frame-options)"
  [ "$nosniff" = nosniff ] && [ "$frame" = DENY ] || sec_missing="$sec_missing $1 ($code)"
}

# --- The single-page app ---
get /
if [ "$code" = 200 ] && is_index; then pass "/ serves index.html"; else fail "/ should serve site/index.html (got HTTP $code)"; fi
cc="$(header cache-control)"; sec "/"
if [[ "$cc" =~ no-cache|no-store|max-age=0 ]]; then pass "index.html is revalidated on every visit (Cache-Control: $cc)"
else fail "index.html must not be cached without revalidation — send Cache-Control: no-cache (got \"$cc\")"; fi
get /orders/42
if [ "$code" = 200 ] && is_index && [[ "$(header content-type)" == text/html* ]]; then pass "a frontend route with no file (/orders/42) gets index.html, so deep links and reloads work"
else fail "/orders/42 should get index.html with 200 (single-page-app fallback); got HTTP $code, $(header content-type)"; fi
cc="$(header cache-control)"; sec "/orders/42"
if [[ "$cc" =~ no-cache|no-store|max-age=0 ]]; then pass "the fallback index.html is revalidated too"; else fail "/orders/42 (index.html) should also send Cache-Control: no-cache (got \"$cc\")"; fi

get "/$asset_js"
cc="$(header cache-control)"; sec "/$asset_js"
max_age="$(echo "$cc" | sed -n 's/.*max-age=\([0-9]*\).*/\1/p')"
if [ "$code" = 200 ] && [ "${max_age:-0}" -ge 2592000 ] && [[ "$cc" == *immutable* ]]; then pass "fingerprinted assets are cached for a long time and marked immutable (Cache-Control: $cc)"
else fail "/$asset_js should be cached for at least 30 days and be immutable (got HTTP $code, Cache-Control \"$cc\")"; fi
if [[ "$(header content-type)" == application/javascript* || "$(header content-type)" == text/javascript* ]]; then pass "JavaScript is served with a JavaScript content type"
else fail "/$asset_js should be served as JavaScript (got \"$(header content-type)\")"; fi
get /assets/app.0000000.js
sec "/assets/app.0000000.js"
if [ "$code" = 404 ] && ! is_index; then pass "a missing asset gets 404, not index.html"
else fail "/assets/app.0000000.js does not exist and should get 404 — not index.html, which a browser would try to run as JavaScript (got HTTP $code$(is_index && echo ', index.html'))"; fi

gz_ok=1
for f in "$asset_js" "$asset_css"; do
  get "/$f" -H "Accept-Encoding: gzip"
  [ "$(header content-encoding)" = gzip ] && [[ "$(header vary)" == *Accept-Encoding* ]] || { gz_ok=0; gz_detail="/$f: Content-Encoding \"$(header content-encoding)\", Vary \"$(header vary)\""; }
done
if [ "$gz_ok" = 1 ]; then pass "JavaScript and CSS are gzip-compressed for clients that accept it, with Vary: Accept-Encoding"
else fail "JavaScript and CSS should be gzip-compressed with Vary: Accept-Encoding ($gz_detail)"; fi

# --- The API gateway ---
routed() { # DESCRIPTION PATH SERVICE URI
  get "$2"; sec "$2"
  if [ "$code" = 200 ] && [ "$(field service)" = "$3" ] && [ "$(field uri)" = "$4" ]; then pass "$1"
  else fail "$1 (expected the $3 service to receive $4; got HTTP $code$( [ -n "$(field service)" ] && echo " from $(field service) with $(field uri)"; is_index && echo ', index.html'))"; fi
}
routed "/api/v1/users/42?fields=name reaches the users service as /users/42?fields=name" "/api/v1/users/42?fields=name" users "/users/42?fields=name"
routed "/api/v1/orders/ reaches the orders service as /orders/" /api/v1/orders/ orders /orders/
routed "/api/v1/orders/7/items reaches the orders service as /orders/7/items" /api/v1/orders/7/items orders /orders/7/items
get /api/v1/orders/7 -H "X-Forwarded-For: 203.0.113.7"
xff="$(field x-forwarded-for)"
if [ "$(field host)" = "$addr" ] || [ "$(field host)" = "${addr%:*}" ]; then host_ok=1; else host_ok=0; fi
if [ "$host_ok" = 1 ] && [[ "$xff" =~ ^203\.0\.113\.7,\ [0-9.]+$ ]] && [ "$(field x-forwarded-proto)" = http ]; then pass "the services receive the client's Host, X-Forwarded-For (appended) and X-Forwarded-Proto"
else fail "the services should receive Host, X-Forwarded-For with the client appended, and X-Forwarded-Proto (got host=\"$(field host)\", x-forwarded-for=\"$xff\", x-forwarded-proto=\"$(field x-forwarded-proto)\")"; fi

get /api/v1/payments/3; sec "/api/v1/payments/3"
if [ "$code" = 404 ] && ! is_index && [ -z "$(field service)" ] && [[ "$(header content-type)" == application/json* ]] && echo "$body" | grep_quiet '"error"'; then
  pass "an unknown API path gets a JSON 404 from Nginx — not index.html, not a service"
else fail "/api/v1/payments/3 should get 404 with a JSON body such as {\"error\":\"not found\"} (got HTTP $code, $(header content-type)$(is_index && echo ', index.html')$( [ -n "$(field service)" ] && echo ", from $(field service)"))"; fi

# --- Request-size limits ---
head -c 51200 /dev/zero | tr '\0' 'a' > "$tmp/50k"
head -c 204800 /dev/zero | tr '\0' 'a' > "$tmp/200k"
head -c 3145728 /dev/zero | tr '\0' 'a' > "$tmp/3m"
head -c 6291456 /dev/zero | tr '\0' 'a' > "$tmp/6m"
get /api/v1/orders/ -X POST --data-binary "@$tmp/50k" -H "Content-Type: application/json"
if [ "$code" = 200 ] && [ "$(field service)" = orders ] && [ "$(field body-bytes)" = 51200 ]; then pass "a 50 KB order reaches the orders service"
else fail "a 50 KB POST to /api/v1/orders/ should reach the orders service whole (got HTTP $code from $(field service), body-bytes=$(field body-bytes))"; fi
get /api/v1/orders/ -X POST --data-binary "@$tmp/200k" -H "Content-Type: application/json"; sec "413 for /api/v1/orders/"
if [ "$code" = 413 ] && [ -z "$(field service)" ]; then pass "a 200 KB order is refused with 413 before it reaches the service"
else fail "a 200 KB POST to /api/v1/orders/ should be refused with 413 (the API limit is 100 KB); got HTTP $code"; fi
get /api/v1/users/avatar -X POST --data-binary "@$tmp/3m" -H "Content-Type: image/png"
if [ "$code" = 200 ] && [ "$(field service)" = users ] && [ "$(field uri)" = /users/avatar ] && [ "$(field body-bytes)" = 3145728 ]; then pass "a 3 MB avatar upload reaches the users service as /users/avatar"
else fail "a 3 MB POST to /api/v1/users/avatar should reach the users service as /users/avatar (got HTTP $code, $(field uri), body-bytes=$(field body-bytes))"; fi
get /api/v1/users/avatar -X POST --data-binary "@$tmp/6m" -H "Content-Type: image/png"
if [ "$code" = 413 ]; then pass "a 6 MB avatar upload is refused with 413"
else fail "a 6 MB POST to /api/v1/users/avatar should be refused with 413 (the avatar limit is 5 MB); got HTTP $code"; fi

# --- Rate limiting (after a pause, so the earlier requests do not count) ---
sleep 3
for _ in $(seq 1 40); do curl -s -o /dev/null -m 10 -w '%{http_code}\n' "http://$addr/api/v1/users/1"; done > "$tmp/codes"
ok=$(grep -c '^200$' "$tmp/codes"); limited=$(grep -c '^429$' "$tmp/codes"); other=$(grep -vc '^\(200\|429\)$' "$tmp/codes")
if [ "$ok" -ge 20 ] && [ "$ok" -le 34 ] && [ "$limited" -ge 1 ] && [ "$other" = 0 ]; then pass "40 rapid API requests: a burst of about 20 is served at once, the excess gets 429 ($ok × 200, $limited × 429)"
else fail "40 rapid API requests should give 20–34 × 200 and the rest 429 (10 requests/s, burst 20, no delay, status 429); got $ok × 200, $limited × 429, $other other"; fi
get /api/v1/users/1; sec "429 for /api/v1/users/1"
sleep 3
for _ in $(seq 1 40); do curl -s -o /dev/null -m 10 -w '%{http_code}\n' "http://$addr/"; done > "$tmp/codes"
if [ "$(grep -c '^200$' "$tmp/codes")" = 40 ]; then pass "the frontend is not rate-limited: 40 rapid requests for / all get 200"
else fail "only the API is rate-limited: 40 rapid requests for / should all get 200 (got $(sort "$tmp/codes" | uniq -c | tr -s ' \n' ' '))"; fi

# --- Headers on every response ---
if [ -z "$sec_missing" ]; then pass "every response, errors included, carries X-Content-Type-Options: nosniff and X-Frame-Options: DENY"
else fail "X-Content-Type-Options: nosniff and X-Frame-Options: DENY are missing from:$sec_missing"; fi
get /
if [ "$(header server)" = nginx ]; then pass "responses say Server: nginx, without the version number"
else fail "the Server header should be just \"nginx\" (server_tokens off), not \"$(header server)\""; fi

if [ "$(docker inspect -f '{{.State.Running}}' "$id-nginx")" = true ]; then pass "Nginx is still running after all requests"
else fail "Nginx stopped during the check: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"; fi
finish
