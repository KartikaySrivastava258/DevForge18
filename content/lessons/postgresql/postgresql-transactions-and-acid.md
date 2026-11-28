---
id: postgresql-transactions-and-acid
title: Transactions and ACID
track: postgresql
order: 4
level: intermediate
estimated_minutes: 30
prerequisites: [postgresql-relationships-and-joins]
learning_objectives:
  - Group statements into a transaction with BEGIN and COMMIT, and undo one with ROLLBACK.
  - Undo part of a transaction with SAVEPOINT and ROLLBACK TO SAVEPOINT.
  - Explain atomicity, consistency, isolation and durability with an example of each.
resources:
  - title: PostgreSQL tutorial — Transactions
    url: https://www.postgresql.org/docs/16/tutorial-transactions.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: beginner
    official: true
    why: BEGIN, COMMIT, ROLLBACK and savepoints with a bank example.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — Asynchronous Commit
    url: https://www.postgresql.org/docs/16/wal-async-commit.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: Why a commit normally waits for the write-ahead log to reach permanent storage — durability.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: autocommit
    prompt: Without BEGIN, you run an INSERT and then an UPDATE in psql. The UPDATE fails. What happened to the INSERT?
    options:
      - { id: a, text: "It was rolled back too" }
      - { id: b, text: "It stays: without BEGIN, each statement is its own transaction and was committed on its own" }
      - { id: c, text: "It is waiting for COMMIT" }
    answer: b
    explanation: PostgreSQL treats every statement outside BEGIN … COMMIT as a separate transaction. To make several statements all-or-nothing, put them in one transaction.
  - id: savepoint
    prompt: Inside a transaction you set SAVEPOINT before_second, run two more statements, then ROLLBACK TO SAVEPOINT before_second and COMMIT. What is saved?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "Everything before the savepoint; the two statements after it are undone" }
      - { id: c, text: "Only the two statements after the savepoint" }
    answer: b
    explanation: A savepoint marks a point inside a transaction. Rolling back to it undoes only the work after it; the transaction continues and COMMIT saves the rest.
  - id: durability
    prompt: COMMIT has returned. A second later the server loses power. With PostgreSQL's default settings, is the transaction kept?
    options:
      - { id: a, text: "Yes: by default, COMMIT waits until the transaction's write-ahead log records are flushed to permanent storage" }
      - { id: b, text: "Only if a checkpoint happened" }
      - { id: c, text: "No: data is only safe after a backup" }
    answer: a
    explanation: That is durability. PostgreSQL's documentation explains that with synchronous commit (the default) a committed transaction survives a crash immediately afterwards; asynchronous commit trades that guarantee for speed.
verification:
  method: executed
  details: Every SQL block is run by the test suite against PostgreSQL 16, after the previous lessons, and its output is compared with this lesson. Durability was checked against the PostgreSQL 16 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **transaction** groups statements so that they succeed or fail **together**, and PostgreSQL promises four things about it — **atomicity, consistency, isolation and durability** (ACID).

## Explain it like I'm twelve

Swapping football cards with a friend: you give yours *and* get theirs, or the swap does not happen. Nobody should end up with both cards or neither.

The swap is a **transaction**; "both or neither" is **atomicity**.

Where the analogy breaks: a database can run thousands of swaps at the same time, and **isolation** decides how much they can see of each other.

## What problem it solves

Real actions take several statements: enrolling a student means adding an enrolment *and* taking a seat. If the program crashes or a rule fails in between, a half-done action leaves the data wrong — a seat taken without an enrolment. Transactions make such multi-step changes safe.

## How it works

![](media:postgresql/acid.svg)

- `BEGIN` starts a transaction; `COMMIT` makes all its changes permanent at once; `ROLLBACK` throws them all away. Without `BEGIN`, every statement is its own transaction (*autocommit*).
- `SAVEPOINT name` marks a point inside a transaction; `ROLLBACK TO SAVEPOINT name` undoes only what came after it.
- If a statement fails inside a transaction, the whole transaction is aborted: PostgreSQL ignores further commands until `ROLLBACK`.
- By default, `COMMIT` returns only after the transaction's records in the **write-ahead log** (WAL) are on permanent storage, so a committed transaction survives a crash.

## Try it yourself

> **Local lab** — continue in your database from the previous lessons (`students`, `courses`, `enrolments`). Every SQL block is run automatically in DevForge's tests.

### 1. Courses get a limited number of seats

```sql run
ALTER TABLE courses ADD COLUMN seats integer NOT NULL DEFAULT 2 CHECK (seats >= 0);
SELECT code, seats FROM courses ORDER BY code;
```

```text output
ALTER TABLE
 code  | seats
-------+-------
 CS101 |     2
 DB201 |     2
 NW301 |     2
(3 rows)
```

The `CHECK` is a **consistency** rule: no course may have fewer than zero seats.

### 2. Enrol as one transaction

Enrolling is two changes that belong together:

```sql run
BEGIN;
INSERT INTO enrolments (student_id, course_code) VALUES (2, 'NW301');
UPDATE courses SET seats = seats - 1 WHERE code = 'NW301';
COMMIT;
SELECT code, seats FROM courses WHERE code = 'NW301';
```

```text output
BEGIN
INSERT 0 1
UPDATE 1
COMMIT
 code  | seats
-------+-------
 NW301 |     1
(1 row)
```

Between `BEGIN` and `COMMIT`, other sessions could not see the new enrolment; at `COMMIT`, both changes became visible together.

### 3. Change your mind: ROLLBACK

```sql run
BEGIN;
DELETE FROM enrolments;
SELECT count(*) AS enrolments_inside_the_transaction FROM enrolments;
ROLLBACK;
SELECT count(*) AS enrolments_after_rollback FROM enrolments;
```

```text output
BEGIN
DELETE 5
 enrolments_inside_the_transaction
-----------------------------------
                                 0
(1 row)

ROLLBACK
 enrolments_after_rollback
---------------------------
                         5
(1 row)
```

Inside the transaction, every enrolment was gone. `ROLLBACK` undid the delete as if it had never happened.

### 4. Undo part of a transaction with a savepoint

Meera and Nikhil both ask for the last seat in NW301. You enrol Meera, set a savepoint, enrol Nikhil — then learn Nikhil's request was a mistake:

```sql run
BEGIN;
INSERT INTO enrolments (student_id, course_code) VALUES (3, 'NW301');
SAVEPOINT before_nikhil;
INSERT INTO enrolments (student_id, course_code) VALUES (7, 'NW301');
ROLLBACK TO SAVEPOINT before_nikhil;
UPDATE courses SET seats = seats - 1 WHERE code = 'NW301';
COMMIT;
SELECT s.name, c.seats AS seats_left
FROM enrolments e JOIN students s ON s.id = e.student_id JOIN courses c ON c.code = e.course_code
WHERE e.course_code = 'NW301' ORDER BY s.name;
```

```text output
BEGIN
INSERT 0 1
SAVEPOINT
INSERT 0 1
ROLLBACK
UPDATE 1
COMMIT
    name    | seats_left
------------+------------
 Meera Iyer |          0
 Ravi Kumar |          0
(2 rows)
```

Only the work after the savepoint was undone; Meera's enrolment and the seat update were committed.

### 5. Atomicity when a rule is broken

NW301 has no seats left. Try to enrol Nikhil properly, as one transaction:

```sql run fails
BEGIN;
INSERT INTO enrolments (student_id, course_code) VALUES (7, 'NW301');
UPDATE courses SET seats = seats - 1 WHERE code = 'NW301';
COMMIT;
```

```text output
BEGIN
INSERT 0 1
ERROR:  new row for relation "courses" violates check constraint "courses_seats_check"
DETAIL:  Failing row contains (NW301, Computer Networks, -1).
```

```sql run
SELECT count(*) AS nikhil_in_nw301 FROM enrolments WHERE student_id = 7 AND course_code = 'NW301';
```

```text output
 nikhil_in_nw301
-----------------
               0
(1 row)
```

The `INSERT` succeeded, the `UPDATE` broke the seats rule, and the transaction never committed — so the enrolment is gone too. Without the transaction, Nikhil would be enrolled in a full course.

### 6. Durability is a setting you can see

```sql run
SHOW synchronous_commit;
```

```text output
 synchronous_commit
--------------------
 on
(1 row)
```

`on`, the default: `COMMIT` waits for the WAL to reach disk. Setting it `off` makes commits faster but, as the documentation warns, the most recent transactions can be lost in a crash.

## Common mistakes

- **Forgetting BEGIN.** Each statement then commits on its own, and a failure halfway leaves half the work done.
- **Long-running transactions.** They hold locks and keep old row versions alive; keep transactions short and do slow work (network calls, user input) outside them.
- **Ignoring the aborted state.** After an error inside a transaction, every further statement fails until `ROLLBACK`; application code must roll back and usually retry.
- **Checking first, writing later, outside one transaction.** "Is a seat free?" then "take it" in two separate transactions lets two people take the last seat. Do both in one transaction, and see the lesson on isolation levels for how isolation affects it.

## Where this fits in a real system

A web API built on PostgreSQL wraps each request's writes in a transaction; **Redis** caches are updated only after the transaction commits; and the **Kafka** outbox pattern writes the event to a table in the same transaction as the data, so both happen or neither does.
