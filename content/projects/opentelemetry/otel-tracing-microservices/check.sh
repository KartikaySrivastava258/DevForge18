#!/usr/bin/env bash
# Acceptance check for "Distributed tracing for a microservice demo".
# Usage: bash check.sh path/to/your/project
# Needs Docker and Python 3 (and network access once, for npm install). Validates otel-collector.yaml, then
# runs Jaeger 2.23.0, the OpenTelemetry Collector 0.165.0 with your configuration and your two services on a
# private Docker network, sends requests to /products, and reads the resulting traces back from Jaeger's API.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. Everything it starts is removed.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
jaeger="jaegertracing/jaeger:2.23.0@sha256:3823829974ccfc2485d2e48b165579091f32295022ae80ca49704e2f4834116e"            # published 2026-11-05
collector="otel/opentelemetry-collector:0.165.0@sha256:34b24b740c3c88d3467740e8642a397c13898ef76d7295c5425164c482ed1b73" # published 2026-11-07
node="node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d"               # published 2026-11-05
id="devforge-check-otel-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in otel-collector.yaml package.json frontend.js catalogue.js; do [ -f "$src/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

work="$(mktemp -d)"
cleanup() {
  docker rm -f -v "$id-frontend" "$id-catalogue" "$id-collector" "$id-jaeger" > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
cp -a "$src/." "$work/" && rm -rf "$work/node_modules"
chmod -R a+rX "$work"

if out="$(docker run --rm -v "$work/otel-collector.yaml:/cfg.yaml:ro" "$collector" validate --config=/cfg.yaml 2>&1)"; then pass "otel-collector.yaml is a valid Collector configuration"; else fail "otelcol validate: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

if out="$(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/app" -w /app "$node" npm install --no-audit --no-fund --loglevel=error 2>&1)"; then pass "npm install succeeds"; else fail "npm install failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

docker network create "$id" > /dev/null
docker run -d --name "$id-jaeger" --network "$id" --network-alias jaeger "$jaeger" > /dev/null
docker run -d --name "$id-collector" --network "$id" --network-alias collector -v "$work/otel-collector.yaml:/cfg.yaml:ro" "$collector" --config=/cfg.yaml > /dev/null
svc() { docker run -d --name "$id-$1" --network "$id" --network-alias "$1" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 -e CATALOGUE_URL=http://catalogue:8081 -v "$work:/app" -w /app "$node" npm run --silent "start:$1" > /dev/null; }
# fetch <url>: GET from inside the network, prints status and body.
fetch() { docker run --rm --network "$id" "$node" node -e 'fetch(process.argv[1]).then(async r => console.log(r.status + " " + await r.text())).catch(e => console.log("000 " + e.cause?.code))' "$1"; }
for _ in $(seq 1 30); do docker logs "$id-collector" 2>&1 | grep -q 'Everything is ready' && break; sleep 1; done
for _ in $(seq 1 30); do fetch http://jaeger:16686/ | grep -q '^200' && break; sleep 1; done
svc catalogue; svc frontend

answer=""
for _ in $(seq 1 30); do answer="$(fetch http://frontend:8080/products)"; case "$answer" in 200*) break ;; esac; sleep 1; done
if echo "$answer" | grep -q '^200 .*Masala dosa'; then pass "GET /products on the frontend returns the catalogue's items"; else fail "GET /products should return 200 with the items (got: $(echo "$answer" | head -c 160))"; fi
fetch http://frontend:8080/products > /dev/null; fetch http://frontend:8080/products > /dev/null

start="$(date -u -d '-10 min' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)"
end="$(date -u -d '+5 min' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+5M +%Y-%m-%dT%H:%M:%SZ)"
traces=""
for _ in $(seq 1 30); do
  traces="$(fetch "http://jaeger:16686/api/v3/traces?query.service_name=frontend&query.start_time_min=$start&query.start_time_max=$end")"
  echo "$traces" | grep -q '"catalogue"' && break
  sleep 2
done
python3 - "${traces#* }" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try:
    data = json.loads(sys.argv[1])["result"]["resourceSpans"]
except (ValueError, KeyError, TypeError):
    print("FAIL: no traces from service frontend reached Jaeger — check tracing.js, OTEL_SERVICE_NAME, the exporter endpoint and the Collector pipeline")
    sys.exit(1)
spans = []
for rs in data:
    service = next((a["value"].get("stringValue") for a in rs.get("resource", {}).get("attributes", []) if a["key"] == "service.name"), None)
    for ss in rs.get("scopeSpans", []):
        for s in ss.get("spans", []):
            attrs = {a["key"]: list(a["value"].values())[0] for a in s.get("attributes", [])}
            spans.append({**s, "service": service, "attrs": attrs})
by_trace = {}
for s in spans: by_trace.setdefault(s["traceId"], []).append(s)
services = {s["service"] for s in spans}
if {"frontend", "catalogue"} <= services: ok("spans arrive in Jaeger from services named frontend and catalogue")
else: bad(f"expected spans from services named frontend and catalogue, found: {sorted(x for x in services if x)}")
both = [t for t in by_trace.values() if {"frontend", "catalogue"} <= {s["service"] for s in t}]
if both: ok(f"{len(both)} request(s) form one trace across both services")
else: bad("no single trace contains spans from both services — the trace context is not propagated from frontend to catalogue")
linked = False
for t in both:
    ids = {s["spanId"]: s for s in t}
    for s in t:
        if s["service"] == "catalogue" and s.get("kind") == 2:  # SERVER
            parent = ids.get(s.get("parentSpanId"))
            if parent and parent["service"] == "frontend" and parent.get("kind") == 3:  # CLIENT
                linked = True
if linked: ok("the catalogue's server span is a child of the frontend's outgoing (client) span")
else: bad("the catalogue's server span should have the frontend's client span as its parent")
manual = [s for t in both for s in t if s["service"] == "catalogue" and s.get("name") == "load products"]
good = [s for s in manual if str(s["attrs"].get("products.count")) == "3"]
if good: ok('catalogue records a "load products" span with products.count = 3')
else: bad('add a span named "load products" in the catalogue with the attribute products.count (3 for the sample data)' + (f"; found the span with attributes {manual[0]['attrs']}" if manual else ""))
nested = [s for s in good if any(p["spanId"] == s.get("parentSpanId") and p.get("kind") == 2 for t in both for p in t)]
if good and nested: ok('"load products" is a child of the catalogue\'s request span')
elif good: bad('"load products" should be created inside the request (a child of the catalogue server span), not as a separate trace')
sys.exit(fails)
PY
finish
