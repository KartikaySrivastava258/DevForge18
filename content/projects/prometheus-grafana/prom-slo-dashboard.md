---
id: prom-slo-dashboard
track: prometheus-grafana
title: SLO dashboard for a sample API
level: advanced
estimated_hours: 8
prerequisites: [prometheus-slos-and-error-budgets, prometheus-metric-types-done-right, grafana-dashboards-and-variables]
related_tracks: [opentelemetry]
user_stories:
  - As a product owner, I want to see how much of this month's error budget is left so that I can decide whether to ship features or invest in reliability.
  - As an on-call engineer, I want to be paged only when the budget is burning fast enough to matter so that slow, small problems become tickets instead of night calls.
  - As a developer, I want latency to count against an SLO too so that a slow API is treated as seriously as a failing one.
acceptance_criteria:
  - rules.yml defines the availability and latency SLI recording rules for the 5m, 30m, 1h, 6h and 30d windows, and the two 30-day budget-remaining rules.
  - A burn rate above 14.4 over both 1 h and 5 m pages (AvailabilityFastBurn, LatencyFastBurn); above 6 over both 6 h and 30 m opens a ticket (AvailabilitySlowBurn, LatencySlowBurn).
  - An outage that has already ended does not page (the short window has recovered), and burn rates of 4 or below raise nothing.
  - With 0.25% errors against a 0.5% budget, the availability budget remaining is 0.5.
  - tests.yml passes promtool test rules and tests all four alerts.
  - dashboard.json shows both budgets, both burn rates and an SLI; every query is valid PromQL built on the recording rules.
rubric:
  - { criterion: "SLO design", excellent: "SLIs measure what users feel (failed and slow requests at the API's edge), targets are justified, and the README explains what happens when the budget is spent.", good: "Both SLOs implemented as specified.", needs_work: "SLIs on CPU or other causes instead of user-facing symptoms." }
  - { criterion: "Alerting", excellent: "Multiwindow burn-rate alerts for both SLOs with page versus ticket severities, tested on edge cases (just under each threshold, an outage that ended), with runbook links in annotations.", good: "All four alerts work and are tested.", needs_work: "Threshold alerts on raw error ratios, or single-window alerts that keep paging after recovery." }
  - { criterion: "Dashboard", excellent: "Budget left and burn rates are the first things you see, with thresholds drawn at 14.4 and 6, consistent with the alerts because they read the same recording rules.", good: "The required panels are present and correct.", needs_work: "Panels compute their own ratios that disagree with the alerts." }
  - { criterion: "Correctness of PromQL", excellent: "Ratios divide sums of rates, the latency SLI uses the le=\"0.5\" bucket against _count, and floating-point comparisons in tests are rounded.", good: "Correct expressions.", needs_work: "Averages of ratios, or percentiles used as an SLI without a bucket boundary." }
hints:
  - Start from the lesson "SLIs, SLOs and error budgets" — it builds the availability half. The latency SLI is the same idea with a different "bad event", a request slower than 500 ms; 1 − bucket{le="0.5"} ÷ count is the share of slow requests.
  - Burn rate = error ratio ÷ budget. 14.4 over an hour spends 2% of a 30-day budget (14.4 ÷ 720 hours); 6 over six hours spends 5%.
  - The second, short window in each alert is what stops a page after an outage has ended. Write a test where the outage stops 30 minutes before eval_time.
  - Budget remaining = 1 − (30-day error ratio ÷ budget). In a test with two days of data, the 30-day rate uses the data that exists.
  - promtool unit tests can query ALERTS{alertname=…, alertstate="firing"} in promql_expr_test — useful when you only care which labels fired.
stretch_goals:
  - Load the rules and the dashboard into a running Prometheus and Grafana (see "Grafana — a data source and a dashboard from files") and drive traffic with the app from the beginner project.
  - Add a per-route latency SLO for /results with a stricter target, and explain why routes can deserve different objectives.
  - Write an error-budget policy (half a page) that says what the team does at 50%, 25% and 0% budget left.
starter: starter
solution: solution
check_needs: [docker, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The campus API has agreed two service-level objectives for a rolling 30 days: **99.5% of requests succeed** and
**99% of requests finish in 500 ms or less**. The team's first attempt at alerting has one window, one SLI and
pages on any error ratio above 1% — so it pages for small blips, keeps paging after an outage has ended, and
ignores slowness entirely. There is no way to see how much error budget is left.

Build the SLO monitoring properly: recording rules for both SLIs over five windows, the error budget remaining,
multiwindow multi-burn-rate alerts with page and ticket severities, tests that prove them, and a dashboard that
reads the same recording rules so the graphs and the alerts never disagree.

The check runs your tests and then hidden scenarios — a bad deploy, a slow leak, an outage that already ended,
healthy days with some errors — plus the budget arithmetic, and verifies every dashboard query with promtool.

## Getting started

1. Copy the starter folder and read its README (the specification: names, windows, thresholds, labels).
2. Use promtool from the official image, as in the earlier projects:

   ```bash
   alias promtool='docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" -w /w --entrypoint promtool prom/prometheus:v3.16.0'
   promtool check rules rules.yml && promtool test rules tests.yml
   ```

3. Build the recording rules, then the alerts, then a test for each alert including one that must stay quiet.
4. Write the dashboard last, using only the recording rules.
5. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
