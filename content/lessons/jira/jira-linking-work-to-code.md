---
id: jira-linking-work-to-code
title: Linking work items to branches and commits
track: jira
order: 3
level: beginner
estimated_minutes: 25
prerequisites: [jira-sprints-boards-and-wip, git-first-commits]
learning_objectives:
  - Put a work item's key in branch names, commit messages and pull request titles so Jira can link the code to the work.
  - Find every commit for a work item, and every work item a branch touched, with Git alone.
  - Explain why the key's exact format matters.
resources:
  - title: Reference work items in your development work
    url: https://support.atlassian.com/jira-software-cloud/docs/reference-issues-in-your-development-work/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: Where Jira looks for work item keys (branch names, commit messages, pull request titles) and how the key must be written.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: where-key
    prompt: Where should the work item key DEV-12 appear so that Jira links the code to the work item?
    options:
      - { id: a, text: "Only in a comment in the code" }
      - { id: b, text: "In the branch name, the commit messages and the pull request title" }
      - { id: c, text: "In the README" }
    answer: b
    explanation: Atlassian's documentation tells you to include the key in the branch name, the commit message and the pull request title; Jira's development integrations look for it there.
  - id: casing
    prompt: A commit message says "dev-12 fix reset link". Will Jira link it to DEV-12?
    options:
      - { id: a, text: "Yes, case does not matter" }
      - { id: b, text: "No — the key must be written as Jira shows it, in capitals: DEV-12" }
      - { id: c, text: "Only on Fridays" }
    answer: b
    explanation: Atlassian's documentation says to format keys with capital letters — "JRA-123", not "jra-123". You see in the lesson that a lower-case key is missed by a search that follows the same rule.
  - id: why-link
    prompt: Why is linking commits to work items worth the habit?
    options:
      - { id: a, text: "It makes the code run faster" }
      - { id: b, text: "Anyone can go from a work item to the exact code that changed for it, and from a line of code back to why it was written" }
      - { id: c, text: "Git requires it" }
    answer: b
    explanation: The link answers the questions people ask months later — what changed for this bug, and why does this code exist?
verification:
  method: executed
  details: Every command is run by the test suite with Git; the output shown was recorded from that run. No Jira site is needed or used; how Jira reads keys was checked against Atlassian's documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Write the work item's **key** — such as `DEV-12` — in your **branch name**, **commit messages** and **pull request title**: Jira's development integrations look for it there and link the code to the work, and even without Jira the key lets anyone find all the code for one piece of work.

## Explain it like I'm twelve

At a library, every book has a code on its spine. If you write that code on every note you take, you can later collect all notes about one book in seconds — and someone looking at a note knows exactly which book it is about.

The book is the **work item**, its code is the **key**, and your notes are **commits**.

Where the analogy breaks: Jira collects the notes automatically, once your Git host is connected to it.

## What problem it solves

Months later someone asks: "What exactly changed to fix the password-reset bug?" or "Why does this line exist?". Without a link, the answer is a search through hundreds of commits. With the key in branches and commits, Jira's development panel shows the branches, commits and pull requests for each work item, and Git can find them too.

## How it works

![](media:jira/key-links.svg)

- A key is the space's short name, a hyphen and a number: `DEV-12`. Write it exactly as Jira shows it, in capitals.
- Name the branch after the work item (`DEV-12-reset-link`), start commit messages with the key (`DEV-12 Expire reset links after 30 minutes`), and put the key in the pull request title.
- When a Git host such as GitHub or Bitbucket is connected to Jira, Jira reads those keys and shows the linked work in the work item's development panel.

## Try it yourself

> **Local lab** — needs only Git. You play a developer on the space `DEV`; no Jira site is used. Every command is run automatically in DevForge's tests.

### 1. A repository and two pieces of work

```bash run
mkdir jira-lab && cd jira-lab
git init -q -b main && git config user.name "Asha" && git config user.email "asha@example.edu"
echo "reset link: no expiry" > auth.txt && git add . && git commit -q -m "Initial version"

git switch -q -c DEV-12-reset-link-expiry
echo "reset link: expires after 30 minutes" > auth.txt && git commit -q -am "DEV-12 Expire reset links after 30 minutes"
echo "reset link: single use" >> auth.txt && git commit -q -am "DEV-12 Make reset links single use"
git switch -q main && git merge -q --no-ff -m "Merge DEV-12-reset-link-expiry" DEV-12-reset-link-expiry

git switch -q -c DEV-15-timetable-cache
echo "timetable: cached for 60 s" > timetable.txt && git add . && git commit -q -m "DEV-15 Cache the timetable for 60 seconds"
echo "reset link: single use, logged" >> auth.txt && git commit -q -am "dev-12 log reset link use"
git log --oneline --format='%s' main..
```

```text output
dev-12 log reset link use
DEV-15 Cache the timetable for 60 seconds
```

- The first branch is named after **DEV-12** and both of its commits start with the key; it is merged into `main`.
- The second branch, for **DEV-15**, also contains a commit about DEV-12 — but written as `dev-12`, in lower case.
- `git log main..` lists the commits on the current branch that are not yet on `main`.

### 2. Every commit for one work item

```bash run
git switch -q main && git merge -q --no-ff -m "Merge DEV-15-timetable-cache" DEV-15-timetable-cache
git log --format='%s' --grep='DEV-12\b'
```

```text output
Merge DEV-12-reset-link-expiry
DEV-12 Make reset links single use
DEV-12 Expire reset links after 30 minutes
```

`--grep` searches commit messages. It finds both DEV-12 commits and the merge — but not `dev-12 log reset link use`, because the search, like Jira, expects the key in capitals. That commit is invisible from the work item.

### 3. Every work item a piece of history touched

```bash run
git log --format='%s' | grep -o '\b[A-Z][A-Z0-9]*-[0-9]\+\b' | sort | uniq -c
```

```text output
      3 DEV-12
      2 DEV-15
```

- `grep -o` pulls out everything shaped like a key: capital letters (and digits), a hyphen, a number.
- This is how you write release notes or check that every change belongs to a work item. Again, the lower-case `dev-12` is missed.

### 4. Find the commits with a malformed key

```bash run
git log --format='%h %s' | grep -iv '^[0-9a-f]* \(Merge \|Initial\)' | grep -v ' [A-Z][A-Z0-9]*-[0-9]\+ ' | cut -d' ' -f2-
```

```text output
dev-12 log reset link use
```

A quick check like this — run in a team's CI on every pull request — catches commits that will not link to any work item before they are merged.

## Common mistakes

- **Keys in lower case or with a typo** (`dev-12`, `DEV12`). They link to nothing.
- **Only the branch has the key.** Branch names disappear after merging; put the key in commit messages and the pull request title too.
- **One branch for several work items.** It makes the history impossible to untangle; one work item, one branch.
- **Commit messages that are just the key.** `DEV-12` alone says nothing; add what the commit does.

## Where this fits in a real system

The same keys travel through the whole delivery path: **GitHub** pull requests with **GitHub Actions** checks (which can enforce the key format), builds in **Jenkins**, and deployments that Jira can show next to the work item when the deployment tool is connected.
