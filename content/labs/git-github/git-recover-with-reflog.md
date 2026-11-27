---
id: git-recover-with-reflog
title: Diagnose an accidental commit and recover safely
track: git-github
level: advanced
mode: local
estimated_minutes: 30
prerequisites: [git-first-commits]
objectives:
  - Find "lost" commits after a hard reset with git reflog, and bring them back.
  - Spot a secret file in a commit before it is pushed, and remove it from that commit.
  - Explain why a secret that was already pushed must be revoked or rotated, not just deleted.
checkpoints:
  - { id: reflog-read, text: "I found the lost commit's entry in git reflog and recovered it" }
  - { id: env-removed, text: "git show --stat HEAD no longer lists .env, and .gitignore ignores it" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: git reflog — reference manual
    url: https://git-scm.com/docs/git-reflog
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: What the reflog records, and the HEAD@{n} syntax.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Removing sensitive data from a repository
    url: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
    publisher: GitHub Docs
    type: documentation
    level: intermediate
    official: true
    why: Why a pushed secret must first be revoked or rotated, and what rewriting history does and does not fix.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Git, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Two classic accidents, both before anything is pushed: a `git reset --hard` that seems to throw away a commit, and a commit that includes a file of secrets. You diagnose each one with Git's own tools and repair it, then prove the result with a check script.

## Before you start

You need Git and a terminal, with your name and email set (from *Your first commits*). The lab uses a new folder. The "secret" in it is a made-up value; never put a real key in a practice repository.

## Steps

### 1. A small repository

```bash run
mkdir recovery-lab && cd recovery-lab
git init -q -b main
printf '# Notes\n' > notes.md
git add notes.md && git commit -q -m "Add notes"
printf '# Exam schedule\nDatabases: 12 December\n' > schedule.md
git add schedule.md && git commit -q -m "Add exam schedule"
git log --oneline
```

```text output
d4610ee Add exam schedule
1d96681 Add notes
```

### 2. Accident one: a hard reset

Someone meant to undo a change in the working folder, but typed a command that moves the branch back one commit and overwrites the files:

```bash run
git reset --hard HEAD~1
git log --oneline
ls
```

```text output
HEAD is now at 1d96681 Add notes
1d96681 Add notes
notes.md
```

The schedule commit is no longer on `main`, and `schedule.md` has gone from the folder. It is not deleted yet: Git keeps a **reflog**, a local record of where `HEAD` has pointed.

```bash run
git reflog
```

```text output
1d96681 HEAD@{0}: reset: moving to HEAD~1
d4610ee HEAD@{1}: commit: Add exam schedule
1d96681 HEAD@{2}: commit (initial): Add notes
```

Read it from the top: the latest move was the reset; one move before that (`HEAD@{1}`), `HEAD` pointed at the schedule commit.

### 3. Recover the commit

```bash run
git reset --hard 'HEAD@{1}'
git log --oneline
ls
```

```text output
HEAD is now at d4610ee Add exam schedule
d4610ee Add exam schedule
1d96681 Add notes
notes.md
schedule.md
```

`main` points at the schedule commit again and the file is back. The quotes around `HEAD@{1}` stop some shells from treating the braces specially. The reflog is local to your machine and its entries expire: by default, entries for commits no longer on any branch are pruned after 30 days (`gc.reflogExpireUnreachable`), others after 90. So recover soon — and remember it cannot bring back changes that were never committed.

### 4. Accident two: a secret in a commit

```bash run
printf 'API_KEY=not-a-real-key-123\n' > .env
printf -- '- Results due on Friday\n' >> notes.md
git add -A
git commit -q -m "Update notes"
git show --stat --format=%s HEAD
```

```text output
Update notes

 .env     | 1 +
 notes.md | 1 +
 2 files changed, 2 insertions(+)
```

`git add -A` staged everything, including `.env`. Always read the list of files before you commit or push.

### 5. Remove the secret from the commit (it was not pushed)

```bash run
git rm -q --cached .env
printf '.env\n' >> .gitignore
git add .gitignore
git commit -q --amend --no-edit
git show --stat --format=%s HEAD
git status --short
```

```text output
Update notes

 .gitignore | 1 +
 notes.md   | 1 +
 2 files changed, 2 insertions(+)
```

- `git rm --cached` stops tracking `.env` but leaves the file on your disk.
- `.gitignore` keeps it from being added again — `git status` is now empty.
- `--amend` replaces the last commit, so the commit on `main` never contained `.env`.

Amending is safe here only because the commit was never pushed. **If a secret has been pushed, treat it as leaked:** GitHub's documentation says the first step is to revoke or rotate the secret. Rewriting history afterwards does not undo copies that others may already have.

## Check your work

Run this script inside `recovery-lab`. It checks the result, so any correct repair passes.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "this folder is a Git repository" 'git rev-parse --git-dir'
check "the exam schedule commit is on main" 'git log --format=%s main | grep -x "Add exam schedule" > /dev/null'
check "schedule.md is in the latest commit" 'git cat-file -e HEAD:schedule.md'
check "no commit on main contains .env" '[ -z "$(git log --format=%h main -- .env)" ]'
check ".gitignore ignores .env" 'git check-ignore -q .env'
check "the working folder has no uncommitted changes" '[ -z "$(git status --porcelain)" ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: this folder is a Git repository
PASS: the exam schedule commit is on main
PASS: schedule.md is in the latest commit
PASS: no commit on main contains .env
PASS: .gitignore ignores .env
PASS: the working folder has no uncommitted changes
All checks passed
```

## Reset

Leave the folder and delete it — `cd .. && rm -rf recovery-lab` — then begin again at step 1.

## What you practised

Most "lost" work in Git is only unreferenced: the reflog shows where it went. And the cheapest moment to catch a secret is before `git push`; after that, the secret itself must be changed.
