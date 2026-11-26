---
id: airflow-scheduler-experiments
title: Predict scheduler runs, retries and backfills
track: airflow
level: intermediate
mode: simulation
estimated_minutes: 30
prerequisites: [airflow-schedules-and-catchup, airflow-retries-and-failures]
objectives:
  - Predict, then check, which runs the scheduler creates with and without catchup as days pass.
  - Use retries to get through a temporary outage, and explain what a failed attempt leaves in the table.
  - Backfill a week so that every date is loaded exactly once, by making the load task safe to repeat.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: airflow-scheduler-timeline
  challenges: [flaky-week, fill-missed-days, backfill-without-duplicates]
resources:
  - title: DAG runs
    url: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html
    publisher: The Apache Software Foundation
    type: documentation
    level: beginner
    official: true
    why: Logical dates, data intervals, timetables and catchup, including its default in Airflow 3.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Airflow best practices
    url: https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Why tasks should produce the same outcome on every re-run, and other advice for production DAGs.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model of one daily DAG, not a real Airflow. Its rules — one run per logical date, catchup creating every missed run or only the most recent one, retries as extra attempts, and a backfill's reprocess behaviour — follow the Airflow 3 documentation, as stated in the model. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the scheduler timeline like a scientist: **predict** which runs Airflow will create and what each one leaves in the table, **run** the experiment, and **compare** with the event log. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of Airflow's scheduler, not a real Airflow. The lessons *Schedules, logical dates and catchup* and *Retries, failures and safe re-runs* show the same ideas on a real Airflow running in Docker.

## Steps

### 1. Get through a flaky week

Choose the scenario **A week with a flaky source**. Today is 1 January. The source will time out on 3 and 6 January, and the task has no retries. Before you touch anything, write down:

- When you press **Step** to reach 3 January, will its run succeed or fail? How many tries will it show?
- Which dates will the table be missing rows for at the end of the week?

Step one day at a time to 7 January. Read the event log under **What happened** after each step, and the **Run** and **Rows** columns.

Now press **Reset**. The outage is temporary: trying again a moment later works. Which task setting makes Airflow try again by itself? Change it, predict the number of tries for 3 and 6 January, and step through the week again.

Retries are for problems that go away on their own. A bug or a missing file would fail on every try.

### 2. Fill in the missed days

Choose **Deployed a week late, without catchup**. The DAG's `start_date` is 1 January, but it was deployed on 8 January.

- How many runs exist right now? Which logical dates do they cover?
- What would be different with `catchup=True`?

Check your second answer: switch to **Deployed a week late, with catchup** and read the table. Then go back to the scenario without catchup.

Catchup only applies when the DAG is deployed. To process the past dates now, use the **Backfill** controls (**From**, **To**, **Reprocess**, **Create backfill**). Before you press the button, decide:

- Which range of dates needs a run?
- Does the **Reprocess** choice matter for this range? Why, or why not?

Compare each date's run kind (scheduled or backfill) and its rows with your prediction.

### 3. Backfill without duplicates

Choose **A broken week with an appending task**. It is 8 January. The runs for 4 and 5 January failed, and the load task appends rows, so those failed runs left half-written data behind. Look at the **Rows** column first.

- If you **Clear** the run for 4 January while the task still appends, how many rows will the table hold for that date? Work it out, then try it.
- Why does a successful run not repair the table here?

Now decide what must change before you re-run anything. Use **Load task writes by** and read what the event log says the task now does. Then choose a backfill range and a **Reprocess** option that covers the dates that are still wrong.

If you made a date wrong in an earlier experiment, ask yourself which reprocess option, or which button, would run it again. You can also press **Reset** and start again.

A task that replaces its day's rows gives the same result however often it runs. That is what makes retries, clears and backfills safe.

## Simulation

```simulation airflow-scheduler-timeline
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

The scheduler creates one run per logical date, and catchup decides whether it fills in the past when a DAG is deployed. Retries rescue temporary failures, and backfills process past dates on purpose. None of that is safe unless the task gives the same result each time it runs for a date.
