---
id: postgresql-relationships-and-joins
title: Relationships, joins and grouping
track: postgresql
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [postgresql-tables-and-constraints]
learning_objectives:
  - Model a many-to-many relationship with a linking table and foreign keys.
  - Explain how a foreign key prevents orphaned and dangling references.
  - Combine tables with JOIN and find missing matches with LEFT JOIN.
  - Summarise rows with COUNT and GROUP BY.
resources:
  - title: PostgreSQL tutorial
    url: https://www.postgresql.org/docs/current/tutorial.html
    publisher: The PostgreSQL Global Development Group
    type: tutorial
    level: beginner
    official: true
    why: The official tutorial covers creating tables, populating them and querying, with the same concepts as this lesson.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: link-table
    prompt: A student can take many courses and a course has many students. How should this be stored?
    options:
      - { id: a, text: "A comma-separated list of course codes in a text column on students" }
      - { id: b, text: "A separate enrolments table with one row per student–course pair, each column a foreign key" }
      - { id: c, text: "One column per course on the students table" }
    answer: b
    explanation: A linking table models many-to-many relationships cleanly. Foreign keys keep every pair valid, a composite primary key stops duplicates, and joins answer questions in either direction. Lists inside a column cannot be constrained, indexed or joined properly.
  - id: left-join
    prompt: Why does the query for students with no enrolments use LEFT JOIN rather than JOIN?
    options:
      - { id: a, text: "LEFT JOIN is faster" }
      - { id: b, text: "JOIN keeps only rows with a match, so unenrolled students would disappear; LEFT JOIN keeps every student and fills missing enrolment columns with NULL, which WHERE … IS NULL can find" }
      - { id: c, text: "JOIN does not work with foreign keys" }
    answer: b
    explanation: An inner JOIN returns only matching pairs. LEFT JOIN keeps all rows from the left table; where there is no match, the right-hand columns are NULL, which is exactly what you filter on.
  - id: count-column
    prompt: In the course summary, why count(e.student_id) instead of count(*)?
    options:
      - { id: a, text: "count(*) is not valid SQL in PostgreSQL" }
      - { id: b, text: "With a LEFT JOIN a course without students still produces one row whose enrolment columns are NULL; count(*) would count that row as 1, while count(e.student_id) ignores NULLs and correctly gives 0" }
      - { id: c, text: "They always return the same number" }
    answer: b
    explanation: count(*) counts rows; count(column) counts non-NULL values. After a LEFT JOIN, the difference is what makes empty courses show 0.
  - id: fk-delete
    prompt: Deleting a student who still has enrolments fails with a foreign-key error. Why is that useful?
    options:
      - { id: a, text: "It prevents enrolment rows that point to a student who no longer exists" }
      - { id: b, text: "It is a bug; deletes should always succeed" }
      - { id: c, text: "It stops anyone from ever deleting students" }
    answer: a
    explanation: By default a foreign key refuses to delete a referenced row, so references can never dangle. You can remove the enrolments first, or choose a different rule such as ON DELETE CASCADE when that is truly the intended behaviour.
verification:
  method: executed
  details: Every SQL block is run by the test suite against a fresh PostgreSQL database, after the previous lesson, and its output is compared with this lesson. Confirmed in CI against PostgreSQL 16.16 with the psql 16 client on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Related data lives in separate tables connected by **foreign keys**, and **joins** combine those tables back together when you query.

## Explain it like I'm twelve

The college keeps one list of students and one list of courses. Instead of rewriting a student's full details on every course sheet, each sign-up slip just says "student 1 takes CS101". The office can always look up who student 1 is. The rule is: a slip may only mention students and courses that really exist.

Where the analogy breaks: a clerk might forget to check the lists, but a foreign key makes PostgreSQL check every slip automatically.

## What problem it solves

Copying a student's name and email onto every course record wastes space and, worse, creates contradictions: update the email in one place and the copies disagree. Storing each fact once (**normalisation**) and linking with keys keeps data consistent, while joins still answer questions such as "who takes Database Systems?" and "which students have no courses?".

## How it works

```text
 students              enrolments                    courses
 ┌────┬────────────┐   ┌────────────┬─────────────┐   ┌───────┬────────────────────┐
 │ id │ name       │◀──│ student_id │ course_code │──▶│ code  │ title              │
 ├────┼────────────┤   ├────────────┼─────────────┤   ├───────┼────────────────────┤
 │  1 │ Asha Rao   │   │          1 │ CS101       │   │ CS101 │ Programming Basics │
 │  2 │ Ravi Kumar │   │          1 │ DB201       │   │ DB201 │ Database Systems   │
 └────┴────────────┘   └────────────┴─────────────┘   └───────┴────────────────────┘
                        PRIMARY KEY (student_id, course_code): no duplicate pairs
```

- A **foreign key** (`REFERENCES`) says a column's value must exist in another table's key.
- A **linking table** such as `enrolments` turns a many-to-many relationship into two one-to-many relationships.
- **JOIN** matches rows from two tables using a condition (`ON s.id = e.student_id`).
- **GROUP BY** collapses rows into groups so **aggregate functions** such as `count()` can summarise each group.

## Try it yourself

> **Local lab** — continue in the `college` database from the previous lesson (`\c college` in psql). Every SQL block below is run automatically in DevForge's CI against PostgreSQL 16, starting from the previous lesson's data.

### 1. Add courses and enrolments

```sql run
CREATE TABLE courses (
    code  text PRIMARY KEY,
    title text NOT NULL
);
INSERT INTO courses (code, title) VALUES
    ('CS101', 'Programming Basics'),
    ('DB201', 'Database Systems'),
    ('NW301', 'Computer Networks');
```

```text output
CREATE TABLE
INSERT 0 3
```

```sql run
CREATE TABLE enrolments (
    student_id  integer NOT NULL REFERENCES students (id),
    course_code text    NOT NULL REFERENCES courses (code),
    PRIMARY KEY (student_id, course_code)
);
INSERT INTO enrolments (student_id, course_code) VALUES
    (1, 'CS101'),
    (1, 'DB201'),
    (2, 'DB201'),
    (3, 'CS101');
```

```text output
CREATE TABLE
INSERT 0 4
```

The primary key is *composite*: the pair of columns together must be unique.

### 2. See the foreign keys protect the data

Enrol a student who does not exist:

```sql run fails
INSERT INTO enrolments (student_id, course_code) VALUES (99, 'CS101');
```

```text output
ERROR:  insert or update on table "enrolments" violates foreign key constraint "enrolments_student_id_fkey"
DETAIL:  Key (student_id)=(99) is not present in table "students".
```

Enrol Asha in CS101 a second time:

```sql run fails
INSERT INTO enrolments (student_id, course_code) VALUES (1, 'CS101');
```

```text output
ERROR:  duplicate key value violates unique constraint "enrolments_pkey"
DETAIL:  Key (student_id, course_code)=(1, CS101) already exists.
```

Delete a student who still has enrolments:

```sql run fails
DELETE FROM students WHERE id = 1;
```

```text output
ERROR:  update or delete on table "students" violates foreign key constraint "enrolments_student_id_fkey" on table "enrolments"
DETAIL:  Key (id)=(1) is still referenced from table "enrolments".
```

The database refuses to leave enrolments pointing at a student who no longer exists.

### 3. Join the tables

Who takes what? Join each enrolment to its student and course:

```sql run
SELECT s.name, c.title
FROM enrolments e
JOIN students s ON s.id = e.student_id
JOIN courses  c ON c.code = e.course_code
ORDER BY s.name, c.title;
```

```text output
    name    |       title
------------+--------------------
 Asha Rao   | Database Systems
 Asha Rao   | Programming Basics
 Meera Iyer | Programming Basics
 Ravi Kumar | Database Systems
(4 rows)
```

`e`, `s` and `c` are **aliases**: short names for the tables within this query.

### 4. Find students with no courses

A plain `JOIN` drops students without enrolments. `LEFT JOIN` keeps every student and fills the missing enrolment columns with `NULL`:

```sql run
SELECT s.name
FROM students s
LEFT JOIN enrolments e ON e.student_id = s.id
WHERE e.student_id IS NULL;
```

```text output
    name
-------------
 Nikhil Shah
(1 row)
```

Nikhil, added in the previous lesson, has not enrolled in anything.

### 5. Count students per course

```sql run
SELECT c.title, count(e.student_id) AS students
FROM courses c
LEFT JOIN enrolments e ON e.course_code = c.code
GROUP BY c.title
ORDER BY students DESC, c.title;
```

```text output
       title        | students
--------------------+----------
 Database Systems   |        2
 Programming Basics |        2
 Computer Networks  |        0
(3 rows)
```

`GROUP BY c.title` makes one output row per course. `count(e.student_id)` counts only non-NULL values, so Computer Networks, which has no enrolments, correctly shows 0. `AS students` names the result column.

## Common mistakes

- **Storing lists in a column** (`'CS101,DB201'`). It cannot be constrained, joined or indexed properly; use a linking table.
- **Using JOIN when you need LEFT JOIN**, so rows without matches silently vanish from reports.
- **Using `count(*)` after a LEFT JOIN**, which counts the NULL-filled row and reports 1 instead of 0.
- **Selecting a column that is neither grouped nor aggregated.** PostgreSQL rejects it, because it would not know which row's value to show.
- **Reaching for `ON DELETE CASCADE` by default.** Cascades are sometimes right, but they can delete far more than intended; decide deliberately.

## Where this fits in a real system

Almost every backend endpoint runs queries like these: a course page joins courses to enrolments; an admin report groups and counts. As data grows, **indexes** keep joins fast (an intermediate PostgreSQL lesson), **Redis** can cache expensive report results, and **Airflow** can schedule heavy aggregations to run overnight instead of on every page view.
