---
id: jira-sprints-boards-and-wip
title: Sprints, boards and work-in-progress limits
track: jira
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [jira-work-items-and-workflows]
learning_objectives:
  - Plan a sprint from a prioritised backlog against the team's capacity, with a sprint goal.
  - Read a board, a burndown chart and a cumulative flow diagram.
  - Explain why limiting work in progress helps a team finish work, and how Jira shows a column over its limit.
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
  - title: Comprehensive kanban tutorial with Jira
    url: https://www.atlassian.com/agile/tutorials/how-to-do-kanban-with-jira
    publisher: Atlassian
    type: tutorial
    level: beginner
    official: true
    why: Kanban boards in Jira, including setting work-in-progress limits on columns.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: unfinished
    prompt: The sprint ends and two stories are still In Progress. What does Jira do with them when you complete the sprint?
    options:
      - { id: a, text: "Marks them done" }
      - { id: b, text: "Asks where they should go — the backlog, a future sprint, or a new sprint" }
      - { id: c, text: "Deletes them" }
    answer: b
    explanation: Only work in the board's last column counts as complete. Atlassian's documentation says incomplete work items can be moved to the backlog, an existing future sprint, or a new sprint.
  - id: wip-limit
    prompt: Your In Progress column has a maximum of 3 and holds 5 work items. What does Jira do?
    options:
      - { id: a, text: "Refuses to move the extra items" }
      - { id: b, text: "Highlights the column so the team sees it is over its limit; it does not block the move" }
      - { id: c, text: "Nothing at all" }
    answer: b
    explanation: Column constraints are a visual signal — a red column header for a maximum exceeded. The team decides what to do, usually finishing work before starting more.
  - id: why-limit
    prompt: Why does limiting work in progress often help a team finish more?
    options:
      - { id: a, text: "People work faster when they have fewer tasks" }
      - { id: b, text: "Less switching between tasks, blocked work is noticed sooner, and effort goes into finishing items instead of starting new ones" }
      - { id: c, text: "Jira rewards teams with low WIP" }
    answer: b
    explanation: Many items in progress means attention is split and nothing finishes. The simulation in this lesson lets you see it in a burndown.
verification:
  method: docs-checked
  details: Jira is a hosted service, so this lesson has no commands to run; it was checked against Atlassian's documentation on 2026-11-25. The simulation is a labelled teaching model of a sprint. Atlassian changes Jira's screens often, so details of the interface may differ from what you see.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

In **Scrum**, a team picks work from its **backlog** into a short, fixed-length **sprint** with a **sprint goal**; in **Kanban**, work flows continuously across a **board** whose columns have **work-in-progress (WIP) limits** — and in both, Jira's board and charts show whether work is actually finishing.

## Explain it like I'm twelve

Your class has two weeks to prepare a science fair. The teacher's list has twenty possible jobs, in order of importance (the **backlog**). The class picks what it can really do in two weeks (the **sprint**) and writes the one thing that must work on the day — "the volcano erupts" (the **sprint goal**).

If everyone starts a different job on day one, by day ten there are twenty half-finished jobs and no volcano. If the class agrees "no more than three jobs at once", jobs actually get finished — that rule is a **WIP limit**.

Where the analogy breaks: in real teams, priorities change during the sprint, and the team talks every day to adjust.

## What problem it solves

Teams start more than they finish, promise more than fits, and discover too late that something is stuck. A sprint makes the team commit to a realistic amount with a clear goal; a board makes every piece of work visible; WIP limits and charts make stuck or overloaded work obvious early.

## How it works

```diagram steps=jira/sprint-board
```

- The **backlog** is the ordered list of work not yet started; the top is what matters most.
- In **sprint planning**, the team moves items from the backlog into the sprint until it reaches its **capacity**, often measured in story points (a relative size estimate), and writes a sprint goal.
- On the **board**, each column maps to workflow statuses. Work counts as complete only in the board's **last column**. When a sprint is completed, Jira asks where the incomplete work items should go: the backlog, a future sprint, or a new sprint.
- **Column constraints** set a minimum or maximum number of work items for a column. Over the maximum, the column header turns red — a signal, not a block.
- A **burndown chart** shows the work remaining in the sprint day by day, against an ideal line. A **cumulative flow diagram** stacks how many items are in each column over time; a widening "in progress" band means work is piling up.

## Try it in the simulation

A ten-day sprint with a three-person team, a backlog of stories and a few blockers that appear on fixed days. Plan the sprint, set a WIP limit, and play it day by day — watch the burndown and the board. It is a labelled teaching model of a sprint, not Jira.

```simulation jira-sprint-board scenario=too-much-wip
```

## Common mistakes

- **Planning more than the team's capacity.** Leave room for bugs, reviews and surprises; a sprint full to 100 % will not finish.
- **No sprint goal.** Without one, the team cannot decide what to drop when things go wrong.
- **Starting everything on day one.** High WIP spreads effort thin and hides blocked work; finish before you start.
- **Ignoring a red column.** A WIP limit only helps if the team reacts — swarm on what is stuck.
- **Treating story points as hours or as a target.** They are relative sizes for planning; comparing teams by points rewards inflating them.

## Where this fits in a real system

Board columns often match the path of code through the system: In Progress (a **Git** branch), In Review (a pull request with **GitHub Actions** checks), Done (merged and deployed by **Jenkins** or GitHub Actions). Linking work items to that code is the next lesson.
