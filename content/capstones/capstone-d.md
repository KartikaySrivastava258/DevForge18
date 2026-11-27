---
id: capstone-d
letter: D
title: Data engineering and analytics pipeline
summary: A campus data platform that lands event streams and daily files, checks them before anyone can see them, publishes clean tables for reports, can be rerun for any past day, and tells you when data is late or wrong.
level: advanced
estimated_hours: 60
tracks: [postgresql, kafka, airflow, docker, prometheus-grafana]
architecture: media:capstones/capstone-d-architecture.svg
user_stories:
  - As a dean, I want a weekly dashboard of attendance, library use and canteen footfall so that I can plan staff and opening hours.
  - As a data engineer, I want every day's data to be reprocessable on its own so that a late or corrected file never means rebuilding everything.
  - As a report owner, I want bad data stopped before it reaches my tables so that I never present numbers I have to retract.
  - As an operator, I want an alert when data is late or a check fails so that I hear about problems before the dean does.
milestones:
  - id: storage
    title: A warehouse schema built by migrations
    goal: Design raw, staging and warehouse schemas in PostgreSQL, with indexes for the reporting queries and a read-only role for report users, all created through migrations.
    deliverables:
      - Migrations for the three schemas, indexes and roles.
      - The reporting queries with their EXPLAIN output before and after indexing.
    acceptance:
      - Migrations apply to an empty database and to one with data.
      - The reporting queries do not read whole fact tables.
      - The report role cannot change any table.
    reuses:
      - { kind: project, id: pg-analytics-migrations }
      - { kind: lab, id: postgresql-query-plans-and-indexes }
  - id: streams
    title: Streams landed exactly once in effect
    goal: Publish campus events to Kafka and land them into raw tables with an idempotent consumer, so that restarts and redeliveries never duplicate rows.
    deliverables:
      - Topics with partitions and retention chosen and explained.
      - A landing consumer with committed offsets after each write.
    acceptance:
      - Restarting the consumer mid-stream loses and duplicates nothing.
      - Replaying a day from Kafka rebuilds that day's raw rows identically.
    reuses:
      - { kind: project, id: kafka-campus-activity }
      - { kind: lesson, id: kafka-offsets-retention-and-replay }
      - { kind: lab, id: kafka-partitions-and-consumer-groups }
  - id: batch
    title: Daily, idempotent, backfillable batch jobs
    goal: Build Airflow DAGs that load each day's files and raw events into staging using the logical date, so that any past day can be rerun safely.
    deliverables:
      - DAGs for each source with retries, timeouts and failure callbacks.
      - A backfill of a past week, documented.
    acceptance:
      - Rerunning a day gives identical tables.
      - A backfill of seven days runs without manual steps and without overlapping runs.
    reuses:
      - { kind: project, id: airflow-attendance-pipeline }
      - { kind: project, id: airflow-weekly-report }
      - { kind: lab, id: airflow-backfill-safely }
  - id: quality
    title: Nothing unaudited reaches a report
    goal: Put a write–audit–publish gate in front of every warehouse table, with row-level quarantine, dataset-level checks and quality reports.
    deliverables:
      - Quality checks per table, quarantine tables and daily quality reports.
      - Alerts when a check fails.
    acceptance:
      - A day with duplicates, invalid values or a partial upload is not published and raises an alert.
      - The quarantine says which rows were rejected and why.
    reuses:
      - { kind: project, id: airflow-data-quality }
      - { kind: lesson, id: airflow-backfills-and-data-quality }
  - id: observability
    title: Knowing that data is fresh and correct
    goal: Package the platform with Docker Compose and monitor it — freshness of every published table, failed runs, consumer lag and quarantined rows — with tested alerts and a dashboard.
    deliverables:
      - Compose file for the whole platform.
      - Metrics, alert rules with unit tests, and a Grafana dashboard.
    acceptance:
      - Stopping the landing consumer produces a lag alert; a missing daily file produces a freshness alert.
      - The dashboard shows when each table was last published.
    reuses:
      - { kind: project, id: prom-resource-monitoring }
      - { kind: project, id: prom-health-dashboard }
      - { kind: project, id: docker-compose-fullstack }
rubric:
  - { criterion: "Correctness and idempotence", excellent: "Every job keyed by logical date, reruns and backfills give identical results, proven by tests that compare checksums of tables.", good: "Reruns are safe for the tested days.", needs_work: "Appends, or jobs that use today's date." }
  - { criterion: "Data quality", excellent: "Checks chosen from real failure modes, quarantine with reasons, quality reports trended over time.", good: "Write–audit–publish works for every table.", needs_work: "Checks run after publishing, or only print warnings." }
  - { criterion: "Performance", excellent: "Indexes and partitioning justified with query plans; heavy work outside the report path.", good: "Reports are fast on the sample data.", needs_work: "Full table scans in every report." }
  - { criterion: "Operations", excellent: "One command to start, freshness and lag alerts tested, a runbook for a failed day and for a backfill.", good: "Monitoring and alerts exist.", needs_work: "Problems found by looking at the dashboard by chance." }
  - { criterion: "Communication", excellent: "A data dictionary, data cards for each source and architecture decision records for the main choices.", good: "A clear README.", needs_work: "No documentation of what the tables mean." }
stretch_goals:
  - Add a slowly changing dimension for students moving between classes and show its effect on a report.
  - Replace one daily batch with a streaming aggregation and compare freshness and complexity.
  - Publish a data contract for one source and fail the pipeline when the producer breaks it.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college wants to understand how its campus is used — attendance, library loans, canteen footfall — and today
the numbers come from spreadsheets assembled by hand, late and often wrong. Build the data platform behind a weekly
dashboard: event streams and daily files land, are checked, and are published as clean tables that reports can
trust; any past day can be reprocessed on its own; and someone is alerted when data is late or wrong.

Use invented or properly anonymised data only, and say so in the data cards.

## Architecture

Data flows in one direction — raw, staging, warehouse — and only the publish step writes the warehouse. Every job
is keyed by its logical date, so reruns and backfills are routine rather than emergencies. Kafka keeps a replayable
record of events; Airflow schedules, retries and backfills; PostgreSQL holds the layers; Prometheus and Grafana
watch freshness and failures.

Record your main decisions — partitioning, retention, check thresholds, schedule — as architecture decision
records.

## Getting started

1. Write the data dictionary and the three schemas first; agree on keys and grain with your team.
2. Build one source end to end (land, stage, audit, publish, dashboard) before adding the others.
3. Keep a small fixture dataset in the repository and test reruns and backfills against it in CI.
4. Present the dashboard, then break a day's file on purpose and show the alert, the quarantine and the fix.
