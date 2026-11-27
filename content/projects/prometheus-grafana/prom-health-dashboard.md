---
id: prom-health-dashboard
track: prometheus-grafana
title: Application health dashboard
level: beginner
estimated_hours: 4
prerequisites: [prometheus-metrics-and-labels, prometheus-scraping-and-promql, grafana-dashboards-from-files]
related_tracks: [docker]
user_stories:
  - As a developer on call, I want one dashboard that shows whether the API is up, how busy it is, how many requests fail and how slow it is so that I can tell in a minute where to look.
  - As a team lead, I want the dashboard stored as a JSON file in the repository so that it is reviewed like code and can be recreated on any Grafana.
  - As a student learning Prometheus, I want every panel's query to be correct PromQL so that the graphs show real rates, not ever-growing counters.
acceptance_criteria:
  - prometheus.yml is valid and scrapes the app as job campus-api, at least every 15 seconds; up is 1.
  - dashboard.json has a uid, a title and at least 4 panels, and every panel query returns data from the running Prometheus.
  - A panel shows whether the API is up.
  - A panel shows requests per second (rate of http_requests_total), not the raw counter.
  - A panel shows the error ratio — 5xx requests divided by all requests.
  - A panel shows the 95th percentile latency from the histogram, with the unit set to seconds.
rubric:
  - { criterion: "Queries", excellent: "Rates use $__rate_interval, ratios divide sums of rates, the percentile aggregates by le (and route) before histogram_quantile, and each choice is explained in the panel description.", good: "All four signals are correct.", needs_work: "Raw counters, averages of percentiles, or ratios of counters." }
  - { criterion: "Readability", excellent: "Units on every panel, legends named after routes, the most important signal top-left, and a description that tells a newcomer what normal looks like.", good: "Clear titles and units.", needs_work: "Panels with default titles or no units." }
  - { criterion: "Configuration as code", excellent: "Dashboard and Prometheus config are in version control, provisioned into Grafana from files (see the lesson), and the uid stays stable across edits.", good: "The files work when loaded.", needs_work: "The dashboard exists only in someone's Grafana." }
hints:
  - Run app.py and look at http://localhost:8000/metrics first — the metric names and labels you need are all there.
  - A counter only goes up; rate(counter[1m]) turns it into "per second". Graphing the counter itself shows a line that always climbs.
  - "Error ratio: sum(rate(…{code=~\"5..\"}[…])) / sum(rate(…[…])). Divide sums, not individual series."
  - histogram_quantile(0.95, sum by (le) (rate(…_bucket[…]))) — keep le in the aggregation, or the quantile cannot be computed.
  - Inside Docker Compose or a Docker network, a service is reached by its name (app), not by localhost.
stretch_goals:
  - Provision the dashboard and a Prometheus data source into Grafana from files, as in "Grafana — a data source and a dashboard from files", and open it in a browser.
  - Add a variable for the route so the latency panel can be filtered.
  - Add a panel for the 99th percentile and explain why it is noisier than the 95th.
starter: starter
solution: solution
check_needs: [docker, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The campus API — timetable, results and library search — exports Prometheus metrics, but nobody looks at them
until students complain. Build the dashboard the on-call developer opens first: **is it up, how busy is it, how
many requests fail, how slow is it?** These four signals answer most "something is wrong" questions.

The starter includes `app.py`, a small stand-in that serves the API's real metric names with simulated traffic,
so everything runs on your machine. It also contains a first attempt that does not work: Prometheus scrapes the
wrong port once a minute, and the only panel graphs a raw counter.

The dashboard is a Grafana dashboard JSON file. The check does not start Grafana; it does something stricter —
it starts your app and Prometheus with your configuration, and runs every query in every panel against real
scraped data. A query that would show an empty or broken panel fails.

## Getting started

1. Copy the starter folder and look at the metrics: `python3 app.py`, then open http://localhost:8000/metrics.
2. Fix `prometheus.yml` and try it with Docker (the app and Prometheus on one network):

   ```bash
   docker network create health-lab
   docker run -d --name app --network health-lab -v "$PWD/app.py:/app.py:ro" python:3.12-slim python3 /app.py
   docker run -d --name prom --network health-lab -p 127.0.0.1:9090:9090 \
     -v "$PWD/prometheus.yml:/etc/prometheus/prometheus.yml:ro" prom/prometheus:v3.16.0
   ```

   Open http://localhost:9090, check Status → Targets, and try your queries in the query page.
3. Write the four panels in `dashboard.json` with the queries that worked.
4. Clean up (`docker rm -f app prom && docker network rm health-lab`) and run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
