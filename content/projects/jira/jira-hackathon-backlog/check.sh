#!/usr/bin/env bash
# Acceptance check for "Plan a hackathon product backlog".
# Usage: bash check.sh path/to/your/project   (the folder with export.json and plan.md)
# Reads export.json (written by export.py from your Jira project) and plan.md. Needs Python 3.
# Story points are a custom field whose id differs between Jira sites; the check finds it in the export's
# "names" by its display name ("Story point estimate" or "Story Points"). If yours is called something else:
#   STORY_POINTS_FIELD="Estimate" bash check.sh my-project      (a display name or a field id)
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
data, issues = load_export(folder)
by_key = {i.get("key"): i for i in issues}
names = data.get("names") or {}
wanted = os.environ.get("STORY_POINTS_FIELD")
candidates = [wanted] if wanted else ["Story point estimate", "Story Points"]
points_field = next((fid for c in candidates for fid, n in names.items() if fid == c or n == c), None)

epics = [i for i in issues if kind(i) == "Epic"]
stories = [i for i in issues if kind(i) == "Story"]
children = {e["key"]: [s for s in stories if parent(s) == e["key"]] for e in epics}
small = [k for k, c in children.items() if len(c) < 2]
if len(epics) >= 2 and not small: ok(f"{len(epics)} epics, each with at least 2 stories")
else: bad(f"organise the backlog as at least 2 epics with 2 or more stories each (epics: {len(epics)}; too few stories under: {', '.join(small) or '-'})")

not_stories = [i["key"] for i in stories if not STORY.search(description_text(i))]
weak = [i["key"] for i in stories if len(criteria(i)) < 2]
if stories and not not_stories and not weak: ok(f"all {len(stories)} stories have the user-story form and at least 2 acceptance criteria")
else: bad(f"stories need \"As a …, I want … so that …\" and an \"Acceptance criteria\" list of 2+ items — fix: {', '.join(sorted(set(not_stories + weak))) or '(no stories)'}")

def scope(i):
    s = {l for l in labels(i) if l in ("mvp", "later")}
    return s.pop() if len(s) == 1 else None
unscoped = [i["key"] for i in stories if scope(i) is None]
mvp = [i for i in stories if scope(i) == "mvp"]
later = [i for i in stories if scope(i) == "later"]
if stories and not unscoped and len(mvp) >= 5 and later: ok(f"every story is labelled mvp ({len(mvp)}) or later ({len(later)})")
else: bad(f"label every story with exactly one of mvp or later, with at least 5 mvp and at least 1 later (unlabelled or both: {', '.join(unscoped) or '-'}; mvp {len(mvp)}, later {len(later)})")

total = 0
if not points_field:
    bad(f"no story-point field in the export's names (looked for {', '.join(candidates)}); export with export.py, or set STORY_POINTS_FIELD")
else:
    bad_points = []
    for i in mvp:
        v = F(i, points_field)
        if v in (1, 2, 3, 5, 8, 1.0, 2.0, 3.0, 5.0, 8.0): total += int(v)
        else: bad_points.append(f"{i['key']}={v}")
    if mvp and not bad_points: ok(f"every mvp story is estimated with 1, 2, 3, 5 or 8 points ({total} in total)")
    else: bad(f"estimate every mvp story with 1, 2, 3, 5 or 8 points — split anything bigger: {', '.join(bad_points) or '(no mvp stories)'}")

try:
    plan = open(os.path.join(folder, "plan.md"), encoding="utf-8").read()
except OSError:
    plan = ""
    bad("plan.md is missing")
if plan:
    cap = re.search(r"^capacity:\s*(\d+)\s*points?\s*$", plan, re.I | re.M)
    goal = re.search(r"^sprint goal:\s*(\S.{10,})$", plan, re.I | re.M)
    if goal and cap: ok(f"plan.md states the sprint goal and a capacity of {cap.group(1)} points")
    else: bad('plan.md needs a line "Sprint goal: …" (a sentence) and a line "Capacity: N points"')
    if cap and points_field and mvp:
        if total <= int(cap.group(1)): ok(f"the MVP ({total} points) fits the team's capacity ({cap.group(1)} points)")
        else: bad(f"the MVP is {total} points but capacity is {cap.group(1)}: move stories to later, or split them")
    section = re.search(r"^## *MVP *$(.*?)(?=^## |\Z)", plan, re.I | re.M | re.S)
    listed = set(re.findall(r"\b[A-Z][A-Z0-9]+-\d+\b", section.group(1))) if section else set()
    missing = sorted(i["key"] for i in mvp if i["key"] not in listed)
    wrong = sorted(k for k in listed if k not in {i["key"] for i in mvp})
    if section and not missing and not wrong: ok("plan.md's MVP section lists exactly the mvp stories")
    else: bad(f"plan.md needs a \"## MVP\" section listing every mvp story key and nothing else (missing: {', '.join(missing) or '-'}; not mvp: {', '.join(wrong) or '-'})")
finish()
PY
