---
id: grafana-dashboards-and-variables
title: Grafana dashboards and variables
track: prometheus-grafana
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [grafana-dashboards-from-files]
learning_objectives:
  - Add query variables to a provisioned dashboard, so one dashboard serves every route instead of one dashboard per route.
  - Find the values a variable offers by asking Prometheus through Grafana's data source proxy.
  - Explain how Grafana substitutes variables (single value, multi-value regex, All) into PromQL, and repeat a panel per value.
  - Link to a dashboard with variable values in the URL.
resources:
  - title: Variables (Grafana documentation)
    url: https://grafana.com/docs/grafana/latest/visualizations/dashboards/variables/
    publisher: Grafana Labs
    type: documentation
    level: intermediate
    official: true
    why: Query variables, and that variable values are synced to the URL as var-<name>=value.
    verification: { status: verified, checked_on: 2026-11-28 }
  - title: Provisioning Grafana
    url: https://grafana.com/docs/grafana/latest/administration/provisioning/
    publisher: Grafana Labs
    type: documentation
    level: intermediate
    official: true
    why: Dashboard providers from files (path, updateIntervalSeconds, allowUiUpdates), as in the previous lesson.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Prometheus HTTP API — label values
    url: https://prometheus.io/docs/prometheus/latest/querying/api/
    publisher: Prometheus
    type: reference
    level: intermediate
    official: true
    why: GET /api/v1/label/<name>/values with match[] selectors — what a label_values() variable asks Prometheus.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-variables
    prompt: A team has a dashboard per route — 40 near-identical dashboards. What do variables offer?
    options:
      - { id: a, text: "Nothing; copies are clearer" }
      - { id: b, text: "One dashboard with a route variable: the list fills itself from Prometheus, new routes appear automatically, and a fix to a panel fixes it for every route" }
      - { id: c, text: "Faster queries" }
    answer: b
    explanation: label_values(devforge_http_requests_total, route) asks Prometheus which routes exist; panels use $route.
  - id: multi
    prompt: A multi-value variable route has /api/tracks and /api/search selected. What does route=~"$route" become in the query?
    options:
      - { id: a, text: "route=~\"/api/tracks,/api/search\"" }
      - { id: b, text: "A regular expression matching either value, like route=~\"(/api/tracks|/api/search)\" — which is why multi-value variables need =~, not =" }
      - { id: c, text: "Two separate queries" }
    answer: b
    explanation: Grafana joins multiple values as a regex alternation (escaping special characters for Prometheus); with = the query would match nothing.
  - id: url
    prompt: How do you send a colleague the dashboard already filtered to /api/search?
    options:
      - { id: a, text: "A screenshot" }
      - { id: b, text: "The dashboard URL with var-route=/api/search — Grafana keeps variable values in the URL" }
      - { id: c, text: "Export the JSON" }
    answer: b
    explanation: Links from alerts and runbooks can use the same parameter to open the right view directly.
verification:
  method: executed
  details: Every command is run by the test suite with Prometheus 3.16.0 and Grafana 13.3.2 against a real DevForge server, after the earlier Prometheus and Grafana lessons, and its output is compared with this lesson. Variable substitution happens in the browser; the lab performs the same substitution and sends the query through Grafana's query API. Checked against the Grafana and Prometheus documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Variables** turn a dashboard into a template: a dropdown filled from Prometheus (`label_values(…)`) chooses the route, status or instance, Grafana substitutes the choice into every panel's query, and the choice lives in the URL so it can be shared.

## Explain it like I'm twelve

Instead of printing a separate timetable for every class, the school prints one timetable with a dial: turn it to "Class 7B" and every row shows 7B's lessons. The list of classes on the dial updates itself when a new class starts.

Where the analogy breaks: you can turn the dial to several classes at once — Grafana then shows them together, or repeats the panel for each.

## What problem it solves

Copy-pasted dashboards multiply: one per service, per route, per environment — and a fix to one never reaches the others. Variables keep one well-built dashboard that adapts to whatever exists right now, because the values come from the data itself.

## How it works

![](media:prometheus-grafana/variables.svg)

- A **query variable** runs `label_values(metric, label)` against the data source; Grafana asks Prometheus `GET /api/v1/label/<label>/values?match[]=<metric>`.
- Panels use `$route` in their queries. With **multi-value** selection or **All**, Grafana substitutes a regular expression (`(a|b)`), so queries use `=~`.
- `"repeat": "route"` repeats a panel once per selected value.
- Values are kept in the URL as `var-route=…`.

## Try it yourself

> **Local lab** — needs Prometheus and Grafana as in the previous lesson (with `GRAFANA_HOME` set), and the DevForge server at `$API`. Prometheus starts with a fresh data folder so the list of routes is predictable. Every command is run automatically in DevForge's tests.

### 1. Prometheus, and some traffic on several routes

```bash run
cd ..
mkdir -p grafana-vars-lab/provisioning/datasources grafana-vars-lab/provisioning/dashboards \
  grafana-vars-lab/provisioning/plugins grafana-vars-lab/provisioning/alerting grafana-vars-lab/dashboards
cd grafana-vars-lab
prometheus --config.file=../prometheus-lab/prometheus.yml --storage.tsdb.path=data-prometheus \
  --web.listen-address=127.0.0.1:9090 > prometheus.log 2>&1 &
echo $! > prometheus.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9090/-/ready && break; sleep 1; done
for path in /api/tracks /api/tracks/redis /api/tracks/docker /api/paths "/api/search?q=git"; do
  curl -s -o /dev/null "$API$path"
done
for i in $(seq 1 60); do [ -n "$(promtool query instant http://127.0.0.1:9090 'count(count by (route) (devforge_http_requests_total)) >= 5' 2> /dev/null)" ] && break; sleep 1; done
echo "Prometheus sees the routes"
```

```text output
Prometheus sees the routes
```

### 2. A dashboard with a variable

```bash run
cat > provisioning/datasources/prometheus.yml <<'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    uid: devforge-prometheus
    type: prometheus
    access: proxy
    url: http://127.0.0.1:9090
    isDefault: true
EOF
cat > provisioning/dashboards/devforge.yml <<EOF
apiVersion: 1
providers:
  - name: devforge
    type: file
    options:
      path: $PWD/dashboards
EOF
cat > dashboards/routes.json <<'EOF'
{
  "uid": "devforge-routes",
  "title": "DevForge routes",
  "time": { "from": "now-15m", "to": "now" },
  "templating": {
    "list": [
      {
        "name": "route",
        "label": "Route",
        "type": "query",
        "datasource": { "type": "prometheus", "uid": "devforge-prometheus" },
        "query": { "query": "label_values(devforge_http_requests_total, route)", "refId": "routes" },
        "refresh": 2,
        "multi": true,
        "includeAll": true,
        "current": { "text": "All", "value": "$__all" }
      }
    ]
  },
  "panels": [
    {
      "type": "timeseries",
      "title": "Requests per second: $route",
      "repeat": "route",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "devforge-prometheus" },
      "targets": [
        { "refId": "A", "expr": "sum by (status) (rate(devforge_http_requests_total{route=~\"$route\"}[1m]))", "legendFormat": "{{status}}" }
      ]
    }
  ]
}
EOF
GF_PATHS_PROVISIONING="$PWD/provisioning" GF_PATHS_DATA="$PWD/data" GF_PATHS_LOGS="$PWD/logs" \
GF_SERVER_HTTP_ADDR=127.0.0.1 GF_SERVER_HTTP_PORT=3000 GF_SECURITY_ADMIN_PASSWORD=devforge-lab-only \
  grafana server --homepath "$GRAFANA_HOME" > grafana.log 2>&1 &
echo $! > grafana.pid
for i in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:3000/api/health && break; sleep 1; done
G=http://127.0.0.1:3000; AUTH=admin:devforge-lab-only
for i in $(seq 1 30); do curl -sf -u "$AUTH" -o /dev/null "$G/api/dashboards/uid/devforge-routes" && break; sleep 1; done
curl -s -u "$AUTH" "$G/api/dashboards/uid/devforge-routes" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const d = JSON.parse(s).dashboard;
    for (const v of d.templating.list) console.log(`variable ${v.name}: ${v.query.query} (multi: ${v.multi}, All: ${v.includeAll})`);
    for (const p of d.panels) console.log(`panel "${p.title}" repeats for each ${p.repeat}`);
  });'
```

```text output
variable route: label_values(devforge_http_requests_total, route) (multi: true, All: true)
panel "Requests per second: $route" repeats for each route
```

### 3. The values the dropdown will offer

`label_values` makes Grafana ask Prometheus for the label's values. Ask the same question through Grafana's data source proxy:

```bash run
curl -sg -u "$AUTH" "$G/api/datasources/proxy/uid/devforge-prometheus/api/v1/label/route/values?match[]=devforge_http_requests_total" \
  | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).data.join("\n")));'
```

```text output
/api/paths
/api/search
/api/tracks
/api/tracks/:slug
/metrics
```

Every route that has served a request appears — including `/metrics`, which Prometheus itself scrapes. When the API gains a route, the dropdown gains it too, with no dashboard change. `/api/tracks/redis` and `/api/tracks/docker` appear once, as the pattern `/api/tracks/:slug` — the low-cardinality label design from the earlier lessons.

### 4. What a panel actually queries

The browser substitutes the variable before sending the query. Do the same for two selections and send them through Grafana's query API:

```bash run
panel_query() {   # $1: the value Grafana substitutes for $route
  local expr="count(devforge_http_requests_total{route=~\"$1\"})"
  echo "route=~\"$1\""
  curl -s -u "$AUTH" -H 'Content-Type: application/json' -X POST "$G/api/ds/query" \
    -d "{\"from\":\"now-5m\",\"to\":\"now\",\"queries\":[{\"refId\":\"A\",\"datasource\":{\"uid\":\"devforge-prometheus\"},\"expr\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$expr"),\"instant\":true}]}" \
    | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const f = JSON.parse(s).results.A.frames[0]; console.log(`  -> ${f.data.values[1][0]} series`); });'
}
panel_query '/api/tracks/:slug'
panel_query '(/api/tracks|/api/search)'
echo "share it: $G/d/devforge-routes?var-route=/api/search&var-route=/api/tracks"
```

```text output
route=~"/api/tracks/:slug"
  -> 2 series
route=~"(/api/tracks|/api/search)"
  -> 2 series
share it: http://127.0.0.1:3000/d/devforge-routes?var-route=/api/search&var-route=/api/tracks
```

- One value becomes a plain match; two selected values become a regex alternation — that is why the panel uses `=~`.
- Each answer counts series, one per status code: `/api/tracks/:slug` has two because the server also counted the deliberate `404`s from the PromQL lesson.
- The URL carries the selection, so a link in an alert or a runbook opens the dashboard already filtered.

### 5. Stop everything

```bash run
kill "$(cat grafana.pid)" "$(cat prometheus.pid)"
```

## Common mistakes

- **`=` with a multi-value variable.** It matches the literal regex text; use `=~`.
- **Variables over high-cardinality labels** (user IDs, request IDs). The dropdown and every repeated panel explode; such labels should not exist (next lessons).
- **A variable per dashboard copy.** Put shared variables (environment, cluster) in every dashboard the same way, so links between dashboards keep the selection.
- **Refresh "never".** The list goes stale; refresh on dashboard load or time-range change.
- **Hard-coded data source UIDs in shared dashboards.** Use a data source variable when dashboards are reused across environments.

## Where this fits in a real system

Teams keep dashboards as JSON files in **Git**, provisioned like this or through Grafana's API from **GitHub Actions**; variables cover environment, cluster (**Kubernetes**), service and route. **OpenTelemetry** resource attributes become the labels those variables use, and alert notifications (next lesson) link to dashboards with `var-…` parameters.
