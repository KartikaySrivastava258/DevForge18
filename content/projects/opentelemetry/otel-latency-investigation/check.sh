#!/usr/bin/env bash
# Acceptance check for "Latency investigation challenge".
# Usage: bash check.sh path/to/your/project
# Needs Docker and Python 3 (and network access once, for npm install). Runs Jaeger 2.23.0, the OpenTelemetry
# Collector 0.165.0 and both services (your report.js; grades.js must be unchanged) on a private network, sends
# 40 report requests, measures the latency, checks the answer, and reads one report's trace back from Jaeger.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. Everything it starts is removed.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
jaeger="jaegertracing/jaeger:2.23.0@sha256:3823829974ccfc2485d2e48b165579091f32295022ae80ca49704e2f4834116e"            # published 2026-11-05
collector="otel/opentelemetry-collector:0.165.0@sha256:34b24b740c3c88d3467740e8642a397c13898ef76d7295c5425164c482ed1b73" # published 2026-11-07
node="node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d"               # published 2026-11-05
grades_sha="0659df5f25384d9a79a1a43d24a2696d1cb2433d3c5e58e345e8698c4ee48698"
id="devforge-check-otel-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in report.js grades.js tracing.js package.json FINDINGS.md; do [ -f "$src/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish
if [ "$(sha256sum < "$src/grades.js" | cut -d' ' -f1)" = "$grades_sha" ]; then pass "grades.js is unchanged (it belongs to another team)"; else fail "grades.js was changed — fix the report service instead"; fi

python3 - "$src/FINDINGS.md" <<'PY' || failures=$((failures + $?))
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
fails = 0
for name in ("Symptom", "Evidence", "Cause", "Fix"):
    m = re.search(rf"^## +{name}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    body = m.group(1).strip() if m else ""
    if not m or "TODO" in body or len(body.split()) < 15 or not re.search(r"\d", body):
        print(f"FAIL: FINDINGS.md section \"## {name}\" needs at least 15 words with numbers, and no TODO"); fails += 1
if not fails: print("PASS: FINDINGS.md explains the symptom, evidence, cause and fix with numbers")
sys.exit(fails)
PY

work="$(mktemp -d)"
cleanup() {
  docker rm -f -v "$id-report" "$id-grades" "$id-collector" "$id-jaeger" > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
cp -a "$src/." "$work/" && rm -rf "$work/node_modules" && chmod -R a+rX "$work"
cat > "$work/.check-collector.yaml" <<'YAML'
receivers: { otlp: { protocols: { http: { endpoint: 0.0.0.0:4318 } } } }
processors: { batch: { timeout: 1s } }
exporters: { otlp_grpc: { endpoint: jaeger:4317, tls: { insecure: true } } }
service: { pipelines: { traces: { receivers: [otlp], processors: [batch], exporters: [otlp_grpc] } } }
YAML
chmod 644 "$work/.check-collector.yaml"
if ! out="$(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/app" -w /app "$node" npm install --no-audit --no-fund --loglevel=error 2>&1)"; then fail "npm install failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; fi

docker network create "$id" > /dev/null
docker run -d --name "$id-jaeger" --network "$id" --network-alias jaeger "$jaeger" > /dev/null
docker run -d --name "$id-collector" --network "$id" --network-alias collector -v "$work/.check-collector.yaml:/cfg.yaml:ro" "$collector" --config=/cfg.yaml > /dev/null
svc() { docker run -d --name "$id-$1" --network "$id" --network-alias "$1" --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318 -e GRADES_URL=http://grades:8082 -v "$work:/app" -w /app "$node" npm run --silent "start:$1" > /dev/null; }
for _ in $(seq 1 30); do docker logs "$id-collector" 2>&1 | grep_quiet 'Everything is ready' && break; sleep 1; done
svc grades; svc report

# One Node process on the network does the requests, the timing and the Jaeger query; it prints JSON.
result="$(docker run --rm --network "$id" "$node" node -e '
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let first = null;
  for (let i = 0; i < 40 && !first; i++) {
    try { const r = await fetch("http://report:8080/report?class=CS-A"); if (r.ok) first = await r.json(); } catch {}
    if (!first) await sleep(500);
  }
  const times = [];
  for (let i = 0; i < 40; i++) {
    const t = performance.now();
    await (await fetch("http://report:8080/report?class=CS-A")).text();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p95 = Math.round(times[Math.floor(0.95 * times.length) - 1]);
  const start = new Date(Date.now() - 600000).toISOString(), end = new Date(Date.now() + 300000).toISOString();
  let traces = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const r = await fetch(`http://jaeger:16686/api/v3/traces?query.service_name=report&query.start_time_min=${start}&query.start_time_max=${end}&query.num_traces=5`);
      if (r.ok) { traces = await r.json(); if (JSON.stringify(traces).includes("\"grades\"")) break; }
    } catch {}
  }
  console.log(JSON.stringify({ first, p95, traces }));
})();
')"
printf '%s' "$result" > "$work/.result.json"
python3 - "$work/.result.json" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try:
    r = json.load(open(sys.argv[1]))
except ValueError:
    print("FAIL: the report service did not answer"); sys.exit(1)
if r.get("first") == {"class": "CS-A", "students": 30, "average": 70.6}: ok("the report is still correct (30 students, average 70.6)")
else: bad(f"the report must stay {{\"class\": \"CS-A\", \"students\": 30, \"average\": 70.6}} — got {r.get('first')}")
p95 = r.get("p95")
if isinstance(p95, (int, float)) and p95 < 200: ok(f"95% of reports take under 200 ms (p95 {p95} ms over 40 requests)")
else: bad(f"the 95th percentile of report latency must be under 200 ms (p95 {p95} ms over 40 requests)")
def attrs(lst): return {a["key"]: list(a["value"].values())[0] for a in lst or []}
spans = []
for rs in ((r.get("traces") or {}).get("result") or {}).get("resourceSpans", []):
    svc = attrs(rs.get("resource", {}).get("attributes")).get("service.name")
    for ss in rs.get("scopeSpans", []):
        for s in ss.get("spans", []):
            spans.append({**s, "service": svc, "attrs": attrs(s.get("attributes"))})
traces = {}
for s in spans: traces.setdefault(s["traceId"], []).append(s)
reports = [t for t in traces.values() if any(s["service"] == "report" and s.get("kind") == 2 and "report" in str(s["attrs"].get("http.target", "")) + str(s["attrs"].get("url.path", "")) + s.get("name", "") for s in t)]
reports = [t for t in reports if any(s["service"] == "grades" for s in t)]
if not reports:
    bad("no report trace that includes the grades service reached Jaeger — keep tracing.js and the start scripts working")
    sys.exit(fails)
calls = min(sum(1 for s in t if s["service"] == "report" and s.get("kind") == 3) for t in reports)
if calls <= 2: ok(f"one report makes {calls} call(s) to the grades service (the trace no longer shows one call per student)")
else: bad(f"one report still makes {calls} calls to the grades service — the trace shows the N+1 pattern")
build = [s for t in reports for s in t if s["service"] == "report" and s.get("name") == "build report"]
if build and str(build[0]["attrs"].get("report.students")) == "30": ok('a "build report" span records report.students = 30')
else: bad('add a span named "build report" with the attribute report.students' + (f" (found attributes {build[0]['attrs']})" if build else ""))
sys.exit(fails)
PY
finish
