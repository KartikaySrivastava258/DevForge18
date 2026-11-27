---
id: prometheus-trigger-an-alert
title: Trigger and investigate an alert
track: prometheus-grafana
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [prometheus-scraping-and-promql]
objectives:
  - Write an alerting rule with a threshold and a for duration, and check it with promtool.
  - Unit-test the rule against made-up series before it ever runs, including the case where it must stay quiet.
  - Trigger the alert against a real service, watch it go from pending to firing to resolved, and find the cause by label.
checkpoints:
  - { id: unit-tested, text: "promtool test rules passed for both the noisy and the quiet case" }
  - { id: lifecycle, text: "I saw the alert pending, then firing, then gone after the traffic stopped" }
  - { id: cause, text: "The investigation query pointed to the /api/tracks/:slug route" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Alerting rules
    url: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
    publisher: Prometheus documentation
    type: documentation
    level: intermediate
    official: true
    why: The alert, expr, for, labels and annotations fields, and the pending and firing states.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Unit testing for rules
    url: https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/
    publisher: Prometheus documentation
    type: documentation
    level: advanced
    official: true
    why: The test file format for promtool test rules — input series, eval times and expected alerts.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Prometheus 3.16.0 scraping a real DevForge server, after the previous lessons, and their output is compared with this page. How long the alert takes to change state varies by a few seconds, so the lab shows the states, not the times. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

A dashboard only helps when someone is looking. An **alert** looks for you. You write a rule that fires when DevForge answers too many requests with `404`, prove with unit tests that it fires when it should — and stays quiet when it should — then cause a real burst of 404s, watch the alert's life cycle, and trace the cause to one route.

## Before you start

Continue from *Scraping and PromQL*: Prometheus running from the `prometheus-lab` folder (its process ID in `prometheus.pid`), DevForge running with `API` set, and the `wait_for` helper defined. This lab only shows alerts in Prometheus; sending them to people (by email or chat) is the job of Alertmanager, which is not set up here.

## Steps

### 1. An alerting rule

```bash run
cat > rules.yml <<'EOF'
groups:
  - name: devforge
    rules:
      - alert: HighNotFoundRate
        expr: sum(rate(devforge_http_requests_total{status="404"}[30s])) > 0.5
        for: 10s
        labels:
          severity: warning
        annotations:
          summary: "More than 0.5 requests per second are answered 404"
EOF
promtool check rules rules.yml
```

```text output
Checking rules.yml
  SUCCESS: 1 rules found
```

- **expr** is a PromQL condition: the rate of `404` answers over the last 30 seconds, summed over every route, above 0.5 per second. While it returns a value, the alert is **pending**.
- **for: 10s** — the condition must hold for 10 seconds before the alert is **firing**. One unlucky scrape does not wake anyone up. Real rules typically use minutes; seconds keep this lab short.
- **labels** are added to the alert (and used later to route it); **annotations** are the human-readable text.

### 2. Unit-test the rule before it runs

`promtool test rules` feeds the rule made-up series and checks which alerts would be active at given times — no running Prometheus, no waiting.

```bash run
cat > tests.yml <<'EOF'
rule_files: [rules.yml]
evaluation_interval: 5s
tests:
  # A noisy minute: one 404 per second (5 more every 5 seconds).
  - interval: 5s
    input_series:
      - series: 'devforge_http_requests_total{route="/api/tracks/:slug", status="404"}'
        values: '0+5x24'
    alert_rule_test:
      - eval_time: 10s
        alertname: HighNotFoundRate
        exp_alerts: []
      - eval_time: 1m
        alertname: HighNotFoundRate
        exp_alerts:
          - exp_labels:
              severity: warning
            exp_annotations:
              summary: "More than 0.5 requests per second are answered 404"
  # A quiet minute: one 404 every 5 seconds is 0.2 per second, under the threshold.
  - interval: 5s
    input_series:
      - series: 'devforge_http_requests_total{route="/api/tracks/:slug", status="404"}'
        values: '0+1x24'
    alert_rule_test:
      - eval_time: 1m
        alertname: HighNotFoundRate
        exp_alerts: []
EOF
promtool test rules tests.yml
```

```text output
Processing test file: tests.yml
  SUCCESS
```

- `'0+5x24'` means: start at 0, add 5 at every step, 24 times — a counter rising by one per second.
- At **10 seconds**, nothing is firing yet: the `for: 10s` clock has only just started. At **1 minute**, the alert fires with the expected labels and text.
- The **quiet** case matters as much: a rule that fires on normal traffic gets ignored, and then it is useless.

### 3. Load the rule into the running Prometheus

```bash run
cat > prometheus.yml <<EOF
global:
  scrape_interval: 5s
  evaluation_interval: 5s
rule_files: [rules.yml]
scrape_configs:
  - job_name: devforge
    static_configs:
      - targets: ["${API#http://}"]
EOF
promtool check config prometheus.yml | grep 'prometheus.yml is valid'
kill -HUP "$(cat prometheus.pid)"
for i in $(seq 1 30); do curl -s http://127.0.0.1:9090/api/v1/rules | grep '"health":"ok"' > /dev/null && break; sleep 1; done
curl -s http://127.0.0.1:9090/api/v1/rules | grep -o '"name":"HighNotFoundRate"\|"health":"[a-z]*"' | head -n 2
```

```text output
 SUCCESS: prometheus.yml is valid prometheus config file syntax
"name":"HighNotFoundRate"
"health":"ok"
```

- `evaluation_interval: 5s` — how often Prometheus evaluates rules. `rule_files` names the rule file.
- The rules API lists the loaded rule; `"health":"ok"` means its last evaluation worked.
- `kill -HUP` asks the running Prometheus to **reload** its configuration without restarting (and without losing the data it has collected).

### 4. Cause a burst of 404s and watch the alert

```bash run
( end=$((SECONDS + 45)); while [ $SECONDS -lt $end ]; do curl -s -o /dev/null "$API/api/tracks/no-such-track"; sleep 0.2; done ) &
traffic=$!
alert_state() { curl -s http://127.0.0.1:9090/api/v1/alerts | grep -o '"state":"[a-z]*"' | head -n 1 | cut -d'"' -f4 || true; }
last=inactive
for i in $(seq 1 90); do
  now=$(alert_state); now=${now:-inactive}
  [ "$now" != "$last" ] && echo "alert is now: $now" && last=$now
  [ "$now" = firing ] && break
  sleep 1
done
```

```text output
alert is now: pending
alert is now: firing
```

About five requests a second are answered `404`. Once a scrape shows the rate above 0.5, the alert becomes **pending**; after 10 more seconds of the same, **firing**. Open <http://localhost:9090/alerts> to see it in the web interface.

### 5. Investigate: which route?

The alert summed over every route. To find the cause, take the sum apart by label:

```bash run
promtool query instant http://127.0.0.1:9090 'sum by (route) (rate(devforge_http_requests_total{status="404"}[30s])) > 0'
```

```text output
{route="/api/tracks/:slug"} => … @[…]
```

All the 404s come from the track route — someone (here, your loop) asks for a track that does not exist. In a real incident, the next questions would be *which client* and *since when*; good labels and logs answer them.

### 6. The traffic stops; the alert resolves

```bash run
wait "$traffic"
for i in $(seq 1 90); do [ -z "$(alert_state)" ] && break; sleep 1; done
[ -z "$(alert_state)" ] && echo "alert is now: inactive" || echo "alert is still active"
```

```text output
alert is now: inactive
```

When the 30-second rate falls back under the threshold, the alert stops being active — no one has to switch it off. If Alertmanager were set up, it could send a "resolved" notification at this point.

## Check your work

Run this inside `prometheus-lab` while Prometheus is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "rules.yml is valid and defines HighNotFoundRate" 'promtool check rules rules.yml && grep -q "alert: HighNotFoundRate" rules.yml'
check "the rule has a for duration" 'grep -qE "^ +for: " rules.yml'
check "the unit tests pass" 'promtool test rules tests.yml'
check "the tests include a case where the alert must stay quiet" 'grep -q "exp_alerts: \[\]" tests.yml'
check "the running Prometheus has loaded the rule" 'curl -s http://127.0.0.1:9090/api/v1/rules | grep "\"name\":\"HighNotFoundRate\"" > /dev/null'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: rules.yml is valid and defines HighNotFoundRate
PASS: the rule has a for duration
PASS: the unit tests pass
PASS: the tests include a case where the alert must stay quiet
PASS: the running Prometheus has loaded the rule
All checks passed
```

## Clean up

```bash run
kill "$(cat prometheus.pid)"
```

## Reset

Stop Prometheus (as above), delete `rules.yml` and `tests.yml`, start Prometheus again with step 2 of *Scraping and PromQL*, then begin this lab at step 1.

## What you practised

An alert is a PromQL condition plus a duration. Unit tests with `promtool` let you prove a rule's behaviour — firing and staying quiet — before it runs; a live trigger shows its life cycle from pending to firing to resolved; and breaking the sum apart by label turns "something is wrong" into "this route is wrong".
