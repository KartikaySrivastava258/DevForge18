---
id: jira-release-triage
track: jira
title: Build a release and bug-triage workflow
level: advanced
estimated_hours: 7
prerequisites: [jira-work-items-and-workflows, jira-linking-work-to-code, jira-reports-and-anti-patterns]
related_tracks: [git-github]
user_stories:
  - As a support lead, I want every new bug triaged — severity, priority and a decision — before anyone works on it so that the most harmful bugs are fixed first.
  - As a release manager, I want a release to contain exactly the work items with its fix version, all finished, so that the release notes are true.
  - As a developer six months from now, I want every fix commit to name its Jira work item so that I can find why a line of code changed.
acceptance_criteria:
  - At least 5 bugs, each with a priority and exactly one label severity-critical, severity-major or severity-minor.
  - Every bug that was worked on passed through Triage before In Progress.
  - At least 3 work items have the fix version named in RELEASE_NOTES.md ("# Release X.Y.Z"); all of them are Done, and every Done bug has a fix version.
  - No severity-critical bug is still open.
  - RELEASE_NOTES.md lists exactly the work items in that version.
  - Every work item in the release has a commit on main whose message names its key in capitals; no commit writes a key in lower case.
  - An annotated tag vX.Y.Z exists and contains all of those commits.
rubric:
  - { criterion: "Triage", excellent: "Severity (impact) and priority (order of work) are used consistently and differently, triage decisions are recorded in a comment, and the workflow makes Triage a required step.", good: "Bugs are labelled and prioritised before work starts.", needs_work: "Severity and priority are copies of each other, or work starts untriaged." }
  - { criterion: "Fixes", excellent: "Each fix has a test that failed before the fix and a commit message that names the key and says what changed; fixes are minimal.", good: "Each bug is fixed and tested.", needs_work: "Fixes without tests, or one commit fixing everything." }
  - { criterion: "Release", excellent: "Fix versions, release notes, the tag and the Jira release page agree; known issues are stated honestly; the release could be repeated by another team member from the notes.", good: "Fix version, notes and tag agree.", needs_work: "Release notes written from memory, or a tag on the wrong commit." }
  - { criterion: "Traceability", excellent: "From any line of the fix you can reach the work item (git log -S or blame, then the key), and from the work item its commits in Jira's development panel.", good: "Every fix commit names its key.", needs_work: "Commits say \"fix\" or \"update\"." }
hints:
  - Reproduce each bug before fixing it — the starter's cart.py really has all three. Write the failing test first; it is your proof that the fix works.
  - Severity is how bad the effect is; priority is when you will fix it. A minor bug can be high priority if it is quick and visible.
  - Add the Triage status in the workflow editor and move every new bug there first. The check reads the order of status changes from the export's changelog.
  - Start each commit message with the key, in capitals — CAFE-1 Apply a discount code only once — as in "Linking work items to branches and commits".
  - Tag the commit that contains every fix and the release notes, with git tag -a v1.1.0 -m "Release 1.1.0". A lightweight tag (without -a) has no message or author.
stretch_goals:
  - Create the version 1.1.0 in Jira's Releases page, release it, and compare Jira's release report with your notes.
  - Add a GitHub Actions workflow that refuses a pull request whose commits do not name a work item key.
  - Measure the cycle time of the three bugs from the export with the script from "Kanban and flow metrics in depth".
starter: starter
solution: solution
check_needs: [git, python3]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college canteen's pre-order app has three bug reports this week: a discount code that can be applied twice by
refreshing the page, a total of 99.89999999999999 rupees, and orders with a quantity of 0 reaching the kitchen.
The team wants to ship a bug-fix release, 1.1.0 — but bugs are filed without severity, work starts before anyone
has looked at them, commits do not say which bug they fix, and nobody can say what is in a release.

You will build the workflow and use it once, end to end: triage the bugs in Jira, fix them in the code with tests,
link every commit to its work item, and cut a release whose notes, Jira fix version and Git tag agree. The starter
contains the app (with all three bugs present) and an export of today's untidy board.

The check reads your repository and the Jira export inside it. It judges the workflow's evidence — the order of
status changes, fix versions, commit messages and the tag — not the Jira screens themselves.

## Getting started

1. Copy the starter into a new folder, make it a Git repository and commit it:

   ```bash
   cd ~/canteen && git init -b main && git add -A && git commit -m "Import the canteen pre-order app"
   python3 -m unittest                  # passes — the tests do not cover the bugs yet
   ```

2. In your Jira project, add a Triage status, file the bugs (and at least two more you find), and triage them.
3. For each bug in the release: write a failing test, fix `cart.py`, commit with a message that starts with the
   key, and move the work item through the workflow.
4. Write `RELEASE_NOTES.md`, export the board (`python3 export.py CAFE`), commit both, tag `v1.1.0`, and check:

   ```bash
   bash check.sh ~/canteen
   ```

   If your workflow's statuses have other names: `TRIAGE_STATUS="Needs triage" bash check.sh ~/canteen`.
