#!/usr/bin/env bash
# Acceptance check for "Build a release and bug-triage workflow".
# Usage: bash check.sh path/to/your/repository
# The folder is the product's Git repository; it also holds export.json (written by export.py from your Jira
# project) and RELEASE_NOTES.md. Needs Python 3 and Git. Status names default to Triage, In Progress and Done;
# set TRIAGE_STATUS, IN_PROGRESS_STATUS or DONE_STATUS if your workflow uses others.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. It only reads the repository.
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
import subprocess

folder = sys.argv[1]
triage = os.environ.get("TRIAGE_STATUS", "Triage")
in_progress = os.environ.get("IN_PROGRESS_STATUS", "In Progress")
done = os.environ.get("DONE_STATUS", "Done")

def git(*args):
    r = subprocess.run(["git", "-C", folder, *args], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

top = (git("rev-parse", "--show-toplevel") or "").strip()
if not top or os.path.realpath(top) != os.path.realpath(folder) or git("rev-parse", "--verify", "-q", "main^{commit}") is None:
    bad(f"{folder} must be the top folder of a Git repository with a main branch")
data, issues = load_export(folder)
by_key = {i.get("key"): i for i in issues}
project = (sorted(by_key)[0].rsplit("-", 1)[0] if by_key else "X")

bugs = [i for i in issues if kind(i) == "Bug"]
SEVERITIES = {"severity-critical", "severity-major", "severity-minor"}
unsorted = [i["key"] for i in bugs if len(SEVERITIES & set(labels(i))) != 1 or not (F(i, "priority") or {}).get("name")]
if len(bugs) >= 5 and not unsorted: ok(f"{len(bugs)} bugs, each with a priority and one severity label")
else: bad(f"triage at least 5 bugs, each with a priority and exactly one of {', '.join(sorted(SEVERITIES))} (bugs: {len(bugs)}; to fix: {', '.join(unsorted) or '-'})")

def triaged_first(i):
    targets = [to for _, _, to in moves(i)]
    if in_progress not in targets: return True
    return triage in targets[: targets.index(in_progress)]
skipped = [i["key"] for i in bugs if not triaged_first(i)]
started = [i for i in bugs if in_progress in [to for _, _, to in moves(i)]]
if started and not skipped: ok(f"every bug that was worked on ({len(started)}) went through {triage} first")
else: bad(f"bugs must be triaged before work starts ({triage} before {in_progress}): {', '.join(skipped) or 'no bug has been worked on yet'}")

try:
    notes = open(os.path.join(folder, "RELEASE_NOTES.md"), encoding="utf-8").read()
except OSError:
    notes = ""
m = re.search(r"^# +Release +(\d+\.\d+\.\d+)\s*$", notes, re.M)
if not m:
    bad('RELEASE_NOTES.md must start with a heading "# Release X.Y.Z"')
    finish()
version = m.group(1)
in_release = [i for i in issues if version in [v.get("name") for v in F(i, "fixVersions") or []]]
done_bugs_without = [i["key"] for i in bugs if status(i) == done and not (F(i, "fixVersions") or [])]
if len(in_release) >= 3 and not done_bugs_without: ok(f"{len(in_release)} work items have fix version {version}, and every {done} bug has a fix version")
else: bad(f"set the fix version: at least 3 items in {version}, and every {done} bug in some version (items in {version}: {len(in_release)}; {done} bugs without one: {', '.join(done_bugs_without) or '-'})")
unfinished = [i["key"] for i in in_release if status(i) != done]
if in_release and not unfinished: ok(f"every item in {version} is {done}")
else: bad(f"release {version} contains unfinished items — finish them or move them to the next version: {', '.join(unfinished) or '(none in the release)'}")
blockers = [i["key"] for i in bugs if "severity-critical" in labels(i) and status(i) != done]
if not blockers: ok("no critical bug is open")
else: bad(f"critical bugs are still open — fix them before releasing: {', '.join(blockers)}")

listed = set(re.findall(rf"\b{re.escape(project)}-\d+\b", notes))
expected = {i["key"] for i in in_release}
if expected and listed == expected: ok(f"RELEASE_NOTES.md lists exactly the {len(expected)} items in {version}")
else: bad(f"RELEASE_NOTES.md must list exactly the items with fix version {version} (missing: {', '.join(sorted(expected - listed)) or '-'}; not in the release: {', '.join(sorted(listed - expected)) or '-'})")

log = git("log", "main", "--format=%H%x09%s%x09%b%x1e") or ""
commits = [c.strip().split("\t", 1) for c in log.split("\x1e") if c.strip()]
lower = [msg.split("\t")[0][:60] for _, msg in commits if re.search(rf"\b{re.escape(project.lower())}-\d+\b", msg)]
if commits and not lower: ok("commit messages write work item keys in capitals")
else: bad(f"write work item keys in capitals, as Atlassian's documentation asks (e.g. {project}-12), so Jira links the commits: {'; '.join(lower) or 'no commits on main'}")
unlinked = [k for k in sorted(expected) if not any(re.search(rf"\b{re.escape(k)}\b", msg) for _, msg in commits)]
if expected and not unlinked: ok(f"every item in {version} has a commit on main that names its key")
else: bad(f"every item in the release needs a commit on main mentioning its key: {', '.join(unlinked) or '(no items)'}")

tag = f"v{version}"
if git("cat-file", "-t", f"refs/tags/{tag}") != "tag\n":
    bad(f"there is no annotated tag {tag} (git tag -a {tag} -m \"Release {version}\")")
else:
    missing = []
    for k in sorted(expected):
        shas = [sha for sha, msg in commits if re.search(rf"\b{re.escape(k)}\b", msg)]
        if shas and not all(subprocess.run(["git", "-C", folder, "merge-base", "--is-ancestor", s, tag]).returncode == 0 for s in shas):
            missing.append(k)
    if not missing: ok(f"tag {tag} includes the commits of every item in the release")
    else: bad(f"tag {tag} is missing commits for: {', '.join(missing)} — tag the commit that contains them all")
finish()
PY
