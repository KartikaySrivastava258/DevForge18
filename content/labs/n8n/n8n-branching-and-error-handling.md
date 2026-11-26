---
id: n8n-branching-and-error-handling
title: Add branching and error handling
track: n8n
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [n8n-workflows-nodes-and-items, n8n-validation-and-errors]
objectives:
  - Trace each item through a workflow and predict which output of each node it leaves by.
  - Route invalid submissions to an error workflow with complete checks, so none is dropped or saved.
  - Choose between an error output and retries for a service that fails for a moment.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: n8n-workflow-executor
  challenges: [report-invalid, complete-checks, survive-flaky]
resources:
  - title: n8n — handle errors gracefully
    url: https://docs.n8n.io/build/flow-logic/handle-errors-gracefully/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Error workflows with the Error Trigger, and handling errors inside a workflow.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n — work with nodes (node settings)
    url: https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Retry On Fail and On Error (Continue using error output).
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model of one form workflow, not a real n8n. Its rules — items pass between nodes, an If node's unconnected output sends its items nowhere, Continue (using error output) sends failed items to a second output, Retry On Fail reruns a failing node, and otherwise a failing node fails the execution — follow the n8n documentation, as stated in the model. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the workflow executor like a scientist: **predict** where each of the five submissions will end up, **run** the workflow, and **compare** with the outcome table and the event log. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of an n8n workflow (Form → Valid? → Check seats → Save), not a real n8n. The lessons *Workflows, nodes and items* and *Validating input and handling errors* show the same nodes and settings in a real n8n running in Docker.

## Steps

### 1. Report invalid submissions

Choose the scenario **Invalid items vanish**. The If node, **Valid?**, checks all three rules, but its false output is not connected. Read the five submissions in the table. Before you touch anything, write down:

- Which submissions are invalid, and which rule does each one break?
- Where will the invalid items go when you run the workflow? Will the execution succeed or fail?

Press **Run the workflow**. Compare the **Outcome** column and the **Dropped silently** summary with your prediction. Then read the trace below the table: what did **Valid?** send out of its true output, and what out of its false one?

Now look at **Valid? false output**. What should happen to an item that fails validation? Change the setting, predict the new outcome for every submission, and run again.

A dropped item leaves no trace. The execution still says it succeeded, so nobody finds out.

### 2. Check everything that matters

Choose **Only the name is checked**. Invalid items now go to the error workflow, but **Valid?** checks only that the name is not empty.

- Which invalid submissions will this check catch, and which will slip through?
- Where will the ones that slip through end up?

Run it and read the event log. Does it warn that invalid submissions were saved? For each one, which rule under **Valid? (If node) checks** would have caught it? Tick what you need, predict the outcome again, and run.

An error branch only helps with the items your checks recognise as wrong.

### 3. Survive a flaky service

Choose **A flaky seat service**. Validation is complete, but **Check seats** times out the first time it is asked about submission 5. On Error is set to Stop Workflow, with no retries.

- When the request for #5 fails, what happens to the whole execution? Will the valid submissions before it be saved?
- Run it once more without changing anything. Does the second execution behave any differently?

Run it and read the outcome for every submission. Then try one setting at a time and predict before each run:

- Set **Check seats: On Error** to Continue (using error output). Does the execution survive? Where does #5 end up, and does that meet the goal?
- The outage is temporary. What would a person do if a request failed once? Which setting does that for you?

Read the note on **Check seats** in the trace: how many requests did it make?

An error output keeps the execution going but reports the item. Retries help only when a second try can succeed.

## Simulation

```simulation n8n-workflow-executor
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

In n8n, items flow node by node, and each output decides where they go next. An unconnected output drops items silently, and missing checks let bad items through. For a failing node, Stop Workflow, an error output and Retry On Fail each give a different result, and you choose by asking whether the failure is temporary.
