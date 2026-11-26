---
id: git-resolve-a-merge-conflict
title: Resolve a merge conflict
track: git-github
level: intermediate
mode: local
estimated_minutes: 25
prerequisites: [git-first-commits]
objectives:
  - Cause a merge conflict on purpose by changing the same line on two branches.
  - Read Git's conflict markers and decide what the line should say.
  - Finish the merge and confirm the history joins both branches.
checkpoints:
  - { id: conflict-seen, text: "git merge stopped and reported CONFLICT (content) in timetable.md" }
  - { id: markers-read, text: "I can say which part between the markers came from main (HEAD) and which from room-change" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Pro Git — Basic Branching and Merging (Basic Merge Conflicts)
    url: https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Walks through a merge conflict, the conflict markers and finishing the merge.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git merge — reference manual
    url: https://git-scm.com/docs/git-merge
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: How conflicts are presented, and how to abort or finish a merge.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Git, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Two people change the same line of a shared file on different branches. You merge their work, Git stops with a **conflict**, and you resolve it so that the result keeps what both of them meant — then prove it with a check script.

## Before you start

You need Git and a terminal, and your name and email set in Git (from *Your first commits*). The lab uses a new folder, so it does not touch your earlier practice repository.

## Steps

### 1. A repository with a timetable

```bash run
mkdir conflict-lab && cd conflict-lab
git init -q -b main
printf '# Week 1 timetable\nMonday: Lecture, Room 101\nTuesday: Lab, Room 204\n' > timetable.md
git add timetable.md
git commit -q -m "Add week 1 timetable"
git log --oneline
```

```text output
ad6e003 Add week 1 timetable
```

### 2. Two branches change the same line

On a branch, the lab moves to a bigger room. Meanwhile, on `main`, someone adds a reminder to the same line.

```bash run
git switch -q -c room-change
sed -i.bak 's/Room 204/Room 310/' timetable.md && rm timetable.md.bak
git commit -q -am "Move Tuesday lab to Room 310"
git switch -q main
sed -i.bak 's/Room 204/Room 204 (bring laptops)/' timetable.md && rm timetable.md.bak
git commit -q -am "Remind students to bring laptops"
git log --oneline --graph --all
```

```text output
* 15ab46a Remind students to bring laptops
| * 3d8eb0d Move Tuesday lab to Room 310
|/
* ad6e003 Add week 1 timetable
```

`sed -i.bak … && rm …` edits the file in place on both Linux and macOS; in real work you would open the file in your editor.

### 3. Merge, and read the conflict

```bash run fails
git merge room-change
```

```text output
Auto-merging timetable.md
CONFLICT (content): Merge conflict in timetable.md
Automatic merge failed; fix conflicts and then commit the result.
```

Git merged what it could and stopped at the line both branches changed. Look at the file and at `git status`:

```bash run
cat timetable.md
git status --short
```

```text output
# Week 1 timetable
Monday: Lecture, Room 101
<<<<<<< HEAD
Tuesday: Lab, Room 204 (bring laptops)
=======
Tuesday: Lab, Room 310
>>>>>>> room-change
UU timetable.md
```

- Between `<<<<<<< HEAD` and `=======` is **your side**: the line as it is on `main`, the branch you are on.
- Between `=======` and `>>>>>>> room-change` is **their side**: the line from the branch you are merging.
- `UU` means the file is *unmerged*: both sides changed it.

Git does not guess which is right. Here, both changes matter: the room moved *and* students should bring laptops.

### 4. Resolve and finish the merge

Edit `timetable.md` so it says what both people meant, and delete all three marker lines. The command below writes the resolved file; in your editor, you would make the same edit by hand.

```bash run
printf '# Week 1 timetable\nMonday: Lecture, Room 101\nTuesday: Lab, Room 310 (bring laptops)\n' > timetable.md
git add timetable.md
git commit -q --no-edit
git log --oneline --graph
```

```text output
*   415240d Merge branch 'room-change'
|\
| * 3d8eb0d Move Tuesday lab to Room 310
* | 15ab46a Remind students to bring laptops
|/
* ad6e003 Add week 1 timetable
```

`git add` tells Git the conflict is resolved; the commit is a **merge commit** with two parents, which joins the two lines of history.

## Check your work

Run this script inside `conflict-lab`. It checks the result, not the commands you typed, so any correct resolution passes.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "this folder is a Git repository" 'git rev-parse --git-dir'
check "no merge is still in progress" '! git rev-parse -q --verify MERGE_HEAD'
check "timetable.md has no conflict markers left" '[ -f timetable.md ] && ! grep -qE "^(<<<<<<<|=======|>>>>>>>)" timetable.md'
check "the last commit is a merge (two parents)" '[ "$(git rev-list --parents -n 1 HEAD | wc -w)" -eq 3 ]'
check "the room change is kept" 'grep -q "Room 310" timetable.md'
check "the laptop reminder is kept" 'grep -q "bring laptops" timetable.md'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: this folder is a Git repository
PASS: no merge is still in progress
PASS: timetable.md has no conflict markers left
PASS: the last commit is a merge (two parents)
PASS: the room change is kept
PASS: the laptop reminder is kept
All checks passed
```

## Reset

- **Stuck in the middle of a merge?** `git merge --abort` puts everything back as it was before `git merge`.
- **Start the whole lab again:** leave the folder and delete it — `cd .. && rm -rf conflict-lab` — then begin at step 1.

## What you practised

A conflict is Git asking a person to decide. Small, frequent merges keep conflicts small; reading both sides before editing keeps both people's work.
