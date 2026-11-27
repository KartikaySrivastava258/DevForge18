---
id: jira-kanban-and-flow-metrics
title: Kanban and flow metrics in depth
track: jira
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [jira-sprints-boards-and-wip]
starts_fresh: true
learning_objectives:
  - Read work-item history in the shape Jira's REST API returns (a changelog of status transitions) and turn it into flow metrics.
  - Calculate lead time, cycle time, throughput and work in progress, and explain how they differ.
  - Use percentiles of cycle time to make a forecast ("85% of items finish within N days") instead of an average.
  - Check Little's Law on real numbers and read a cumulative flow table for a bottleneck.
resources:
  - title: Jira Cloud REST API — issues and changelogs
    url: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
    publisher: Atlassian
    type: reference
    level: intermediate
    official: true
    why: An issue's changelog is a list of histories, each with a created time and items naming the field that changed (fromString, toString) — the data these metrics are built from.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: View and understand the cumulative flow diagram (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-cumulative-flow-diagram/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: Each coloured area is a workflow status; an area that widens vertically over time generally marks a bottleneck.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: "Little, J. D. C. (1961). A Proof for the Queuing Formula: L = λW. Operations Research 9(3), 383–387"
    url: https://doi.org/10.1287/opre.9.3.383
    publisher: INFORMS (Operations Research)
    type: reference
    level: advanced
    official: false
    why: The original proof that the average number of items in a system equals the arrival rate times the average time in the system — the basis of the WIP / throughput / cycle-time relationship. Citation details checked through Crossref.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: lead-vs-cycle
    prompt: An item was created on 1 March, started on 10 March and finished on 12 March. What are its lead time and cycle time?
    options:
      - { id: a, text: "Both 11 days" }
      - { id: b, text: "Lead time 11 days (created → done), cycle time 2 days (started → done) — the customer waits the lead time; the team controls the cycle time" }
      - { id: c, text: "Both 2 days" }
    answer: b
    explanation: The difference — 9 days waiting in the backlog — is a queue, not work.
  - id: percentile
    prompt: Why forecast with the 85th percentile of cycle time rather than the average?
    options:
      - { id: a, text: "It is always smaller" }
      - { id: b, text: "Cycle times are skewed by a few long items; \"85% of items finish within N days\" is a promise you can keep, while the average is beaten by half of the items and missed by the rest" }
      - { id: c, text: "Jira only shows percentiles" }
    answer: b
    explanation: The lab's average is pulled up by two slow items; the percentiles describe what customers actually experience.
  - id: wip
    prompt: According to Little's Law, how do you shorten average cycle time without working faster?
    options:
      - { id: a, text: "Start more items" }
      - { id: b, text: "Lower work in progress — at the same throughput, average cycle time = average WIP ÷ throughput" }
      - { id: c, text: "Add story points" }
    answer: b
    explanation: That is why Kanban boards have WIP limits.
verification:
  method: executed
  details: Every command is run by the test suite with the host's Python 3 (standard library only), from nothing, and its output is compared with this lesson. The work items are a made-up sample written in the shape of Jira's REST API changelog (dates, statuses, keys), so no Jira site is needed; with a real site you would fetch the same structure. Checked against Atlassian's REST API reference and report documentation, and the Little's Law paper's metadata (Crossref), on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

**Flow metrics** — **lead time**, **cycle time**, **throughput** and **work in progress** — are calculated from when each work item changed status, and they answer the questions people actually ask ("when will it be done?", "why is everything slow?") better than story points do.

## Explain it like I'm twelve

At the school canteen, **lead time** is from when you join the queue to when you get your lunch; **cycle time** is from when the cook starts your plate to when it's handed over; **throughput** is how many lunches come out per minute; **work in progress** is how many plates are being prepared at once. If the cooks start twenty plates at once, every plate takes longer — even though nobody is cooking any slower.

## What problem it solves

Boards show where work is *now*; they do not show how work *flows*. Teams that only look at the board miss that items wait days in review, that a few huge items dominate their "average", or that starting more work is making everything slower. The status history Jira already records contains the answers — once you turn it into numbers.

## How it works

![](media:jira/flow-metrics.svg)

- **Status history**: every transition is a changelog entry with a time, `fromString` and `toString`.
- **Lead time** = done − created. **Cycle time** = done − first moved to an in-progress status. **Throughput** = items finished per week. **WIP** = items in progress on a day.
- **Percentiles**: sort the cycle times; the 85th percentile is the time within which 85% of items finished.
- **Little's Law**: over a stable period, average WIP = throughput × average cycle time.
- **Cumulative flow**: count items in each status per day or week; a band that keeps widening is where work piles up.

## Try it yourself

> **Local lab** — needs Python 3.10 or newer, and nothing else. The data is a made-up sample written in the same shape Jira's REST API returns for `GET /rest/api/3/issue/{key}?expand=changelog`, so you can later run the same script on an export from a real site. Every command is run automatically in DevForge's tests.

### 1. Work items and their status history

```bash run
mkdir -p flow-lab && cd flow-lab
python3 - <<'EOF'
# Writes issues.json: 12 items in the shape of Jira's REST API (fields.created + changelog.histories).
import json
def item(key, created, moves):
    histories = [{"created": f"{day}T10:00:00.000+0000", "items": [{"field": "status", "fromString": a, "toString": b}]}
                 for day, a, b in moves]
    return {"key": key, "fields": {"created": f"{created}T09:00:00.000+0000", "summary": f"Item {key}"},
            "changelog": {"histories": histories}}
T, P, R, D = "To Do", "In Progress", "In Review", "Done"
issues = [
    item("SHOP-1",  "2026-03-02", [("2026-03-03", T, P), ("2026-03-05", P, R), ("2026-03-06", R, D)]),
    item("SHOP-2",  "2026-03-02", [("2026-03-04", T, P), ("2026-03-06", P, R), ("2026-03-09", R, D)]),
    item("SHOP-3",  "2026-03-03", [("2026-03-05", T, P), ("2026-03-09", P, R), ("2026-03-10", R, D)]),
    item("SHOP-4",  "2026-03-03", [("2026-03-09", T, P), ("2026-03-11", P, R), ("2026-03-16", R, D)]),
    item("SHOP-5",  "2026-03-04", [("2026-03-10", T, P), ("2026-03-12", P, R), ("2026-03-18", R, D)]),
    item("SHOP-6",  "2026-03-05", [("2026-03-11", T, P), ("2026-03-13", P, R), ("2026-03-19", R, D)]),
    item("SHOP-7",  "2026-03-06", [("2026-03-12", T, P), ("2026-03-16", P, R), ("2026-03-23", R, D)]),
    item("SHOP-8",  "2026-03-09", [("2026-03-16", T, P), ("2026-03-17", P, R), ("2026-03-24", R, D)]),
    item("SHOP-9",  "2026-03-09", [("2026-03-17", T, P), ("2026-03-30", P, R), ("2026-04-01", R, D)]),
    item("SHOP-10", "2026-03-10", [("2026-03-18", T, P), ("2026-03-20", P, R), ("2026-03-26", R, D)]),
    item("SHOP-11", "2026-03-11", [("2026-03-19", T, P), ("2026-03-23", P, R), ("2026-03-30", R, D)]),
    item("SHOP-12", "2026-03-12", [("2026-03-20", T, P), ("2026-04-02", P, R), ("2026-04-06", R, D)]),
]
json.dump(issues, open("issues.json", "w"), indent=1)
print(len(issues), "work items written")
EOF
python3 -c '
import json
item = json.load(open("issues.json"))[0]
print(item["key"], "created", item["fields"]["created"][:10])
for h in item["changelog"]["histories"]:
    for change in h["items"]:
        print(" ", h["created"][:10], change["field"] + ":", change["fromString"], "→", change["toString"])'
```

```text output
12 work items written
SHOP-1 created 2026-03-02
  2026-03-03 status: To Do → In Progress
  2026-03-05 status: In Progress → In Review
  2026-03-06 status: In Review → Done
```

This is all the data the metrics need: when each item was created, and when it moved between statuses.

### 2. Lead time, cycle time and where the time went

```bash run
cat > flow.py <<'EOF'
import json
from datetime import date

ACTIVE = {"In Progress", "In Review"}          # statuses that count as "being worked on"

def day(timestamp):
    return date.fromisoformat(timestamp[:10])

def timeline(issue):
    created = day(issue["fields"]["created"])
    moves = [(day(h["created"]), c["toString"]) for h in issue["changelog"]["histories"] for c in h["items"] if c["field"] == "status"]
    started = min((d for d, s in moves if s in ACTIVE), default=None)
    review = min((d for d, s in moves if s == "In Review"), default=None)
    done = max((d for d, s in moves if s == "Done"), default=None)
    in_status, previous_day, previous_status = {}, created, "To Do"
    for d, s in moves:
        in_status[previous_status] = in_status.get(previous_status, 0) + (d - previous_day).days
        previous_day, previous_status = d, s
    return {"key": issue["key"], "created": created, "started": started, "review": review, "done": done, "in_status": in_status}

items = [timeline(i) for i in json.load(open("issues.json"))]
EOF
python3 - <<'EOF'
from flow import items
print(f"{'item':8} {'lead':>5} {'cycle':>6} {'waiting in To Do':>17} {'In Progress':>12} {'In Review':>10}")
for t in items:
    s = t["in_status"]
    print(f"{t['key']:8} {(t['done'] - t['created']).days:>5} {(t['done'] - t['started']).days:>6} "
          f"{s.get('To Do', 0):>17} {s.get('In Progress', 0):>12} {s.get('In Review', 0):>10}")
EOF
```

```text output
item      lead  cycle  waiting in To Do  In Progress  In Review
SHOP-1       4      3                 1            2          1
SHOP-2       7      5                 2            2          3
SHOP-3       7      5                 2            4          1
SHOP-4      13      7                 6            2          5
SHOP-5      14      8                 6            2          6
SHOP-6      14      8                 6            2          6
SHOP-7      17     11                 6            4          7
SHOP-8      15      8                 7            1          7
SHOP-9      23     15                 8           13          2
SHOP-10     16      8                 8            2          6
SHOP-11     19     11                 8            4          7
SHOP-12     25     17                 8           13          4
```

- **Lead time** is what the person who asked experiences; **cycle time** is what the team controls. Their difference is waiting in the backlog.
- Look at the last two columns: after the first three items, most items spend longer **waiting in review** than being worked on. That is a queue, not a work problem.

### 3. Percentiles beat averages

```bash run
python3 - <<'EOF'
from flow import items
cycle = sorted((t["done"] - t["started"]).days for t in items)
def percentile(values, p):                     # nearest-rank method
    return values[max(0, -(-p * len(values) // 100) - 1)]
print("cycle times, sorted:", cycle)
print(f"average: {sum(cycle) / len(cycle):.1f} days")
for p in (50, 85, 95):
    print(f"{p}th percentile: {percentile(cycle, p)} days")
EOF
```

```text output
cycle times, sorted: [3, 5, 5, 7, 8, 8, 8, 8, 11, 11, 15, 17]
average: 8.8 days
50th percentile: 8 days
85th percentile: 15 days
95th percentile: 17 days
```

Two long items pull the average to 8.8 days, a number no single item had. Said as a forecast: "half our items finish within 8 days; 85% within 15 days". That last sentence is a promise a team can make and usually keep — "about 9 days" is missed by a third of the items here.

### 4. Throughput, WIP and Little's Law

```bash run
python3 - <<'EOF'
from datetime import date, timedelta
from flow import items
start, end = date(2026, 3, 9), date(2026, 3, 29)        # three full weeks, Monday to Sunday
days = [start + timedelta(n) for n in range((end - start).days + 1)]
wip = [sum(1 for t in items if t["started"] <= d < t["done"]) for d in days]
finished = [t for t in items if start <= t["done"] <= end]
throughput_per_day = len(finished) / len(days)
avg_wip = sum(wip) / len(days)
avg_cycle = sum((t["done"] - t["started"]).days for t in finished) / len(finished)
print(f"items finished in the period: {len(finished)} ({len(finished) / 3:.1f} per week)")
print(f"average WIP: {avg_wip:.1f} items")
print(f"Little's Law, WIP / throughput: {avg_wip / throughput_per_day:.1f} days")
print(f"measured average cycle time of those items: {avg_cycle:.1f} days")
EOF
```

```text output
items finished in the period: 8 (2.7 per week)
average WIP: 4.0 items
Little's Law, WIP / throughput: 10.6 days
measured average cycle time of those items: 7.5 days
```

The two numbers disagree — and that is the lesson. Little's Law holds for a **stable** period: about as many items starting as finishing, nothing piling up. These three weeks were not stable — WIP climbed to six items in the third week (see the next table), and SHOP-9 and SHOP-12, started inside the window, finished only after it, so their long cycle times are missing from the "measured" figure. Read the law as direction rather than accounting: at an average of 4 items in progress and 2.7 finished a week, cycle times of around 10–11 days are what this way of working produces. To shorten them without anyone working faster, lower the WIP — a **WIP limit**: stop starting, start finishing.

### 5. Cumulative flow: where the work piles up

```bash run
python3 - <<'EOF'
from datetime import date, timedelta
from flow import items
print(f"{'week of':10} {'To Do':>6} {'In Progress':>12} {'In Review':>10} {'Done':>5}")
for week in range(5):
    d = date(2026, 3, 8) + timedelta(7 * week)      # each Sunday evening
    counts = {"To Do": 0, "In Progress": 0, "In Review": 0, "Done": 0}
    for t in items:
        if t["created"] > d:
            continue                                  # not created yet
        status = "Done" if t["done"] <= d else "In Review" if t["review"] <= d else "In Progress" if t["started"] <= d else "To Do"
        counts[status] += 1
    print(f"{d.isoformat():10} {counts['To Do']:>6} {counts['In Progress']:>12} {counts['In Review']:>10} {counts['Done']:>5}")
EOF
```

```text output
week of     To Do  In Progress  In Review  Done
2026-03-08      4            1          1     1
2026-03-15      5            1          3     3
2026-03-22      0            3          3     6
2026-03-29      0            2          1     9
2026-04-05      0            0          1    11
```

Read the **In Review** column down the weeks: in the weeks of 15 and 22 March it held three items — as many as were being built — while the backlog emptied into the board. On Jira's cumulative flow diagram those weeks show the In Review band widening, which Atlassian's documentation describes as the sign of a bottleneck; step 2 shows the same thing per item (five to seven days waiting in review). Adding developers would make it worse — more items arriving at review. Limiting WIP in review, or having developers review before starting something new, would help.

## Common mistakes

- **Using story points as a speed measure.** Points are estimates; flow metrics are measurements of what happened.
- **Reporting the average cycle time.** Use percentiles, and show the spread.
- **Counting "In Progress" only.** Waiting statuses (review, QA, blocked) are where most time goes; include them in cycle time and look at them separately.
- **Applying Little's Law to an unstable period.** It describes steady states; a mismatch tells you WIP is growing.
- **Changing the workflow mid-period without noting it.** New statuses break comparisons; annotate the change.

## Where this fits in a real system

Fetch the history with Jira's REST API (or a CSV export), keep the script in Git, and run it on a schedule — an **Airflow** job or a **GitHub Actions** cron — to publish the numbers to a dashboard in **Grafana**. The next lesson reads Jira's own reports and the ways teams accidentally (or deliberately) make these numbers lie.
