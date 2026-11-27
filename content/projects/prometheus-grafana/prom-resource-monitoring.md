---
id: prom-resource-monitoring
track: prometheus-grafana
title: Resource monitoring lab
level: intermediate
estimated_hours: 6
prerequisites: [prometheus-scraping-and-promql, prometheus-alerting-and-alertmanager, prometheus-slos-and-error-budgets]
related_tracks: []
user_stories:
  - As an on-call technician for the college's lab servers, I want to be paged only for problems that need action now so that I still trust the pager at 3 a.m.
  - As a lab administrator, I want a warning hours before a disk fills up so that I can clean up or extend it before students lose work.
  - As a team lead, I want alert rules tested like code so that a "small tweak" cannot silently stop an alert from firing.
acceptance_criteria:
  - rules.yml passes promtool check rules and defines the recording rules instance:node_cpu_utilisation:rate5m and instance:node_memory_utilisation:ratio.
  - HostHighCpu fires (warning) only after CPU is above 90% for 10 minutes; a 5-minute spike or 80% load does not fire it.
  - HostMemoryPressure fires (warning) when less than 10% of memory is available for 5 minutes, and not at 25% available.
  - HostDiskWillFillIn4Hours fires (critical) when the last hour's trend fills the filesystem within 4 hours, and stays quiet for a nearly full but stable disk or a slow fill.
  - HostDown fires (critical) after 2 minutes without a scrape, and not for one missed scrape.
  - tests.yml passes promtool test rules and tests every alert.
  - Alertmanager sends critical alerts to oncall-pager and warnings to team-email, and HostDown inhibits the other alerts of the same instance.
rubric:
  - { criterion: "Alert design", excellent: "Every alert is actionable and symptom-based where possible, with thresholds and durations justified in comments, and annotations that tell the responder what to check first.", good: "Alerts meet the specification and avoid flapping.", needs_work: "Alerts on every spike, or static thresholds that fire too late." }
  - { criterion: "Rule tests", excellent: "Each alert has a firing case, a not-firing edge case (just below the threshold or just short of the duration), and the tests read as documentation.", good: "Each alert is tested at least once.", needs_work: "Tests only prove the happy path, or none." }
  - { criterion: "Routing and noise", excellent: "Routing, grouping and inhibition are explained; repeat intervals differ by severity; a test of the routes is part of the workflow (amtool config routes test).", good: "Correct routes and an inhibit rule.", needs_work: "Everything goes to one receiver." }
  - { criterion: "PromQL", excellent: "Recording rules aggregate deliberately (by instance), alerts reuse them, and predict_linear is used with a window long enough to be stable.", good: "Correct expressions.", needs_work: "Copied expressions that mix up rates and counters." }
hints:
  - Start with the recording rules, then write each alert on top of them. A test with input_series of '0+3x30' for the idle counter means 3 idle seconds every 60-second minute — 95% busy.
  - 'An alert''s "for" duration is how it ignores short spikes. Test it: one evaluation before the duration ends must have no alert.'
  - predict_linear(series[1h], 4 * 3600) extrapolates one hour of history four hours ahead; below zero means "full by then".
  - amtool config routes test --config.file=alertmanager.yml severity=critical prints the receiver that alert would reach.
  - Inhibition needs source_matchers (the alert that wins), target_matchers (the alerts it silences) and equal (the labels that must match, here instance).
stretch_goals:
  - Run Prometheus and node_exporter for real (see "Scraping and PromQL") and load your rules into it.
  - Add an alert that predicts memory exhaustion, and decide in a comment whether it should page.
  - Send warnings only during working hours with Alertmanager's time intervals, and test it.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college's lab servers are monitored by Prometheus with node_exporter, and the alerts the team wrote are
making things worse: every CPU spike pages the on-call technician as critical, the disk alert fires only when a
disk is already almost full (and then forever on servers that are always nearly full), memory and unreachable
hosts are not covered at all, and every alert goes to the same mailbox.

Rewrite the rules so that each alert fires when — and only when — someone needs to act, prove that with
**rule unit tests**, and route the alerts so the right person hears about them. The README in the starter is the
specification: alert names, labels, thresholds, durations and receivers.

This is how alerting is done well in practice: alerts are code, tested like code, and every page is worth waking
up for.

## Getting started

1. Copy the starter folder. You need Docker; the check uses the official Prometheus 3.16.0 and Alertmanager
   0.34.2 images. To run the tools yourself the same way:

   ```bash
   alias promtool='docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/w" -w /w --entrypoint promtool prom/prometheus:v3.16.0'
   alias amtool='docker run --rm -v "$PWD:/w" -w /w --entrypoint amtool prom/alertmanager:v0.34.2'
   promtool check rules rules.yml
   promtool test rules tests.yml
   amtool config routes test --config.file=alertmanager.yml severity=critical
   ```

2. Rewrite `rules.yml` alert by alert, adding a firing and a not-firing test for each to `tests.yml`.
3. Fix the routing and add the inhibit rule in `alertmanager.yml`.
4. Run the check from the folder above your project:

   ```bash
   bash check.sh path/to/your/project
   ```

   Besides your own tests, it runs ten hidden scenarios against your rules — spikes, slow and fast disk fills,
   a missed scrape — and reports which alert fired or stayed quiet wrongly.
