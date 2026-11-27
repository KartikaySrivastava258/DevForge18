#!/usr/bin/env bash
# Acceptance check for "Application health dashboard".
# Usage: bash check.sh path/to/your/project   (the folder with prometheus.yml, dashboard.json and app.py)
# Needs Docker and Python 3. Starts your app.py and Prometheus 3.16.0 with your prometheus.yml on a private
# Docker network, waits for real scrapes, then runs every query of every panel in dashboard.json against that
# Prometheus. Prints PASS or FAIL per criterion and exits non-zero if any fails; removes what it started.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
prometheus="prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06"  # published 2026-11-05
python="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
id="devforge-check-prom-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in prometheus.yml dashboard.json app.py; do [ -f "$dir/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

if out="$(docker run --rm --user "$(id -u):$(id -g)" -v "$dir:/w:ro" -w /w --entrypoint promtool "$prometheus" check config prometheus.yml 2>&1)"; then
  pass "prometheus.yml is valid"
else
  fail "promtool check config: $(echo "$out" | tr '\n' ' ')"; finish
fi

trap 'docker rm -f -v "$id-prom" "$id-app" > /dev/null 2>&1; docker network rm "$id" > /dev/null 2>&1' EXIT
docker network create "$id" > /dev/null
docker run -d --name "$id-app" --network "$id" --network-alias app -v "$dir/app.py:/app.py:ro" "$python" python3 /app.py > /dev/null
docker run -d --name "$id-prom" --network "$id" -v "$dir/prometheus.yml:/etc/prometheus/prometheus.yml:ro" "$prometheus" > /dev/null
api() { docker exec "$id-prom" wget -qO- "http://localhost:9090/api/v1/$1" 2>/dev/null; }
for _ in $(seq 1 30); do api status/buildinfo > /dev/null && break; sleep 1; done

up=""
for _ in $(seq 1 45); do
  up="$(api 'query?query=up%7Bjob%3D%22campus-api%22%7D' | python3 -c 'import json,sys; r=json.load(sys.stdin)["data"]["result"]; print(r[0]["value"][1] if r else "")' 2>/dev/null)"
  [ "$up" = "1" ] && break
  sleep 2
done
if [ "$up" = "1" ]; then pass "Prometheus scrapes the app as job campus-api (up = 1)"; else fail "job campus-api is not scraped successfully (up = ${up:-no series}); check the job name, target address and port"; fi
interval="$(api 'targets' | python3 -c '
import json, sys
t = [x for x in json.load(sys.stdin)["data"]["activeTargets"] if x["labels"].get("job") == "campus-api"]
print(t[0]["scrapeInterval"] if t else "")' 2>/dev/null)"
case "$interval" in
  ""|*m*|*h*) fail "scrape campus-api at least every 15 seconds (scrape interval: ${interval:-unknown})" ;;
  *) [ "${interval%s}" -le 15 ] 2> /dev/null && pass "campus-api is scraped every $interval" || fail "scrape campus-api at least every 15 seconds (scrape interval: $interval)" ;;
esac
sleep 20   # a few more scrapes, so rate() has samples to work with

python3 - "$id-prom" "$dir/dashboard.json" <<'PY' || failures=$((failures + $?))
import json, re, subprocess, sys, urllib.parse
container = sys.argv[1]
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try:
    dash = json.load(open(sys.argv[2], encoding="utf-8"))
except ValueError as e:
    print(f"FAIL: dashboard.json is not valid JSON ({e})"); sys.exit(1)
panels = [p for p in dash.get("panels", []) if p.get("type") != "row"]
if dash.get("uid") and dash.get("title") and len(panels) >= 4: ok(f'dashboard "{dash["title"]}" (uid {dash["uid"]}) has {len(panels)} panels')
else: bad("dashboard.json needs a uid, a title and at least 4 panels")
# Grafana replaces these variables before sending a query; use typical values to run the query directly.
GRAFANA = {"$__rate_interval": "1m", "$__interval": "15s", "$__range": "1h", "${__rate_interval}": "1m"}
def run(expr):
    for k, v in GRAFANA.items(): expr = expr.replace(k, v)
    url = "http://localhost:9090/api/v1/query?query=" + urllib.parse.quote(expr)
    out = subprocess.run(["docker", "exec", container, "wget", "-qO-", url], capture_output=True, text=True)
    try: body = json.loads(out.stdout)
    except ValueError: return None, out.stderr.strip()[:120] or "query failed"
    return body.get("data", {}).get("result"), body.get("error")
found = {"up": False, "rate": False, "errors": False, "p95": False}
for p in panels:
    title = p.get("title") or "(untitled panel)"
    exprs = [t.get("expr", "") for t in p.get("targets", []) if t.get("expr")]
    if not exprs:
        bad(f'panel "{title}" has no PromQL query'); continue
    for expr in exprs:
        result, error = run(expr)
        if error or result is None: bad(f'panel "{title}": query fails — {error}'); continue
        if not result: bad(f'panel "{title}": query returns no data — {expr}'); continue
        e = expr.replace(" ", "")
        if re.search(r"\bup\{", e): found["up"] = True
        if "rate(http_requests_total" in e and "5.." not in e: found["rate"] = True
        if "5.." in e and "/" in e: found["errors"] = True
        if "histogram_quantile(0.95" in e and "_bucket" in e:
            found["p95"] = True
            if (p.get("fieldConfig", {}).get("defaults", {}).get("unit")) != "s": bad(f'panel "{title}" shows seconds: set its unit to "s"')
        if re.search(r"http_requests_total(\{[^}]*\})?\s*$", expr.strip()) and "rate(" not in e: bad(f'panel "{title}" graphs a raw counter; use rate() to show requests per second')
names = {"up": "whether the API is up (up)", "rate": "request rate (rate of http_requests_total)", "errors": "error ratio (5xx ÷ all requests)", "p95": "95th percentile latency (histogram_quantile(0.95, … _bucket))"}
for k, ok_ in found.items():
    if ok_: ok(f"a panel shows {names[k]}, and its query returns data")
    else: bad(f"add a panel that shows {names[k]} with a query that returns data")
sys.exit(fails)
PY
finish
