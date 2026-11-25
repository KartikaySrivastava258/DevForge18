---
id: grafana-dashboards-from-files
title: Grafana — a data source and a dashboard from files
track: prometheus-grafana
order: 3
level: beginner
estimated_minutes: 40
prerequisites: [prometheus-scraping-and-promql]
learning_objectives:
  - Explain how Grafana, Prometheus and an application fit together.
  - Define a Grafana data source and a dashboard in files (provisioning) instead of clicking them together.
  - Check Grafana's health, its dashboards and its connection to Prometheus through the HTTP API.
resources:
  - title: Grafana download page
    url: https://grafana.com/grafana/download
    publisher: Grafana Labs
    type: reference
    level: beginner
    official: true
    why: Official Grafana downloads for Linux, macOS and Windows, including the standalone archives used here.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Provision Grafana
    url: https://grafana.com/docs/grafana/latest/administration/provisioning/
    publisher: Grafana Labs
    type: documentation
    level: intermediate
    official: true
    why: The full format of data source and dashboard provisioning files, and how Grafana picks up changes.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Configure Grafana
    url: https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/
    publisher: Grafana Labs
    type: reference
    level: intermediate
    official: true
    why: Every setting, and how GF_ environment variables override the configuration file.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Sign in to Grafana
    url: https://grafana.com/docs/grafana/latest/setup-grafana/sign-in-to-grafana/
    publisher: Grafana Labs
    type: documentation
    level: beginner
    official: true
    why: The default first login and why you should change the administrator password.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: where-data-lives
    prompt: You stop Prometheus but leave Grafana running. What happens to the dashboard?
    options:
      - { id: a, text: "It keeps working, because Grafana stores a copy of the metrics" }
      - { id: b, text: "Its panels show errors or no data, because Grafana only queries the data source; it does not store metrics itself" }
      - { id: c, text: "Grafana starts scraping DevForge itself" }
    answer: b
    explanation: Grafana is a visualisation layer. Every panel sends its query to the data source when it is displayed. Without Prometheus there is nothing to query, so the dashboard definition is still there but its panels have no data.
  - id: why-provisioning
    prompt: Why define the dashboard in a JSON file in Git instead of building it by clicking in the browser?
    options:
      - { id: a, text: "Clicked dashboards cannot show Prometheus data" }
      - { id: b, text: "Files can be reviewed, versioned and recreated identically on another Grafana, for example after a reinstall or in a second environment" }
      - { id: c, text: "Provisioned dashboards load faster" }
    answer: b
    explanation: Provisioning treats dashboards as code. A dashboard built by hand lives only in that Grafana's database; a file can be reviewed in a pull request and applied to every Grafana the same way.
  - id: unauthorised
    prompt: curl http://127.0.0.1:3000/api/search returns 401. What is the most likely reason?
    options:
      - { id: a, text: "Grafana is not running" }
      - { id: b, text: "The request had no credentials, and Grafana requires a signed-in user for its API" }
      - { id: c, text: "No dashboards exist" }
    answer: b
    explanation: 401 Unauthorized means the server answered but did not know who you were. If Grafana were not running, curl would fail to connect. With no dashboards, an authorised search returns an empty list, not 401.
verification:
  method: executed
  details: Every command is run by the test suite with Grafana 13.3.2 and Prometheus 3.16.0 (checksum-verified official archives) and a real DevForge server, after the previous lessons; the output shown was recorded from that run. Looking at the dashboard in a browser is not executed. Grafana facts were checked against the Grafana documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Grafana** draws dashboards: each panel sends a query to a **data source** such as Prometheus and turns the answer into a graph or a number, and you can describe both the data source and the dashboard in files so they are created the same way every time.

## Explain it like I'm twelve

Prometheus is a library full of notebooks of measurements. Grafana is the noticeboard in the hall: each poster on it asks the library one question ("how many requests per second?") and shows the answer as a picture. If the library closes, the posters stay on the board, but they can no longer show anything.

Where the analogy breaks: Grafana asks the question again every time someone looks, so the picture is always up to date.

## What problem it solves

PromQL answers are numbers in a terminal. People on call need to see trends at a glance and compare many services on one screen. Grafana gives them that. Defining the dashboards in files — *provisioning* — means they can be reviewed in pull requests, kept in Git next to the code, and rebuilt identically on another machine instead of being clicked together by hand.

## How it works

![](media:prometheus-grafana/grafana-provisioning.svg)

At startup Grafana reads its provisioning folder: YAML files that list data sources, and YAML files that point to folders of dashboard JSON. It creates or updates everything it finds. When you open the dashboard, each panel sends its PromQL query to Prometheus, which answers from the data it scraped from DevForge.

## Try it yourself

> **Local lab** — keep DevForge running (`npm start`) and Prometheus running from the previous lesson. Every command is run automatically in DevForge's tests with Grafana 13.3.2, after the previous lessons. Opening the dashboard in your browser is the one step that is not.

### 0. Install Grafana

Download the standalone archive for your system from the [Grafana download page](https://grafana.com/grafana/download) (version 13.3.2 here), unpack it, and tell your shell where it is. On Linux, for example:

```bash
curl -fsSLO https://dl.grafana.com/oss/release/grafana-13.3.2.linux-amd64.tar.gz
tar -xzf grafana-13.3.2.linux-amd64.tar.gz
export GRAFANA_HOME="$PWD/grafana-13.3.2"
export PATH="$GRAFANA_HOME/bin:$PATH"
```

`GRAFANA_HOME` is the unpacked folder; Grafana needs it to find its web pages and default settings.

```bash run
grafana --version
```

```text output
grafana version 13.3.2
```

### 1. Describe the data source in a file

The previous lesson left you inside `prometheus-lab`; go back up one level and make a folder for Grafana:

```bash run
cd ..
mkdir -p grafana-lab/provisioning/datasources grafana-lab/provisioning/dashboards \
  grafana-lab/provisioning/plugins grafana-lab/provisioning/alerting grafana-lab/dashboards
cd grafana-lab
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
```

- `type: prometheus` and `url` — what kind of data source, and where it is.
- `uid` — a fixed identifier, so dashboards can refer to this data source by name instead of an ID that changes between installations.
- `access: proxy` — Grafana's server sends the queries, not your browser.
- Grafana expects a few provisioning folders (`plugins`, `alerting`); creating them empty avoids error messages in its log.

### 2. Describe the dashboard in files

Two files: a *provider* that tells Grafana where dashboard JSON lives, and the dashboard itself. The provider needs an absolute path, so this heredoc is not quoted and `$PWD` is filled in:

```bash run
cat > provisioning/dashboards/devforge.yml <<EOF
apiVersion: 1
providers:
  - name: devforge
    type: file
    options:
      path: $PWD/dashboards
EOF
cat > dashboards/devforge.json <<'EOF'
{
  "uid": "devforge-overview",
  "title": "DevForge overview",
  "time": { "from": "now-15m", "to": "now" },
  "panels": [
    {
      "type": "timeseries",
      "title": "Requests per second by status",
      "gridPos": { "x": 0, "y": 0, "w": 16, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "devforge-prometheus" },
      "targets": [
        { "refId": "A", "expr": "sum by (status) (rate(devforge_http_requests_total[1m]))", "legendFormat": "{{status}}" }
      ]
    },
    {
      "type": "stat",
      "title": "95th percentile latency",
      "gridPos": { "x": 16, "y": 0, "w": 8, "h": 8 },
      "datasource": { "type": "prometheus", "uid": "devforge-prometheus" },
      "fieldConfig": { "defaults": { "unit": "s" } },
      "targets": [
        { "refId": "A", "expr": "histogram_quantile(0.95, sum by (le) (rate(devforge_http_request_duration_seconds_bucket[5m])))" }
      ]
    }
  ]
}
EOF
find provisioning dashboards -type f | sort
```

```text output
dashboards/devforge.json
provisioning/dashboards/devforge.yml
provisioning/datasources/prometheus.yml
```

Each panel has a `type` (a time series graph, a single big number), a position on a 24-column grid (`gridPos`), the data source by its `uid`, and one or more PromQL queries in `targets` — the same queries you ran in the previous lesson. `legendFormat` names each line after its `status` label; `"unit": "s"` shows the number as seconds.

### 3. Start Grafana

Grafana reads settings from a configuration file, and any setting can be overridden with an environment variable named `GF_<SECTION>_<KEY>`. Here they point Grafana at this folder and set the administrator password:

```bash run
GF_PATHS_PROVISIONING="$PWD/provisioning" GF_PATHS_DATA="$PWD/data" GF_PATHS_LOGS="$PWD/logs" \
GF_SERVER_HTTP_ADDR=127.0.0.1 GF_SERVER_HTTP_PORT=3000 \
GF_SECURITY_ADMIN_PASSWORD=devforge-lab-only \
  grafana server --homepath "$GRAFANA_HOME" > grafana.log 2>&1 &
echo $! > grafana.pid
for i in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:3000/api/health && break
  sleep 1
done
curl -s http://127.0.0.1:3000/api/health
```

```text output
{
  "database": "ok",
  "version": "13.3.2",
  "commit": "bd754986872f554d30a147ebd605a7fe15881a28"
}
```

- `GF_PATHS_PROVISIONING` is the setting `provisioning` in the `[paths]` section; `GF_SECURITY_ADMIN_PASSWORD` is `admin_password` in `[security]`.
- Grafana keeps its own database (users, settings) in `data`, and its log in `logs`.
- Without `GF_SECURITY_ADMIN_PASSWORD`, the first login is `admin` / `admin` and Grafana asks you to change it. `devforge-lab-only` is a practice password for a server only your own computer can reach — never use a password from a tutorial on a real server.
- `/api/health` does not need a login; the loop waits until it answers, for at most a minute.

### 4. Check what Grafana created

Grafana's API needs a user. `-u admin:devforge-lab-only` sends the username and password:

```bash run
curl -s -u admin:devforge-lab-only 'http://127.0.0.1:3000/api/search?query=DevForge'
echo
curl -s -u admin:devforge-lab-only http://127.0.0.1:3000/api/dashboards/uid/devforge-overview | grep -o '"title":"[^"]*"'
```

```text output
[{"id":…,"uid":"devforge-overview","orgId":1,"title":"DevForge overview","uri":"db/devforge-overview","url":"/d/devforge-overview/devforge-overview","slug":"","type":"dash-db","tags":[],"isStarred":false,"sortMeta":0,"isDeleted":false}]
"title":"Requests per second by status"
"title":"95th percentile latency"
"title":"DevForge overview"
```

The dashboard exists, with both panels, and its address is `/d/devforge-overview/…`. (`grep -o` prints only the matching parts of the JSON.) Now ask Grafana whether it can reach Prometheus:

```bash run
curl -s -u admin:devforge-lab-only http://127.0.0.1:3000/api/datasources/uid/devforge-prometheus/health
```

```text output
{"details":{"application":"Prometheus","features":{"rulerApiEnabled":false}},"message":"Successfully queried the Prometheus API.","status":"OK"}
```

And without credentials:

```bash run
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/search
```

```text output
401
```

`401 Unauthorized`: Grafana is running, but will not answer an anonymous request.

### 5. Look at it

Open <http://localhost:3000/d/devforge-overview>, sign in as `admin` with `devforge-lab-only`, and you will see the two panels. Make some requests to DevForge (reload a few track pages, or run the curl loop from the previous lesson) and watch the lines rise within a scrape or two. This step is not part of the automatic tests.

You do not have to restart Grafana to change the dashboard: the documentation says provisioned dashboards are reloaded when their JSON files change (the provisioning page explains how often Grafana checks).

### 6. Stop Prometheus and Grafana

When you are finished:

```bash run
kill "$(cat grafana.pid)" "$(cat ../prometheus-lab/prometheus.pid)"
```

The `grafana-lab` and `prometheus-lab` folders keep the configuration, the dashboard and the stored data; start the servers again with the same commands to carry on.

## Common mistakes

- **Expecting Grafana to store metrics.** It only queries. If panels say *No data*, check the data source health and the query in Prometheus first.
- **A data source URL that only works from your browser.** With `access: proxy`, the Grafana *server* connects to the URL, so `localhost` means the machine Grafana runs on — in containers that is often not where Prometheus is.
- **Referring to a data source by an ID that differs between installations.** Give it a fixed `uid` and use that in dashboards.
- **A relative path in the dashboard provider.** Use an absolute path, as here.
- **Leaving the default `admin` / `admin` login**, or committing real passwords in files. Set the password through the environment or a secret store.

## Where this fits in a real system

Teams keep dashboards and data sources in Git next to the service, and a pipeline (**GitHub Actions** or **Jenkins**) deploys them. Grafana usually queries several data sources at once — **Prometheus** for metrics, a log store, and a tracing back end fed by **OpenTelemetry** — so one screen can link a spike in errors to the logs and traces that explain it. In **Kubernetes**, the same provisioning folders can be filled from ConfigMaps.
