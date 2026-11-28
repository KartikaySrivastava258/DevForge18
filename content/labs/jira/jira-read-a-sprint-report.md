---
id: jira-read-a-sprint-report
title: Read a sprint report and identify bottlenecks
track: jira
level: advanced
mode: read-through
estimated_minutes: 35
prerequisites: [jira-kanban-and-flow-metrics, jira-reports-and-anti-patterns]
objectives:
  - Separate what a team committed to at sprint start from work added during the sprint, and from what was finished.
  - Read a burndown that stays flat and then drops, and say what it shows about how work is finished.
  - Find the bottleneck from the time finished items spent in each status, and from where unfinished items stopped.
  - Propose a change that addresses the bottleneck rather than the symptom.
checkpoints:
  - { id: read, text: "I read each output and answered the questions below" }
questions:
  - id: commitment
    prompt: The report shows 18 of 31 committed points finished, plus 3 of 5 points added during the sprint. What is the honest summary for the sprint review?
    options:
      - { id: a, text: "The team finished 21 points, so it met 68% of its plan" }
      - { id: b, text: "The team finished 18 of the 31 points it committed to (58%); 5 points of new work were added mid-sprint and 3 of them were finished — the plan and the interruptions are two separate stories" }
      - { id: c, text: "The team failed, because not every committed item is Done" }
    answer: b
    explanation: Mixing added work into the commitment hides two different problems — planning too much, and being interrupted. Report them separately; the 21 points "completed" are real, but only 18 of them were the plan.
  - id: bottleneck
    prompt: Finished items spent 1–3 days In Progress but 6 days In Review, and two of the four unfinished items stopped In Review. Where is the bottleneck?
    options:
      - { id: a, text: "In Progress: developers are too slow" }
      - { id: b, text: "In Review: work is done quickly but waits for review, so it queues there and finishes late" }
      - { id: c, text: "To Do: the backlog is too long" }
    answer: b
    explanation: A bottleneck is the stage where work waits. Items moved through In Progress in a day or three and then sat in review for six; that queue, not coding speed, decides when work is finished.
  - id: burndown
    prompt: The burndown stays around 31 points for the whole first week and only drops in the second. What does that tell you?
    options:
      - { id: a, text: "Nobody worked in the first week" }
      - { id: b, text: "Points only burn when items reach Done; work was started early but finished late, because it waited in review — the flat line hides activity, not idleness" }
      - { id: c, text: "The chart is broken" }
    answer: b
    explanation: A burndown counts remaining estimate, which falls only when an item is Done. The status history shows work moving every day; it just did not finish until reviews happened.
  - id: fix
    prompt: Which change addresses this sprint's bottleneck?
    options:
      - { id: a, text: "Start more items at once, so there is always something to review" }
      - { id: b, text: "Limit work in review (for example a column limit of 2), and make reviewing waiting work the first job before starting anything new" }
      - { id: c, text: "Commit to more story points next sprint" }
    answer: b
    explanation: Starting more work makes the review queue longer. A WIP limit on In Review and a "finish before you start" habit drain the queue; committing to more points ignores both problems.
resources:
  - title: View and understand the burndown chart (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-burndown-chart/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: The burndown shows the work remaining in a sprint over time, used to judge the likelihood of meeting the sprint goal.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: View and understand the velocity chart (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-velocity-chart/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: The commitment bar is the estimate at sprint start, the completed bar what was finished by the end.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Complete a sprint (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/complete-a-sprint/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: What counts as complete, and where unfinished work items go when a sprint ends.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: View and understand the cumulative flow diagram (Jira Cloud)
    url: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-cumulative-flow-diagram/
    publisher: Atlassian
    type: documentation
    level: intermediate
    official: true
    why: Each coloured area is a workflow status; an area that widens vertically over time generally marks a bottleneck.
    verification: { status: verified, checked_on: 2026-11-27 }
verification:
  method: executed
  details: Every command on this page is run by DevForge's test suite with the host's Python 3 (standard library only), from nothing, and its output is compared with this page. The sprint is a made-up sample in the shape of Jira's REST API (sprint dates, story points and status histories), so no Jira site is needed. You read and interpret the output; running the commands yourself is optional.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

A two-week sprint has ended and the team is not happy: "we worked hard, but the burndown looks terrible". Your job is the one a scrum master or tech lead does before the sprint review: turn the sprint's data into a report, separate the plan from the interruptions, and find **where work waited** — the bottleneck. Answer the questions at the end to complete the lab.

The output comes from a short Python script over a sprint export in the shape Jira's REST API returns. Running it yourself is optional and needs only Python 3.10 or newer; no Jira site is involved.

## The sprint

Sprint 7 ran from Monday 4 May to Friday 15 May 2026. Seven items were planned at the start; two more were added while it ran. Each item records its story points, when it joined the sprint, and every status change.

```bash run
mkdir -p sprint-lab && cd sprint-lab
cat > sprint.json <<'EOF'
{
  "sprint": {"name": "SHOP Sprint 7", "start": "2026-05-04", "end": "2026-05-15"},
  "items": [
    {"key": "SHOP-40", "points": 5, "added": "2026-05-04", "moves": [["2026-05-04", "In Progress"], ["2026-05-05", "In Review"], ["2026-05-11", "Done"]]},
    {"key": "SHOP-41", "points": 3, "added": "2026-05-04", "moves": [["2026-05-04", "In Progress"], ["2026-05-06", "In Review"], ["2026-05-12", "Done"]]},
    {"key": "SHOP-42", "points": 8, "added": "2026-05-04", "moves": [["2026-05-05", "In Progress"], ["2026-05-08", "In Review"], ["2026-05-14", "Done"]]},
    {"key": "SHOP-43", "points": 2, "added": "2026-05-04", "moves": [["2026-05-06", "In Progress"], ["2026-05-07", "In Review"], ["2026-05-13", "Done"]]},
    {"key": "SHOP-44", "points": 5, "added": "2026-05-04", "moves": [["2026-05-07", "In Progress"], ["2026-05-11", "In Review"]]},
    {"key": "SHOP-45", "points": 3, "added": "2026-05-04", "moves": [["2026-05-11", "In Progress"], ["2026-05-13", "In Review"]]},
    {"key": "SHOP-46", "points": 5, "added": "2026-05-04", "moves": []},
    {"key": "SHOP-47", "points": 3, "added": "2026-05-06", "moves": [["2026-05-06", "In Progress"], ["2026-05-06", "In Review"], ["2026-05-07", "Done"]]},
    {"key": "SHOP-48", "points": 2, "added": "2026-05-12", "moves": [["2026-05-12", "In Progress"]]}
  ]
}
EOF
python3 -c 'import json; d = json.load(open("sprint.json")); print(d["sprint"]["name"], "-", len(d["items"]), "items")'
```

```text output
SHOP Sprint 7 - 9 items
```

## 1. Commitment, scope change and completion

The first question in any sprint review: what did we plan, what came in on top, and what got finished?

```bash run
python3 - <<'EOF'
import json
d = json.load(open("sprint.json"))
start = d["sprint"]["start"]
def done(item):
    return bool(item["moves"]) and item["moves"][-1][1] == "Done"
committed = [i for i in d["items"] if i["added"] <= start]
added = [i for i in d["items"] if i["added"] > start]
pts = lambda items: sum(i["points"] for i in items)
print(f"committed at start: {len(committed)} items, {pts(committed)} points")
fin = [i for i in committed if done(i)]
print(f"  finished: {len(fin)} of {len(committed)} items, {pts(fin)} of {pts(committed)} points ({pts(fin) * 100 // pts(committed)}%)")
print(f"added during sprint: {len(added)} items, {pts(added)} points ({', '.join(i['key'] + ' on ' + i['added'][5:] for i in added)})")
fin = [i for i in added if done(i)]
print(f"  finished: {len(fin)} of {len(added)} items, {pts(fin)} of {pts(added)} points")
left = [i for i in d["items"] if not done(i)]
print("not finished:", ", ".join(f"{i['key']} ({i['moves'][-1][1] if i['moves'] else 'To Do'})" for i in left))
EOF
```

```text output
committed at start: 7 items, 31 points
  finished: 4 of 7 items, 18 of 31 points (58%)
added during sprint: 2 items, 5 points (SHOP-47 on 05-06, SHOP-48 on 05-12)
  finished: 1 of 2 items, 3 of 5 points
not finished: SHOP-44 (In Review), SHOP-45 (In Review), SHOP-46 (To Do), SHOP-48 (In Progress)
```

## 2. The burndown

Remaining points at the end of each day — the line a burndown chart draws. Points burn only when an item reaches **Done**; added items raise the line on the day they join.

```bash run
python3 - <<'EOF'
import json
from datetime import date, timedelta
d = json.load(open("sprint.json"))
day, end = date.fromisoformat(d["sprint"]["start"]), date.fromisoformat(d["sprint"]["end"])
while day <= end:
    if day.weekday() < 5:
        iso = day.isoformat()
        remaining = sum(i["points"] for i in d["items"]
                        if i["added"] <= iso and not any(s == "Done" and when <= iso for when, s in i["moves"]))
        print(f"{iso} {day.strftime('%a')} {remaining:>3} {'#' * remaining}")
    day += timedelta(days=1)
EOF
```

```text output
2026-05-04 Mon  31 ###############################
2026-05-05 Tue  31 ###############################
2026-05-06 Wed  34 ##################################
2026-05-07 Thu  31 ###############################
2026-05-08 Fri  31 ###############################
2026-05-11 Mon  26 ##########################
2026-05-12 Tue  25 #########################
2026-05-13 Wed  23 #######################
2026-05-14 Thu  15 ###############
2026-05-15 Fri  15 ###############
```

## 3. Where did the work wait?

For each finished item, the days it spent in each status. Then, for the whole sprint, how many items sat in each status at the end of each day — a cumulative flow diagram in numbers.

```bash run
python3 - <<'EOF'
import json
from datetime import date
d = json.load(open("sprint.json"))
days = lambda a, b: (date.fromisoformat(b) - date.fromisoformat(a)).days
print(f"{'item':8} {'In Progress':>12} {'In Review':>10}")
totals = {"In Progress": [], "In Review": []}
for i in d["items"]:
    moves = i["moves"]
    if not moves or moves[-1][1] != "Done":
        continue
    spent = {}
    for (when, status), (nxt, _) in zip(moves, moves[1:]):
        spent[status] = spent.get(status, 0) + days(when, nxt)
    for s in totals:
        totals[s].append(spent.get(s, 0))
    print(f"{i['key']:8} {spent.get('In Progress', 0):>12} {spent.get('In Review', 0):>10}")
for s, v in totals.items():
    print(f"average days {s}: {sum(v) / len(v):.1f}")
EOF
```

```text output
item      In Progress  In Review
SHOP-40             1          6
SHOP-41             2          6
SHOP-42             3          6
SHOP-43             1          6
SHOP-47             0          1
average days In Progress: 1.4
average days In Review: 5.0
```

```bash run
python3 - <<'EOF'
import json
from datetime import date, timedelta
d = json.load(open("sprint.json"))
statuses = ["To Do", "In Progress", "In Review", "Done"]
def status_on(item, iso):
    current = "To Do"
    for when, s in item["moves"]:
        if when <= iso:
            current = s
    return current
print(f"{'day':10} " + " ".join(f"{s:>11}" for s in statuses))
day, end = date.fromisoformat(d["sprint"]["start"]), date.fromisoformat(d["sprint"]["end"])
while day <= end:
    if day.weekday() < 5:
        iso = day.isoformat()
        here = [status_on(i, iso) for i in d["items"] if i["added"] <= iso]
        print(f"{iso} " + " ".join(f"{here.count(s):>11}" for s in statuses))
    day += timedelta(days=1)
EOF
```

```text output
day              To Do In Progress   In Review        Done
2026-05-04           5           2           0           0
2026-05-05           4           2           1           0
2026-05-06           3           2           3           0
2026-05-07           2           2           3           1
2026-05-08           2           1           4           1
2026-05-11           1           1           4           2
2026-05-12           1           2           3           3
2026-05-13           1           1           3           4
2026-05-14           1           1           2           5
2026-05-15           1           1           2           5
```

## Questions to think about before you answer

- Which number would you put first in the sprint review, and which would you keep separate?
- Look at the In Review column in the last table. From which day does it hold more items than the In Progress column, and what is the team doing during those days?
- SHOP-46 was never started. Is it a bottleneck, or a sign of something else?

## Reset

The commands only create the `sprint-lab` folder. To start again, delete it: `rm -rf sprint-lab`.

## What you practised

A sprint report answers three different questions — what was planned, what interrupted the plan, and what finished — and mixing them hides the problem. The burndown shows *when* work finished, not when people worked; the time items spend in each status shows *where* they waited. Here the queue was in review: limiting work in review and finishing before starting would do more for the next sprint than committing to more points.
