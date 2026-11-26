---
id: prometheus-slos-and-error-budgets
title: SLIs, SLOs and error budgets
track: prometheus-grafana
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [prometheus-scraping-and-promql]
learning_objectives:
  - Define an SLI as a ratio of good events, choose an SLO, and turn it into an error budget in minutes.
  - Write recording rules for the error ratio over several windows, and burn-rate alerts with the multiwindow pattern from Google's SRE workbook.
  - Prove alerting rules with promtool test rules — an outage pages, a healthy day stays quiet, a slow leak is still caught.
  - Explain why alerting on burn rate beats alerting on a fixed error percentage.
resources:
  - title: Alerting on SLOs (The Site Reliability Workbook)
    url: https://sre.google/workbook/alerting-on-slos/
    publisher: Google
    type: reference
    level: advanced
    official: true
    why: Burn rate defined, and the recommended multiwindow alerts — 2% of the budget in 1 hour (burn rate 14.4), 5% in 6 hours (burn rate 6), 10% in 3 days (burn rate 1).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Unit testing for rules
    url: https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/
    publisher: Prometheus
    type: documentation
    level: advanced
    official: true
    why: promtool test rules with input_series, alert_rule_test and promql_expr_test.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Recording rules — naming and aggregation
    url: https://prometheus.io/docs/practices/rules/
    publisher: Prometheus
    type: documentation
    level: intermediate
    official: true
    why: Recording rules should be named level:metric:operations, as the lab's job:slo_errors_per_request:ratio_rate1h is.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: budget
    prompt: A service has an SLO of 99.9% successful requests over 30 days. How much failure does that allow?
    options:
      - { id: a, text: "None — 99.9% means aim for perfect" }
      - { id: b, text: "0.1% of requests — if spread evenly, the equivalent of about 43 minutes of total outage in 30 days. That is the error budget" }
      - { id: c, text: "9 hours" }
    answer: b
    explanation: 30 × 24 × 60 × 0.001 = 43.2 minutes. The budget can be spent on deployments, experiments and incidents; when it runs out, reliability work comes first.
  - id: burn
    prompt: The error ratio over the last hour is 2%, and the SLO allows 0.1%. What is the burn rate, and what does it mean?
    options:
      - { id: a, text: "2 — twice as fast" }
      - { id: b, text: "20 — at this pace the 30-day budget is gone in a day and a half, so it pages" }
      - { id: c, text: "0.02 — no problem" }
    answer: b
    explanation: Burn rate = error ratio ÷ budgeted ratio = 0.02 ÷ 0.001 = 20, above the 14.4 threshold that means 2% of the monthly budget is spent within the hour.
  - id: two-windows
    prompt: Why does each burn-rate alert check two windows, such as 1 hour and 5 minutes?
    options:
      - { id: a, text: "To make the query slower" }
      - { id: b, text: "The long window shows enough budget is really being spent; the short window shows it is still happening — so the alert stops soon after the problem is fixed" }
      - { id: c, text: "Prometheus requires two windows" }
    answer: b
    explanation: That is the multiwindow, multi-burn-rate approach from the SRE workbook.
verification:
  method: executed
  details: Every command is run by the test suite with promtool from Prometheus 3.16.0, after the earlier Prometheus lessons, and its output is compared with this lesson. The alerting rules are evaluated by promtool test rules against synthetic series, so the results do not depend on timing. Thresholds follow Google's SRE workbook; rule syntax was checked against the Prometheus documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Decide how reliable a service must be (**SLO**), measure it as a ratio of good to total events (**SLI**), treat the allowed failures as a **budget** — and page people when the budget is being spent too fast (**burn rate**), not whenever one error appears.

## Explain it like I'm twelve

A school promises that the canteen serves lunch on time on at least 999 of every 1,000 days (the SLO). That leaves room for one late lunch in about three years (the budget). Nobody panics about one late lunch — but if lunch was late three days in a row this week, the budget would be gone by the end of the month, so someone should act *now* (burn rate).

Where the analogy breaks: services count requests, not days, and the maths runs every minute.

## What problem it solves

Alerting on "any error" wakes people for blips; alerting on "error rate above 1%" either misses slow leaks or fires too late. And without an agreed target, teams argue endlessly about whether a service is "reliable enough". SLOs make reliability a number everyone agrees on; error budgets turn it into a decision rule (ship features or fix reliability); burn-rate alerts page only when the target is genuinely at risk.

## How it works

![](media:prometheus-grafana/error-budget.svg)

- **SLI**: good events ÷ all events — here, the fraction of requests that did *not* fail. The error ratio is `rate(errors) / rate(requests)` over a window.
- **SLO**: a target for the SLI over a period, such as 99.9% over 30 days. **Error budget**: 1 − SLO = 0.1% of requests.
- **Burn rate**: error ratio ÷ budget. Burn rate 1 spends exactly the budget in 30 days; 14.4 spends 2% of it in one hour.
- **Multiwindow alerts** (SRE workbook): page when the 1-hour ratio and the 5-minute ratio both exceed 14.4 × budget; also page on 6 hours and 30 minutes above 6 × budget.
- **Recording rules** precompute the ratios, so alerts stay cheap and readable.

## Try it yourself

> **Local lab** — needs promtool (installed with Prometheus in the earlier lessons). No server runs: promtool evaluates the rules against synthetic time series, so the results are exact. Every command is run automatically in DevForge's tests.

### 1. Error budgets in minutes

```bash run
mkdir -p slo-lab && cd slo-lab
for slo in 99 99.9 99.99; do
  awk -v slo="$slo" 'BEGIN { printf "SLO %-6s -> budget %.2f%% of requests, about %.1f minutes of full outage per 30 days\n", slo"%", 100 - slo, 30 * 24 * 60 * (100 - slo) / 100 }'
done
```

```text output
SLO 99%    -> budget 1.00% of requests, about 432.0 minutes of full outage per 30 days
SLO 99.9%  -> budget 0.10% of requests, about 43.2 minutes of full outage per 30 days
SLO 99.99% -> budget 0.01% of requests, about 4.3 minutes of full outage per 30 days
```

Each extra nine divides the budget by ten. Pick the SLO users actually need — 99.99% leaves four minutes a month for every deployment, incident and dependency failure.

### 2. Recording rules and burn-rate alerts

```bash run
cat > slo-rules.yml <<'EOF'
groups:
  - name: course-site-slo
    rules:
      # SLI windows: the fraction of requests that failed (5xx).
      - record: job:slo_errors_per_request:ratio_rate5m
        expr: sum by (job) (rate(http_requests_total{code=~"5.."}[5m])) / sum by (job) (rate(http_requests_total[5m]))
      - record: job:slo_errors_per_request:ratio_rate30m
        expr: sum by (job) (rate(http_requests_total{code=~"5.."}[30m])) / sum by (job) (rate(http_requests_total[30m]))
      - record: job:slo_errors_per_request:ratio_rate1h
        expr: sum by (job) (rate(http_requests_total{code=~"5.."}[1h])) / sum by (job) (rate(http_requests_total[1h]))
      - record: job:slo_errors_per_request:ratio_rate6h
        expr: sum by (job) (rate(http_requests_total{code=~"5.."}[6h])) / sum by (job) (rate(http_requests_total[6h]))
      # SLO 99.9%: the error budget is 0.001. Thresholds from the SRE workbook.
      - alert: ErrorBudgetFastBurn
        expr: job:slo_errors_per_request:ratio_rate1h > (14.4 * 0.001) and job:slo_errors_per_request:ratio_rate5m > (14.4 * 0.001)
        labels: { severity: page }
        annotations: { summary: "{{ $labels.job }} is burning its error budget 14.4x too fast" }
      - alert: ErrorBudgetSlowBurn
        expr: job:slo_errors_per_request:ratio_rate6h > (6 * 0.001) and job:slo_errors_per_request:ratio_rate30m > (6 * 0.001)
        labels: { severity: page }
        annotations: { summary: "{{ $labels.job }} is burning its error budget 6x too fast" }
EOF
promtool check rules slo-rules.yml
```

```text output
Checking slo-rules.yml
  SUCCESS: 6 rules found

```

Four recording rules compute the error ratio over 5 minutes, 30 minutes, 1 hour and 6 hours; two alerts combine a long and a short window each.

### 3. Prove the alerts with three scenarios

```bash run
cat > slo-tests.yml <<'EOF'
rule_files: [slo-rules.yml]
evaluation_interval: 1m
tests:
  - name: an outage, 2% of requests fail
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="course-site", code="200"}'
        values: '0+980x120'          # 980 good requests a minute, for two hours
      - series: 'http_requests_total{job="course-site", code="500"}'
        values: '0+20x120'           # and 20 failures a minute
    promql_expr_test:
      - expr: round(job:slo_errors_per_request:ratio_rate1h / 0.001)   # the burn rate (rounded: floating point)
        eval_time: 1h
        exp_samples:
          - labels: '{job="course-site"}'
            value: 20
    alert_rule_test:
      - alertname: ErrorBudgetFastBurn
        eval_time: 1h
        exp_alerts:
          - exp_labels: { severity: page, job: course-site }
            exp_annotations: { summary: "course-site is burning its error budget 14.4x too fast" }
  - name: a healthy day, 0.05% of requests fail
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="course-site", code="200"}'
        values: '0+9995x400'
      - series: 'http_requests_total{job="course-site", code="500"}'
        values: '0+5x400'
    alert_rule_test:
      - alertname: ErrorBudgetFastBurn
        eval_time: 6h
        exp_alerts: []
      - alertname: ErrorBudgetSlowBurn
        eval_time: 6h
        exp_alerts: []
  - name: a slow leak, 0.8% of requests fail for hours
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="course-site", code="200"}'
        values: '0+992x400'
      - series: 'http_requests_total{job="course-site", code="500"}'
        values: '0+8x400'
    alert_rule_test:
      - alertname: ErrorBudgetFastBurn
        eval_time: 6h
        exp_alerts: []
      - alertname: ErrorBudgetSlowBurn
        eval_time: 6h
        exp_alerts:
          - exp_labels: { severity: page, job: course-site }
            exp_annotations: { summary: "course-site is burning its error budget 6x too fast" }
EOF
promtool test rules slo-tests.yml
```

```text output
Processing test file: slo-tests.yml
  SUCCESS
```

All three scenarios behave as designed:

- **Outage** (2% errors): burn rate 20, above 14.4 — the fast-burn alert pages within the hour.
- **Healthy day** (0.05%): burn rate 0.5 — the budget would last two months; nothing fires, even though errors happen.
- **Slow leak** (0.8%): burn rate 8 — too slow for the fast-burn alert, but the 6-hour alert catches it before a third of the monthly budget is gone.

### 4. A test that catches a wrong rule

Someone "simplifies" the fast-burn alert to fire only above 5% errors:

```bash run
sed 's/job:slo_errors_per_request:ratio_rate1h > (14.4 \* 0.001)/job:slo_errors_per_request:ratio_rate1h > 0.05/' slo-rules.yml > slo-rules-broken.yml
sed 's/slo-rules.yml/slo-rules-broken.yml/' slo-tests.yml > slo-tests-broken.yml
promtool test rules slo-tests-broken.yml > broken.txt 2>&1 || echo "promtool exit code: $?"
grep -E 'FAILED|alertname: ErrorBudgetFastBurn' broken.txt | head -n 2
```

```text output
promtool exit code: 1
  FAILED:
    alertname: ErrorBudgetFastBurn, time: 1h,
```

The outage scenario no longer pages, and the test says so before the change reaches production — test alerting rules in CI like any other code.

## Common mistakes

- **SLOs on things users do not feel.** Measure success as users see it (requests, page loads, jobs completed), not CPU.
- **100% as the target.** It leaves no room for change and is impossible anyway; your dependencies are not 100% either.
- **Alerting on a fixed error rate.** It is either noisy or slow; burn rate ties alerts to the budget.
- **One window only.** A long window alone keeps firing long after a fix; a short one alone is noisy.
- **Untested alert rules.** A typo can silence an alert for months; `promtool test rules` belongs in CI.

## Where this fits in a real system

The recording rules feed **Grafana** dashboards showing budget remaining; burn-rate alerts go through Alertmanager (previous lesson) to on-call people; teams use the remaining budget to decide whether to release, as **GitHub Actions** and **Kubernetes** rollouts can be paused when it runs out. **OpenTelemetry** traces then explain *why* requests failed.
