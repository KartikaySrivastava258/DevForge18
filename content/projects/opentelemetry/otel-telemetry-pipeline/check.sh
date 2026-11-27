#!/usr/bin/env bash
# Acceptance check for "Unified telemetry pipeline".
# Usage: bash check.sh path/to/your/project   (the folder with otel-collector.yaml)
# Needs Docker and Python 3 (and network access once, for pip). Validates your configuration, runs the
# OpenTelemetry Collector 0.165.0 with it next to Jaeger 2.23.0, sends one trace, one metric and one log record
# over OTLP, and checks what arrives at each destination. Prints PASS or FAIL per criterion; exits non-zero if
# any fails. Everything it starts is removed.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
jaeger="jaegertracing/jaeger:2.23.0@sha256:3823829974ccfc2485d2e48b165579091f32295022ae80ca49704e2f4834116e"            # published 2026-11-05
collector="otel/opentelemetry-collector:0.165.0@sha256:34b24b740c3c88d3467740e8642a397c13898ef76d7295c5425164c482ed1b73" # published 2026-11-07
python="python:3.12-slim@sha256:191083cdf6c7bda8c76158983163ead5d5cf7b77cf3033e805bb0f5296f51b4b"
id="devforge-check-otel-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$src/otel-collector.yaml" ] || { fail "otel-collector.yaml is missing"; finish; }
work="$(mktemp -d)"
cleanup() {
  docker rm -f -v "$id-collector" "$id-jaeger" "$id-py" > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/out" && chmod 777 "$work/out"
cp "$src/otel-collector.yaml" "$work/cfg.yaml" && chmod 644 "$work/cfg.yaml"

if out="$(docker run --rm -v "$work/cfg.yaml:/cfg.yaml:ro" "$collector" validate --config=/cfg.yaml 2>&1)"; then pass "otel-collector.yaml is a valid Collector configuration"; else fail "otelcol validate: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

# The sample data (the same as send_sample.py in the starter).
cat > "$work/send.py" <<'PY'
import json
import sys
import time
import urllib.request

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
SPAN_ID = "00f067aa0ba902b7"
HEALTH_TRACE_ID = "7d3a1e5c9b2f4a6e8c0d1f3b5a7e9c11"


def attr(key, value):
    kind = "intValue" if isinstance(value, int) else "stringValue"
    return {"key": key, "value": {kind: str(value) if kind == "intValue" else value}}


def post(endpoint, path, body):
    request = urllib.request.Request(endpoint.rstrip("/") + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        print(path, response.status)


def main(endpoint):
    now = time.time_ns()
    resource = {"attributes": [attr("service.name", "orders-api")]}
    post(endpoint, "/v1/traces", {"resourceSpans": [{"resource": resource, "scopeSpans": [{"scope": {"name": "sample"}, "spans": [
        {"traceId": TRACE_ID, "spanId": SPAN_ID, "name": "GET /orders", "kind": 2,
         "startTimeUnixNano": str(now - 120_000_000), "endTimeUnixNano": str(now),
         "attributes": [attr("http.route", "/orders"), attr("user.email", "asha@college.example"), attr("orders.count", 3)]},
        {"traceId": HEALTH_TRACE_ID, "spanId": "1111111111111111", "name": "GET /healthz", "kind": 2,
         "startTimeUnixNano": str(now - 1_000_000), "endTimeUnixNano": str(now)},
    ]}]}]})
    post(endpoint, "/v1/metrics", {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"scope": {"name": "sample"}, "metrics": [
        {"name": "orders.created", "unit": "1", "sum": {"aggregationTemporality": 2, "isMonotonic": True, "dataPoints": [
            {"asInt": "3", "startTimeUnixNano": str(now - 60_000_000_000), "timeUnixNano": str(now)}]}},
    ]}]}]})
    post(endpoint, "/v1/logs", {"resourceLogs": [{"resource": resource, "scopeLogs": [{"scope": {"name": "sample"}, "logRecords": [
        {"timeUnixNano": str(now), "severityNumber": 17, "severityText": "ERROR",
         "body": {"stringValue": "payment failed for order 1013"}, "traceId": TRACE_ID, "spanId": SPAN_ID,
         "attributes": [attr("order.id", 1013), attr("user.email", "asha@college.example")]},
    ]}]}]})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4318")
PY
docker network create "$id" > /dev/null
docker run -d --name "$id-jaeger" --network "$id" --network-alias jaeger "$jaeger" > /dev/null
docker run -d --name "$id-collector" --network "$id" --network-alias collector -v "$work/cfg.yaml:/cfg.yaml:ro" -v "$work/out:/out" "$collector" --config=/cfg.yaml > /dev/null
docker run -d --name "$id-py" --network "$id" -v "$work:/w" "$python" sleep 600 > /dev/null
py() { docker exec -i "$id-py" python3 - "$@"; }
get() { py "$1" <<'PY'
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=5) as r: print(r.status, r.read().decode())
except urllib.error.HTTPError as e: print(e.code, "")
except Exception as e: print("000", type(e).__name__)
PY
}
ready=""
for _ in $(seq 1 30); do docker logs "$id-collector" 2>&1 | grep_quiet 'Everything is ready' && ready=1 && break; sleep 1; done
for _ in $(seq 1 30); do get http://jaeger:16686/ | grep_quiet '^200' && break; sleep 1; done
[ -n "$ready" ] || { fail "the Collector did not start: $(docker logs "$id-collector" 2>&1 | tail -n 3 | tr '\n' ' ')"; finish; }

grpc="$(py <<'PY'
import socket
try:
    socket.create_connection(("collector", 4317), timeout=3).close(); print("open")
except OSError: print("closed")
PY
)"
if [ "$grpc" = "open" ]; then pass "the Collector accepts OTLP/gRPC on port 4317"; else fail "nothing listens on collector:4317 — add the gRPC protocol on 0.0.0.0:4317"; fi
if out="$(docker exec "$id-py" python3 /w/send.py http://collector:4318 2>&1)" && [ "$(echo "$out" | grep -c ' 200$')" = "3" ]; then pass "the Collector accepts traces, metrics and logs over OTLP/HTTP"; else fail "sending the sample over OTLP/HTTP failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; fi

start="$(date -u -d '-10 min' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)"
end="$(date -u -d '+5 min' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+5M +%Y-%m-%dT%H:%M:%SZ)"
traces=""
for _ in $(seq 1 20); do
  traces="$(get "http://jaeger:16686/api/v3/traces?query.service_name=orders-api&query.start_time_min=$start&query.start_time_max=$end")"
  case "$traces" in 200*GET\ /orders*) break ;; esac
  sleep 1
done
sleep 2
healthz="$(get http://jaeger:16686/api/v3/traces/7d3a1e5c9b2f4a6e8c0d1f3b5a7e9c11 | cut -c1-3)"
metrics="$(get http://collector:8889/metrics)"
logs="$(docker exec "$id-py" cat /w/out/logs.jsonl 2>/dev/null)"
docker exec "$id-py" pip install -q --root-user-action=ignore --disable-pip-version-check pyyaml==6.0.3 > /dev/null 2>&1

python3 - "${traces#* }" "$healthz" "$metrics" "$logs" <<'PY' || failures=$((failures + $?))
import json, sys
traces_raw, healthz, metrics, logs = sys.argv[1:5]
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
def attrs(lst): return {a["key"]: list(a["value"].values())[0] for a in lst or []}
try:
    rs = json.loads(traces_raw)["result"]["resourceSpans"]
    spans = [(attrs(r.get("resource", {}).get("attributes")), s) for r in rs for ss in r.get("scopeSpans", []) for s in ss.get("spans", [])]
except (ValueError, KeyError, TypeError):
    spans = []
orders = [(res, s) for res, s in spans if s.get("name") == "GET /orders"]
if orders: ok("traces reach Jaeger")
else: bad("the GET /orders span did not reach Jaeger — check the traces pipeline and its exporter")
if orders:
    res, s = orders[0]
    a = attrs(s.get("attributes"))
    (ok if res.get("deployment.environment") == "lab" else bad)("spans carry deployment.environment = lab" if res.get("deployment.environment") == "lab" else f"spans need the resource attribute deployment.environment = lab (resource: {res})")
    if "user.email" in a: bad("user.email is still on the span — remove it in the Collector")
    elif "orders.count" not in a: bad("other span attributes must stay (orders.count disappeared) — remove only user.email")
    else: ok("user.email is removed from spans; other attributes stay")
if healthz == "404" and orders: ok("GET /healthz spans are dropped")
elif orders: bad(f"the GET /healthz span reached Jaeger — drop it with a filter processor (lookup answered {healthz})")
mline = [l for l in metrics.splitlines() if l.startswith("orders_created_total")]
if mline and mline[0].rstrip().endswith(" 3"): ok("metrics are exposed for Prometheus on port 8889 (orders_created_total 3)")
else: bad("orders_created_total is not on collector:8889/metrics — add a metrics pipeline with the prometheus exporter")
if mline and 'deployment_environment="lab"' in metrics: ok("metrics carry deployment.environment = lab")
elif mline: bad("the metrics need deployment.environment = lab (as a label or in target_info)")
records = []
for line in logs.splitlines():
    try:
        for r in json.loads(line).get("resourceLogs", []):
            for sl in r.get("scopeLogs", []):
                for lr in sl.get("logRecords", []):
                    records.append((attrs(r.get("resource", {}).get("attributes")), lr))
    except ValueError:
        pass
err = [(res, lr) for res, lr in records if lr.get("body", {}).get("stringValue") == "payment failed for order 1013"]
if err: ok("logs are written to /out/logs.jsonl")
else: bad("the log record did not reach /out/logs.jsonl — add a logs pipeline with the file exporter")
if err:
    res, lr = err[0]
    a = attrs(lr.get("attributes"))
    if lr.get("traceId", "").lower() == "4bf92f3577b34da6a3ce929d0e0e4736": ok("log records keep their trace ID (logs link to traces)")
    else: bad("the log record lost its trace ID")
    if "user.email" in a: bad("user.email is still on the log record — remove it in the logs pipeline too")
    else: ok("user.email is removed from log records")
    (ok if res.get("deployment.environment") == "lab" else bad)("log records carry deployment.environment = lab" if res.get("deployment.environment") == "lab" else "log records need deployment.environment = lab")
sys.exit(fails)
PY

order="$(docker exec -i "$id-py" python3 - <<'PY'
import yaml
cfg = yaml.safe_load(open("/w/cfg.yaml"))
bad = []
for name, p in (cfg.get("service", {}).get("pipelines") or {}).items():
    procs = p.get("processors") or []
    if not procs or procs[0].split("/")[0] != "memory_limiter" or procs[-1].split("/")[0] != "batch":
        bad.append(f"{name}: {procs}")
names = sorted(n.split("/")[0] for n in (cfg.get("service", {}).get("pipelines") or {}))
print("ok" if not bad and {"traces", "metrics", "logs"} <= set(names) else "; ".join(bad) or "missing pipelines")
PY
)"
if [ "$order" = "ok" ]; then pass "every pipeline starts with memory_limiter and ends with batch"; else fail "each of the traces, metrics and logs pipelines must start with memory_limiter and end with batch ($order)"; fi
finish
