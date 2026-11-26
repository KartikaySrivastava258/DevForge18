---
id: postgresql-indexes-and-explain
title: Indexes and EXPLAIN ANALYZE
track: postgresql
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [postgresql-relationships-and-joins]
learning_objectives:
  - Read a query plan with EXPLAIN and see what a query really did with EXPLAIN ANALYZE.
  - Add an index and show, with row counts, how it changes the plan.
  - Explain why the planner sometimes ignores an index, and what indexes cost.
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
self_check:
  - id: rows-removed
    prompt: 'EXPLAIN ANALYZE shows "Seq Scan on orders" with "Rows Removed by Filter: 99980" for a query that returns 20 rows. What does that tell you?'
    options:
      - { id: a, text: "The query is as fast as it can be" }
      - { id: b, text: "PostgreSQL read every row and threw almost all of them away — a selective index on the filtered column would let it go straight to the 20 it needs" }
      - { id: c, text: "Rows were deleted from the table" }
    answer: b
    explanation: The line Rows Removed by Filter counts rows that were read and rejected by the condition. Reading 100,000 rows to keep 20 is the classic sign of a missing index.
  - id: ignored-index
    prompt: There is an index on status, but a query for status = 'shipped' — nine rows in ten — still uses a sequential scan. Why?
    options:
      - { id: a, text: "The index is broken" }
      - { id: b, text: "When a condition matches a large share of the table, reading it in order is cheaper than jumping between the index and scattered rows, so the planner chooses the sequential scan" }
      - { id: c, text: "PostgreSQL never uses indexes on text columns" }
    answer: b
    explanation: Fetching rows one by one through an index is much more expensive per row than reading the table sequentially; it only pays off when few rows match. You see the planner make that choice in the lesson.
  - id: cost
    prompt: Why not add an index on every column?
    options:
      - { id: a, text: "PostgreSQL allows only one index per table" }
      - { id: b, text: "Every index must be kept in step with the table, which adds work to every insert, update and delete — and unused indexes give nothing back" }
      - { id: c, text: "Indexes make SELECT slower" }
    answer: b
    explanation: The documentation notes that keeping an index synchronised adds overhead to data changes, and that indexes seldom or never used should be removed.
verification:
  method: executed
  details: Every statement is run by the test suite against PostgreSQL 16 (the CI service container); the output shown was recorded from that run. Plans are shown without costs and timings, which vary between machines. Facts about EXPLAIN, scan types and indexes were checked against the PostgreSQL 16 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Before running a query, PostgreSQL's **planner** chooses a **plan** — for example read the whole table (**sequential scan**) or use an **index** to jump to the matching rows — and `EXPLAIN` shows that plan, while `EXPLAIN ANALYZE` actually runs the query and shows how many rows each step really touched.

## Explain it like I'm twelve

To find every mention of "volcano" in a thick book, you could read every page — or turn to the index at the back, which lists the pages for each word. For one rare word, the index is much faster. But if you want every page that mentions "the", flipping back and forth to the index is slower than just reading the book.

Reading every page is a **sequential scan**, the list at the back is an **index**, and deciding which way is faster is the **planner**'s job.

Where the analogy breaks: the planner decides from statistics about the table, not by trying both ways.

## What problem it solves

Queries that are instant on a laptop with 50 rows take seconds in production with millions. Instead of guessing, `EXPLAIN ANALYZE` shows exactly what PostgreSQL did — which scan, how many rows it read and threw away — so you can add the right index, and check that it is really used.

## How it works

```diagram steps=postgresql/scan-vs-index
```

- `EXPLAIN query` shows the plan the planner chose. `EXPLAIN ANALYZE query` runs the query and adds the real row counts of every plan step.
- A **Seq Scan** reads every row and applies the condition as a **Filter**; `Rows Removed by Filter` counts the rows it read and rejected.
- `CREATE INDEX` builds a **B-tree** by default, which the planner can use for `=`, `<`, `>`, `BETWEEN` and similar conditions. An **Index Scan** or a **Bitmap Index Scan** then finds the matching rows without reading the others.
- The planner chooses by estimated cost, using statistics that `ANALYZE` collects. On a tiny table, or when many rows match, a sequential scan is cheaper — and it picks that.

## Try it yourself

> **Local lab** — needs PostgreSQL and `psql`, as in the previous lessons. Every statement is run automatically in DevForge's tests. Plans are shown with `COSTS OFF` (and, for `ANALYZE`, `TIMING OFF, SUMMARY OFF`), because costs and timings differ from machine to machine; row counts do not.

### 1. A table with 100,000 orders

```sql run
CREATE TABLE orders (
    id          integer PRIMARY KEY,
    customer_id integer NOT NULL,
    status      text    NOT NULL,
    total       numeric NOT NULL
);
INSERT INTO orders (id, customer_id, status, total)
SELECT i, i % 5000, CASE WHEN i % 10 = 0 THEN 'pending' ELSE 'shipped' END, (i % 100) + 0.99
FROM generate_series(1, 100000) AS i;
ANALYZE orders;
SELECT count(*) AS orders, count(DISTINCT customer_id) AS customers FROM orders;
```

```text output
CREATE TABLE
INSERT 0 100000
ANALYZE
 orders | customers
--------+-----------
 100000 |      5000
(1 row)
```

- `generate_series(1, 100000)` produces the numbers 1 to 100,000; each becomes an order. `i % 5000` spreads them over 5,000 customers, 20 orders each, and nine orders in ten are shipped.
- `ANALYZE` collects the statistics the planner uses to estimate how many rows a condition matches.

### 2. One customer's orders, without an index

```sql run
EXPLAIN (COSTS OFF) SELECT * FROM orders WHERE customer_id = 42;
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT * FROM orders WHERE customer_id = 42;
```

```text output
          QUERY PLAN
------------------------------
 Seq Scan on orders
   Filter: (customer_id = 42)
(2 rows)

                 QUERY PLAN
---------------------------------------------
 Seq Scan on orders (actual rows=20 loops=1)
   Filter: (customer_id = 42)
   Rows Removed by Filter: 99980
(3 rows)
```

- `EXPLAIN` alone shows the plan: a **Seq Scan** with a **Filter**.
- `EXPLAIN ANALYZE` ran it: 20 rows came out — and `Rows Removed by Filter` shows how many were read for nothing.

### 3. Add an index and look again

```sql run
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT * FROM orders WHERE customer_id = 42;
```

```text output
CREATE INDEX
                                 QUERY PLAN
----------------------------------------------------------------------------
 Bitmap Heap Scan on orders (actual rows=20 loops=1)
   Recheck Cond: (customer_id = 42)
   Heap Blocks: exact=20
   ->  Bitmap Index Scan on orders_customer_id_idx (actual rows=20 loops=1)
         Index Cond: (customer_id = 42)
(5 rows)
```

The plan changed. A **Bitmap Index Scan** looks up customer 42 in the index (`Index Cond`) and notes where its rows are; the **Bitmap Heap Scan** above it then reads only those table pages — `Heap Blocks: exact=20` — instead of all of them, and no row is read and thrown away. On a big table this is the difference between reading everything and reading almost nothing.

### 4. An index the planner does not use

```sql run
CREATE INDEX orders_status_idx ON orders (status);
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) SELECT count(*) FROM orders WHERE status = 'shipped';
```

```text output
CREATE INDEX
                      QUERY PLAN
------------------------------------------------------
 Aggregate (actual rows=1 loops=1)
   ->  Seq Scan on orders (actual rows=90000 loops=1)
         Filter: (status = 'shipped'::text)
         Rows Removed by Filter: 10000
(4 rows)
```

Nine orders in ten are shipped. Fetching 90,000 rows through an index would cost more than reading the table in order, so the planner chooses a sequential scan — the index on `status` is not used for this query.

### 5. Indexes are not free

```sql run
SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relname IN ('orders', 'orders_customer_id_idx', 'orders_status_idx')
ORDER BY relname;
DROP INDEX orders_status_idx;
```

```text output
        relname         |  size
------------------------+---------
 orders                 | 5096 kB
 orders_customer_id_idx | 776 kB
 orders_status_idx      | 696 kB
(3 rows)

DROP INDEX
```

- Each index is a separate structure on disk, and PostgreSQL must update it on every insert, update and delete.
- The `status` index did not help any query here, so it goes. Keep indexes that real queries use — check with `EXPLAIN ANALYZE`, not by guessing.

## Try it in the simulation

Create and drop indexes — one column or two — and run EXPLAIN: the planner shows every plan it compared and the rows each would touch. It is a labelled teaching model with invented cost units, not PostgreSQL's real planner.

```simulation postgresql-query-planner scenario=pending-day
```

## Common mistakes

- **Adding indexes without checking the plan.** Run `EXPLAIN ANALYZE` before and after; an index the planner never uses is pure cost.
- **Testing on a tiny table.** With a few rows, a sequential scan is cheapest and the planner will ignore your index; test with realistic data volumes.
- **Forgetting `ANALYZE` after loading lots of data.** Out-of-date statistics lead to bad estimates and bad plans (autovacuum normally runs it for you, but not instantly).
- **Indexing low-selectivity columns** such as a status with two values, expecting them to speed up queries that match half the table.
- **Running `EXPLAIN ANALYZE` on a data-changing query in production.** It really executes the statement; wrap it in a transaction you roll back.

## Where this fits in a real system

Slow queries usually show up first in **Prometheus** and **Grafana** dashboards or in **OpenTelemetry** traces as long database spans. `EXPLAIN ANALYZE` finds the cause; an index or a **Redis** cache in front of the query is the usual fix, and the index is added with a migration that runs in CI, such as **GitHub Actions**.
