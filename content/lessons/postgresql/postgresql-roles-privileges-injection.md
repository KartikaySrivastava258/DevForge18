---
id: postgresql-roles-privileges-injection
title: Roles, privileges and SQL injection prevention
track: postgresql
order: 6
level: intermediate
estimated_minutes: 35
prerequisites: [postgresql-transactions-and-acid]
learning_objectives:
  - Create roles and grant them only the privileges they need, down to single columns.
  - Check what a role can do by switching to it with SET ROLE.
  - Show a real SQL injection through string concatenation, and prevent it with a parameter.
resources:
  - title: PostgreSQL documentation — Privileges
    url: https://www.postgresql.org/docs/16/ddl-priv.html
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: intermediate
    official: true
    why: GRANT and REVOKE on tables and columns, and how privileges are checked.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: PostgreSQL documentation — Executing Dynamic Commands (PL/pgSQL)
    url: https://www.postgresql.org/docs/16/plpgsql-statements.html#PLPGSQL-STATEMENTS-EXECUTING-DYN
    publisher: PostgreSQL Global Development Group
    type: documentation
    level: advanced
    official: true
    why: EXECUTE … USING for parameters, and the warning about inserting values into query strings.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: OWASP — SQL Injection Prevention Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
    publisher: OWASP
    type: documentation
    level: intermediate
    official: true
    why: Prepared statements with parameters as the primary defence, plus least privilege.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: least-privilege
    prompt: A reporting tool only reads course data. What should its database role be allowed to do?
    options:
      - { id: a, text: "Everything — it is an internal tool" }
      - { id: b, text: "SELECT on the tables (or columns) it reports on, and nothing else" }
      - { id: c, text: "SELECT, INSERT, UPDATE and DELETE on all tables" }
    answer: b
    explanation: Least privilege limits the damage from a bug or a stolen password. A role that can only read two tables cannot delete students.
  - id: injection
    prompt: Why does WHERE name = '<input>' built by concatenation return every row when the input is x' OR '1'='1?
    options:
      - { id: a, text: "PostgreSQL ignores quotes" }
      - { id: b, text: "The input's quote closes the string, and the rest becomes SQL: WHERE name = 'x' OR '1'='1' is true for every row" }
      - { id: c, text: "Because the table has no index" }
    answer: b
    explanation: Concatenation lets data change the query's structure. A parameter is sent separately and is always treated as a value.
  - id: escaping
    prompt: What is the main defence against SQL injection?
    options:
      - { id: a, text: "Removing quotes from user input" }
      - { id: b, text: "Parameters (prepared statements or EXECUTE … USING), so input is never part of the SQL text" }
      - { id: c, text: "Hiding error messages from users" }
    answer: b
    explanation: OWASP lists prepared statements with parameterised queries as the first defence. Filtering characters misses cases; hiding errors only makes attacks slower.
verification:
  method: executed
  details: Every SQL block is run by the test suite against PostgreSQL 16, after the previous lessons, and its output is compared with this lesson. The roles are created and dropped by the lesson, so it can run again.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Give every program its own database **role** with only the **privileges** it needs, and never paste user input into SQL text — pass it as a **parameter** — so a bug or an attacker cannot read or change more than intended.

## Explain it like I'm twelve

A school gives the canteen staff a key to the kitchen, not to the head teacher's office. And when a pupil hands in a note saying "Lunch for: Ravi; also open the safe", the canteen reads the *name* on it — it does not follow instructions written inside the name.

The keys are **privileges**; treating the note as a name, not an order, is a **parameter**.

Where the analogy breaks: databases can restrict access down to single columns, like giving a key that opens only one drawer.

## What problem it solves

Applications often connect as an all-powerful database user, and build queries by gluing strings together. Then one SQL injection, or one leaked password, gives an attacker the whole database. Roles limit what any one connection can do; parameters stop input from becoming code.

## How it works

![](media:postgresql/sql-injection.svg)

- A **role** is a database user or group. `GRANT SELECT ON courses TO reporting` gives a privilege; `REVOKE` takes it away. Privileges can be on whole tables or on chosen columns.
- `SET ROLE name` makes your session act as that role (a superuser can switch to any role) — a quick way to test what it can do. `RESET ROLE` switches back.
- **SQL injection** happens when input is inserted into the text of a query. A **parameter** (`$1`) is sent separately from the SQL, so it can only ever be a value.

## Try it yourself

> **Local lab** — continue in your database from the previous lessons, connected as the `postgres` superuser (as in the first lesson). Every SQL block is run automatically in DevForge's tests.

### 1. A role for reports, with only what it needs

```sql run
SET client_min_messages TO warning;
DROP ROLE IF EXISTS devforge_reports;
CREATE ROLE devforge_reports NOLOGIN;
GRANT SELECT ON courses TO devforge_reports;
GRANT SELECT (id, name) ON students TO devforge_reports;
```

```text output
SET
DROP ROLE
CREATE ROLE
GRANT
GRANT
```

`DROP ROLE IF EXISTS` lets you run this step again; `client_min_messages` hides its notice when the role did not exist yet. The role may read the whole `courses` table, but only the `id` and `name` columns of `students` — not their email addresses. `NOLOGIN` means nobody can connect *as* it directly; a real application role would get a password and `LOGIN`.

### 2. Test it with SET ROLE

```sql run
SET ROLE devforge_reports;
SELECT code, seats FROM courses ORDER BY code;
SELECT name FROM students ORDER BY id LIMIT 2;
RESET ROLE;
```

```text output
SET
 code  | seats
-------+-------
 CS101 |     2
 DB201 |     2
 NW301 |     0
(3 rows)

    name
------------
 Asha Rao
 Ravi Kumar
(2 rows)

RESET
```

```sql run fails
SET ROLE devforge_reports;
SELECT email FROM students;
```

```text output
SET
ERROR:  permission denied for table students
```

```sql run fails
SET ROLE devforge_reports;
DELETE FROM courses;
```

```text output
SET
ERROR:  permission denied for table courses
```

Reading the allowed columns works; the email column and any change are refused. A bug — or an attacker — using this role cannot leak emails or delete courses.

### 3. A real SQL injection

Here is a search function that builds its query by **concatenating** the name into the SQL text:

```sql run
CREATE FUNCTION find_student_unsafe(search text) RETURNS SETOF students
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM students WHERE name = ''' || search || '''';
END $$;
SELECT count(*) AS normal_search FROM find_student_unsafe('Asha Rao');
SELECT count(*) AS injected_search FROM find_student_unsafe($q$x' OR '1'='1$q$);
```

```text output
CREATE FUNCTION
 normal_search
---------------
             1
(1 row)

 injected_search
-----------------
               4
(1 row)
```

A normal name finds one student. The input `x' OR '1'='1` closes the quoted string and adds a condition that is always true, so the query returned **every** student. (`$q$…$q$` is just a way to write that text in SQL without escaping its quotes.) In a web application, the same mistake lets a search box read — or with other inputs, change — data it should never touch.

### 4. The fix: a parameter

```sql run
CREATE FUNCTION find_student(search text) RETURNS SETOF students
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM students WHERE name = $1' USING search;
END $$;
SELECT count(*) AS normal_search FROM find_student('Asha Rao');
SELECT count(*) AS injected_search FROM find_student($q$x' OR '1'='1$q$);
```

```text output
CREATE FUNCTION
 normal_search
---------------
             1
(1 row)

 injected_search
-----------------
               0
(1 row)
```

With `$1` and `USING search`, the SQL text never contains the input. The whole input is compared as one value — and no student is called `x' OR '1'='1`. Application code does the same with its driver's placeholders (for example `$1` in node-postgres, `%s` in psycopg) instead of building strings.

### 5. Clean up

```sql run
DROP FUNCTION find_student_unsafe(text);
DROP FUNCTION find_student(text);
DROP OWNED BY devforge_reports;
DROP ROLE devforge_reports;
```

```text output
DROP FUNCTION
DROP FUNCTION
DROP OWNED
DROP ROLE
```

A role that still has privileges cannot be dropped; `DROP OWNED BY` removes its privileges in this database first.

## Common mistakes

- **Applications connecting as the superuser.** Every bug then runs with full power. Create a role per application with only the privileges it needs.
- **"Escaping" input by hand.** Removing quotes misses cases and breaks names like O'Brien. Use parameters.
- **Building table or column names from input.** Parameters only work for values; for identifiers, choose from a fixed list in code (or use `format('%I', …)` in PL/pgSQL).
- **Granting to PUBLIC.** Privileges granted to `PUBLIC` apply to every role, including ones created later.

## Where this fits in a real system

Each service gets its own role — the API can insert enrolments, a reporting job can only read — and passwords live in a secret store, injected like the **Jenkins** credentials in that track's lab. **Postman** test collections should include injection-shaped inputs, and scanners in **GitHub Actions** can flag string-built SQL.
