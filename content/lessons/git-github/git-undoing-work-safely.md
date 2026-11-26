---
id: git-undoing-work-safely
title: Undoing work safely
track: git-github
order: 5
level: intermediate
estimated_minutes: 30
prerequisites: [git-first-commits]
learning_objectives:
  - Discard edits with git restore, and unstage a file with git restore --staged.
  - Undo local commits with git reset --soft, --mixed and --hard, and say what each keeps.
  - Undo a commit that others already have with git revert, and explain why reset is wrong there.
resources:
  - title: Pro Git — Undoing Things
    url: https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Amending, unstaging and discarding changes, with the warning about commands that lose work.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git reset — reference manual
    url: https://git-scm.com/docs/git-reset
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: Exactly what --soft, --mixed and --hard change.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git revert — reference manual
    url: https://git-scm.com/docs/git-revert
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: Recording a new commit that reverses an earlier one.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: restore
    prompt: You edited notes.md and want the last committed version back, throwing your edits away. Which command?
    options:
      - { id: a, text: "git restore notes.md" }
      - { id: b, text: "git revert notes.md" }
      - { id: c, text: "git reset --soft HEAD~1" }
    answer: a
    explanation: git restore with a file name replaces the file in your folder with the version from the index (the last commit, if nothing is staged). The edits are gone for good — Git never saved them.
  - id: soft-vs-hard
    prompt: What is the difference between git reset --soft HEAD~1 and git reset --hard HEAD~1?
    options:
      - { id: a, text: "There is none" }
      - { id: b, text: "Both move the branch back one commit; --soft keeps that commit's changes staged, --hard also throws them out of the staging area and your folder" }
      - { id: c, text: "--soft only works on pushed commits" }
    answer: b
    explanation: --soft moves only the branch; --mixed (the default) also resets the staging area; --hard also resets your files. --hard is the one that can destroy uncommitted work.
  - id: shared
    prompt: A commit you pushed to the shared main branch broke something. Teammates have already pulled it. How do you undo it?
    options:
      - { id: a, text: "git reset --hard HEAD~1 and git push --force" }
      - { id: b, text: "git revert <commit> and push: a new commit that undoes the change, so nobody's history is rewritten" }
      - { id: c, text: "Delete the repository and clone it again" }
    answer: b
    explanation: Reset rewrites history; teammates who already have the commit would end up with diverged branches, and a force push can overwrite their work. Revert adds to history instead, which is safe on shared branches.
verification:
  method: executed
  details: Every command is run by the test suite with Git, after the earlier lessons, and its output is compared with this lesson.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Git has a different "undo" for each place a change can be — `restore` for your folder and staging area, `reset` for commits only you have, and `revert` for commits others already have — and choosing the right one is the difference between a quick fix and lost work.

## Explain it like I'm twelve

You are writing an essay. Crossing out a sentence you have not handed in yet is easy (that is `restore`). Taking back a page from the "to hand in" pile is easy too (`reset`). But once the teacher has photocopied your essay for the whole class, you cannot pull the page out of everyone's copy — you hand in a correction sheet instead (`revert`).

Where the analogy breaks: Git keeps old commits for a while even after `reset`, so local mistakes can often be recovered (see the lab *Diagnose an accidental commit and recover safely*).

## What problem it solves

Everyone commits the wrong thing, stages the wrong file, or pushes a bug. Using a too-strong undo deletes work you wanted; using `reset` on a shared branch breaks your teammates' history. Knowing which command fits which situation makes mistakes cheap.

## How it works

![](media:git-github/undo-map.svg)

- **Working folder** — edits you have not staged. `git restore <file>` puts back the last committed (or staged) version; your edits are not saved anywhere.
- **Staging area** — what the next commit will contain. `git restore --staged <file>` takes a file out of it and keeps your edits.
- **Local commits** — `git reset` moves the branch back. `--soft` keeps the changes staged, `--mixed` (the default) keeps them in your folder, `--hard` throws them away.
- **Pushed commits** — `git revert <commit>` records a *new* commit that reverses the old one. History only grows, so everyone can simply pull it.

## Try it yourself

> **Local lab** — a new practice repository. Every command is run automatically in DevForge's tests.

### 1. A repository with three commits

```bash run
mkdir undo-practice && cd undo-practice
git init -q -b main
for week in 1 2 3; do echo "Week $week notes" > "week$week.md"; git add "week$week.md"; git commit -q -m "Add week $week"; done
git log --oneline
```

```text output
5c3db4d Add week 3
8718431 Add week 2
bb50f0a Add week 1
```

### 2. Discard edits, and unstage a file

```bash run
echo "a line I regret" >> week3.md
git restore week3.md
cat week3.md
echo "secret=12345" > local.env
git add local.env
git restore --staged local.env
git status --short
```

```text output
Week 3 notes
?? local.env
```

- `git restore week3.md` put the committed version back; the regretted line is gone and cannot be recovered.
- `git restore --staged local.env` took the file out of the next commit. The file is still there (`??`, untracked) — add it to `.gitignore` next.

### 3. Undo a local commit, keeping the work

```bash run
rm local.env
echo "Week 4 notes (draft)" > week4.md
git add week4.md && git commit -q -m "Add week 4"
git reset --soft HEAD~1
git log --oneline -n 1
git status --short
```

```text output
5c3db4d Add week 3
A  week4.md
```

The commit is gone from `main`, but its change is still **staged** (`M` in the first column) — ready to be improved and committed again (`A`: a new file, staged). `HEAD~1` means "one commit before `HEAD`".

### 4. The three strengths of reset

```bash run
git commit -q -m "Add week 4"
for mode in soft mixed hard; do
  git reset -q --$mode HEAD~1
  echo "--$mode: branch at '$(git log -1 --format=%s)', status: '$(git status --short)', week4.md: $([ -f week4.md ] && echo kept || echo deleted)"
  git reset -q --hard ORIG_HEAD
done
```

```text output
--soft: branch at 'Add week 3', status: 'A  week4.md', week4.md: kept
--mixed: branch at 'Add week 3', status: '?? week4.md', week4.md: kept
--hard: branch at 'Add week 3', status: '', week4.md: deleted
```

All three move the branch back one commit. `--soft` leaves the change staged, `--mixed` unstaged (the new file is back to untracked, `??`), and `--hard` removes it from your folder too. (`ORIG_HEAD` is where `HEAD` was before the reset; the loop uses it to put the commit back between tries.)

### 5. Undo a commit others already have

Suppose "Add week 2" was pushed and teammates pulled it — then it turned out to be wrong:

```bash run
git revert --no-edit HEAD~2
git log --oneline -n 2
ls
```

```text output
[main d25e5b3] Revert "Add week 2"
 Date: …
 1 file changed, 1 deletion(-)
 delete mode 100644 week2.md
d25e5b3 Revert "Add week 2"
e385608 Add week 4
week1.md
week3.md
week4.md
```

The bad commit is still in the history, followed by a new commit that undoes exactly its change — the later work (weeks 3 and 4) stays. Anyone can pull this; nobody's history was rewritten.

## Common mistakes

- **`git reset --hard` with uncommitted work.** Edits that were never committed are not in the reflog and cannot be recovered. Commit or stash first.
- **Resetting a pushed branch.** Your branch and everyone else's now disagree; a force push to fix that can delete their commits. Revert instead.
- **`git restore .` by reflex.** It discards *every* unstaged edit in the folder. Look at `git status` first.
- **Reverting a merge without reading the docs.** Reverting a merge commit needs `-m` to say which parent to keep; read `git revert`'s manual first.

## Where this fits in a real system

On **GitHub**, protected branches usually forbid force pushes, which makes `revert` the only way to undo on `main` — and a revert goes through a pull request and **GitHub Actions** checks like any other change. Deployment pipelines (**Jenkins**, **Argo**, **GitHub Actions**) often roll back by reverting and redeploying.
