---
id: team-delivery-workflow
title: Team delivery workflow from work item to release
summary: Each change starts as a Jira work item with testable acceptance criteria, is built on a branch named after its key, reaches main through a small reviewed pull request whose required checks include the unit tests and a Postman collection run by Newman, and ships in a tagged release whose notes, Jira fix version and commits agree.
problem: A team needs to know what it is working on, why each change was made and what is in each release, and must stop untested changes reaching main — without a heavy process that people work around.
tracks: [jira, git-github, github-actions, postman]
diagram: media:architecture/team-delivery-workflow.svg
components:
  - { name: Jira work items and board, track: jira, role: "Stories, tasks and bugs with testable acceptance criteria move through a small workflow on a board with WIP limits; each has a key such as DEV-12." }
  - { name: GitHub repository, track: git-github, role: "Branches named after the key, commit messages and pull request titles that start with it; main is protected by required reviews and required status checks." }
  - { name: Pull request workflow, track: github-actions, role: "Runs on every pull request — unit tests, the API started fresh, the Postman collection and a check that every commit carries a work item key — as required checks." }
  - { name: Postman collection, track: postman, role: "The API's tests and its documentation; Newman runs it against a throwaway environment with secrets from CI, writes a JUnit report and fails the job with a non-zero exit code." }
  - { name: Release workflow, track: github-actions, role: "Starts when a version tag is pushed, runs the tests again and publishes the release only if they pass, with notes grouped by work item." }
  - { name: Flow metrics, track: jira, role: "Cycle time, throughput and work in progress calculated from each item's status history, reviewed as percentiles rather than averages." }
flow:
  - A work item is written as a need with testable acceptance criteria and pulled onto the board when its column is under the WIP limit.
  - The developer creates a branch named after the key, commits with the key at the start of each message and opens a small pull request with the key in its title.
  - CI runs the unit tests, starts the API, waits for its health check and runs the Postman collection with Newman; the pull request cannot merge until the checks are green and a reviewer approves.
  - Jira's development integration links the branch, commits and pull request to the work item, which counts as done only once it is reviewed, tested and merged.
  - A maintainer pushes a version tag; the release workflow re-runs the tests and publishes notes grouped by work item, and the Jira fix version matches the tag.
  - The team reviews cycle-time percentiles, throughput and the age of unfinished items rather than velocity targets.
trade_offs:
  - { choice: "Work item keys in branches, commits and pull request titles", gain: "Anyone can find all the code for one piece of work, and release notes can be generated from the commit history.", cost: "It works only if every commit carries a correctly written key, which needs a commit-msg hook locally and the same check in CI." }
  - { choice: "Required reviews and required checks on main", gain: "No untested or unreviewed change reaches main.", cost: "Merging waits for a reviewer, so pull requests must stay small to be reviewed quickly; administrator bypasses must stay rare and deliberate." }
  - { choice: "The Postman collection as the API test suite in CI", gain: "The same collection documents the API and catches broken behaviour on every pull request.", cost: "CI needs a throwaway environment, a wait for the API's health check, a pinned Newman version and secrets passed from CI instead of committed files." }
  - { choice: "Flow metrics instead of story-point velocity", gain: "Questions like \"when will it be done?\" are answered from what actually happened.", cost: "Status history has to be honest: skipped statuses and bulk transitions at the end of a sprint distort every report." }
failure_modes:
  - { failure: "Keys are missing, lower-case or misspelt (dev-12, DEV12)", effect: "Commits link to nothing, and release notes miss changes.", mitigation: "A commit-msg hook shared through core.hooksPath, and the same check in CI so that it cannot be skipped." }
  - { failure: "CI runs on pull requests but is not a required check", effect: "A red result is easy to ignore, and broken changes are merged.", mitigation: "Make the checks required in branch protection and do not allow bypasses by default." }
  - { failure: "Collections run against production", effect: "Tests create and change real data.", mitigation: "Point Newman at a throwaway or test environment through a CI environment file." }
  - { failure: "Long-lived branches", effect: "Branches drift from main, conflicts grow and reviews get skimmed.", mitigation: "One work item per branch, small pull requests, merged often." }
  - { failure: "Done means coded", effect: "The board says work is finished that has not been reviewed, tested or merged, and flow metrics look better than reality.", mitigation: "Put Done in the board's last column only after merge, and include review and waiting statuses in cycle time." }
alternatives:
  - { instead_of: "Jira", consider: "GitHub Projects with GitHub Issues", when: "The code already lives on GitHub and the team wants issues, pull requests and planning boards in one place with little setup." }
  - { instead_of: "Postman collections", consider: "Bruno", when: "You want API requests stored as plain files in the Git repository and reviewed like code." }
  - { instead_of: "GitHub Actions", consider: "Jenkins (see Self-managed CI with Jenkins and build agents)", when: "CI must run on your own servers or integrate with on-premise systems, and you will operate it." }
decision_prompts:
  - What does "Done" mean for your team, and which check proves each part of it?
  - Which checks are required before merging, and who, if anyone, may bypass them?
  - How are release notes produced, and how do you confirm that the fix version, the tag and the notes agree?
  - Which flow metric will the team watch, and what will it change if that metric gets worse?
  - What WIP limit does each column have, and what does the team do when a column goes over it?
learn_more:
  - { kind: lesson, id: jira-linking-work-to-code }
  - { kind: lesson, id: jira-work-items-and-workflows }
  - { kind: lesson, id: git-pull-requests-and-review }
  - { kind: lesson, id: postman-collections-in-ci }
  - { kind: lab, id: jira-enforce-work-item-keys }
  - { kind: project, id: jira-release-triage }
capstones: [capstone-b]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape for any team of two or more people building and releasing software together, from a semester project
to a product team. It is light on purpose: one key that travels from the work item through the branch, commits and
pull request into the release notes, and a small set of required checks that every change passes.

It does not deploy anything by itself; for that, add Continuous delivery to Kubernetes after the release step, or
Self-managed CI with Jenkins and build agents if CI must run on your own servers. If the team already plans in GitHub
Issues, GitHub Projects can replace Jira and keep everything in one place.

## How it works

The work item key is the thread that ties everything together. Written in capitals in the branch name, at the start
of each commit message and in the pull request title, it lets Jira link the code to the work and lets anyone answer
"what is in this release, and why?" from the commit history. A hook catches a missing key at commit time, and the
same check in CI makes the rule one that cannot be skipped.

Required checks are what turn "we test our changes" from an intention into a rule. Every pull request runs the unit
tests and the Postman collection against a freshly started API, and branch protection refuses the merge until they
pass and someone has reviewed the change. Because the status history in Jira records when work really started and
finished, the team can then measure its delivery with cycle time and throughput instead of estimates.
