---
id: pg-analytics-migrations
track: postgresql
title: Analytics-ready schema with indexes and migration scripts
level: advanced
estimated_hours: 9
prerequisites: [postgresql-indexes-and-explain, postgresql-backups-restores-migrations, postgresql-roles-privileges-injection, postgresql-isolation-and-anomalies]
related_tracks: [airflow]
user_stories:
  - As a data analyst, I want my three daily report queries to answer in milliseconds so that I can explore the data instead of waiting for it.
  - As a product manager, I want a dashboard of daily orders and revenue that stays available while its numbers are refreshed so that it never shows an error page during a refresh.
  - As a database administrator, I want every schema change as a numbered migration that is safe to run twice and works on the existing production data so that every environment ends up identical.
  - As a data engineer, I want the database to refuse impossible orders from now on so that bad rows stop reaching the reports.
acceptance_criteria:
  - Migration 001 (already applied in production) is unchanged; every change is a new numbered migration.
  - All migrations apply to an empty database, and running migrate.sh again applies nothing.
  - On a database that already holds migration 001 and 300,000 orders, the new migrations apply without errors.
  - None of the three queries in report_queries.sql reads the whole orders table, and the customer query reads its rows in index order without sorting.
  - daily_revenue is a materialized view with the correct day, orders and revenue for every UTC day (cancelled orders excluded), and REFRESH MATERIALIZED VIEW CONCURRENTLY works on it.
  - A quantity below 1, a negative unit price or an unknown status is rejected, and every CHECK constraint is validated against the existing rows.
  - The analyst role can read the order tables and daily_revenue, and cannot insert, update, delete or refresh anything.
rubric:
  - { criterion: "Migrations", excellent: "Small, single-purpose files with comments; changes to existing data and locks are planned (NOT VALID then VALIDATE; a note on CREATE INDEX CONCURRENTLY and why the runner's transactions rule it out); the README explains how to roll forward after a failure.", good: "Numbered, idempotent through the runner, and correct on existing data.", needs_work: "001 edited, or migrations that only work on an empty database." }
  - { criterion: "Indexes", excellent: "One index per access pattern, justified with EXPLAIN ANALYZE before and after (recorded in the README), and no redundant indexes; write cost considered.", good: "The report queries use indexes.", needs_work: "Indexes on every column, or plans not checked." }
  - { criterion: "Dashboard data", excellent: "Materialized view with a unique index, refreshed CONCURRENTLY on a schedule; the README states how stale the dashboard may be and how the refresh is monitored.", good: "Correct materialized view that refreshes concurrently.", needs_work: "A plain view (recomputed on every load) or a table filled by hand." }
  - { criterion: "Security", excellent: "Read-only role with exactly the needed SELECT grants, idempotent creation, and default privileges or a documented step for tables added later.", good: "Read-only role that works.", needs_work: "Analysts share the owner's login." }
hints:
  - Load the sample data after migration 001 alone (as production is), then run EXPLAIN on each report query. Write down which ones say Seq Scan on orders before you add anything.
  - Queries 1 and 2 filter on a time range; query 3 filters on one customer and orders by time. That is two different access patterns, so two different indexes.
  - CREATE MATERIALIZED VIEW stores the result. REFRESH … CONCURRENTLY keeps the old contents readable during a refresh, but only if the view has a unique index on plain columns.
  - Adding a CHECK constraint to a big table scans every row while holding a lock that blocks writes. ADD CONSTRAINT … NOT VALID in one migration and VALIDATE CONSTRAINT in the next keeps the strong lock short.
  - migrate.sh runs each file with --single-transaction. Anything that cannot run inside a transaction (CREATE INDEX CONCURRENTLY, for example) fails there — decide what to do about that and say so in a comment.
stretch_goals:
  - Schedule the materialized view refresh with Airflow (see the Airflow track) and alert when it has not succeeded for a day.
  - Partition orders by month (declarative partitioning) in a migration that moves the existing rows, and compare plans and maintenance.
  - Teach migrate.sh to run files named *.nontransactional.sql without --single-transaction, and use it for CREATE INDEX CONCURRENTLY.
  - Try a BRIN index on ordered_at instead of a B-tree (the orders arrive in time order) and compare size and query time.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

An online shop's orders database has grown to 300,000 orders, and the analysts now run reports on it every day.
Each report reads the entire `orders` table, the dashboard recomputes a year and a half of daily revenue on every
page load, and a few impossible rows (zero quantities, unknown statuses) have appeared. The database was built
with one migration, `001_create_orders.sql`, which **is already applied in production** — so you cannot edit it.
Every improvement must be a new migration that works both on an empty database (a developer's laptop, CI) and on
production, where the orders already exist.

This is how schema changes work in real teams: the change is code, reviewed and applied by a tool, the same way
everywhere, and it must be planned for the data and the traffic that are already there.

## Getting started

1. Copy the starter into a new folder. Create a database, apply 001 and load the sample data, as production is:

   ```bash
   createdb analytics
   bash migrate.sh analytics                 # apply 001_create_orders
   psql -v ON_ERROR_STOP=1 -d analytics -f sample_data.sql
   psql -d analytics -c "EXPLAIN ANALYZE SELECT id FROM orders WHERE customer_id = 1234 ORDER BY ordered_at DESC LIMIT 10"
   ```

2. Read `README.md` (the analysts' requirements) and `report_queries.sql`, and EXPLAIN each report query.
3. Add migrations `002_…`, `003_…` and so on. Apply them with `bash migrate.sh analytics`; run it twice to see
   that the second run skips everything. To test on an empty database too: `createdb scratch && bash migrate.sh scratch`.
4. Run the check (Docker needed; it uses its own throwaway PostgreSQL 16 and the same 300,000 sample orders):

   ```bash
   bash check.sh path/to/your/project
   ```

   It applies your migrations twice to an empty database, then replays production — 001, the data, then your new
   migrations — and checks the plans, the dashboard, the rules and the role on the result.
