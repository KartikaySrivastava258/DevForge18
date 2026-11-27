#!/usr/bin/env bash
# Acceptance check for "Team task tracker with branches and pull requests".
# Usage: bash check.sh path/to/your/task-tracker
# Works on a local repository or a fresh clone of your GitHub repository. Prints PASS or FAIL for each
# criterion and exits non-zero if any fails. It only reads the repository: behaviour and tests run on a copy
# of what is committed on main.
set -uo pipefail
repo="${1:-.}"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
g() { git -C "$repo" "$@"; }

if [ "$(g rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ] || ! g rev-parse -q --verify main^{commit} > /dev/null; then
  fail "$repo is not a Git repository with a main branch"
  echo "1 or more criteria failed."
  exit 1
fi

# main only changes through merges: after the first commit, every commit on main's first-parent line is a merge.
root="$(g rev-list --max-parents=0 main | tail -n 1)"
direct="$(g rev-list --first-parent --no-merges main | grep -v "^$root$" | wc -l)"
merges="$(g rev-list --first-parent --merges main | wc -l)"
if [ "$direct" -eq 0 ]; then pass "after the first commit, main only changed through merges"; else fail "$direct commit(s) were made directly on main; make every change on a branch and merge it"; fi
if [ "$merges" -ge 2 ]; then pass "$merges branches were merged into main with merge commits (at least 2)"; else fail "$merges branch(es) merged into main with a merge commit; merge at least 2 (use a merge commit, not squash or rebase)"; fi

committed() { g cat-file -e "main:$1" 2> /dev/null; }

template=""
for path in .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md pull_request_template.md docs/pull_request_template.md; do
  committed "$path" && template="$path" && break
done
if [ -z "$template" ]; then
  fail "no pull request template is committed (for example .github/pull_request_template.md)"
else
  items="$(g show "main:$template" | grep -c '^ *- \[ \]')"
  if [ "$items" -ge 3 ]; then pass "$template has a checklist of $items items"; else fail "$template needs a checklist with at least 3 \"- [ ]\" items (it has $items)"; fi
fi

owners=""
for path in .github/CODEOWNERS CODEOWNERS docs/CODEOWNERS; do
  committed "$path" && owners="$path" && break
done
if [ -n "$owners" ] && g show "main:$owners" | grep -Eq '^[^#[:space:]].*[[:space:]]@[^[:space:]]+'; then
  pass "$owners assigns reviewers"
else
  fail "commit a CODEOWNERS file (for example .github/CODEOWNERS) with a rule such as \"* @your-org/reviewers\""
fi

leaked="$(g log --all --name-only --format= | sort -u | grep -E '(^|/)tasks\.json$')"
if [ -n "$leaked" ]; then fail "tasks.json (personal data) is in the history"
elif g check-ignore -q --no-index tasks.json; then pass "tasks.json is ignored and was never committed"
else fail "tasks.json is not ignored; add it to .gitignore"; fi

dirty="$(g status --porcelain)"
if [ -z "$dirty" ]; then pass "the working tree is clean"; else fail "uncommitted or untracked changes: $(echo "$dirty" | tr '\n' ' ')"; fi

# Behaviour and tests, on a copy of what is committed on main.
copy="$(mktemp -d)"
trap 'rm -rf "$copy"' EXIT
g archive main | tar -x -C "$copy"
run() { (cd "$copy" && TASKS_FILE="$copy/check-data.json" python3 tasks.py "$@" 2>&1); }

if [ ! -f "$copy/tasks.py" ]; then
  fail "tasks.py is not committed on main"
else
  run add "Write the report" > /dev/null
  run add "Book a room" > /dev/null
  done_out="$(run done 1)"
  open_out="$(run list --open)"
  all_out="$(run list)"
  run done 99 > /dev/null; unknown_status=$?
  if [ "$done_out" = "Completed task 1." ] && [ "$all_out" = "$(printf '[x] 1. Write the report\n[ ] 2. Book a room')" ]; then
    pass "\"tasks.py done 1\" marks task 1 as done"
  else
    fail "\"tasks.py done 1\" should print \"Completed task 1.\" and mark it [x]; got: $done_out / $(echo "$all_out" | tr '\n' ' ')"
  fi
  if [ "$open_out" = "[ ] 2. Book a room" ]; then pass "\"tasks.py list --open\" shows only unfinished tasks"; else fail "\"tasks.py list --open\" should show only \"[ ] 2. Book a room\"; got: $(echo "$open_out" | tr '\n' ' ')"; fi
  if [ "$unknown_status" -eq 1 ]; then pass "an unknown task id exits with status 1"; else fail "\"tasks.py done 99\" (no such task) should exit with status 1, not $unknown_status"; fi

  tests_out="$(cd "$copy" && python3 -m unittest -v 2>&1)"; tests_status=$?
  ran="$(echo "$tests_out" | sed -n 's/^Ran \([0-9]*\) tests\{0,1\}.*/\1/p')"
  if [ "$tests_status" -eq 0 ] && [ "${ran:-0}" -ge 5 ]; then
    pass "the unit tests pass ($ran tests, at least 5 — the starter has 3)"
  else
    fail "the unit tests must pass and include tests for the new commands (ran ${ran:-0}, status $tests_status)"
  fi
fi

if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
echo "All criteria pass."
