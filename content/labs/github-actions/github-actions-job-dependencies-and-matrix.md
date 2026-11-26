---
id: github-actions-job-dependencies-and-matrix
title: Speed up a workflow with needs and a matrix
track: github-actions
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [github-actions-pull-requests-and-safety, github-actions-caching-and-artifacts]
objectives:
  - Predict when each job starts from its needs, and the total run time.
  - Remove dependencies that are not real without breaking the ones that are.
  - Use a matrix to test three Node versions without making the run longer, and see how a failed job skips the jobs that need it.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the timeline" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: github-actions-workflow-run
  challenges: [fast-and-correct, three-versions-fast]
resources:
  - title: GitHub Actions documentation
    url: https://docs.github.com/en/actions
    publisher: GitHub
    type: documentation
    level: all
    official: true
    why: Workflow syntax, events, runners, permissions and security hardening, from GitHub.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with fixed job durations and runners that are always free. Its rules follow GitHub's documentation (jobs run in parallel unless one needs another; if a needed job fails or is skipped, the jobs that need it are skipped; a matrix runs a job once per combination). Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the workflow-run simulation like a scientist: **predict** the timeline, **run** the workflow, and **compare** with the start and end minute of every job. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of a workflow run, not GitHub Actions; the lessons *Pull requests, required checks and safe workflows* and *Caching and artifacts* show real workflows with a matrix and with `needs`.

## Steps

### 1. Twelve minutes, still correct

Choose the scenario **Everything in a line**. Each job needs the one before it. Before you touch anything, write down:

- Using the durations shown next to each job, how long will the whole run take?
- Which jobs really use another job's output, and which could start straight away?

Press **Run the workflow** and compare the timeline with your prediction.

Now change the **needs** checkboxes. Read the event log after each change: it warns you when a job no longer waits for something it uses.

- Which chain of jobs decides the total time once the false dependencies are gone?
- Is 12 minutes the best this workflow can do? Why?

Run again after each change and compare. Every needless `needs` makes the run longer; every missing one lets a job start before what it uses exists.

### 2. Three versions, no slower

Choose **Testing three Node versions**. Only the real dependencies are set, but the unit job tests Node 20, 22 and 24 one after another.

- How long does the unit job take now? Predict the total run time before you run it.
- What would change if each Node version ran in its own job, side by side?

Run the workflow, then use **Run unit as a matrix**, predict again, and run. Which job is now on the longest path?

Before you finish, tick **fails** on one job and predict which jobs will be skipped. Run it and check. Untick it again: the challenge needs a run in which every job succeeds.

## Simulation

```simulation github-actions-workflow-run
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

Jobs run in parallel unless one needs another, so the total time is set by the longest chain of real dependencies. A matrix tests several versions side by side instead of one after another, and a failed job skips every job that needs it.
