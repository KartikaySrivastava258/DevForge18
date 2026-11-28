---
id: jira-plan-a-student-project-backlog
title: Create a student project backlog
track: jira
level: beginner
mode: local
estimated_minutes: 35
prerequisites: [jira-work-items-and-workflows]
objectives:
  - Turn a vague list of tasks into epics, stories, tasks and a bug, each with the parts its work type needs.
  - Write stories in the "As a … I want … so that …" form with acceptance criteria that can be tested with yes or no.
  - Split work that is too big for one sprint, and write a bug someone else can reproduce.
checkpoints:
  - { id: review-failed, text: "The review script listed the problems in the first draft" }
  - { id: review-clean, text: "After rewriting, the review script reported no problems" }
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
    why: Detailed, current documentation for configuring and administering Jira Cloud, if you later enter the backlog into a real site.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with the host's Python 3 (standard library only), and their output is compared with this page. The check script is also run in an empty folder, where it must fail. No Jira site is needed or used; the backlog is a text file in the shape you would enter into Jira.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

Four students are starting a semester project: a library-catalogue web app. Their "backlog" is a list of reminders — *login*, *frontend stuff*, *fix bug*. You turn it into a backlog a team can plan from: epics for the big goals, stories with acceptance criteria, a task, and a bug someone else can reproduce. A small review script points out problems as you go, and a check script confirms the result.

## Before you start

You need Python 3.10 or newer and a terminal. No Jira site is needed: you write the backlog in a text file, one heading per work item, in the shape you would later enter into Jira (or into GitHub Issues, or on cards). Keys such as `LIB-2` follow Jira's pattern of a project's short name and a number.

## Steps

### 1. The file format

Each work item is a heading with its work type, key and summary; stories and tasks end with their estimate in points. Everything under a heading until the next one is its description.

```text
## Epic LIB-1: Find books
### Story LIB-2: Search the catalogue by title (3 points)
As a student, I want to …, so that …
- An acceptance criterion
### Bug LIB-9: …
Steps: …
Expected: …
Actual: …
```

### 2. A first draft

This draft is close to what teams really write in their first week.

```bash run
mkdir backlog-lab && cd backlog-lab
cat > backlog.md <<'EOF'
# LIB: Library catalogue (semester project)

## Epic LIB-1: Find books
### Story LIB-2: Search (3 points)
Search should be fast and easy.
### Story LIB-3: Everything about borrowing (13 points)
As a student, I want to borrow, renew and return books online, so that I do not have to queue at the desk.
- Borrowing works
- It is user-friendly

### Bug LIB-4: fix bug
Search is broken.
EOF
echo "draft written"
```

```text output
draft written
```

### 3. A review script

The script reads `backlog.md` and applies the checklist from *Work items, types and workflows*: stories name a user, a goal and a reason, have at least two criteria without vague words, and fit in a sprint (8 points at most here); bugs say how to reproduce them; every item sits under an epic.

```bash run
cat > review.py <<'EOF'
import re, sys

FORM = re.compile(r"^As an? .+, I want .+, so that .+\.$")
VAGUE = ("easy", "fast", "nice", "user-friendly", "works")
items, epic = [], None
for line in open("backlog.md", encoding="utf-8").read().splitlines():
    if m := re.match(r"^## Epic (LIB-\d+): (.+)$", line):
        epic = m[1]
        items.append({"type": "Epic", "key": m[1], "summary": m[2], "body": []})
    elif m := re.match(r"^### (Story|Task|Bug) (LIB-\d+): (.+?)(?: \((\d+) points?\))?$", line):
        items.append({"type": m[1], "key": m[2], "summary": m[3], "points": m[4] and int(m[4]), "epic": epic, "body": []})
    elif items and line.strip():
        items[-1]["body"].append(line.strip())

problems = []
for it in items:
    where = f"{it['key']} ({it['type']})"
    body, criteria = it["body"], [l[2:] for l in it["body"] if l.startswith("- ")]
    if it["type"] != "Epic" and not it["epic"]:
        problems.append(f"{where}: not under an epic")
    if it["type"] in ("Story", "Task"):
        if it["points"] is None:
            problems.append(f"{where}: no estimate")
        elif it["points"] > 8:
            problems.append(f"{where}: {it['points']} points is too big for one sprint; split it")
    if it["type"] == "Story":
        if not any(FORM.match(l) for l in body):
            problems.append(f"{where}: no 'As a …, I want …, so that ….' sentence")
        if len(criteria) < 2:
            problems.append(f"{where}: needs at least two acceptance criteria")
        for c in criteria:
            if any(re.search(rf"\b{v}\b", c, re.I) for v in VAGUE):
                problems.append(f"{where}: criterion '{c}' cannot be tested with yes or no")
    if it["type"] == "Bug":
        for part in ("Steps:", "Expected:", "Actual:"):
            if not any(l.startswith(part) for l in body):
                problems.append(f"{where}: missing '{part}'")
        if len(it["summary"]) < 15:
            problems.append(f"{where}: the summary '{it['summary']}' does not say what is wrong")
names = {"Epic": ("epic", "epics"), "Story": ("story", "stories"), "Task": ("task", "tasks"), "Bug": ("bug", "bugs")}
counts = {t: sum(1 for i in items if i["type"] == t) for t in names}
print(", ".join(f"{n} {names[t][n != 1]}" for t, n in counts.items()))
print("\n".join(problems) if problems else "no problems found")
sys.exit(1 if problems else 0)
EOF
python3 review.py || echo "(review found problems)"
```

```text output
1 epic, 2 stories, 0 tasks, 1 bug
LIB-2 (Story): no 'As a …, I want …, so that ….' sentence
LIB-2 (Story): needs at least two acceptance criteria
LIB-3 (Story): 13 points is too big for one sprint; split it
LIB-3 (Story): criterion 'Borrowing works' cannot be tested with yes or no
LIB-3 (Story): criterion 'It is user-friendly' cannot be tested with yes or no
LIB-4 (Bug): missing 'Steps:'
LIB-4 (Bug): missing 'Expected:'
LIB-4 (Bug): missing 'Actual:'
LIB-4 (Bug): the summary 'fix bug' does not say what is wrong
(review found problems)
```

Every line is a habit that makes a board hard to use: a story nobody can test, a 13-point "story" that is really an epic, a bug titled *fix bug* that nobody else can reproduce.

### 4. Rewrite the backlog

Split the borrowing story into stories that each deliver something a student can try, give each one testable criteria, add a second epic, a task, and a reproducible bug.

```bash run
cat > backlog.md <<'EOF'
# LIB: Library catalogue (semester project)

## Epic LIB-1: Find books
### Story LIB-2: Search the catalogue by title (3 points)
As a student, I want to search the catalogue by title, so that I can find a book without asking at the desk.
- Typing part of a title lists every book whose title contains it, ignoring capitals.
- Each result shows the title, the author and how many copies are on the shelf.
- A search with no matches says "No books found" and suggests checking the spelling.
### Story LIB-5: Filter search results by subject (2 points)
As a student, I want to filter search results by subject, so that I see only books for my course.
- The subject list contains only subjects that have at least one book.
- Choosing a subject keeps the search text and shows only books with that subject.
### Bug LIB-4: Search for a title with an apostrophe shows an error page
Steps: Open the catalogue, type O'Reilly in the search box and press Enter.
Expected: The books whose titles contain O'Reilly are listed.
Actual: An "Internal Server Error" page appears; other searches still work.

## Epic LIB-6: Borrow books online
### Story LIB-3: Reserve a book that is on the shelf (5 points)
As a student, I want to reserve a book that is on the shelf, so that it is kept for me until I collect it.
- Reserving lowers the number of copies on the shelf by one.
- A reservation not collected within two days is cancelled and the copy is released.
### Story LIB-7: Renew a borrowed book (3 points)
As a student, I want to renew a book I have borrowed, so that I can keep it for another two weeks.
- Renewing moves the due date two weeks from today.
- A book that another student has reserved cannot be renewed, and the page says why.
### Story LIB-8: See my borrowed books and due dates (2 points)
As a student, I want to see the books I have borrowed with their due dates, so that I return them on time.
- The list shows every book I have borrowed, sorted by due date, soonest first.
- Books due within three days are marked "due soon".
### Task LIB-10: Set up the database schema for books and loans (3 points)
Create the tables for books, copies and loans, with foreign keys, in a migration that runs on an empty database.
EOF
python3 review.py
```

```text output
2 epics, 5 stories, 1 task, 1 bug
no problems found
```

The big borrowing story became three stories, each small enough to finish and show at the end of a sprint. The criteria are now things a tester can answer with yes or no.

## Check your work

Run this inside `backlog-lab`. It does not use `review.py` — it reads `backlog.md` itself.

```bash run check
python3 - <<'CHECK'
import os, re, sys
results = []
def check(name, ok):
    results.append(ok)
    print(("PASS: " if ok else "FAIL: ") + name)
text = open("backlog.md", encoding="utf-8").read() if os.path.exists("backlog.md") else ""
heads = re.findall(r"^(##|###) (Epic|Story|Task|Bug) (LIB-\d+): (.+)$", text, re.M)
blocks = re.split(r"^(?=##+ (?:Epic|Story|Task|Bug) )", text, flags=re.M)
item = lambda t: [b for b in blocks if re.match(rf"^##+ {t} ", b)]
stories, bugs = item("Story"), item("Bug")
keys = [h[2] for h in heads]
check("backlog.md has at least two epics", len(item("Epic")) >= 2)
check("it has at least five stories and one bug", len(stories) >= 5 and len(bugs) >= 1)
check("every key is unique", len(keys) == len(set(keys)) and len(keys) > 0)
check("no item comes before the first epic", bool(heads) and heads[0][1] == "Epic")
check("every story says who, what and why", bool(stories) and all(re.search(r"^As an? .+, I want .+, so that .+", s, re.M) for s in stories))
check("every story has at least two acceptance criteria", bool(stories) and all(len(re.findall(r"^- ", s, re.M)) >= 2 for s in stories))
check("every story and task is estimated at 8 points or less", bool(stories) and all((m := re.search(r"\((\d+) points?\)", s.splitlines()[0])) and int(m[1]) <= 8 for s in stories + item("Task")))
check("no criterion uses a vague word", bool(stories) and not re.search(r"^- .*\b(easy|fast|nice|user-friendly|works)\b", "".join(stories), re.M | re.I))
check("every bug has steps, expected and actual results", bool(bugs) and all(all(re.search(rf"^{p}: .+", b, re.M) for p in ("Steps", "Expected", "Actual")) for b in bugs))
print("All checks passed" if all(results) else "Some checks failed")
sys.exit(0 if all(results) else 1)
CHECK
```

```text output
PASS: backlog.md has at least two epics
PASS: it has at least five stories and one bug
PASS: every key is unique
PASS: no item comes before the first epic
PASS: every story says who, what and why
PASS: every story has at least two acceptance criteria
PASS: every story and task is estimated at 8 points or less
PASS: no criterion uses a vague word
PASS: every bug has steps, expected and actual results
All checks passed
```

## Reset

The lab only creates the `backlog-lab` folder. To start again, leave it and delete it — `cd .. && rm -rf backlog-lab` — then begin at step 2.

## Take it further

If your team uses Jira, create the epics and work items from this file in a practice project (Jira has a free plan; check Atlassian's current terms). The work types, keys and descriptions map one to one; the estimate goes in the *Story point estimate* field where your project has it. GitHub Issues with labels and milestones works just as well for a small team.

## What you practised

A backlog is useful when someone who was not in the planning meeting can read any item and know who it is for, what "done" means and how big it is. Epics hold goals, stories deliver something a user can try, tasks cover necessary work users do not see, and a good bug report lets anyone reproduce the problem.
