#!/usr/bin/env bash
# Acceptance check for "SLO dashboard for a sample API".
# Usage: bash check.sh path/to/your/project   (the folder with rules.yml, tests.yml and dashboard.json)
# Needs Docker and Python 3. Runs promtool (Prometheus 3.16.0) from the official image: validates your rules,
# runs your tests, then DevForge's hidden scenarios (outages, slow leaks, a short spike that already ended) and
# the error-budget arithmetic; finally it checks that every dashboard query is valid PromQL built on your
# recording rules. Prints PASS or FAIL per criterion and exits non-zero if any fails.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
prometheus="prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06"  # published 2026-11-05
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
hidden="$(mktemp -d)"
trap 'rm -rf "$hidden"' EXIT
chmod 755 "$hidden"
promtool() { docker run --rm --user "$(id -u):$(id -g)" -v "$dir:/w:ro" -v "$hidden:/h:ro" -w /w --entrypoint promtool "$prometheus" "$@" 2>&1; }
for f in rules.yml tests.yml dashboard.json; do [ -f "$dir/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

if out="$(promtool check rules rules.yml)"; then pass "rules.yml is valid ($(echo "$out" | grep -o '[0-9]* rules found'))"; else fail "promtool check rules: $(echo "$out" | tr '\n' ' ')"; finish; fi
missing=""
for w in 5m 30m 1h 6h 30d; do
  for sli in job:sli_availability_errors job:sli_latency_slow; do grep -Eq "record: *$sli:ratio_rate$w *$" "$dir/rules.yml" || missing="$missing $sli:ratio_rate$w"; done
done
for r in job:slo_availability_budget_remaining:ratio30d job:slo_latency_budget_remaining:ratio30d; do grep -Eq "record: *$r *$" "$dir/rules.yml" || missing="$missing $r"; done
if [ -z "$missing" ]; then pass "all SLI and error-budget recording rules exist"; else fail "missing recording rules:$missing"; fi

if out="$(promtool test rules tests.yml)"; then pass "your own rule tests pass"; else fail "your rule tests fail: $(echo "$out" | head -n 8 | tr '\n' ' ')"; fi
untested=""
for alert in AvailabilityFastBurn AvailabilitySlowBurn LatencyFastBurn LatencySlowBurn; do grep -Eq "alertname: *$alert *$" "$dir/tests.yml" || untested="$untested $alert"; done
if [ -z "$untested" ]; then pass "tests.yml tests every alert"; else fail "tests.yml has no alert_rule_test for:$untested"; fi

run_test() { # <name> <input series> <promql_expr_test entries>
  cat > "$hidden/t.yml" <<EOT
rule_files: [/w/rules.yml]
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
$2
    promql_expr_test:
$3
EOT
  if out="$(promtool test rules /h/t.yml)"; then pass "$1"; else fail "$1 — $(echo "$out" | grep -E 'exp:|got:|error' | tr -s ' ' | tr '\n' ' ')"; fi
}
firing() { # <alert> <eval_time> <severity>
  echo "      - expr: 'count by (job, severity) (ALERTS{alertname=\"$1\", alertstate=\"firing\"})'
        eval_time: $2
        exp_samples:
          - labels: '{job=\"campus-api\", severity=\"$3\"}'
            value: 1"; }
quiet() { # <alert> <eval_time>
  echo "      - expr: 'count(ALERTS{alertname=\"$1\", alertstate=\"firing\"}) or vector(0)'
        eval_time: $2
        exp_samples:
          - labels: '{}'
            value: 0"; }
exists() { grep -Eq "alert: *$1 *$" "$dir/rules.yml" || { fail "$2 (rules.yml has no alert named $1)"; return 1; }; }
requests() { # <good per minute> <bad per minute> <minutes>
  echo "      - series: 'http_requests_total{job=\"campus-api\", code=\"200\"}'
        values: '0+$1x$3'
      - series: 'http_requests_total{job=\"campus-api\", code=\"500\"}'
        values: '0+$2x$3'"; }
latency() { # <fast per minute> <total per minute> <minutes>
  echo "      - series: 'http_request_duration_seconds_bucket{job=\"campus-api\", le=\"0.5\"}'
        values: '0+$1x$3'
      - series: 'http_request_duration_seconds_count{job=\"campus-api\"}'
        values: '0+$2x$3'"; }

n="10% of requests fail for an hour: AvailabilityFastBurn pages"
exists AvailabilityFastBurn "$n" && run_test "$n" "$(requests 900 100 120)" "$(firing AvailabilityFastBurn 1h page)"
n="2% of requests fail (burn rate 4): AvailabilityFastBurn does not page"
exists AvailabilityFastBurn "$n" && run_test "$n" "$(requests 980 20 120)" "$(quiet AvailabilityFastBurn 2h)"
n="4% of requests fail for 6 hours (burn rate 8): AvailabilitySlowBurn opens a ticket"
exists AvailabilitySlowBurn "$n" && run_test "$n" "$(requests 960 40 400)" "$(firing AvailabilitySlowBurn 6h ticket)"
n="0.2% of requests fail all day: no availability alert"
exists AvailabilitySlowBurn "$n" && run_test "$n" "$(requests 998 2 400)" "$(quiet AvailabilitySlowBurn 6h)
$(quiet AvailabilityFastBurn 6h)"
n="a 30-minute outage that ended 30 minutes ago: no page now (the short window has recovered)"
exists AvailabilityFastBurn "$n" && run_test "$n" "      - series: 'http_requests_total{job=\"campus-api\", code=\"200\"}'
        values: '0+700x30 21000+1000x30'
      - series: 'http_requests_total{job=\"campus-api\", code=\"500\"}'
        values: '0+300x30 9000+0x30'" "$(quiet AvailabilityFastBurn 60m)"
n="20% of requests slower than 500 ms for an hour: LatencyFastBurn pages"
exists LatencyFastBurn "$n" && run_test "$n" "$(latency 800 1000 120)" "$(firing LatencyFastBurn 1h page)"
n="8% slow requests for 6 hours (burn rate 8): LatencySlowBurn opens a ticket"
exists LatencySlowBurn "$n" && run_test "$n" "$(latency 920 1000 400)" "$(firing LatencySlowBurn 6h ticket)"
n="4% slow requests (burn rate 4): no latency alert"
exists LatencySlowBurn "$n" && run_test "$n" "$(latency 960 1000 400)" "$(quiet LatencySlowBurn 6h)
$(quiet LatencyFastBurn 6h)"
run_test "0.25% errors for two days leaves half the availability budget (0.5)" \
  "      - series: 'http_requests_total{job=\"campus-api\", code=\"200\"}'
        values: '0+9975x288'
      - series: 'http_requests_total{job=\"campus-api\", code=\"500\"}'
        values: '0+25x288'" \
  "      - expr: round(job:slo_availability_budget_remaining:ratio30d * 100)
        eval_time: 2d
        exp_samples:
          - labels: '{job=\"campus-api\"}'
            value: 50"

# Dashboard: structure, and every query is valid PromQL that reads the recording rules.
python3 - "$dir/dashboard.json" "$hidden/dash-rules.yml" <<'PY' || failures=$((failures + $?))
import json, re, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try:
    dash = json.load(open(sys.argv[1], encoding="utf-8"))
except ValueError as e:
    print(f"FAIL: dashboard.json is not valid JSON ({e})"); sys.exit(1)
panels = [p for p in dash.get("panels", []) if p.get("type") != "row"]
exprs = [(p.get("title", "?"), t["expr"]) for p in panels for t in p.get("targets", []) if t.get("expr")]
if dash.get("uid") and dash.get("title") and len(panels) >= 4: ok(f"dashboard has a uid, a title and {len(panels)} panels")
else: bad("dashboard.json needs a uid, a title and at least 4 panels")
raw = [t for t, e in exprs if not re.search(r"\bjob:(sli|slo)_", e)]
if exprs and not raw: ok("every panel query reads the recording rules (cheap and consistent with the alerts)")
else: bad(f"these panels compute from raw metrics instead of the recording rules: {', '.join(raw) or '(no queries)'}")
joined = " ".join(e for _, e in exprs)
for rule in ("job:slo_availability_budget_remaining:ratio30d", "job:slo_latency_budget_remaining:ratio30d"):
    (ok if rule in joined else bad)(f"a panel shows {rule}" if rule in joined else f"add a panel for {rule}")
if re.search(r"availability_errors:ratio_rate1h", joined) and re.search(r"latency_slow:ratio_rate1h", joined): ok("burn-rate panels cover availability and latency")
else: bad("add burn-rate panels (the 1-hour ratio divided by the budget) for availability and latency")
GRAFANA = {"$__rate_interval": "1m", "$__interval": "15s", "$__range": "1h"}
with open(sys.argv[2], "w") as f:
    f.write("groups:\n  - name: dashboard-queries\n    rules:\n")
    for i, (_, e) in enumerate(exprs):
        for k, v in GRAFANA.items(): e = e.replace(k, v)
        f.write(f"      - record: dashboard_query_{i}\n        expr: {json.dumps(e)}\n")
sys.exit(fails)
PY
if [ -s "$hidden/dash-rules.yml" ]; then
  if out="$(promtool check rules /h/dash-rules.yml)"; then pass "every dashboard query is valid PromQL"; else fail "invalid PromQL in dashboard.json: $(echo "$out" | grep -v SUCCESS | tr '\n' ' ')"; fi
fi
finish
