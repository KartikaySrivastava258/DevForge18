#!/usr/bin/env bash
# Acceptance check for "Resource monitoring lab".
# Usage: bash check.sh path/to/your/project   (the folder with rules.yml, tests.yml and alertmanager.yml)
# Needs Docker. Runs promtool (Prometheus 3.16.0) and amtool (Alertmanager 0.34.2) from their official images:
# validates your files, runs your own rule tests, then runs DevForge's hidden scenarios against your rules —
# alerts must fire when they should and stay quiet when they should not — and tests the Alertmanager routing.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. Nothing is left running.
set -uo pipefail
dir="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
prometheus="prom/prometheus:v3.16.0@sha256:e04987641b57704f408e31f6373ba4138ecf27cb4a165d24aabb6c38fddd0f06"     # published 2026-11-05
alertmanager="prom/alertmanager:v0.34.2@sha256:39d8bb3966c694a124428a3a88fbcffd40bd069129ecd47c059f8a3f17c55f3b" # published 2026-10-29
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
amtool() { docker run --rm --user "$(id -u):$(id -g)" -v "$dir:/w:ro" -w /w --entrypoint amtool "$alertmanager" "$@" 2>&1; }

for f in rules.yml tests.yml alertmanager.yml; do [ -f "$dir/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish

if out="$(promtool check rules rules.yml)"; then pass "rules.yml is valid ($(echo "$out" | grep -o '[0-9]* rules found'))"; else fail "promtool check rules: $(echo "$out" | tr '\n' ' ')"; finish; fi
for rule in instance:node_cpu_utilisation:rate5m instance:node_memory_utilisation:ratio; do
  grep -Eq "record: *$rule *$" "$dir/rules.yml" && pass "recording rule $rule exists" || fail "add the recording rule $rule"
done

if out="$(promtool test rules tests.yml)"; then pass "your own rule tests pass"; else fail "your rule tests fail: $(echo "$out" | head -n 8 | tr '\n' ' ')"; fi
untested=""
for alert in HostHighCpu HostMemoryPressure HostDiskWillFillIn4Hours HostDown; do
  grep -Eq "alertname: *$alert *$" "$dir/tests.yml" || untested="$untested $alert"
done
if [ -z "$untested" ]; then pass "tests.yml tests every alert"; else fail "tests.yml has no alert_rule_test for:$untested"; fi

# Hidden scenarios: each checks that an alert is firing (or not) with the right instance and severity.
scenario() { # <name> <series lines> <alert> <eval_time> <expected: "instance severity" or "none">
  local expr exp
  if ! grep -Eq "alert: *$3 *$" "$dir/rules.yml"; then fail "$1 (rules.yml has no alert named $3)"; return; fi
  expr="count by (instance, severity) (ALERTS{alertname=\"$3\", alertstate=\"firing\"})"
  if [ "$5" = "none" ]; then
    exp="      - expr: 'count(ALERTS{alertname=\"$3\", alertstate=\"firing\"}) or vector(0)'
        eval_time: $4
        exp_samples:
          - labels: '{}'
            value: 0"
  else
    set -- "$1" "$2" "$3" "$4" $5
    exp="      - expr: '$expr'
        eval_time: $4
        exp_samples:
          - labels: '{instance=\"$5\", severity=\"$6\"}'
            value: 1"
  fi
  cat > "$hidden/t.yml" <<EOF
rule_files: [/w/rules.yml]
evaluation_interval: 1m
tests:
  - interval: 1m
    input_series:
$2
    promql_expr_test:
$exp
EOF
  if out="$(promtool test rules /h/t.yml)"; then pass "$1"; else fail "$1 — $(echo "$out" | grep -E 'exp:|got:' | tr -s ' ' | tr '\n' ' ')"; fi
}
cpu() { echo "      - series: 'node_cpu_seconds_total{instance=\"web-1:9100\", job=\"node\", cpu=\"0\", mode=\"idle\"}'
        values: '$1'"; }
scenario "CPU 95% busy for 20 minutes: HostHighCpu fires (warning)" "$(cpu '0+3x30')" HostHighCpu 20m "web-1:9100 warning"
scenario "CPU 95% busy for only 5 minutes: HostHighCpu stays quiet" "$(cpu '0+3x30')" HostHighCpu 5m none
scenario "CPU 80% busy for 30 minutes: HostHighCpu stays quiet" "$(cpu '0+12x40')" HostHighCpu 30m none
mem() { echo "      - series: 'node_memory_MemTotal_bytes{instance=\"web-1:9100\", job=\"node\"}'
        values: '8000000000x30'
      - series: 'node_memory_MemAvailable_bytes{instance=\"web-1:9100\", job=\"node\"}'
        values: '$1x30'"; }
scenario "4% memory available for 15 minutes: HostMemoryPressure fires (warning)" "$(mem 320000000)" HostMemoryPressure 15m "web-1:9100 warning"
scenario "25% memory available: HostMemoryPressure stays quiet" "$(mem 2000000000)" HostMemoryPressure 15m none
disk() { echo "      - series: 'node_filesystem_avail_bytes{instance=\"db-1:9100\", job=\"node\", mountpoint=\"/data\", fstype=\"ext4\"}'
        values: '$1'"; }
scenario "a disk losing 6 GB an hour from 10 GB: HostDiskWillFillIn4Hours fires (critical)" "$(disk '10000000000-100000000x90')" HostDiskWillFillIn4Hours 75m "db-1:9100 critical"
scenario "a nearly full but stable disk (1 GB free, not shrinking): HostDiskWillFillIn4Hours stays quiet" "$(disk '1000000000x90')" HostDiskWillFillIn4Hours 75m none
scenario "a slowly filling disk (100 MB an hour, 50 GB free): HostDiskWillFillIn4Hours stays quiet" "$(disk '50000000000-1666666x90')" HostDiskWillFillIn4Hours 75m none
up() { echo "      - series: 'up{instance=\"web-1:9100\", job=\"node\"}'
        values: '$1'"; }
scenario "a host down for 5 minutes: HostDown fires (critical)" "$(up '1 1 0 0 0 0 0 0')" HostDown 7m "web-1:9100 critical"
scenario "one missed scrape: HostDown stays quiet" "$(up '1 1 0 1 1 1 1 1')" HostDown 7m none

if out="$(amtool check-config alertmanager.yml)"; then pass "alertmanager.yml is valid"; else fail "amtool check-config: $(echo "$out" | tr '\n' ' ')"; fi
route() { amtool config routes test --config.file=alertmanager.yml "$@" | tail -n 1; }
critical="$(route severity=critical alertname=HostDown instance=web-1:9100)"
warning="$(route severity=warning alertname=HostHighCpu instance=web-1:9100)"
if [ "$critical" = "oncall-pager" ] && [ "$warning" = "team-email" ]; then pass "critical alerts go to oncall-pager, warnings to team-email"; else fail "route critical alerts to oncall-pager and warnings to team-email (got: critical → ${critical:-?}, warning → ${warning:-?})"; fi
if grep -Eq 'source_matchers:.*alertname *= *"?HostDown' "$dir/alertmanager.yml" && grep -Eq 'equal:.*instance' "$dir/alertmanager.yml"; then
  pass "an inhibit rule silences a down host's other alerts (source HostDown, equal instance)"
else
  fail "add an inhibit rule: source_matchers alertname=\"HostDown\", equal: [instance]"
fi
finish
