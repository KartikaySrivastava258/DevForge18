---
id: jira-work-items-and-workflows
title: Work items, types and workflows
track: jira
order: 1
level: beginner
estimated_minutes: 25
prerequisites: []
learning_objectives:
  - Explain what a Jira work item is and choose the right work type — epic, story, task, bug or subtask.
  - Write a story that says who wants what and why, with acceptance criteria that can be checked.
  - Read a workflow as statuses and transitions, and explain what "done" means for a team.
resources:
  - title: What are work types?
    url: https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: Atlassian's definitions of epics, stories, tasks, bugs and subtasks.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: "Work is the new collective term for items tracked in Jira"
    url: https://community.developer.atlassian.com/t/work-is-the-new-collective-term-for-items-tracked-in-jira/88552
    publisher: Atlassian (developer community announcement)
    type: article
    level: all
    official: true
    why: Why newer Jira screens say "work items" where older guides and the REST API say "issues".
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: which-type
    prompt: Users cannot reset their password because the email link points to the wrong page. Which work type fits?
    options:
      - { id: a, text: "Epic" }
      - { id: b, text: "Bug — a problem that impairs or prevents a function of the product" }
      - { id: c, text: "Story" }
    answer: b
    explanation: Atlassian describes a bug as a problem which impairs or prevents the functions of a product. A story describes new value for a user; an epic groups a larger initiative.
  - id: good-criteria
    prompt: Which is a checkable acceptance criterion for "As a student, I want to reset my password, so that I can get back into my account"?
    options:
      - { id: a, text: "Password reset should be easy" }
      - { id: b, text: "A reset link sent to the registered email works once and expires after 30 minutes" }
      - { id: c, text: "Use a nice design" }
    answer: b
    explanation: A good criterion can be tested with a clear yes or no. "Easy" and "nice" cannot.
  - id: workflow-done
    prompt: Why should a team agree what its last workflow status means?
    options:
      - { id: a, text: "It does not matter" }
      - { id: b, text: "Boards and reports count work as complete only in the last column, so \"Done\" must mean the same thing to everyone — for example reviewed, tested and merged" }
      - { id: c, text: "Jira deletes work items in that status" }
    answer: b
    explanation: Jira treats work in the board's last column as complete when a sprint ends. If "Done" means different things to different people, the reports are wrong.
verification:
  method: docs-checked
  details: Jira is a hosted service, so this lesson has no commands to run; it was checked against Atlassian's documentation on 2026-11-25. Atlassian changes Jira's screens and names often (for example "issues" became "work items"), so details of the interface may differ from what you see.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Jira** tracks a team's work as **work items** — each with a **work type** such as story, task or bug, a short description of what is needed, and a **status** that moves through a **workflow** from "To Do" to "Done".

## Explain it like I'm twelve

A class is putting on a school play. Every job goes on its own card: "paint the backdrop", "the spotlight flickers", "learn Act 1". Big jobs get a folder that holds many cards ("costumes"). The cards hang on a board with three columns — not started, doing, finished — and you move a card when its job moves.

Each card is a **work item**, the folder is an **epic**, the kind of card (job, problem, small step) is its **work type**, and the columns are the **workflow**.

Where the analogy breaks: Jira also keeps the history of every card — who moved it, when, and what was said about it.

## What problem it solves

When work lives in chats and heads, nobody knows what is being done, by whom, or what is blocked. Writing each piece of work down once, in a standard shape, with a visible status, lets a team plan, notice problems early, and look back at what actually happened.

## How it works

![](media:jira/work-item-hierarchy.svg)

- A **work item** is one piece of work. Newer Jira screens say "work item" where older guides — and Jira's REST API — say "issue"; they are the same thing.
- **Work types** (Atlassian's own descriptions): an **epic** is "a big user story that needs to be broken down" and groups stories, tasks and bugs; a **story** is "the smallest unit of work that needs to be done", written from a user's point of view; a **task** "represents work that needs to be done"; a **bug** "is a problem which impairs or prevents the functions of a product"; a **subtask** is "a piece of work that is required to complete a task".
- Each work item has a **key** such as `DEV-12`: the space's short name and a number. The key is how people — and tools such as Git — refer to it.
- A **workflow** is a set of **statuses** (for example To Do, In Progress, In Review, Done) and the **transitions** allowed between them.

## Writing a good story

A widely used way to write a story names the user, the goal and the reason:

> **As a** student, **I want** to reset my password, **so that** I can get back into my account when I forget it.

Then add **acceptance criteria**: short statements that must all be true before the story counts as done, each one testable with a clear yes or no.

- A reset link is sent to the registered email address only.
- The link works once and expires after 30 minutes.
- After resetting, the student is signed in and every other session is signed out.

Keep a story small enough to finish within one sprint (next lesson). If it is bigger, it is probably an epic: split it into stories that each deliver something a user can try.

## Try it yourself

> **Read-through lab** — no account needed. Jira has a free plan if you want to try these steps in a real site later (check Atlassian's current terms); it is never required here.

Take a project you know — a club website, a course assignment — and write, on paper or in a text file:

1. One **epic** for a big goal ("Members can sign up online").
2. Three **stories** under it, each in the *As a / I want / so that* form, with two or three acceptance criteria.
3. One **bug** you can imagine, with steps to reproduce it, what you expected and what happened.
4. The **workflow** you would use, as a line of statuses, and one sentence saying what "Done" means for your team.

Compare your stories with the checklist below; rewrite any that fail a check.

- Does each story name a real user and a reason?
- Can each acceptance criterion be tested with yes or no?
- Could the story be finished in a week or two?
- Does "Done" include review and testing, not just "the code is written"?

## Common mistakes

- **Stories that describe a solution instead of a need.** "Add a Redis cache" is a task; "As a student, I want the timetable to load in under a second" is a story — and Redis may or may not be the answer.
- **Acceptance criteria that cannot be tested** — "fast", "user-friendly", "secure" without numbers or conditions.
- **Epics used as giant stories.** An epic is a container; the work happens in its stories.
- **Workflows with too many statuses.** Every status is a place where work can wait unseen. Start small.
- **"Done" that means "coded".** Work that is not reviewed, tested and merged is not done.

## Where this fits in a real system

Work items connect the rest of the course: a story's key appears in **Git** branch names and commits (lesson 3), its pull request runs **GitHub Actions** checks, and its deployment goes out through **Jenkins** or GitHub Actions. Bugs often start as alerts from **Prometheus** or traces in **OpenTelemetry**.
