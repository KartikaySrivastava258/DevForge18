---
id: jira-reports-and-anti-patterns
title: Reports, cycle time and anti-patterns
track: jira
order: 5
level: advanced
estimated_minutes: 45
prerequisites: [jira-kanban-and-flow-metrics]
starts_fresh: true
learning_objectives:
  - Read Jira's velocity, burndown and control-chart reports for what they measure — and what they cannot.
  - Spot story-point inflation by comparing velocity with the number of items actually finished.
  - Use work-item age against past cycle times to find stuck work before it becomes late.
  - Detect data-quality problems that distort reports — skipped statuses, reopened items, bulk closing — and decide how to treat them.
resources:
  - title: View and understand the velocity chart (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-velocity-chart/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: Velocity can be based on story points, time or work item count; the commitment bar is the estimate at sprint start, the completed bar what was finished by the end.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: View and understand the burndown chart (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-burndown-chart/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: The burndown shows the work remaining in a sprint over time, used to judge the likelihood of meeting the sprint goal.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: View and understand the control chart (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-control-chart/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: The control chart maps cycle (or lead) time per work item for the chosen statuses, with average, rolling average and standard deviation.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: points
    prompt: Velocity rose from 30 to 48 points over four sprints, but the team finished 10 items every sprint. What happened?
    options:
      - { id: a, text: "The team got 60% faster" }
      - { id: b, text: "The estimates grew — the same amount of finished work is now called more points; velocity measures estimates, not output" }
      - { id: c, text: "Items got smaller" }
    answer: b
    explanation: When points become a target, estimates drift upwards. Count finished items alongside points.
  - id: age
    prompt: An item has been in progress for 20 days; 85% of past items finished within 15. What do you do?
    options:
      - { id: a, text: "Wait — it will finish eventually" }
      - { id: b, text: "Talk about it today: it is already slower than 85% of past items, so ask what is blocking it, split it, or swarm on it" }
      - { id: c, text: "Delete it" }
    answer: b
    explanation: Work-item age is the one flow metric that is useful before an item is finished.
  - id: skip
    prompt: Several items went straight from To Do to Done. How do they affect the control chart?
    options:
      - { id: a, text: "Not at all" }
      - { id: b, text: "They add cycle times of zero (or leave cycle time undefined), dragging averages down; decide whether to exclude them or fix the habit of not moving items" }
      - { id: c, text: "They make cycle time longer" }
    answer: b
    explanation: Reports are only as good as how faithfully people move work items.
verification:
  method: executed
  details: Every command is run by the test suite with the host's Python 3 (standard library only), from nothing, and its output is compared with this lesson. The sprints and work items are a made-up sample in the shape of Jira's REST API (changelog histories with status transitions and story-point values), so no Jira site is needed. Report descriptions were checked against Atlassian's Jira Cloud documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

Jira's reports draw whatever the data says, so you must know what each one measures — **velocity** measures *estimates*, the **burndown** measures *remaining estimate*, the **control chart** measures *time between statuses* — and check the data for habits and games that make the pictures lie.

## Explain it like I'm twelve

If the class gets a prize for "most pages read", pages suddenly get bigger fonts. If nobody updates the reading log until Friday, the log shows nothing all week and then everything at once. And a book that has been "currently reading" for two months probably needs a conversation, not more patience. Reports are only as honest as the habits behind them.

## What problem it solves

Teams and managers make decisions from charts — staffing, deadlines, "are we getting faster?". Charts built from inflated estimates, items nobody moved, or work closed in bulk give confident, wrong answers. Knowing the common distortions, and checking for them with a few lines of code, keeps planning grounded in what actually happened.

## How it works

![](media:jira/reports-anti-patterns.svg)

- **Velocity chart**: per sprint, the estimate committed at the start and the estimate completed by the end — in story points by default, or time, or item count.
- **Burndown chart**: remaining estimate over the sprint; a flat line followed by a cliff means items are closed in batches, not when they finish.
- **Control chart**: cycle (or lead) time of each item for the statuses you choose, with averages — skewed by outliers and by items that skipped statuses.
- **Work-item age**: for unfinished items, days since work started — compare it with past cycle-time percentiles to catch stuck work early.
- **Data quality**: skipped statuses, reopened items and bulk transitions change every report; detect them before trusting the numbers.

## Try it yourself

> **Local lab** — needs Python 3.10 or newer. The data is a made-up sample in the shape of Jira's REST API (status histories and story points), so no Jira site is needed. Every command is run automatically in DevForge's tests.

### 1. Velocity says faster; finished items say otherwise

```bash run
mkdir -p reports-lab && cd reports-lab
python3 - <<'EOF'
# Four sprints; each tuple is (story points, finished in the sprint?) for one item.
sprints = {
    "Sprint 1": [3] * 10,
    "Sprint 2": [3] * 6 + [5] * 4,
    "Sprint 3": [5] * 7 + [3] * 3,
    "Sprint 4": [5] * 8 + [8] * 2,
}
print(f"{'sprint':9} {'velocity':>9} {'items finished':>15} {'points per item':>16}")
for name, points in sprints.items():
    print(f"{name:9} {sum(points):>9} {len(points):>15} {sum(points) / len(points):>16.1f}")
EOF
```

```text output
sprint     velocity  items finished  points per item
Sprint 1         30              10              3.0
Sprint 2         38              10              3.8
Sprint 3         44              10              4.4
Sprint 4         56              10              5.6
```

Velocity rose by 87% while the team finished exactly ten items every sprint. Either the items really got bigger — possible, and worth checking — or the same work is being estimated higher, which often happens once velocity becomes a target. Always show finished items next to points, and never compare velocity between teams: their points mean different things.

### 2. Work-item age: catching stuck work early

```bash run
python3 - <<'EOF'
from datetime import date
past_cycle_times = [3, 5, 5, 7, 8, 8, 8, 8, 11, 11, 15, 17]        # from the previous lesson
p85 = sorted(past_cycle_times)[-(-85 * len(past_cycle_times) // 100) - 1]
today = date(2026, 4, 10)
in_progress = {"SHOP-13": date(2026, 4, 7), "SHOP-14": date(2026, 3, 30), "SHOP-15": date(2026, 3, 20), "SHOP-16": date(2026, 4, 9)}
print(f"85% of past items finished within {p85} days")
for key, started in sorted(in_progress.items(), key=lambda kv: kv[1]):
    age = (today - started).days
    flag = "LATE: older than 85% of past items" if age > p85 else ("watch: past the median" if age > 8 else "ok")
    print(f"{key}: in progress for {age:>2} days → {flag}")
EOF
```

```text output
85% of past items finished within 15 days
SHOP-15: in progress for 21 days → LATE: older than 85% of past items
SHOP-14: in progress for 11 days → watch: past the median
SHOP-13: in progress for  3 days → ok
SHOP-16: in progress for  1 days → ok
```

Cycle time is only known when an item finishes — too late to help it. **Age** is known every day. SHOP-15 is already slower than 85% of everything the team has finished; the daily stand-up should be about it, not about the items that are fine.

### 3. Habits that distort the reports

```bash run
cat > history.json <<'EOF'
[
 {"key": "SHOP-20", "moves": [["2026-04-01", "To Do", "In Progress"], ["2026-04-03", "In Progress", "Done"]]},
 {"key": "SHOP-21", "moves": [["2026-04-02", "To Do", "Done"]]},
 {"key": "SHOP-22", "moves": [["2026-04-01", "To Do", "In Progress"], ["2026-04-02", "In Progress", "Done"],
                              ["2026-04-06", "Done", "In Progress"], ["2026-04-09", "In Progress", "Done"]]},
 {"key": "SHOP-23", "moves": [["2026-03-02", "To Do", "In Progress"], ["2026-04-10", "In Progress", "Done"]]},
 {"key": "SHOP-24", "moves": [["2026-03-05", "To Do", "In Progress"], ["2026-04-10", "In Progress", "Done"]]},
 {"key": "SHOP-25", "moves": [["2026-03-09", "To Do", "In Progress"], ["2026-04-10", "In Progress", "Done"]]}
]
EOF
python3 - <<'EOF'
import json
from collections import Counter
items = json.load(open("history.json"))
done_days = Counter()
for item in items:
    moves = item["moves"]
    statuses = [to for _, _, to in moves]
    if "In Progress" not in statuses:
        print(f"{item['key']}: skipped In Progress — no cycle time (or zero), pulls averages down")
    reopened = sum(1 for _, frm, to in moves if frm == "Done")
    if reopened:
        print(f"{item['key']}: reopened {reopened} time(s) — first 'Done' was {moves[1][0]}, final 'Done' {moves[-1][0]}")
    done_days[[d for d, _, to in moves if to == "Done"][-1]] += 1
for day, n in done_days.items():
    if n >= 3:
        print(f"{day}: {n} items closed on the same day — bulk closing makes the burndown fall off a cliff")
EOF
```

```text output
SHOP-21: skipped In Progress — no cycle time (or zero), pulls averages down
SHOP-22: reopened 1 time(s) — first 'Done' was 2026-04-02, final 'Done' 2026-04-09
2026-04-10: 3 items closed on the same day — bulk closing makes the burndown fall off a cliff
```

- **Skipped statuses** (SHOP-21): the item was moved only at the end. Its cycle time is zero or undefined; a few of these make the control chart look better than reality. Fix the habit, or exclude such items explicitly.
- **Reopened items** (SHOP-22): was it done on 2 April (when it was first called done) or 9 April (when it was really done)? Jira's reports use the statuses you pick, so decide — usually the final date — and treat frequent reopening as a quality signal in itself.
- **Bulk closing** (10 April): three items that started in early March were all marked done on the same day, probably during a clean-up. The burndown stays flat and then drops, throughput spikes, and their long cycle times arrive all at once. Move items when the work actually finishes.

### 4. Averages versus the shape of the data

```bash run
python3 - <<'EOF'
cycle = [3, 5, 5, 7, 8, 8, 8, 8, 11, 11, 15, 17, 0, 39, 36, 32]     # last four: SHOP-21 and the bulk-closed items
honest = [c for c in cycle if c > 0]
for label, data in [("all items", cycle), ("without the skipped item", honest)]:
    s = sorted(data)
    p85 = s[-(-85 * len(s) // 100) - 1]
    print(f"{label:26} average {sum(s) / len(s):5.1f} days, median {s[len(s) // 2]:>2}, 85th percentile {p85}")
EOF
```

```text output
all items                  average  13.3 days, median  8, 85th percentile 32
without the skipped item   average  14.2 days, median  8, 85th percentile 32
```

The three long-running items more than doubled the 85th percentile compared with the previous lesson's 15 days, while the median stayed at 8: most work still flows as before, but a few items were left to rot. The skipped item hides a little of it in the average. A control chart's rolling average blends all of this into one line; percentiles and the individual dots tell you what is really happening.

## Common mistakes

- **Velocity as a productivity target or a comparison between teams.** It measures estimates; targets inflate them.
- **Reading a burndown without asking how items are moved.** A flat line and a cliff are a process smell, not a schedule.
- **Looking only at finished work.** Track the age of unfinished items daily.
- **Trusting averages.** Show percentiles and outliers; investigate the outliers.
- **Cleaning up the board at sprint end.** Bulk transitions rewrite history in every report.

## Where this fits in a real system

These checks run as a scheduled script against Jira's REST API — in **GitHub Actions** or **Airflow** — and publish to a **Grafana** dashboard next to deployment frequency and incident counts from **Prometheus**, so flow is discussed alongside delivery. Linking work items to commits (the earlier lesson in this track) adds the code side: how long from first commit to production.
