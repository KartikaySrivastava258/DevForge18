---
id: jira-move-a-bug-through-a-workflow
title: Move a bug through a workflow
track: jira
level: intermediate
mode: local
estimated_minutes: 35
prerequisites: [jira-work-items-and-workflows]
objectives:
  - Read a workflow as statuses plus the transitions allowed between them, and predict which moves it refuses.
  - Add a Triage status with conditions, so no bug is worked on before someone has set its severity and owner.
  - Move a bug from report to Done — including a trip back from review — and read its history.
  - Close a duplicate from Triage with a resolution, without pretending work was done.
checkpoints:
  - { id: refused, text: "The workflow refused To Do → In Progress, and Triage → In Progress until severity and assignee were set" }
  - { id: history, text: "CAFE-1's history shows Triage, a return from In Review, and Done with resolution Fixed" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: What are work types?
    url: https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: Atlassian's definitions of epics, stories, tasks, bugs and subtasks.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Jira Cloud documentation
    url: https://support.atlassian.com/jira-software-cloud/
    publisher: Atlassian
    type: documentation
    level: all
    official: true
    why: Where Jira's own workflow editor, statuses and transitions are documented, for when you configure a real project.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with the host's Python 3 (standard library only), and their output is compared with this page. The check script is also run in an empty folder, where it must fail. jira.py is a small teaching model of workflow rules (statuses, transitions and required fields), not Jira; no Jira site is needed.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

The college canteen's pre-order app has a bug: a discount code can be applied twice by refreshing the page. Today, bugs go straight from *To Do* to *In Progress*, often before anyone has decided how serious they are or who owns them. You add a **Triage** step with rules, then take the bug from report to *Done* — including a trip back from review — and close a duplicate properly.

## Before you start

You need Python 3.10 or newer. Instead of a Jira site, the lab uses `jira.py`, a **teaching model** of the part of Jira that matters here: a workflow is a set of **statuses** and the **transitions** allowed between them, and a transition can require fields to be filled in first (Jira calls these conditions and validators, and offers more kinds than this model). In a real project, an administrator sets the same rules in Jira's workflow editor.

## Steps

### 1. The model and today's workflow

```bash run
mkdir workflow-lab && cd workflow-lab
cat > jira.py <<'EOF'
"""A teaching model of workflow rules — statuses, transitions and required fields. Not Jira."""
import json, os, sys

wf = json.load(open("workflow.json"))
db = json.load(open("bugs.json")) if os.path.exists("bugs.json") else {"next": 1, "items": {}}
cmd, *args = sys.argv[1:]

def save():
    with open("bugs.json", "w") as f:
        json.dump(db, f, indent=1)

if cmd == "create":                       # create "SUMMARY"
    key = f"{wf['project']}-{db['next']}"
    db["next"] += 1
    db["items"][key] = {"summary": args[0], "status": wf["initial"], "fields": {}, "history": []}
    save()
    print(f"{key} created in {wf['initial']}: {args[0]}")
elif cmd == "set":                        # set KEY FIELD VALUE
    key, field, value = args
    db["items"][key]["fields"][field] = value
    save()
    print(f"{key}: {field} = {value}")
elif cmd == "move":                       # move KEY STATUS
    key, to = args
    item = db["items"][key]
    frm = item["status"]
    options = [t for t in wf["transitions"] if t["from"] == frm]
    t = next((t for t in options if t["to"] == to), None)
    if t is None:
        print(f"{key}: no transition from {frm} to {to} (allowed: {', '.join(o['to'] for o in options) or 'none'})")
        sys.exit(1)
    missing = [f for f in t.get("requires", []) if not item["fields"].get(f)]
    if missing:
        print(f"{key}: {frm} -> {to} needs {', '.join(missing)}")
        sys.exit(1)
    item["status"] = to
    item["history"].append([frm, to])
    save()
    print(f"{key}: {frm} -> {to}")
elif cmd == "show":                       # show KEY
    item = db["items"][args[0]]
    print(f"{args[0]} [{item['status']}] {item['summary']}")
    for field, value in sorted(item["fields"].items()):
        print(f"  {field}: {value}")
    print("  history: " + " -> ".join([wf["initial"]] + [to for _, to in item["history"]]))
EOF
cat > workflow.json <<'EOF'
{
  "project": "CAFE",
  "initial": "To Do",
  "transitions": [
    {"from": "To Do", "to": "In Progress"},
    {"from": "In Progress", "to": "In Review"},
    {"from": "In Review", "to": "In Progress"},
    {"from": "In Review", "to": "Done"}
  ]
}
EOF
python3 jira.py create "Discount code can be applied twice by refreshing the order page"
python3 jira.py move CAFE-1 In\ Progress
```

```text output
CAFE-1 created in To Do: Discount code can be applied twice by refreshing the order page
CAFE-1: To Do -> In Progress
```

Nothing stopped someone from starting work on a bug nobody had assessed. Start again with an empty list of bugs:

```bash run
rm bugs.json
echo "bugs cleared"
```

```text output
bugs cleared
```

### 2. Add Triage, with conditions

The team agrees: every new bug goes to **Triage** first. It may leave Triage for *In Progress* only with a severity and an assignee, or straight to *Done* with a resolution (for duplicates and bugs that will not be fixed). Nothing reaches *Done* from review without a resolution and the version that will contain the fix.

```bash run
cat > workflow.json <<'EOF'
{
  "project": "CAFE",
  "initial": "To Do",
  "transitions": [
    {"from": "To Do", "to": "Triage"},
    {"from": "Triage", "to": "In Progress", "requires": ["severity", "assignee"]},
    {"from": "Triage", "to": "Done", "requires": ["resolution"]},
    {"from": "In Progress", "to": "In Review"},
    {"from": "In Review", "to": "In Progress"},
    {"from": "In Review", "to": "Done", "requires": ["resolution", "fix_version"]}
  ]
}
EOF
python3 jira.py create "Discount code can be applied twice by refreshing the order page"
python3 jira.py move CAFE-1 "In Progress" || echo "(refused)"
python3 jira.py move CAFE-1 Triage
python3 jira.py move CAFE-1 "In Progress" || echo "(refused)"
```

```text output
CAFE-1 created in To Do: Discount code can be applied twice by refreshing the order page
CAFE-1: no transition from To Do to In Progress (allowed: Triage)
(refused)
CAFE-1: To Do -> Triage
CAFE-1: Triage -> In Progress needs severity, assignee
(refused)
```

The first refusal is a missing **transition**: the path does not exist. The second is a missing **condition**: the path exists, but the bug is not ready to take it.

### 3. Triage, work, review — and back again

```bash run
python3 jira.py set CAFE-1 severity High
python3 jira.py set CAFE-1 assignee asha
python3 jira.py move CAFE-1 "In Progress"
python3 jira.py move CAFE-1 "In Review"
# The reviewer finds no test that fails without the fix, and sends the bug back.
python3 jira.py move CAFE-1 "In Progress"
python3 jira.py move CAFE-1 "In Review"
python3 jira.py move CAFE-1 Done || echo "(refused)"
python3 jira.py set CAFE-1 resolution Fixed
python3 jira.py set CAFE-1 fix_version 1.1.0
python3 jira.py move CAFE-1 Done
python3 jira.py show CAFE-1
```

```text output
CAFE-1: severity = High
CAFE-1: assignee = asha
CAFE-1: Triage -> In Progress
CAFE-1: In Progress -> In Review
CAFE-1: In Review -> In Progress
CAFE-1: In Progress -> In Review
CAFE-1: In Review -> Done needs resolution, fix_version
(refused)
CAFE-1: resolution = Fixed
CAFE-1: fix_version = 1.1.0
CAFE-1: In Review -> Done
CAFE-1 [Done] Discount code can be applied twice by refreshing the order page
  assignee: asha
  fix_version: 1.1.0
  resolution: Fixed
  severity: High
  history: To Do -> Triage -> In Progress -> In Review -> In Progress -> In Review -> Done
```

The history is the useful part: it shows the bug waited for triage, went back once from review, and which release fixes it. Reports such as cycle time are computed from exactly this kind of history (*Kanban and flow metrics in depth*).

### 4. Close a duplicate without pretending to work on it

```bash run
python3 jira.py create "Using a discount code twice gives double discount"
python3 jira.py move CAFE-2 Triage
python3 jira.py set CAFE-2 resolution "Duplicate of CAFE-1"
python3 jira.py move CAFE-2 Done
python3 jira.py show CAFE-2
```

```text output
CAFE-2 created in To Do: Using a discount code twice gives double discount
CAFE-2: To Do -> Triage
CAFE-2: resolution = Duplicate of CAFE-1
CAFE-2: Triage -> Done
CAFE-2 [Done] Using a discount code twice gives double discount
  resolution: Duplicate of CAFE-1
  history: To Do -> Triage -> Done
```

*Done* with resolution *Duplicate* is honest: the item is closed, and nobody's report claims work was done on it.

## Check your work

Run this inside `workflow-lab`. It reads `workflow.json` and `bugs.json` directly.

```bash run check
python3 - <<'CHECK'
import json, os, sys
results = []
def check(name, ok):
    results.append(bool(ok))
    print(("PASS: " if ok else "FAIL: ") + name)
load = lambda f: json.load(open(f)) if os.path.exists(f) else {}
wf, db = load("workflow.json"), load("bugs.json")
ts = wf.get("transitions", [])
rule = lambda a, b: next((t for t in ts if t["from"] == a and t["to"] == b), None)
bug = db.get("items", {}).get("CAFE-1", {})
path = [wf.get("initial")] + [to for _, to in bug.get("history", [])]
closed = [k for k, i in db.get("items", {}).items() if i["status"] == "Done" and "In Progress" not in [to for _, to in i["history"]]]
check("new bugs go to Triage; To Do cannot skip it", rule("To Do", "Triage") and not rule("To Do", "In Progress"))
check("leaving Triage for work needs severity and assignee", set((rule("Triage", "In Progress") or {}).get("requires", [])) >= {"severity", "assignee"})
check("Done from review needs a resolution and a fix version", set((rule("In Review", "Done") or {}).get("requires", [])) >= {"resolution", "fix_version"})
check("CAFE-1 is Done, resolution Fixed, with a fix version", bug.get("status") == "Done" and bug["fields"].get("resolution") == "Fixed" and bug["fields"].get("fix_version"))
check("CAFE-1 was triaged before work started", "Triage" in path and "In Progress" in path and path.index("Triage") < path.index("In Progress"))
check("CAFE-1 went back from review at least once", ["In Review", "In Progress"] in bug.get("history", []))
check("a duplicate was closed from Triage with a resolution", any(db["items"][k]["fields"].get("resolution") for k in closed))
print("All checks passed" if all(results) else "Some checks failed")
sys.exit(0 if all(results) else 1)
CHECK
```

```text output
PASS: new bugs go to Triage; To Do cannot skip it
PASS: leaving Triage for work needs severity and assignee
PASS: Done from review needs a resolution and a fix version
PASS: CAFE-1 is Done, resolution Fixed, with a fix version
PASS: CAFE-1 was triaged before work started
PASS: CAFE-1 went back from review at least once
PASS: a duplicate was closed from Triage with a resolution
All checks passed
```

## Reset

The lab only creates the `workflow-lab` folder. To start again, delete `bugs.json` (the bugs) or the whole folder — `cd .. && rm -rf workflow-lab` — and begin at step 1.

## Take it further

In a practice Jira project (Jira has a free plan; check Atlassian's current terms), open the project's workflow, add a Triage status and the transitions above, and compare what the editor lets you require on a transition with this model. Keep workflows short: every extra status is a place where work can wait.

## What you practised

A workflow encodes a team's agreements: which steps exist, which moves are allowed, and what must be true before a move. Triage with conditions stops unassessed work from starting; resolutions say *why* something is closed; and the history of moves is what every flow report is built from.
