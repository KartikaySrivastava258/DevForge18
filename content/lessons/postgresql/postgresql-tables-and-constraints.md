---
id: postgresql-tables-and-constraints
title: Tables, rows and constraints
track: postgresql
order: 1
level: beginner
estimated_minutes: 35
prerequisites: []
learning_objectives:
  - Explain what a relational database is and why applications use one instead of files.
  - Create a table with suitable column types, a primary key and constraints.
  - Insert and query rows with INSERT and SELECT, filtering and sorting results.
  - Read a constraint-violation error and explain how constraints protect data.
resources:
  - title: PostgreSQL tutorial
    url: https://www.postgresql.org/docs/current/tutorial.html
    publisher: The PostgreSQL Global Development Group
    type: tutorial
    level: beginner
    official: true
    why: The official tutorial covers creating tables, populating them and querying, with the same concepts as this lesson.
    verification: { status: unverified }
  - title: PostgreSQL documentation — Constraints
    url: https://www.postgresql.org/docs/
    publisher: The PostgreSQL Global Development Group
    type: reference
    level: all
    official: true
    why: The manual's Data Definition chapter documents every constraint type and its exact behaviour.
    verification: { status: unverified }
self_check:
  - id: why-constraints
    prompt: Your application already checks that emails are unique before saving. Why still declare email UNIQUE in the database?
    options:
      - { id: a, text: "It makes SELECT queries faster, which is its main purpose" }
      - { id: b, text: "The database is the last line of defence: it enforces the rule for every program, script and concurrent request, including two sign-ups that pass the app's check at the same moment" }
      - { id: c, text: "PostgreSQL requires every text column to be unique" }
    answer: b
    explanation: Application checks can be bypassed or raced — two requests can both see "no such email" and both insert. A UNIQUE constraint is enforced atomically by the database for every writer. (It also creates an index, which speeds up lookups, but that is a side benefit.)
  - id: identity-gaps
    prompt: After three failed INSERTs, the next successful row gets id 7 instead of 4. What does this tell you?
    options:
      - { id: a, text: "The table is corrupted and should be restored from backup" }
      - { id: b, text: "Identity values are reserved before constraints are checked and are never handed back, so gaps are normal; ids identify rows, they do not count them" }
      - { id: c, text: "PostgreSQL skips ids that were deleted earlier" }
    answer: b
    explanation: Each INSERT takes the next identity value before the row is checked. If the INSERT then fails, that value is not reused. Never rely on ids having no gaps — use COUNT(*) to count rows.
  - id: read-error
    prompt: "An INSERT fails with: ERROR: new row for relation \"students\" violates check constraint \"students_study_year_check\". What should you fix?"
    options:
      - { id: a, text: "The value for study_year, which falls outside the range the CHECK constraint allows" }
      - { id: b, text: "The table name, which is misspelled" }
      - { id: c, text: "The email, which is already taken" }
    answer: a
    explanation: PostgreSQL names the violated constraint, and default names follow table_column_check. The DETAIL line shows the failing row, so you can see which value was rejected.
verification:
  method: pending
  details: Every SQL block is run automatically in CI against a fresh PostgreSQL 16 database. The expected output shown was written from the PostgreSQL 16 documentation and has not yet been confirmed by a test run, so small formatting differences are possible until it is.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

**PostgreSQL** stores data in **tables** of rows and typed columns, and enforces rules called **constraints** so that invalid data is rejected instead of silently saved.

## Explain it like I'm twelve

Picture the class register. Every row is one student; every column is one fact about them — name, email, year. The register has rules: every student must have a name, no two students share an email, and the year must be between 1 and 4. If someone tries to write a row that breaks a rule, the register refuses it.

Where the analogy breaks: a paper register cannot stop a careless writer, but PostgreSQL checks every rule on every change, for every program that touches the data, even when hundreds of changes arrive at once.

## What problem it solves

Applications that save data in their own files soon hit hard problems: two users saving at the same moment overwrite each other, half-written files appear after a crash, and nothing stops a bug from saving a student with no name. A relational database solves these centrally. It lets many users read and write safely at once, guarantees that a change is either completely saved or not at all, and enforces data rules regardless of which program writes the data. SQL then lets you ask new questions of the data without writing new code to read files.

## How it works

```text
 table: students
 ┌────┬────────────┬───────────────────┬────────────┐
 │ id │ name       │ email             │ study_year │   ← columns: name + type
 ├────┼────────────┼───────────────────┼────────────┤
 │  1 │ Asha Rao   │ asha@example.edu  │          2 │   ← one row per student
 │  2 │ Ravi Kumar │ ravi@example.edu  │          3 │
 └────┴────────────┴───────────────────┴────────────┘
   ▲                       ▲                  ▲
 PRIMARY KEY            UNIQUE         CHECK (1 to 4)
 (identifies a row)  (no duplicates)  (allowed values)
```

- A **column type** (`integer`, `text`, `date`, `numeric`…) restricts what a column can hold.
- A **primary key** uniquely identifies each row. Here PostgreSQL generates it automatically with `GENERATED ALWAYS AS IDENTITY`.
- **NOT NULL** requires a value; **UNIQUE** forbids duplicates; **CHECK** enforces a condition.
- You talk to the server in **SQL** through a client. `psql` is the command-line client that ships with PostgreSQL.

## Try it yourself

> **Local lab** — you need a PostgreSQL server and the `psql` client. Every SQL block below is run automatically in DevForge's CI against PostgreSQL 16; see the note at the top of the lesson for the current verification status.

### 1. Start PostgreSQL and connect

Choose **one** option.

**With Docker** (if you completed the Docker track). This starts PostgreSQL 16 reachable only from your own computer, and keeps its data in a named volume so it survives removing the container (see the Docker lesson on volumes):

```bash
docker run --name devforge-pg -e POSTGRES_PASSWORD=choose-a-password -p 127.0.0.1:5432:5432 -v devforge-pgdata:/var/lib/postgresql/data -d postgres:16
docker exec -it devforge-pg psql -U postgres
```

**Installed natively:** on Windows use the installer linked from the official download page (postgresql.org/download); on macOS use Postgres.app or `brew install postgresql@16`; on Ubuntu or Debian run `sudo apt install postgresql`, then `sudo -u postgres psql`.

You are connected when you see a prompt such as `postgres=#`. Create a database for these lessons and switch to it:

```sql
CREATE DATABASE college;
\c college
```

`\c` is a psql command, not SQL: it connects to another database. Type `\q` to quit psql at any time.

### 2. Create a table

```sql run
CREATE TABLE students (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text    NOT NULL,
    email      text    NOT NULL UNIQUE,
    study_year integer NOT NULL CHECK (study_year BETWEEN 1 AND 4)
);
```

```text output
CREATE TABLE
```

psql answers with a *command tag* naming what succeeded. Each line declares a column, its type and its constraints.

### 3. Insert rows

You do not supply `id`; PostgreSQL generates it.

```sql run
INSERT INTO students (name, email, study_year) VALUES
    ('Asha Rao',   'asha@example.edu',  2),
    ('Ravi Kumar', 'ravi@example.edu',  3),
    ('Meera Iyer', 'meera@example.edu', 1);
```

```text output
INSERT 0 3
```

In `INSERT 0 3`, the `3` is the number of rows inserted. (The `0` is a historical field and is always zero.)

### 4. Query the table

```sql run
SELECT * FROM students;
```

```text output
 id |    name    |       email       | study_year
----+------------+-------------------+------------
  1 | Asha Rao   | asha@example.edu  |          2
  2 | Ravi Kumar | ravi@example.edu  |          3
  3 | Meera Iyer | meera@example.edu |          1
(3 rows)
```

`*` means every column. Numbers are right-aligned and text left-aligned. Without `ORDER BY` the database may return rows in any order, so always sort when order matters:

```sql run
SELECT name, study_year
FROM students
WHERE study_year >= 2
ORDER BY name;
```

```text output
    name    | study_year
------------+------------
 Asha Rao   |          2
 Ravi Kumar |          3
(2 rows)
```

`WHERE` filters rows, and `ORDER BY` sorts them.

### 5. Watch the constraints work

Try to register a second student with Asha's email:

```sql run fails
INSERT INTO students (name, email, study_year)
VALUES ('Asha R.', 'asha@example.edu', 2);
```

```text output
ERROR:  duplicate key value violates unique constraint "students_email_key"
DETAIL:  Key (email)=(asha@example.edu) already exists.
```

PostgreSQL named the constraint it enforced (`students_email_key`, a default name built from the table and column) and showed the offending value. Now a student with no name:

```sql run fails
INSERT INTO students (name, email, study_year)
VALUES (NULL, 'nikhil@example.edu', 2);
```

```text output
ERROR:  null value in column "name" of relation "students" violates not-null constraint
DETAIL:  Failing row contains (5, null, nikhil@example.edu, 2).
```

And an impossible year:

```sql run fails
INSERT INTO students (name, email, study_year)
VALUES ('Nikhil Shah', 'nikhil@example.edu', 7);
```

```text output
ERROR:  new row for relation "students" violates check constraint "students_study_year_check"
DETAIL:  Failing row contains (6, Nikhil Shah, nikhil@example.edu, 7).
```

None of these rows were saved. Fix the value and insert again:

```sql run
INSERT INTO students (name, email, study_year)
VALUES ('Nikhil Shah', 'nikhil@example.edu', 2);
```

```text output
INSERT 0 1
```

### 6. Notice the gap

```sql run
SELECT id, name FROM students ORDER BY id;
```

```text output
 id |    name
----+-------------
  1 | Asha Rao
  2 | Ravi Kumar
  3 | Meera Iyer
  7 | Nikhil Shah
(4 rows)
```

Nikhil got id 7, not 4. Each failed INSERT had already taken the next identity value (you can see 5 and 6 in the error details), and those values are never reused. Gaps are normal: an id identifies a row; it does not count rows. Keep this `college` database for the next lesson.

## Common mistakes

- **Relying on application checks only.** Code can be bypassed, and two requests can race past the same check. Put essential rules in constraints.
- **Expecting ids without gaps.** Failed inserts, rollbacks and deletions all leave gaps. Use `SELECT count(*) FROM students` to count.
- **Forgetting `ORDER BY`.** Rows come back in whatever order is convenient for the database, which can change.
- **Storing everything as text.** Numbers, dates and booleans have proper types that enable correct sorting, arithmetic and validation.
- **Forgetting the semicolon** in psql. The prompt changes from `college=#` to `college-#` while it waits for the rest of the statement; type `;` and press Enter.

## Where this fits in a real system

PostgreSQL is usually the **system of record** behind a backend API: the service validates a request, then lets the database enforce the final rules inside a transaction. **Redis** often caches frequently read query results in front of it, and committed changes can be published to **Kafka** so other services react to them. The same constraints you wrote here protect the data no matter which of those services writes to it.
