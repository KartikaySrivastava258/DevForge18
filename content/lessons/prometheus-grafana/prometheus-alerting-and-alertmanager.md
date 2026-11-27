---
id: prometheus-alerting-and-alertmanager
title: Alerting rules and Alertmanager
track: prometheus-grafana
order: 6
level: intermediate
estimated_minutes: 45
prerequisites: [prometheus-scraping-and-promql]
learning_objectives:
  - Write alerting rules in Prometheus and send firing alerts to Alertmanager.
  - Route alerts to different receivers by label (pages to on-call, tickets to the team), with grouping and timing settings.
  - Suppress follow-on alerts with an inhibition rule, and mute planned work with a silence.
  - Keep a Watchdog alert that always fires, so a broken alerting pipeline is noticed.
resources:
  - title: Alertmanager (concepts)
    url: https://prometheus.io/docs/alerting/latest/alertmanager/
    publisher: Prometheus
    type: documentation
    level: intermediate
    official: true
    why: Grouping, inhibition and silences.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Alertmanager configuration
    url: https://prometheus.io/docs/alerting/latest/configuration/
    publisher: Prometheus
    type: reference
    level: intermediate
    official: true
    why: The routing tree (receiver, matchers, group_by, group_wait, group_interval, repeat_interval), inhibit_rules and webhook_configs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Alerting rules
    url: https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/
    publisher: Prometheus
    type: documentation
    level: intermediate
    official: true
    why: alert, expr, for, labels and annotations, and how Prometheus sends firing alerts to Alertmanager.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: split
    prompt: Why do Prometheus and Alertmanager split the work?
    options:
      - { id: a, text: "Historical accident only" }
      - { id: b, text: "Prometheus decides that something is wrong (rules over metrics); Alertmanager decides who hears about it, when and how often (routing, grouping, inhibition, silences) — across many Prometheus servers" }
      - { id: c, text: "Alertmanager stores metrics" }
    answer: b
    explanation: The lab's rules only fire; every decision about notifications is in alertmanager.yml.
  - id: inhibit
    prompt: ServiceDown and HighLatency both fire for the checkout service. With the lab's inhibition rule, who gets paged for what?
    options:
      - { id: a, text: "On-call gets both" }
      - { id: b, text: "On-call gets ServiceDown only: HighLatency is inhibited while ServiceDown fires for the same service — the cause, not its symptoms" }
      - { id: c, text: "Nobody" }
    answer: b
    explanation: equal [service] limits the inhibition to the same service; HighLatency elsewhere still notifies.
  - id: watchdog
    prompt: What is an always-firing Watchdog alert for?
    options:
      - { id: a, text: "Nothing, it is noise" }
      - { id: b, text: "Proving the pipeline works: an external system expects its notification regularly and raises the alarm if it stops — because a broken Prometheus or Alertmanager is otherwise silent" }
      - { id: c, text: "Testing CPU usage" }
    answer: b
    explanation: Silence from monitoring should never be mistaken for "all is well".
verification:
  method: executed
  details: Every command is run by the test suite with Prometheus 3.16.0, Alertmanager and amtool 0.34.2 and a small Node.js webhook receiver, after the earlier Prometheus lessons, and its output is compared with this lesson. Start times vary and are not printed. Behaviour was checked against the Prometheus alerting documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Prometheus** evaluates alerting rules and says *what* is wrong; **Alertmanager** decides *who* hears about it, *when* and *how often* — routing by labels, grouping related alerts, inhibiting symptoms of a known cause, and staying quiet during planned work.

## Explain it like I'm twelve

The school's smoke detectors (Prometheus rules) only shout "smoke in room 12". The office (Alertmanager) decides what happens next: a real fire calls the fire brigade (page), a burnt toast note goes to the caretaker's to-do list (ticket). If the whole building is evacuated, nobody needs ten separate calls about each room (inhibition and grouping). During a planned fire drill, the office ignores the detectors (silence). And a light on the office wall blinks once a minute to show the detectors are still connected (watchdog).

Where the analogy breaks: Alertmanager can do all of this for many buildings — many Prometheus servers — at once.

## What problem it solves

Without routing, every alert goes to everyone, which trains people to ignore them. During an outage, one failure triggers dozens of alerts at once. And a monitoring system that has itself broken looks exactly like a healthy one: quiet. Alertmanager's routing, grouping, inhibition and silences — and a watchdog — address each of these.

## How it works

![](media:prometheus-grafana/alertmanager.svg)

- An **alerting rule** has an `expr` (firing while it returns results), optionally `for` (how long before it fires), `labels` (such as `severity`) and `annotations` (human text). Prometheus sends firing alerts to the Alertmanagers in its `alerting` section.
- Alertmanager's **routing tree** matches alerts by label (`matchers`) to **receivers** (webhook, email, chat, paging services). `group_by` bundles alerts into one notification; `group_wait`, `group_interval` and `repeat_interval` control timing.
- **Inhibition** mutes alerts matching `target_matchers` while an alert matching `source_matchers` fires, if the labels in `equal` match.
- **Silences** (via the UI or `amtool`) mute matching alerts for a period.

## Try it yourself

> **Local lab** — needs Prometheus (as in the earlier lessons), Alertmanager with amtool, and Node.js. Alertmanager listens on `127.0.0.1:9093`, this lesson's Prometheus on `127.0.0.1:9094`, the webhook receiver on `127.0.0.1:9096`. Every command is run automatically in DevForge's tests.

### 1. A receiver that prints notifications, and an Alertmanager configuration

```bash run
mkdir -p alerting-lab && cd alerting-lab
cat > receiver.mjs <<'EOF'
// Records each notification Alertmanager sends: the path (= receiver), status and the alerts in the group.
import http from "node:http";
import { appendFileSync } from "node:fs";
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const n = JSON.parse(body);
    const alerts = n.alerts.map((a) => `${a.labels.alertname}(${a.labels.severity})`).sort().join(", ");
    appendFileSync("notifications.log", `${req.url} ${n.status}: ${alerts}\n`);
    res.end("ok");
  });
}).listen(9096, "127.0.0.1");
EOF
node receiver.mjs > receiver.log 2>&1 &
echo $! > receiver.pid
cat > alertmanager.yml <<'EOF'
route:
  receiver: team-tickets          # default: everything not matched below
  group_by: [alertname]
  group_wait: 1s                  # short for the lab; tens of seconds is typical
  group_interval: 2s
  repeat_interval: 1h
  routes:
    - matchers: ['severity="page"']
      receiver: on-call
    - matchers: ['alertname="Watchdog"']
      receiver: heartbeat
inhibit_rules:
  - source_matchers: ['alertname="ServiceDown"']
    target_matchers: ['alertname="HighLatency"']
    equal: [service]
receivers:
  - name: team-tickets
    webhook_configs: [{ url: "http://127.0.0.1:9096/tickets" }]
  - name: on-call
    webhook_configs: [{ url: "http://127.0.0.1:9096/on-call" }]
  - name: heartbeat
    webhook_configs: [{ url: "http://127.0.0.1:9096/heartbeat" }]
EOF
amtool check-config alertmanager.yml | head -n 1
alertmanager --config.file=alertmanager.yml --storage.path=am-data \
  --web.listen-address=127.0.0.1:9093 --cluster.listen-address= > alertmanager.log 2>&1 &
echo $! > alertmanager.pid
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9093/-/ready && break; sleep 1; done
curl -s http://127.0.0.1:9093/-/ready; echo
```

```text output
Checking 'alertmanager.yml'  SUCCESS
OK
```

`--cluster.listen-address=` (empty) turns off high-availability clustering, which a single local Alertmanager does not need.

### 2. Rules in Prometheus, sent to Alertmanager

```bash run
cat > rules.yml <<'EOF'
groups:
  - name: lab
    rules:
      - alert: Watchdog
        expr: vector(1)                       # always firing: proves the pipeline works
        labels: { severity: none }
        annotations: { summary: "Always firing: proves alerts reach Alertmanager" }
      - alert: PrometheusSelfScrape
        expr: up{job="self"} == 1             # fires as soon as Prometheus scrapes itself
        labels: { severity: ticket }
        annotations: { summary: "A stand-in for a real ticket-level problem" }
EOF
cat > prometheus.yml <<'EOF'
global: { scrape_interval: 1s, evaluation_interval: 1s }
rule_files: [rules.yml]
alerting:
  alertmanagers:
    - static_configs: [{ targets: ["127.0.0.1:9093"] }]
scrape_configs:
  - job_name: self
    static_configs: [{ targets: ["127.0.0.1:9094"] }]
EOF
promtool check rules rules.yml | tail -n 2 | head -n 1
prometheus --config.file=prometheus.yml --storage.tsdb.path=data --web.listen-address=127.0.0.1:9094 \
  --rules.alert.resend-delay=2s > prometheus.log 2>&1 &
echo $! > prometheus.pid
for i in $(seq 1 60); do [ "$(cat notifications.log 2> /dev/null | wc -l)" -ge 2 ] && break; sleep 1; done
sort notifications.log
```

```text output
  SUCCESS: 2 rules found
/heartbeat firing: Watchdog(none)
/tickets firing: PrometheusSelfScrape(ticket)
```

Each alert reached the receiver its labels route it to: the watchdog to `heartbeat`, the ticket to the team's default receiver. `--rules.alert.resend-delay=2s` makes Prometheus re-send firing alerts every 2 seconds instead of every minute — for the lab only: the watchdog fires at the very first rule evaluation, and if Prometheus has not yet connected to Alertmanager at that moment, the default would hold the alert back for a minute. (This happened on a busy CI machine while the lesson was being tested.) In production the heartbeat receiver is an external "dead man's switch" service that raises the alarm when these notifications *stop*.

### 3. A page, and its symptom inhibited

The checkout service goes down; its latency alert fires too. (`amtool alert add` sends alerts directly, as Prometheus would.)

```bash run
am() { amtool --alertmanager.url=http://127.0.0.1:9093 "$@"; }
am alert add ServiceDown service=checkout severity=page
am alert add HighLatency service=checkout severity=page
for i in $(seq 1 30); do grep -q '/on-call' notifications.log && break; sleep 1; done
sleep 3   # a few group intervals, so a HighLatency notification would have arrived by now
grep '/on-call' notifications.log
am alert query --inhibited -o simple | awk 'NR > 1 { print $1, $NF }'
```

```text output
/on-call firing: ServiceDown(page)
HighLatency suppressed
```

On-call was paged once, for the cause. `HighLatency` is active but **suppressed** by the inhibition rule, because `ServiceDown` fires for the same `service`. A latency alert for another service would still page.

### 4. Silence planned work

```bash run
am silence add alertname=PrometheusSelfScrape --duration=1h --author=asha --comment="planned maintenance" > /dev/null
am alert query --silenced -o simple | awk 'NR > 1 { print $1, $NF }'
am silence query -o simple | awk 'NR > 1 { print "silence by", $(NF-2) }'
```

```text output
PrometheusSelfScrape suppressed
silence by asha
```

The alert still fires in Prometheus, but Alertmanager will not notify anyone for an hour. Silences record who created them and why, and expire by themselves.

### 5. Stop everything

```bash run
kill "$(cat prometheus.pid)" "$(cat alertmanager.pid)" "$(cat receiver.pid)"
```

## Common mistakes

- **Paging for everything.** Page only for user-facing problems that need action now; everything else is a ticket.
- **No `for:` on noisy rules.** A single scrape blip should not wake anyone; require the condition for a few minutes.
- **Alerts without labels to route on.** `severity`, `team` or `service` labels are what routing, inhibition and silences match.
- **Silences without expiry or reason.** They hide real problems after the maintenance ends.
- **No watchdog.** A dead Prometheus sends no alerts — and looks healthy.

## Where this fits in a real system

SLO burn-rate alerts (next lesson) are routed this way; notifications link to **Grafana** dashboards with `var-…` filters; Alertmanager runs as a highly available cluster on **Kubernetes**; and receivers include chat, paging services and ticket systems such as **Jira**.
