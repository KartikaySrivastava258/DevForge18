#!/usr/bin/env bash
# Acceptance check for "Personal developer portfolio repository".
# Usage: bash check.sh path/to/your/portfolio
# Prints PASS or FAIL for each criterion and exits non-zero if any criterion fails. It only reads the repository.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
repo="${1:-.}"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
g() { git -C "$repo" "$@"; }

if [ "$(g rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then
  fail "$repo is not a Git repository (run git init -b main inside it)"
  echo "1 or more criteria failed."
  exit 1
fi

branch="$(g symbolic-ref --short HEAD 2>/dev/null)"
if [ "$branch" = "main" ]; then pass "the current branch is main"; else fail "the current branch is '${branch:-detached}', not main"; fi

count="$(g rev-list --count main 2>/dev/null || echo 0)"
if [ "$count" -ge 5 ]; then pass "main has $count commits (at least 5)"; else fail "main has $count commits; make at least 5 small, focused commits"; fi

bad_subjects=0
while IFS= read -r subject; do
  words="$(echo "$subject" | wc -w)"
  lower="$(echo "$subject" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:][:punct:]]*$//')"
  if [ "${#subject}" -gt 72 ] || [ "$words" -lt 3 ] || echo "$lower" | grep_quiet -E '^(update|updates|updated|wip|fix|fixes|changes|stuff|misc|commit|test|asdf)( [0-9]+)?$'; then
    fail "commit subject is too long, too short or a placeholder: \"$subject\""
    bad_subjects=$((bad_subjects + 1))
  fi
done < <(g log main --format=%s 2>/dev/null)
if [ "$bad_subjects" -eq 0 ] && [ "$count" -gt 0 ]; then pass "every commit subject is 3+ words, at most 72 characters and descriptive"; fi

tracked() { g ls-files --error-unmatch -- "$1" > /dev/null 2>&1; }
committed() { g cat-file -e "main:$1" 2> /dev/null; }

if committed README.md; then
  readme="$(g show main:README.md)"
  missing=""
  for section in About Projects Contact; do
    echo "$readme" | grep_quiet -Ei "^## +$section *$" || missing="$missing \"## $section\""
  done
  if [ -n "$missing" ]; then fail "README.md is missing the section(s)$missing"
  elif echo "$readme" | grep_quiet 'TODO'; then fail "README.md still contains TODO placeholders"
  else pass "README.md has About, Projects and Contact sections and no TODO"; fi
else
  fail "README.md is not committed on main"
fi

writeups=0
while IFS= read -r file; do
  content="$(g show "main:$file")"
  if echo "$content" | grep_quiet -Ei '^## +What I learned *$' && ! echo "$content" | grep_quiet 'TODO'; then
    writeups=$((writeups + 1))
  else
    fail "$file needs a \"## What I learned\" section and no TODO placeholders"
  fi
done < <(g ls-tree -r --name-only main -- projects/ 2>/dev/null | grep -E '\.md$')
if [ "$writeups" -ge 2 ]; then pass "$writeups project write-ups in projects/ (at least 2)"; else fail "only $writeups complete project write-up(s) in projects/; commit at least 2"; fi

if committed .gitignore; then
  if g check-ignore -q --no-index .env && g check-ignore -q --no-index server.log; then
    pass ".gitignore ignores .env and *.log files"
  else
    fail ".gitignore must ignore both .env and *.log files"
  fi
else
  fail ".gitignore is not committed on main"
fi

leaked="$(g log --all --name-only --format= 2>/dev/null | sort -u | grep -E '(^|/)\.env$|\.log$')"
if [ -z "$leaked" ]; then pass "no .env or .log file was ever committed (all branches)"; else fail "these files are in the history and must be removed from it: $(echo "$leaked" | tr '\n' ' ')"; fi

if committed LICENSE || committed LICENSE.md || committed LICENSE.txt; then pass "a LICENSE file is committed"; else fail "no LICENSE file is committed"; fi

dirty="$(g status --porcelain 2>/dev/null)"
if [ -z "$dirty" ]; then pass "the working tree is clean"; else fail "uncommitted or untracked changes: $(echo "$dirty" | tr '\n' ' ')"; fi

if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
echo "All criteria pass."
