---
id: jira-plan-and-run-a-sprint
title: Plan and run a sprint
track: jira
level: intermediate
mode: simulation
estimated_minutes: 30
prerequisites: [jira-work-items-and-workflows, jira-sprints-boards-and-wip]
objectives:
  - Predict, then watch, how a work-in-progress limit changes focus, the burndown and what gets finished.
  - Keep the sprint goal safe when a story is blocked.
  - Plan a sprint against the team's capacity so that nothing committed is carried over.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: jira-sprint-board
  challenges: [meet-the-goal, finish-what-you-start]
resources:
  - title: Complete a sprint
    url: https://support.atlassian.com/jira-software-cloud/docs/complete-a-sprint/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: What counts as complete, and where unfinished work items go when a sprint ends.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Configure columns
    url: https://support.atlassian.com/jira-software-cloud/docs/configure-columns/
    publisher: Atlassian
    type: documentation
    level: beginner
    official: true
    why: Column constraints — the minimum and maximum number of work items a column should hold, and how the board shows them.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model of a sprint. It follows the ideas the Jira lessons take from Atlassian's documentation — only work in the last column counts as done, unfinished work does not count when the sprint ends, and a WIP limit is a team rule the board shows — while its focus cost, fixed blockers and exact story points are simplifications. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the sprint-board simulation like a scientist: **predict** how the sprint will go, **run** it day by day, and **compare** with the board, the burndown and the event log. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a sprint, not Jira; the lesson *Sprints, boards and work-in-progress limits* explains how the same ideas appear in Jira's boards and charts.

## Steps

### 1. Meet the sprint goal

Choose the scenario **Everything started at once**. All eight stories (34 points) are in the sprint, and the **In Progress WIP limit** is 8. The sprint goal is DEV-1, DEV-2 and DEV-3. Before you press anything, write down:

- The team does 3 points a day at full focus, and each story in progress beyond the three developers costs 10 % of its focus, down to half. What is the team's focus with eight stories in progress?
- Will the goal stories finish by day 10?

Press **Step** one day at a time, or **Play**. After each day, read the focus in the event log and compare the burndown with its ideal line. What happens to the work on day 2, when DEV-2 becomes blocked?

Press **Reset**, choose a different WIP limit before day 1, and run the sprint again. Predict first: which stories start on day 1, and in what order? Which limits still meet the goal, and which do not?

### 2. Finish everything you commit

Choose **A sprint that is too full**. It holds the same 34 points, with a WIP limit of 3.

- The event log gives the team's full-focus capacity for the sprint. How does 34 points compare with it, before you even count blockers?
- If something must leave the sprint, which stories matter least? Look at their order in **Backlog and plan**.

Run the sprint once and note what is carried over. Then press **Reset** and use **Remove** in **Backlog and plan** before the first day; planning ends once the sprint starts. Run it again and check that the goal is met and nothing is left over.

## Simulation

```simulation jira-sprint-board
```

## Reset

The simulation has a **Reset** button that restores the scenario's starting state. Your verified challenges stay recorded.

## What you practised

A sprint is a bet on how much a team can finish. Starting everything at once spreads the team's focus and puts the sprint goal at risk, while a WIP limit gets stories finished. Committing to less than full capacity leaves room for blocked work, so nothing committed is carried over.
