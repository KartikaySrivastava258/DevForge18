---
id: pg-expense-tracker
track: postgresql
title: Expense tracking API database
level: intermediate
estimated_hours: 7
prerequisites: [postgresql-relationships-and-joins, postgresql-transactions-and-acid, postgresql-indexes-and-explain, postgresql-roles-privileges-injection]
related_tracks: [postman]
user_stories:
  - As a student using the expense app, I want amounts stored exactly so that my monthly total matches my bank statement to the paisa.
  - As a student using the expense app, I want my latest expenses to load instantly even when the app has thousands of users so that I keep using it.
  - As an API developer, I want the database to refuse an expense filed under someone else's category so that a bug in my code cannot mix two users' data.
  - As an on-call engineer, I want the API to connect with a role that cannot delete users or empty tables so that a compromised API cannot destroy the data.
acceptance_criteria:
  - amount is an exact numeric with two decimal places (0.10 + 0.20 adds up to exactly 0.30), greater than zero; currency is three upper-case letters.
  - Required columns are NOT NULL, and a user cannot have two categories with the same name (two users can).
  - An expense whose category belongs to a different user is rejected by the database.
  - Deleting a user deletes their categories and expenses.
  - "monthly_category_totals(user, month) returns one row per category and currency for that calendar month, largest total first, never adding different currencies together."
  - With 100,000 expenses, the API's latest-expenses query reads its 20 rows from an index — no full scan and no sort.
  - The expense_api role can read users, read and write categories and expenses, and run the report — and cannot delete or change users, TRUNCATE or DROP anything.
rubric:
  - { criterion: "Data integrity", excellent: "Every rule is enforced by a constraint, including the cross-user rule (a composite foreign key), with comments explaining the non-obvious ones.", good: "All rules enforced; the cross-user rule uses a trigger or a less direct method.", needs_work: "Rules rely on the API being correct, or money is stored as a floating-point type." }
  - { criterion: "Query performance", excellent: "The index matches the query exactly (equality column first, then the ORDER BY columns), foreign keys used for deletes are indexed too, and EXPLAIN ANALYZE before and after is recorded in the README.", good: "The main query uses an index without a sort.", needs_work: "Only single-column indexes, or indexes on every column 'just in case'." }
  - { criterion: "The report", excellent: "Correct month boundaries for any day in the month, currencies kept apart, deterministic order, and the function is marked STABLE.", good: "Correct results for the sample month.", needs_work: "Adds different currencies together, or misses the first or last day of the month." }
  - { criterion: "Least privilege", excellent: "The role has exactly the privileges the API needs, the script can be loaded twice without failing on the existing role, and the README explains how a login is granted the role.", good: "The role can do its job and cannot delete users or drop tables.", needs_work: "The API connects as the owner or a superuser." }
hints:
  - Change amount's type first and try SELECT 0.1::real + 0.2::real, then the same with numeric. Floating-point types are for measurements, not money.
  - For the cross-user rule, give categories a second UNIQUE (id, user_id) and make expenses reference (category_id, user_id) together. A foreign key can span several columns.
  - For the latest-expenses query, an index on (user_id, spent_on DESC, id DESC) lets PostgreSQL jump to one user and read their rows already in order. Check with EXPLAIN after loading enough rows and running ANALYZE; on a tiny table the planner rightly prefers a sequential scan.
  - Month boundaries are easiest as a half-open range — spent_on >= first day AND spent_on < first day of next month — which date_trunc('month', …) gives you.
  - CREATE ROLE fails if the role exists, and roles belong to the whole server. A DO block with IF NOT EXISTS (SELECT FROM pg_roles …) makes the script safe to run against a second database.
stretch_goals:
  - Write a Postman collection (see the Postman track) that calls a small API on top of this schema and checks that a request for another user's category is refused.
  - Add a monthly budget per category and a query that lists categories over budget, with a test month that has one.
  - Replace the report function with a materialized view refreshed nightly, and compare the two with EXPLAIN ANALYZE.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

A team of students is building an expense-tracking API: users record what they spend, in categories they
define, and see their latest expenses and a monthly report. The API code is written; this project is **its
database**. The starter has the tables and columns the API expects — and almost no rules. Amounts are stored as
`real`, a floating-point type, so totals drift by fractions of a paisa; nothing stops an expense from being
filed under another user's category; and the home-screen query reads the whole table.

Your job is to make the schema correct, fast for the query the API runs most, and safe for the API to use:

- **Correct:** exact money, required fields, and the rule that ties an expense's category to the same user.
- **Fast:** an index that answers "this user's latest 20 expenses" without reading or sorting anything else.
- **Safe:** a dedicated role for the API with only the privileges it needs.

The README in the starter is the specification. Read it as the API developer's request to you.

## Getting started

1. Copy the starter files into a new folder and load them into a scratch database:

   ```bash
   createdb expenses
   psql -v ON_ERROR_STOP=1 -d expenses -f schema.sql
   psql -d expenses -c "SELECT 0.1::real + 0.2::real AS floating, 0.1::numeric + 0.2::numeric AS exact"
   ```

2. Change `schema.sql` one rule at a time. To start from empty again: `dropdb expenses && createdb expenses`.
   Remember that the role is not dropped with the database.
3. For the index, load realistic volume (the check uses 1,000 users × 100 expenses), run `ANALYZE`, and compare
   `EXPLAIN ANALYZE` of the API's query before and after.
4. Try the role: `BEGIN; SET ROLE expense_api; DELETE FROM users; ROLLBACK;` must say *permission denied*.
5. Run the check (it needs Docker and starts its own throwaway PostgreSQL 16):

   ```bash
   bash check.sh path/to/your/project
   ```
