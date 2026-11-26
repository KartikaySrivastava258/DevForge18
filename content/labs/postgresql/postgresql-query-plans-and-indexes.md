---
id: postgresql-query-plans-and-indexes
title: Compare query plans before and after indexing
track: postgresql
level: intermediate
mode: simulation
estimated_minutes: 30
prerequisites: [postgresql-indexes-and-explain]
objectives:
  - Predict, then check, whether the planner will choose a sequential scan or an index scan.
  - Choose a single-column or two-column index that makes a query touch fewer than 1 % of the table.
  - Explain why an index on a column that matches many rows is not used.
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The two challenges below show Done" }
simulation:
  id: postgresql-query-planner
  challenges: [customer-index, pending-day-index]
resources:
  - title: Using EXPLAIN
    url: https://www.postgresql.org/docs/16/using-explain.html
    publisher: The PostgreSQL Global Development Group
    type: documentation
    level: beginner
    official: true
    why: How to read plans — scan types, filters, rows removed — and what EXPLAIN ANALYZE adds.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Indexes — introduction and index types
    url: https://www.postgresql.org/docs/16/indexes-intro.html
    publisher: The PostgreSQL Global Development Group
    type: documentation
    level: beginner
    official: true
    why: What an index is for, the B-tree default, and the cost of keeping indexes up to date.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model with invented cost units and exact row counts. Its rules follow the PostgreSQL documentation (the planner picks the plan it estimates is cheapest, and a multicolumn B-tree index is most useful with conditions on its leading columns). Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the query-planner simulation like a scientist: **predict** which plan the planner will choose, **run** EXPLAIN, and **compare** with the plans it considered. You finish when the server has verified both challenges.

This lab runs in your browser. It is a model of PostgreSQL's planner, not a database; the lesson *Indexes and EXPLAIN ANALYZE* shows real plans from a real PostgreSQL server.

## Steps

### 1. Touch fewer than 1 % of rows

Choose the scenario **One customer's orders**. The table has 100,000 rows, and the query returns 20 of them. Before you touch anything, write down:

- With no index, how many rows must PostgreSQL read to find those 20?
- Which column in the `WHERE` clause could an index help with?

Press **Run EXPLAIN** and read **Rows touched** and the table of plans considered. Then pick a column in **Index column 1**, press **Create index**, predict the new plan, and run EXPLAIN again.

- How many rows did the index scan touch, compared with the rows returned?
- What happened to the cost of the sequential scan? Did it change at all?

The planner does not "prefer" indexes. It compares the estimated cost of every plan it could use and picks the cheapest.

### 2. The right column for the job

Choose **Pending orders on one day**. One order in ten is pending, and there are 365 days.

- About how many rows match `status = 'pending'` on its own? And `day = 100` on its own?
- If you create an index on `status` only, will the planner use it? Write down why you think so before you try.

Create that index, run EXPLAIN and compare the costs in the table. Then try other indexes: a different single column, or two columns with **Index column 2**. Use **Drop** to remove an index you no longer want.

- For a two-column index with both `status` and `day`, does the order of the columns change the rows touched?
- Now try a two-column index where only one of its columns is in the query. Does it matter whether that column comes first or second?
- Which index would you keep in a real database, given that every index also slows down writes?

For a contrast, choose **Nine orders in ten** and predict what the planner does with an index on `status` before you run EXPLAIN.

## Simulation

```simulation postgresql-query-planner
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

An index helps only when it lets the planner skip most of the table. A condition that matches one row in ten — or nine in ten — is not selective enough, so the planner's cost estimate keeps the sequential scan. Choosing which columns to index, and in which order, comes from reading the plans, not from guessing.
