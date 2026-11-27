---
id: git-team-task-tracker
track: git-github
title: Team task tracker with branches and pull requests
level: intermediate
estimated_hours: 6
prerequisites: [git-branches-and-merging, git-remotes-push-pull, git-pull-requests-and-review]
related_tracks: []
user_stories:
  - As a member of a study group, I want to mark tasks as done and list only the open ones so that we can see at a glance what is left before a deadline.
  - As a reviewer on the team, I want every change to arrive as a pull request with a checklist so that I review one focused change at a time and nothing reaches main unreviewed.
  - As a team lead, I want main to change only through merged branches so that git log --first-parent main reads as a list of reviewed changes that can be reverted one by one.
acceptance_criteria:
  - After the first commit, main changes only through merge commits — no commit is made directly on main.
  - At least two branches are merged into main with merge commits.
  - A pull request template is committed with a checklist of at least three "- [ ]" items.
  - A committed CODEOWNERS file assigns reviewers.
  - tasks.json (personal data written by the program) is ignored and appears in no commit.
  - "\"python3 tasks.py done 1\" prints \"Completed task 1.\" and marks the task done; an unknown id exits with status 1."
  - "\"python3 tasks.py list --open\" lists only the tasks that are not done."
  - The unit tests pass and cover the new commands (at least five tests; the starter has three).
  - The working tree is clean.
rubric:
  - { criterion: "Branches and pull requests", excellent: "One branch per backlog item with a descriptive name; each pull request has a description and a completed checklist, and a teammate's review comments are answered with follow-up commits.", good: "Branches and pull requests are used for every change, but some mix two items or have empty descriptions.", needs_work: "Work is committed straight to main, or one branch holds everything." }
  - { criterion: "Code and tests", excellent: "The new commands handle the error cases (unknown id, wrong arguments) and each behaviour has a focused test; the tests were written with, or before, the code.", good: "The commands work and have tests for the main path.", needs_work: "Commands work only for the happy path, or there are no new tests." }
  - { criterion: "Review setup", excellent: "The template asks for what a reviewer actually checks (tests, scope, data), CODEOWNERS names a real team, and the README says how the team works.", good: "Template and CODEOWNERS are present and sensible.", needs_work: "Missing, or a template with no checklist." }
  - { criterion: "History", excellent: "git log --oneline --graph shows one merge per item with clear commit subjects; nothing private or generated was ever committed.", good: "The history is readable; a few subjects are vague.", needs_work: "Merge conflicts resolved by deleting a teammate's work, or tasks.json committed." }
hints:
  - Commit the starter on main first. Then, for each backlog item, git switch -c feature/<short-name>, make the change and its tests, commit, and merge it back.
  - Merge with a merge commit — git merge --no-ff on your machine, or "Create a merge commit" on GitHub. A fast-forward, squash or rebase merge leaves no merge commit, so the history no longer shows which commits came from which pull request.
  - Write the test for done before the code. The function that changes the list (complete) can be tested without touching tasks.json; keep the command-line parsing thin.
  - If you already committed on main by mistake and have not pushed, move the commit to a branch with git branch feature/x, then git reset --hard HEAD~1 on main (see "Undoing work safely").
  - Run the check on a fresh clone (git clone <url> /tmp/tracker-check) to be sure everything you think is committed really is.
stretch_goals:
  - Work with a classmate on GitHub, review each other's pull requests, and turn on a branch protection rule for main that requires one approval.
  - Create a deliberate merge conflict (both of you edit format_task) and resolve it in a pull request.
  - Add a GitHub Actions workflow that runs python3 -m unittest on every pull request (see the GitHub Actions track).
starter: starter
solution: solution
check_needs: [git, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A study group keeps its to-do list in a small command-line program. It can add and list tasks, but nobody
can mark a task as done, and the list gets long. Your team will add the missing features — and, just as
important, adopt the way professional teams change shared code: **every change on its own branch, reviewed
in a pull request, and merged into main with a merge commit.**

The README in the starter has a backlog of four items. Treat each one as a ticket: a branch, a pull request
and a merge. If you do this alone, still open the pull requests (on GitHub) or merge the branches yourself
(locally); the check only looks at the resulting history and code.

Why merge commits? With them, `git log --first-parent main` lists exactly one entry per merged pull request,
and `git revert -m 1 <merge>` takes a whole feature back out in one step. Many teams prefer squash merges for
a tidier history; that is a reasonable choice, but this project practises the merge-commit workflow so you
can see the branch structure.

## Getting started

1. Copy the starter into a new folder and commit it as the first commit on main:

   ```bash
   cd ~/task-tracker
   git init -b main
   git add -A
   git commit -m "Import the starter task tracker"
   python3 -m unittest            # 3 tests pass
   python3 tasks.py add "Try it" && python3 tasks.py list
   git status                     # tasks.json is untracked — backlog item 4 deals with that
   ```

2. Optional but recommended: create an empty repository on GitHub, add it as `origin`, and push main. Then
   push each branch and open a pull request for it.
3. Work through the backlog, one branch per item. Keep each branch small enough to review in five minutes.
4. Check your work from the folder above the repository (or on a fresh clone):

   ```bash
   bash check.sh ~/task-tracker
   ```

   The check runs your program and tests on a copy of what is committed on main, so uncommitted fixes do not
   count.
