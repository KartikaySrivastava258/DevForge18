---
id: postgresql-isolation-and-anomalies
title: Isolation levels and concurrency anomalies
track: postgresql
order: 5
level: advanced
estimated_minutes: 40
prerequisites: [postgresql-transactions-and-acid]
learning_objectives:
  - Reproduce a lost update caused by read-modify-write code, and prevent it with an atomic update or SELECT … FOR UPDATE.
  - Reproduce write skew under REPEATABLE READ, where each transaction is correct alone but together they break a rule.
  - Use SERIALIZABLE to prevent it, and handle the serialization failure by retrying.
resources:
  - title: PostgreSQL documentation — Transaction Isolation
    url: https://www.postgresql.org/docs/16/transaction-iso.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: The anomalies table, what each level guarantees in PostgreSQL, and the advice to retry serialization failures.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — Explicit Locking (row-level locks)
    url: https://www.postgresql.org/docs/16/explicit-locking.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: SELECT … FOR UPDATE and how row locks make other writers wait.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: lost-update
    prompt: Two requests each read seats = 2, compute 2 − 1 in the application, and write seats = 1. What went wrong?
    options:
      - { id: a, text: "Nothing: two enrolments, two updates" }
      - { id: b, text: "A lost update: both based their write on the same old value, so one decrement disappeared — seats should be 0" }
      - { id: c, text: "A dirty read" }
    answer: b
    explanation: Read-modify-write in application code is unsafe at READ COMMITTED. Let the database do the arithmetic (SET seats = seats - 1), or lock the row with SELECT … FOR UPDATE before reading it.
  - id: write-skew
    prompt: Under REPEATABLE READ, Alice and Bob each check that two doctors are on call, then each takes themselves off. Both commit, and nobody is on call. Why did REPEATABLE READ allow it?
    options:
      - { id: a, text: "It does not prevent anything" }
      - { id: b, text: "They updated different rows, so there was no write conflict; each read a snapshot in which the rule held. This serialization anomaly (write skew) is only prevented by SERIALIZABLE" }
      - { id: c, text: "Because of a dirty read" }
    answer: b
    explanation: The isolation table in PostgreSQL's documentation shows serialization anomalies are possible at REPEATABLE READ. SERIALIZABLE detects the dangerous pattern and cancels one transaction.
  - id: retry
    prompt: Your code uses SERIALIZABLE and gets "could not serialize access …". What should it do?
    options:
      - { id: a, text: "Report a bug and stop" }
      - { id: b, text: "Roll back and retry the whole transaction; on the retry it sees the other transaction's committed change and decides again" }
      - { id: c, text: "Retry only the last statement" }
    answer: b
    explanation: A serialization failure means "this order of events could not be made safe". Running the whole transaction again, from its first read, is the documented remedy.
verification:
  method: executed
  details: Every command is run by the test suite against PostgreSQL 16 with the psql client, after the previous lessons, and its output is compared with this lesson. The two-session steps are scripted with pauses so the same transaction finishes first on every run. The isolation table was checked against the PostgreSQL 16 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

When transactions run at the same time, each **isolation level** allows certain surprises — a **lost update** at the default level, **write skew** even at REPEATABLE READ — and the fixes are atomic statements, row locks, or **SERIALIZABLE** with a **retry**.

## Explain it like I'm twelve

Two friends share a bag of 2 sweets. Each looks in, sees 2, takes one, and writes "1 left" on the bag. Now the bag says 1, but it is empty. That is a **lost update**.

Two lifeguards must keep at least one on duty. Each sees the other on the chair and goes for lunch. Nobody is watching the pool. That is **write skew**: each choice was fine alone.

Where the analogy breaks: the database can detect the second case and stop one lifeguard — if you ask it to with SERIALIZABLE.

## What problem it solves

Bugs like these appear only under load, when two requests overlap by milliseconds: double-booked seats, negative balances, rules broken although every check passed. Knowing which anomalies your isolation level allows tells you where code needs an atomic statement, a lock, or a retry.

## How it works

![](media:postgresql/isolation-levels.svg)

- **READ COMMITTED** (PostgreSQL's default): each statement sees what was committed before it started. Two transactions can read the same value and overwrite each other's change.
- **SELECT … FOR UPDATE** locks the selected rows: another transaction that wants to update or lock them waits until the first finishes, then reads the new value.
- **REPEATABLE READ**: the whole transaction reads one snapshot; a write to a row someone else changed meanwhile fails. Rules that span *several* rows can still be broken.
- **SERIALIZABLE**: PostgreSQL makes sure the result is the same as some one-at-a-time order, cancelling a transaction when it cannot. The application must retry it.

## Try it yourself

> **Local lab** — two `psql` sessions at once, scripted with short pauses. Point `psql`, `createdb` and `dropdb` at your server as in the lab *Demonstrate transaction rollback and isolation* (`export PGHOST=… PGUSER=… PGPASSWORD=…`). This lesson uses its own database, `concurrency_lab`. Every command is run automatically in DevForge's tests.

### 1. A database for the experiments

```bash run
dropdb --if-exists concurrency_lab 2> /dev/null; createdb concurrency_lab
psql -X -q -d concurrency_lab <<'SQL'
CREATE TABLE courses (code text PRIMARY KEY, seats integer NOT NULL);
CREATE TABLE doctors (name text PRIMARY KEY, on_call boolean NOT NULL);
SQL
q() { psql -X -q -A -t -v ON_ERROR_STOP=1 -d concurrency_lab "$@" 2>&1 | grep -v '^DETAIL\|^HINT' || true; }
echo "ready"
```

```text output
ready
```

`q` runs SQL in a new session and hides PostgreSQL's DETAIL and HINT lines, so the output below stays short.

### 2. A lost update

Each "request" reads the seats, waits a moment (as an application would while doing other work), and writes back what it computed:

```bash run
q -c "DELETE FROM courses; INSERT INTO courses VALUES ('DB201', 2)"
enrol_naively() {
  q <<SQL
BEGIN;
SELECT seats FROM courses WHERE code = 'DB201' \gset
SELECT pg_sleep(1) \g /dev/null
UPDATE courses SET seats = :seats - 1 WHERE code = 'DB201';
COMMIT;
SQL
}
enrol_naively & enrol_naively; wait
echo "after two enrolments: $(q -c "SELECT seats FROM courses WHERE code = 'DB201'") seats left"
```

```text output
after two enrolments: 1 seats left
```

Two seats were taken, but the count only went down by one. Both sessions read `2` before either wrote, and each wrote `2 − 1`. (`\gset` stores a query's result in the psql variable `:seats`, standing in for application code.)

### 3. Two ways to prevent it

```bash run
q -c "UPDATE courses SET seats = 2"
enrol_atomically() { q -c "UPDATE courses SET seats = seats - 1 WHERE code = 'DB201'"; }
enrol_atomically & enrol_atomically; wait
echo "atomic update:     $(q -c "SELECT seats FROM courses") seats left"
q -c "UPDATE courses SET seats = 2"
enrol_with_lock() {
  q <<SQL
BEGIN;
SELECT seats FROM courses WHERE code = 'DB201' FOR UPDATE \gset
SELECT pg_sleep(1) \g /dev/null
UPDATE courses SET seats = :seats - 1 WHERE code = 'DB201';
COMMIT;
SQL
}
enrol_with_lock & enrol_with_lock; wait
echo "SELECT FOR UPDATE: $(q -c "SELECT seats FROM courses") seats left"
```

```text output
atomic update:     0 seats left
SELECT FOR UPDATE: 0 seats left
```

- `SET seats = seats - 1` lets the database read and write the row in one step; the second update works on the first one's result.
- `FOR UPDATE` locks the row when it is read. The second session waits at its `SELECT` until the first commits, then reads `1` — at the cost of waiting.

### 4. Write skew under REPEATABLE READ

The rule: at least one doctor must stay on call. Each doctor checks the rule, then goes off call — as one conditional update:

```bash run
q -c "DELETE FROM doctors; INSERT INTO doctors VALUES ('alice', true), ('bob', true)"
go_off_call() {  # usage: go_off_call <name> <isolation level>
  q <<SQL
BEGIN ISOLATION LEVEL $2;
SELECT '$1 sees ' || count(*) || ' on call' FROM doctors WHERE on_call;
SELECT pg_sleep(1) \g /dev/null
UPDATE doctors SET on_call = false
WHERE name = '$1' AND (SELECT count(*) FROM doctors WHERE on_call) >= 2;
COMMIT;
SQL
}
go_off_call alice "REPEATABLE READ" > alice.log & sleep 0.3; go_off_call bob "REPEATABLE READ" > bob.log; wait
cat alice.log bob.log
echo "on call now: $(q -c "SELECT count(*) FROM doctors WHERE on_call")"
```

```text output
alice sees 2 on call
bob sees 2 on call
on call now: 0
```

Each transaction's snapshot showed two doctors, so each condition was true, and they updated *different* rows — no conflict for REPEATABLE READ to catch. The rule is broken although every check passed.

### 5. SERIALIZABLE catches it — then retry

```bash run
q -c "UPDATE doctors SET on_call = true"
go_off_call alice SERIALIZABLE > alice.log & sleep 0.3; go_off_call bob SERIALIZABLE > bob.log; wait
cat alice.log bob.log
echo "on call now: $(q -c "SELECT count(*) FROM doctors WHERE on_call")"
echo "--- bob retries"
go_off_call bob SERIALIZABLE
echo "on call now: $(q -c "SELECT count(*) FROM doctors WHERE on_call")"
```

```text output
alice sees 2 on call
bob sees 2 on call
ERROR:  could not serialize access due to read/write dependencies among transactions
on call now: 1
--- bob retries
bob sees 1 on call
on call now: 1
```

- Under SERIALIZABLE, PostgreSQL noticed that the two transactions could not both commit without breaking any one-at-a-time order, and cancelled Bob's (the one that tried to commit second).
- Bob's retry starts from scratch, sees only one doctor on call, and its condition is false: he stays on call. The rule holds. Real code wraps such transactions in a retry loop.

### 6. Clean up

```bash run
dropdb concurrency_lab && echo "dropped"
```

```text output
dropped
```

## Common mistakes

- **Read-modify-write in application code.** Compute in SQL (`seats = seats - 1`) or lock first (`FOR UPDATE`).
- **Assuming REPEATABLE READ is enough for every rule.** It stops lost updates on the *same* row, not rules across several rows.
- **Using SERIALIZABLE without a retry loop.** Serialization failures are expected under load; without retries, users see errors.
- **Locking more than needed.** `FOR UPDATE` on many rows, or long transactions holding locks, turns concurrency into queues — and can deadlock.

## Where this fits in a real system

Booking systems, payments and stock levels all meet these anomalies. Teams often combine atomic updates for counters, unique constraints for "only one" rules, and SERIALIZABLE with retries for complex rules — and put **Redis** or **Kafka** in front only after the database rule is safe.
