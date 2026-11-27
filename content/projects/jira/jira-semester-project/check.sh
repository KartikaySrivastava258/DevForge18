#!/usr/bin/env bash
# Acceptance check for "Manage a semester software project".
# Usage: bash check.sh path/to/your/project   (the folder with export.json, written by export.py)
# Reads only export.json — the export of your Jira project. Needs Python 3 (standard library only).
# The workflow's status names are Jira's defaults; if your board uses others, set them, for example:
#   IN_PROGRESS_STATUS="Doing" DONE_STATUS="Finished" bash check.sh my-project
# Prints PASS or FAIL per criterion and exits non-zero if any fails.
exec python3 - "${1:-.}" <<'PY'
import json, os, re, sys

failures = 0
def ok(msg): print(f"PASS: {msg}")
def bad(msg):
    global failures
    failures += 1
    print(f"FAIL: {msg}")
def finish():
    if failures:
        print(f"{failures} criterion check(s) failed.")
        sys.exit(1)
    print("All criteria pass.")
    sys.exit(0)

def load_export(folder):
    path = os.path.join(folder, "export.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        issues = data["issues"]
        assert isinstance(issues, list)
        return data, issues
    except (OSError, ValueError, KeyError, AssertionError) as error:
        bad(f"{path} is missing or not an export from export.py ({error.__class__.__name__})")
        finish()

def F(issue, name): return (issue.get("fields") or {}).get(name)
def kind(issue): return (F(issue, "issuetype") or {}).get("name", "")
def status(issue): return (F(issue, "status") or {}).get("name", "")
def parent(issue): return (F(issue, "parent") or {}).get("key")
def labels(issue): return F(issue, "labels") or []

def adf_blocks(node):
    """Top-level blocks of an Atlassian Document Format description, as (type, text, list items)."""
    def text(n):
        if n.get("type") == "text": return n.get("text", "")
        return " ".join(t for t in (text(c) for c in n.get("content", []) or []) if t)
    out = []
    for block in (node or {}).get("content", []) or []:
        items = [text(i) for i in block.get("content", []) or []] if block.get("type") in ("bulletList", "orderedList") else []
        out.append((block.get("type"), text(block), items))
    return out

def description_text(issue):
    return " ".join(t for _, t, _ in adf_blocks(F(issue, "description")))

def criteria(issue):
    """The list that follows a heading or paragraph saying "Acceptance criteria"."""
    blocks = adf_blocks(F(issue, "description"))
    for i, (_, text, _) in enumerate(blocks):
        if re.match(r"\s*acceptance criteria\s*:?\s*$", text, re.I):
            for btype, _, items in blocks[i + 1:]:
                if btype in ("bulletList", "orderedList"):
                    return [x for x in items if x.strip()]
                if btype == "heading":
                    break
    return []

STORY = re.compile(r"\bas an? .+?\bi want\b.+?\bso that\b", re.I | re.S)

def moves(issue):
    """Status transitions, oldest first (the API lists the most recent first)."""
    out = []
    for h in (issue.get("changelog") or {}).get("histories", []) or []:
        for item in h.get("items", []) or []:
            if item.get("field") == "status":
                out.append((h.get("created", ""), item.get("fromString"), item.get("toString")))
    return sorted(out)

folder = sys.argv[1]
in_progress = os.environ.get("IN_PROGRESS_STATUS", "In Progress")
done = os.environ.get("DONE_STATUS", "Done")
data, issues = load_export(folder)
by_key = {i.get("key"): i for i in issues}

projects = {str(k).rsplit("-", 1)[0] for k in by_key}
if len(issues) >= 10 and len(projects) == 1:
    ok(f"{len(issues)} work items from one project ({projects.pop()})")
else:
    bad(f"export one project with at least 10 work items (found {len(issues)} items from {len(projects)} project(s))")

epics = [i for i in issues if kind(i) == "Epic"]
work = [i for i in issues if kind(i) in ("Story", "Task")]
stories = [i for i in issues if kind(i) == "Story"]
bugs = [i for i in issues if kind(i) == "Bug"]
if len(epics) >= 2: ok(f"{len(epics)} epics group the work")
else: bad(f"plan the semester as at least 2 epics (found {len(epics)})")
orphans = [i["key"] for i in work if kind(by_key.get(parent(i), {})) != "Epic"]
if work and not orphans: ok(f"every story and task ({len(work)}) belongs to an epic")
else: bad(f"every story and task needs an epic as its parent — missing for: {', '.join(orphans) or 'no stories or tasks found'}")

if len(stories) >= 6: ok(f"{len(stories)} stories")
else: bad(f"write at least 6 stories (found {len(stories)})")
not_stories = [i["key"] for i in stories if not STORY.search(description_text(i))]
if stories and not not_stories: ok('every story says who wants what and why ("As a …, I want … so that …")')
else: bad(f'these stories need "As a …, I want … so that …" in the description: {", ".join(not_stories) or "(no stories)"}')
weak = [i["key"] for i in stories if len(criteria(i)) < 2]
if stories and not weak: ok('every story has an "Acceptance criteria" list with at least 2 items')
else: bad(f'these stories need an "Acceptance criteria" heading followed by a list of at least 2 checks: {", ".join(weak) or "(no stories)"}')

def is_bug_report(i):
    text = description_text(i).lower()
    return all(word in text for word in ("steps to reproduce", "expected", "actual"))
good_bugs = [i for i in bugs if is_bug_report(i)]
if good_bugs: ok(f"{len(good_bugs)} bug(s) with steps to reproduce, expected and actual behaviour")
else: bad("record at least one Bug whose description has steps to reproduce, the expected and the actual behaviour")

moved = [i for i in issues if moves(i)]
finished = [i for i in issues if status(i) == done]
if len(moved) >= 5 and finished: ok(f"the board is in use: {len(moved)} items have moved, {len(finished)} are {done}")
else: bad(f"move work across the board: at least 5 items with status changes and at least 1 in {done} (found {len(moved)} moved, {len(finished)} {done})")
skipped = [i["key"] for i in finished if in_progress not in [to for _, _, to in moves(i)]]
if finished and not skipped: ok(f"every {done} item went through {in_progress} first")
else: bad(f"items should not jump straight to {done} — they skew cycle-time reports: {', '.join(skipped) or '(none finished)'}")
wip = [i["key"] for i in issues if status(i) == in_progress]
if len(wip) <= 3: ok(f"{len(wip)} item(s) in {in_progress} (work-in-progress limit 3)")
else: bad(f"{len(wip)} items are {in_progress}; finish work before starting more (limit 3): {', '.join(wip)}")
finish()
PY
