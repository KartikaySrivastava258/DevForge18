---
id: git-branches-and-merging
title: Branches and merging
track: git-github
order: 4
level: intermediate
estimated_minutes: 30
prerequisites: [git-first-commits]
learning_objectives:
  - Explain that a branch is a movable pointer to a commit, and what HEAD is.
  - Create and switch branches, and see that each branch has its own version of the files.
  - Tell a fast-forward merge from a three-way merge, and read both in git log --graph.
  - Delete branches that are merged, and know why Git refuses to delete one that is not.
resources:
  - title: Pro Git — Git Branching (Branches in a Nutshell, Basic Branching and Merging)
    url: https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging
    publisher: git-scm.com
    type: documentation
    level: beginner
    official: true
    why: Branches as pointers, HEAD, fast-forward and three-way merges, with diagrams.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: git merge — reference manual
    url: https://git-scm.com/docs/git-merge
    publisher: git-scm.com
    type: documentation
    level: intermediate
    official: true
    why: Fast-forward behaviour, --no-ff, and how merges are recorded.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: branch-is
    prompt: What is a branch in Git?
    options:
      - { id: a, text: "A full copy of the project's files in another folder" }
      - { id: b, text: "A movable name that points at one commit; committing on the branch moves it forward" }
      - { id: c, text: "A list of every change ever made to one file" }
    answer: b
    explanation: A branch is a small pointer to a commit, which is why creating one is instant. When you commit while on a branch, the branch moves to the new commit.
  - id: fast-forward
    prompt: You merge feature into main and Git says "Fast-forward". What happened?
    options:
      - { id: a, text: "Git combined two lines of work and created a merge commit" }
      - { id: b, text: "main had no new commits since feature started, so Git just moved main forward to feature's commit — no new commit was needed" }
      - { id: c, text: "Git skipped the merge because it was too large" }
    answer: b
    explanation: When the branch you merge into is an ancestor of the other, there is nothing to combine; the pointer moves forward. A merge commit is only needed when both sides have new commits.
  - id: merge-commit
    prompt: What is special about a merge commit?
    options:
      - { id: a, text: "It has two parents: the tips of the two branches it joined" }
      - { id: b, text: "It contains no files" }
      - { id: c, text: "It deletes the merged branch" }
    answer: a
    explanation: A three-way merge records a commit whose parents are both branch tips, so the history keeps both lines of work. git log --graph draws it as two lines joining.
  - id: delete-unmerged
    prompt: git branch -d experiment fails with "not fully merged". Why does Git refuse?
    options:
      - { id: a, text: "Branches can never be deleted" }
      - { id: b, text: "experiment has commits that no other branch contains; deleting the pointer would make them hard to find, so Git asks you to merge first or use -D on purpose" }
      - { id: c, text: "You are on the experiment branch" }
    answer: b
    explanation: -d only deletes branches whose commits are reachable from your current branch. -D forces it — the commits then survive only in the reflog for a while.
verification:
  method: executed
  details: Every command is run by the test suite with Git, after the earlier lessons, and its output is compared with this lesson.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **branch** is a movable pointer to a commit, so you can develop a change on its own line of history and **merge** it back — either by moving the pointer forward (**fast-forward**) or by recording a **merge commit** that joins two lines of work.

## Explain it like I'm twelve

Imagine a shared notebook and sticky notes. Each sticky note has a name — "main", "glossary" — and is stuck on a page. Writing a new page on a sticky note's line moves that note to the new page. When two people wrote different pages after the same point, you add one page that says "this combines both", and move "main" onto it.

The pages are **commits**, the sticky notes are **branches**, and the "combines both" page is a **merge commit**.

Where the analogy breaks: Git never copies pages; every commit is stored once, and branches only point at them.

## What problem it solves

Work happens in parallel: a bug fix, a new feature, an experiment. If everyone commits to the same line, half-finished work gets in the way of finished work. Branches let each piece of work grow separately and join `main` only when it is ready — and pull requests on GitHub are built on exactly this.

## How it works

![](media:git-github/branch-merge.svg)

- A branch is a name for one commit. `HEAD` is Git's name for "the branch you are on now".
- `git switch -c name` creates a branch at the current commit and switches to it. Committing then moves that branch forward; other branches stay where they were.
- `git merge other` brings `other`'s work into the current branch. If the current branch has no commits of its own since `other` started, Git just moves it forward (**fast-forward**). If both have new commits, Git combines them and records a **merge commit** with two parents.
- When both sides changed the same lines, Git stops with a conflict for you to resolve — practised in the lab *Resolve a merge conflict*.

## Try it yourself

> **Local lab** — a new practice repository, so the `student-notes` repository from the earlier lessons is not changed. Every command is run automatically in DevForge's tests.

### 1. A repository with one commit

```bash run
mkdir branch-practice && cd branch-practice
git init -q -b main
printf '# Course notes\n' > README.md
git add README.md && git commit -q -m "Start the notes"
git branch
```

```text output
* main
```

`git branch` lists branches; `*` marks the one `HEAD` points to.

### 2. A branch with its own work

```bash run
git switch -c glossary
printf 'commit: a saved snapshot\n' > glossary.md
git add glossary.md && git commit -q -m "Add a glossary"
git log --oneline --all --graph
```

```text output
Switched to a new branch 'glossary'
* 972ac8e Add a glossary
* 5bd09e8 Start the notes
```

`--all` shows every branch, not only the current one. Now go back to `main`:

```bash run
git switch main
ls
```

```text output
Switched to branch 'main'
README.md
```

`glossary.md` is not there: `main` still points at the first commit, and switching changed the files in the folder to match it. Nothing was lost — it lives on the `glossary` branch.

### 3. A fast-forward merge

```bash run
git merge glossary
git branch -d glossary
git log --oneline --graph
```

```text output
Updating 5bd09e8..972ac8e
Fast-forward
 glossary.md | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 glossary.md
Deleted branch glossary (was 972ac8e).
* 972ac8e Add a glossary
* 5bd09e8 Start the notes
```

`main` had no new commits, so Git moved it forward to the glossary commit — the history is still a straight line. The branch had served its purpose, so `git branch -d` removed the pointer (the commit stays, on `main`).

### 4. Two lines of work, then a merge commit

This time `main` moves on while the branch is open:

```bash run
git switch -q -c faq
printf 'Q: Where are the slides?\nA: In the course folder.\n' > faq.md
git add faq.md && git commit -q -m "Add an FAQ"
git switch -q main
printf 'Office hours: Tuesday 14:00\n' >> README.md
git commit -q -am "Add office hours"
git merge --no-edit faq
git log --oneline --graph
```

```text output
Merge made by the 'ort' strategy.
 faq.md | 2 ++
 1 file changed, 2 insertions(+)
 create mode 100644 faq.md
*   88d10b8 Merge branch 'faq'
|\
| * d5b3499 Add an FAQ
* | 19091f5 Add office hours
|/
* 972ac8e Add a glossary
* 5bd09e8 Start the notes
```

- Both branches had a new commit, so Git combined them and recorded **Merge branch 'faq'** — a commit with two parents. `ort` is the name of Git's default merge strategy.
- The two changes were in different files, so there was no conflict. `--no-edit` accepts Git's default message instead of opening an editor.

### 5. Branches that are merged, and one that is not

```bash run
git switch -q -c experiment
printf 'draft\n' > draft.md && git add draft.md && git commit -q -m "Try a draft"
git switch -q main
git branch --merged
git branch -d experiment 2> /dev/null || echo "git branch -d refused: experiment is not fully merged"
```

```text output
  faq
* main
git branch -d refused: experiment is not fully merged
```

`faq` is merged into `main`, so it is safe to delete. `experiment` has a commit that no other branch contains, so Git refuses with an error saying the branch is not fully merged (and a hint about `-D`; this lesson hides Git's exact wording, which changes between versions): deleting it would leave that commit without a name. `-D` would force it — only do that on purpose.

## Common mistakes

- **Committing on the wrong branch.** Check `git branch` (or your prompt) before committing; `git switch -c` *then* commit, not the other way round.
- **Switching with uncommitted changes.** Git refuses when a switch would overwrite them, or carries them along when it would not. Commit (or stash) first so you know where your work is.
- **Long-lived branches.** The longer a branch lives, the more `main` moves and the bigger the conflicts. Merge small pieces often.
- **Deleting with -D by habit.** `-d` protects unmerged work; use `-D` only when you mean to throw the commits away.

## Where this fits in a real system

On **GitHub**, a pull request is a request to merge one branch into another, with review and checks in between; **GitHub Actions** and **Jenkins** run the tests on the branch before the merge. **Jira** work item keys in branch names (`DEV-12-…`) link the branch to its work.
