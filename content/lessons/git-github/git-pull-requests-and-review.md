---
id: git-pull-requests-and-review
title: Pull requests and code review
track: git-github
order: 6
level: intermediate
estimated_minutes: 35
prerequisites: [git-branches-and-merging]
learning_objectives:
  - Describe a pull request as a proposal to merge one branch into another, with review and checks in between.
  - Show exactly what a pull request contains with a three-dot diff, and explain why a two-dot diff misleads.
  - Update a pull request after review by pushing more commits.
  - Compare the three ways GitHub can merge a pull request, and run a squash merge locally.
resources:
  - title: GitHub Docs — Pull requests (reference)
    url: https://docs.github.com/en/pull-requests/reference/pull-requests
    publisher: GitHub
    type: documentation
    level: beginner
    official: true
    why: What a pull request is, draft pull requests, and how pull request pages calculate their diff.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: GitHub Docs — Branches (three-dot and two-dot diffs)
    url: https://docs.github.com/en/pull-requests/reference/branches
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: States that pull requests show a three-dot diff, and what each comparison method compares.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: GitHub Docs — Pull request merges
    url: https://docs.github.com/en/pull-requests/reference/pull-request-merges
    publisher: GitHub
    type: documentation
    level: intermediate
    official: true
    why: Merge commits, squash merges and rebase merges, and when to choose each.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: what-pr
    prompt: What is a pull request?
    options:
      - { id: a, text: "A Git command that downloads a branch" }
      - { id: b, text: "A request, on a hosting service such as GitHub, to merge one branch into another — with a place for review, discussion and automated checks before it is merged" }
      - { id: c, text: "A copy of the repository under someone else's account" }
    answer: b
    explanation: Git itself has no pull requests; GitHub (and GitLab, as merge requests) adds them on top of branches. The pull request tracks a branch, so pushing to it updates the pull request.
  - id: three-dot
    prompt: Since you branched, main gained a commit you did not write. Why does git diff main...feature show only your work, while git diff main..feature also shows main's new commit (as if you had removed it)?
    options:
      - { id: a, text: "Three dots compare feature with the merge base — the commit where it left main; two dots compare feature with main's latest state" }
      - { id: b, text: "Three dots ignore deleted files" }
      - { id: c, text: "They are the same; the output order differs" }
    answer: a
    explanation: GitHub's documentation says pull requests show the three-dot diff, so reviewers see what the branch introduced — not changes that happened on main meanwhile.
  - id: squash
    prompt: A pull request has twelve small commits like "fix typo" and "wip". The team wants one commit on main per pull request. Which merge method?
    options:
      - { id: a, text: "Create a merge commit" }
      - { id: b, text: "Squash and merge — the pull request's changes become a single commit on main" }
      - { id: c, text: "Rebase and merge" }
    answer: b
    explanation: Squashing combines the branch's changes into one new commit. Merge commits keep every commit plus a merge; rebase keeps every commit, replayed onto main without a merge commit.
verification:
  method: executed
  details: Every Git command is run by the test suite, after the earlier lessons, and its output is compared with this lesson. Opening, reviewing and merging the pull request on GitHub were checked against GitHub's documentation (2026-11-26) but are not executed, because they need a GitHub account.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **pull request** is a proposal to merge a branch, shown as exactly what that branch changed — the **three-dot diff** — so teammates and automated checks can review it, and further pushes update it until it is merged.

## Explain it like I'm twelve

Before a newspaper prints your article, an editor reads it, marks things to fix, and you hand in a corrected version. Only when the editor approves does it go into the paper.

The article is your **branch**, the editor's marked-up copy is the **pull request**, the corrections are **new commits**, and printing is the **merge**.

Where the analogy breaks: in a pull request, robots (tests, linters) review too, and many people can comment at once.

## What problem it solves

Without review, mistakes go straight into `main`, and knowledge stays in one head. Pull requests make every change visible before it lands, give a place to discuss it, and let continuous integration prove it works. On many teams, `main` can *only* change through a reviewed pull request.

## How it works

![](media:git-github/pull-request-flow.svg)

- You push a branch and open a pull request from it (the *compare* branch) into a *base* branch, usually `main`. A **draft** pull request shares work in progress; GitHub's documentation notes drafts cannot be merged.
- The pull request shows the **three-dot diff**: the changes between the *merge base* (where the branch left `main`) and the branch's latest commit.
- Reviewers comment, approve or request changes; checks such as GitHub Actions run. New commits pushed to the branch appear in the pull request.
- GitHub offers three merge methods: a **merge commit**, **squash and merge** (one new commit), or **rebase and merge** (each commit replayed onto the base).

## Try it yourself

> **Local lab** — a practice repository whose remote `origin` is a local bare repository standing in for GitHub. The Git commands are run automatically in DevForge's tests; opening the pull request needs a GitHub account (step 5).

### 1. A shared repository and a feature branch

```bash run
mkdir pr-practice && cd pr-practice
git init -q --bare origin.git
git init -q -b main work && cd work
git remote add origin ../origin.git
printf '# Timetable\nMonday: Lecture\n' > timetable.md
git add timetable.md && git commit -q -m "Add timetable"
git push -q -u origin main
git switch -q -c add-tuesday
printf 'Tuesday: Lab\n' >> timetable.md
git commit -q -am "Add Tuesday"
git push -q -u origin add-tuesday
git branch -r
```

```text output
  origin/add-tuesday
  origin/main
```

You pushed the branch to the remote — on GitHub, this is the moment the "Compare & pull request" button appears.

### 2. Meanwhile, main moves on

A teammate merges something else into `main`:

```bash run
git switch -q main
printf 'Friday: Quiz\n' > notices.md
git add notices.md && git commit -q -m "Add notices"
git push -q
git switch -q add-tuesday
```

### 3. What does the pull request contain?

Compare the two ways of diffing:

```bash run
echo "--- two dots: main..add-tuesday"
git diff --stat main..add-tuesday
echo "--- three dots: main...add-tuesday"
git diff --stat main...add-tuesday
echo "--- the commits it would add to main"
git log --oneline main..add-tuesday
```

```text output
--- two dots: main..add-tuesday
 notices.md   | 1 -
 timetable.md | 1 +
 2 files changed, 1 insertion(+), 1 deletion(-)
--- three dots: main...add-tuesday
 timetable.md | 1 +
 1 file changed, 1 insertion(+)
--- the commits it would add to main
0924ab6 Add Tuesday
```

- **Two dots** compare the branch with `main` *now*: `notices.md` looks deleted, although your branch never touched it — `main` simply gained it later.
- **Three dots** compare the branch with its **merge base**, the commit where it left `main`. That is exactly your change, and it is what GitHub shows in the pull request.
- For `git log`, two dots mean "commits on `add-tuesday` that are not on `main`" — the commits the pull request would bring in.

### 4. Review asks for a change; push again

A reviewer writes: "Please say which room." You commit on the same branch and push:

```bash run
sed -i.bak 's/Tuesday: Lab/Tuesday: Lab, Room 204/' timetable.md && rm timetable.md.bak
git commit -q -am "Name the room for the Tuesday lab"
git push -q
git log --oneline main..add-tuesday
```

```text output
17b2283 Name the room for the Tuesday lab
0924ab6 Add Tuesday
```

The pull request follows the branch, so it now shows both commits; reviewers see what changed since their last look.

### 5. On GitHub (optional)

On a repository you own: push a branch, click **Compare & pull request**, choose the base branch, describe *why* the change is needed and how you tested it, and create it (as a draft if it is not ready). Ask a teammate to review in **Files changed**, where they can comment on a line, suggest a change or request changes. When it is approved and the checks pass, choose a merge method on the **Merge** button.

### 6. Squash merge, locally

What "Squash and merge" does, with plain Git:

```bash run
git switch -q main
git merge --squash add-tuesday
git commit -q -m "Add Tuesday lab with its room (#1)"
git log --oneline
git show --stat --format=%s HEAD | tail -n 2
```

```text output
Automatic merge went well; stopped before committing as requested
Squash commit -- not updating HEAD
d4bec7b Add Tuesday lab with its room (#1)
7863ddf Add notices
a8fc030 Add timetable
 timetable.md | 1 +
 1 file changed, 1 insertion(+)
```

Two commits on the branch became **one** commit on `main` with the combined change. The branch's own commits are not on `main`; that is the trade-off — a tidy history, but the step-by-step story stays only in the pull request.

## Common mistakes

- **Huge pull requests.** Reviewers skim large diffs and miss bugs. Small pull requests, each doing one thing, get better reviews faster.
- **Reviewing with two dots.** Comparing a branch with today's `main` shows changes nobody made in the branch. Use the three-dot diff, as GitHub does.
- **Force-pushing during review without saying so.** Rewriting the branch makes reviewers lose track of what changed; push new commits, or say clearly that you rebased.
- **A description that only says "fixes stuff".** Explain *why*, how you tested it, and link the work item.

## Where this fits in a real system

**GitHub Actions** runs on every pull request (the lessons on CI and pull request safety use exactly this trigger), protected branches require approvals and passing checks before merging, and **Jira** links the pull request to its work item through the key in its title.
