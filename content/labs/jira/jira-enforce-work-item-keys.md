---
id: jira-enforce-work-item-keys
title: Enforce work item keys and write release notes from them
track: jira
level: intermediate
mode: local
estimated_minutes: 30
prerequisites: [jira-linking-work-to-code]
objectives:
  - Write a Git commit-msg hook that rejects commits whose message does not start with a work item key in capitals.
  - Allow the commits Git writes itself (merges and reverts) without weakening the rule for everyone else.
  - Produce release notes grouped by work item from the commits between two tags.
checkpoints:
  - { id: rejected, text: "The hook rejected a commit without a key and one with a lower-case key" }
  - { id: notes, text: "The release notes listed DEV-21 and DEV-22 with their commits" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Reference work items in your development work
    url: https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/
    publisher: Atlassian Support
    type: documentation
    level: beginner
    official: true
    why: Where Jira looks for work item keys and how the key must be written.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: githooks — commit-msg
    url: https://git-scm.com/docs/githooks
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: When the commit-msg hook runs, what it receives, and how a non-zero exit aborts the commit.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Git, and their output is compared with this page. No Jira site is needed; the key format follows Atlassian's documentation, checked on 2026-11-25. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

In the lesson you *found* commits with a missing or lower-case key after the fact. Here you stop them at the source: a **commit-msg hook** refuses such commits on your machine. Then you put the keys to work by generating **release notes grouped by work item** for everything since the last release.

## Before you start

You need Git and a terminal (on Windows, Git Bash). No Jira site is needed: the keys work the same way in plain Git, and a team using Jira gets the links on top.

## Steps

### 1. A repository with a first release

```bash run
mkdir keys-lab && cd keys-lab
git init -q -b main
echo "timetable" > README.md
git add README.md && git commit -q -m "DEV-20 Start the timetable service"
git tag v1.0
git log --oneline --format='%s'
```

```text output
DEV-20 Start the timetable service
```

### 2. A hook that checks every commit message

Git runs `.git/hooks/commit-msg` before it records a commit, passing the path of the file that holds the message. If the hook exits with a non-zero code, the commit is aborted.

```bash run
cat > .git/hooks/commit-msg <<'EOF'
#!/bin/sh
# Every commit message must start with a work item key in capitals, e.g. "DEV-12 Fix the reset link".
first_line=$(head -n 1 "$1")
case "$first_line" in
  "Merge "*|"Revert "*) exit 0 ;;  # messages Git writes itself
esac
if printf '%s\n' "$first_line" | grep -E '^[A-Z][A-Z0-9]+-[0-9]+ [^ ]' > /dev/null; then
  exit 0
fi
echo "commit-msg: start the message with a work item key in capitals, e.g. \"DEV-12 Fix the reset link\"" >&2
exit 1
EOF
chmod +x .git/hooks/commit-msg
echo "Room 204" > rooms.txt && git add rooms.txt
git commit -q -m "fix rooms" || echo "commit refused"
git commit -q -m "dev-21 Add rooms" || echo "commit refused"
git commit -q -m "DEV-21" || echo "commit refused"
git commit -q -m "DEV-21 Add the room list"
git log --oneline --format='%s'
```

```text output
commit-msg: start the message with a work item key in capitals, e.g. "DEV-12 Fix the reset link"
commit refused
commit-msg: start the message with a work item key in capitals, e.g. "DEV-12 Fix the reset link"
commit refused
commit-msg: start the message with a work item key in capitals, e.g. "DEV-12 Fix the reset link"
commit refused
DEV-21 Add the room list
DEV-20 Start the timetable service
```

- `fix rooms` has no key; `dev-21` is in lower case, which Jira does not recognise; `DEV-21` alone says nothing about the change. All three are refused, and the error says how to fix the message.
- The pattern `[A-Z][A-Z0-9]+-[0-9]+` matches keys such as `DEV-21` or `WEB2-7`, then requires a space and a description.

### 3. Merges still work

Git writes merge messages itself (`Merge branch …`). The hook lets those through, so you do not have to type a key for them:

```bash run
git switch -q -c DEV-22-room-capacity
echo "Room 204: 40 seats" > rooms.txt && git commit -q -am "DEV-22 Record room capacity"
echo "Room 310: 60 seats" >> rooms.txt && git commit -q -am "DEV-22 Add Room 310"
git switch -q main
git merge -q --no-ff --no-edit DEV-22-room-capacity
git log --oneline --format='%s' -n 1
```

```text output
Merge branch 'DEV-22-room-capacity'
```

### 4. Release notes, grouped by work item

Everything since `v1.0`, grouped by key, without merge commits:

```bash run
release_notes() {  # usage: release_notes <from-tag> [to]
  git log --no-merges --format='%s' "$1..${2:-HEAD}" \
    | sed -E 's/^([A-Z][A-Z0-9]+-[0-9]+) (.*)$/\1|\2/' \
    | sort -t'|' -k1,1 -s \
    | awk -F'|' '$1 != key { key = $1; print key } { print "  - " $2 }'
}
release_notes v1.0
```

```text output
DEV-21
  - Add the room list
DEV-22
  - Add Room 310
  - Record room capacity
```

Because every commit starts with a key, the history *is* the change log: each heading is a work item someone can open in Jira, and each line is a change made for it.

### 5. Share the hook with the team

Hooks in `.git/hooks` are not committed, so each clone starts without them. A common approach is to keep hooks in the repository and point Git at that folder:

```bash run
mkdir -p .githooks && cp .git/hooks/commit-msg .githooks/
git config core.hooksPath .githooks
git add .githooks && git commit -q -m "DEV-23 Share the commit-msg hook"
git config core.hooksPath
```

```text output
.githooks
```

Each person still runs `git config core.hooksPath .githooks` once after cloning — and anyone can skip a hook with `git commit --no-verify`. So hooks help people; a check in CI or a branch rule is what *enforces* a rule for everyone.

## Check your work

Run this inside `keys-lab`.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
hook=$(git config core.hooksPath 2>/dev/null)/commit-msg
msg() { f=$(mktemp); printf '%s\n' "$1" > "$f"; sh "$hook" "$f"; r=$?; rm -f "$f"; return $r; }
check "the shared hook exists and is committed" '[ -n "$(git config core.hooksPath)" ] && git ls-files --error-unmatch "$hook"'
check "the hook accepts \"DEV-12 Fix the reset link\"" 'msg "DEV-12 Fix the reset link"'
check "the hook rejects a message without a key" '! msg "fix the reset link"'
check "the hook rejects a lower-case key" '! msg "dev-12 Fix the reset link"'
check "the hook rejects a key with no description" '! msg "DEV-12"'
check "the hook accepts merge messages" 'msg "Merge branch '"'"'DEV-22-room-capacity'"'"'"'
check "every non-merge commit on main starts with a key" '[ -z "$(git log --no-merges --format=%s main | grep -vE "^[A-Z][A-Z0-9]+-[0-9]+ ")" ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the shared hook exists and is committed
PASS: the hook accepts "DEV-12 Fix the reset link"
PASS: the hook rejects a message without a key
PASS: the hook rejects a lower-case key
PASS: the hook rejects a key with no description
PASS: the hook accepts merge messages
PASS: every non-merge commit on main starts with a key
All checks passed
```

## Reset

Leave the folder and delete it — `cd .. && rm -rf keys-lab` — then begin again at step 1.

## What you practised

Work item keys are only useful if every commit has one. A commit-msg hook catches mistakes at the moment they happen, sharing it through `core.hooksPath` spreads it to the team, and consistent keys turn `git log` into release notes. For a rule that cannot be skipped, add the same check in CI.
