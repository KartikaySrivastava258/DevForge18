#!/usr/bin/env bash
# Acceptance check for "Local load-balancing demo".
# Usage: bash check.sh path/to/your/project   (the folder with nginx.conf)
# Needs Docker and curl. Starts six small echo services on a private Docker network — app1, app2, app3 and
# fallback for /api/, r1 and r2 for /reports/ — tests your nginx.conf with `nginx -t`, runs it in Nginx 1.24 (the
# version the Nginx lessons use) and sends real requests while it switches instances into maintenance (503) or
# crashes them (connection refused): how requests are spread, whether users see errors, whether POST requests are
# repeated, and when the backup takes over. Removes everything it started.
# Prints PASS or FAIL per criterion; non-zero exit if any fails.
set -uo pipefail
dir="${1:-.}"
# Nginx 1.24.0 on Alpine, the version the Nginx lessons were recorded with (tag pushed 2024-04-18).
nginx_image="nginx:1.24.0-alpine@sha256:77e5d4a6ad906c5d3793764085706577fa705b1dc6f244ea0241c4b5e2155385"
# Node.js 22.23.5 on Alpine, for the echo services (tag pushed 2026-11-12).
node_image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
id="devforge-check-ngx-lb-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$dir/nginx.conf" ] || { fail "$dir/nginx.conf is missing"; finish; }
command -v curl > /dev/null || { fail "this check needs curl"; finish; }

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
  docker ps -aq --filter "label=devforge-check=$id" | xargs -r docker rm -f -v > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
}
trap cleanup EXIT

# The echo service: answers on port 8000 with its name and what it received (?delay_ms=N answers N ms later).
# A control port, 9000, reachable only inside its container, switches the mode — ok, 503 (maintenance) or down
# (stops listening, as if the process had crashed) — and reports how many GET and POST requests it received.
echo_js=$(cat <<'EOF'
const http = require("node:http");
const name = process.env.NAME;
let mode = "ok";
const stats = { GET: 0, POST: 0, OTHER: 0 };
const app = http.createServer((req, res) => {
  let bytes = 0;
  req.on("data", (c) => { bytes += c.length; });
  req.on("end", () => {
    stats[req.method in stats ? req.method : "OTHER"]++;
    const delay = Math.min(Number(new URL(req.url, "http://x").searchParams.get("delay_ms")) || 0, 30000);
    setTimeout(() => {
      if (mode === "503") { res.writeHead(503, { "content-type": "text/plain" }); return res.end(`service=${name}\nstatus=maintenance\n`); }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`service=${name}\nmethod=${req.method}\nuri=${req.url}\nbody-bytes=${bytes}\n`);
    }, delay);
  });
});
app.listen(8000, () => console.log("ready"));
http.createServer((req, res) => {
  const m = new URL(req.url, "http://x").searchParams.get("mode");
  if (m === "down" && mode !== "down") app.close();
  if (m && m !== "down" && mode === "down") app.listen(8000);
  if (m) mode = m;
  res.end(`mode=${mode} GET=${stats.GET} POST=${stats.POST}\n`);
}).listen(9000, "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
EOF
)

services="app1 app2 app3 fallback r1 r2"
docker network create --label "devforge-check=$id" "$id" > /dev/null || { fail "could not create a Docker network"; finish; }
for svc in $services; do
  docker run -d --name "$id-$svc" --label "devforge-check=$id" --network "$id" --network-alias "$svc" -e NAME="$svc" \
    "$node_image" node -e "$echo_js" > /dev/null || { fail "could not start the $svc service in Docker"; finish; }
done
for svc in $services; do
  for _ in $(seq 1 50); do docker logs "$id-$svc" 2>&1 | grep -q ready && break; sleep 0.2; done
done
# ctl SERVICE [MODE] — switch a service's mode (if given) and print "mode=… GET=n POST=n".
ctl() { docker exec "$id-$1" wget -qO- "http://127.0.0.1:9000/${2:+?mode=$2}"; }
count() { ctl "$1" | sed -n "s/.* $2=\([0-9]*\).*/\1/p"; }

docker create --name "$id-test" --label "devforge-check=$id" --network "$id" "$nginx_image" nginx -t > /dev/null
docker cp "$dir/nginx.conf" "$id-test:/etc/nginx/nginx.conf" > /dev/null
if out="$(docker start -a "$id-test" 2>&1)"; then pass "nginx -t accepts nginx.conf"; else fail "nginx -t rejects nginx.conf: $(echo "$out" | grep -m 1 emerg)"; finish; fi

docker create --name "$id-nginx" --label "devforge-check=$id" --network "$id" -p 127.0.0.1::80 "$nginx_image" > /dev/null
docker cp "$dir/nginx.conf" "$id-nginx:/etc/nginx/nginx.conf" > /dev/null
docker start "$id-nginx" > /dev/null
addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"
for _ in $(seq 1 50); do [ -n "$addr" ] && curl -s -o /dev/null -m 2 "http://$addr/" && break; sleep 0.2; addr="$(docker port "$id-nginx" 80/tcp 2> /dev/null | head -n 1)"; done
if [ -z "$addr" ] || ! curl -s -o /dev/null -m 2 "http://$addr/"; then
  fail "Nginx did not answer on port 80 inside its container: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"
  finish
fi

# burst N PATH [curl options…] — N requests one after another; prints "STATUS SERVICE" per request.
burst() {
  local n="$1" path="$2"; shift 2
  for _ in $(seq 1 "$n"); do
    curl -s -m 15 -w '\n%{http_code}\n' "$@" "http://$addr$path" | awk '/^service=/ { s = substr($0, 9) } /^[0-9][0-9][0-9]$/ { c = $0 } END { print c, (s == "" ? "-" : s) }'
  done
}
summary() { sort | uniq -c | awk '{ printf "%s×%s %s; ", $1, $2, $3 }'; }

# 1. Round robin across the three instances; the backup receives nothing while they are healthy.
res="$(burst 30 /api/items)"
n1=$(grep -c ' app1$' <<< "$res"); n2=$(grep -c ' app2$' <<< "$res"); n3=$(grep -c ' app3$' <<< "$res")
if [ "$(grep -c '^200 ' <<< "$res")" = 30 ] && (for n in $n1 $n2 $n3; do [ "$n" -ge 6 ] && [ "$n" -le 14 ] || exit 1; done); then
  pass "30 requests to /api/ are spread across app1, app2 and app3 ($n1/$n2/$n3)"
else fail "30 requests to /api/ should be spread across app1, app2 and app3, 6–14 each (got: $(summary <<< "$res"))"; fi
if [ "$(count fallback GET)" = 0 ] && ! grep -q ' fallback$' <<< "$res"; then pass "the fallback service receives nothing while app1–app3 are healthy"
else fail "the fallback service must only be used when app1–app3 all fail, but it received requests (got: $(summary <<< "$res"))"; fi

# 2. least_conn for /reports/: while one long report runs, the next short requests go to the idle instance.
curl -s -m 15 "http://$addr/reports/yearly?delay_ms=3000" > "$tmp/long" 2>&1 &
long_pid=$!
sleep 0.7
res="$(burst 6 /reports/daily)"
wait "$long_pid"
busy="$(sed -n 's/^service=//p' "$tmp/long")"
idle=r1; [ "$busy" = r1 ] && idle=r2
if [ -n "$busy" ] && [ "$(grep -c "^200 $idle\$" <<< "$res")" -ge 5 ]; then pass "/reports/ uses least connections: while $busy runs a 3-second report, short requests go to $idle"
else fail "/reports/ should send new requests to the instance with fewer active connections: while ${busy:-?} was busy, 6 short requests went to: $(summary <<< "$res")"; fi

# 3. POST is never sent twice: app3 is in maintenance (503) and every POST must reach exactly one instance.
ctl app3 503 > /dev/null
before=$(( $(count app1 POST) + $(count app2 POST) + $(count app3 POST) + $(count fallback POST) ))
res="$(burst 6 /api/orders -X POST --data-binary '{"item":"notebook"}' -H 'Content-Type: application/json')"
after=$(( $(count app1 POST) + $(count app2 POST) + $(count app3 POST) + $(count fallback POST) ))
if [ "$(count app3 POST)" -ge 1 ] && [ $((after - before)) = 6 ]; then pass "6 POST requests reached the instances exactly 6 times — a POST that got 503 was not repeated on another instance"
else fail "each POST must reach exactly one instance (non-idempotent requests are not retried): 6 POSTs arrived $((after - before)) times, app3 got $(count app3 POST) (responses: $(summary <<< "$res"))"; fi

# 4. GET requests that meet the instance in maintenance are retried on another one.
res="$(burst 12 /api/items)"
if [ "$(grep -c '^200 ' <<< "$res")" = 12 ] && ! grep -q ' app3$' <<< "$res"; then pass "with app3 answering 503, 12 GET requests all get 200 from the other instances"
else fail "with app3 answering 503 (maintenance), GET requests should be retried on another instance — users must not see the 503 (got: $(summary <<< "$res"))"; fi

# 5. A crashed instance (connection refused) costs users nothing.
ctl app2 down > /dev/null
res="$(burst 20 /api/items)"
if [ "$(grep -c '^200 app1$' <<< "$res")" = 20 ]; then pass "with app2 crashed and app3 in maintenance, 20 GET requests all get 200 from app1"
else fail "with app2 crashed (connection refused) and app3 answering 503, every GET should be answered by app1 (got: $(summary <<< "$res"))"; fi

# 6. When every instance fails, the backup answers.
ctl app1 down > /dev/null; ctl app3 down > /dev/null
res="$(burst 4 /api/items)"
if [ "$(grep -c '^200 fallback$' <<< "$res")" = 4 ]; then pass "with app1, app2 and app3 all down, the fallback service answers"
else fail "with app1, app2 and app3 all down, the fallback service should answer (got: $(summary <<< "$res"))"; fi

if [ "$(docker inspect -f '{{.State.Running}}' "$id-nginx")" = true ]; then pass "Nginx is still running after all requests"
else fail "Nginx stopped during the check: $(docker logs "$id-nginx" 2>&1 | tail -n 2 | tr '\n' ' ')"; fi
finish
