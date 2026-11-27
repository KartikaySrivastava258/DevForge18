---
id: batch-data-platform
title: Batch data platform with quality gates
summary: Events from Kafka and daily files land in raw tables; Airflow DAGs keyed by the logical date write each day to staging, audit it and publish it to the warehouse only if the checks pass, so any past day can be rerun or backfilled; Prometheus and Grafana watch failed runs, freshness and consumer lag.
problem: Reports must be built from data that arrives late, twice or wrong, and any past day must be reprocessable after a fix — without duplicating rows and without a report ever showing data that failed its checks.
tracks: [airflow, postgresql, kafka, prometheus-grafana]
diagram: media:architecture/batch-data-platform.svg
components:
  - { name: Kafka, track: kafka, role: "Keeps a replayable record of events; a consumer group can rewind its offsets and process them again for as long as retention keeps them." }
  - { name: Landing consumer, role: "Writes events into raw tables with keys or upserts rather than blind inserts, so restarts, redeliveries and replays never duplicate rows." }
  - { name: Airflow, track: airflow, role: "Creates one DAG run per schedule time with a logical date, retries steps that talk to networks, stops hung tasks with timeouts, and runs backfills over date ranges. Its components share a PostgreSQL metadata database." }
  - { name: Write–audit–publish tasks, track: airflow, role: "For each date: replace that day in staging, check it (row counts, duplicate keys, impossible values, control totals), quarantine invalid rows with a reason, and publish only if the audit passed." }
  - { name: PostgreSQL, track: postgresql, role: "Holds the raw, staging and warehouse layers, created by migrations, with indexes for the reporting queries and a read-only role for report users." }
  - { name: Prometheus and Grafana, track: prometheus-grafana, role: "Alert on failed runs, late published tables, consumer lag and quarantined rows, and show the same on a dashboard." }
flow:
  - Producers publish events to Kafka; a consumer lands them in raw tables keyed by event, so a redelivered event does not create a second row.
  - At each schedule time Airflow creates a run with a logical date; every task reads that date's files and events, never "now" or "the latest file".
  - The write task deletes that date in staging and inserts the fresh rows in one transaction.
  - The audit task checks the staged day and fails with a specific message if anything is wrong; invalid rows go to quarantine with a reason.
  - Only if the audit succeeds does the publish task replace that day in the warehouse table that reports read; otherwise it is marked upstream_failed.
  - After a bug fix, a backfill re-runs a range of dates (only the failed ones, if chosen), with max_active_runs limiting how many run at once.
trade_offs:
  - { choice: "Idempotent loads keyed by the logical date", gain: "Retries, reruns and backfills are routine: running a day once or ten times gives the same result.", cost: "Every task must use the run's date, replace rather than append in one transaction, and guard side effects such as e-mails that cannot be repeated." }
  - { choice: "Write–audit–publish", gain: "Nothing unaudited reaches a report.", cost: "An extra staging copy of each day, and a day that fails its audit stays unpublished — late — until someone fixes it." }
  - { choice: "Kafka as the record of events", gain: "A day's events can be processed again after a fix, by rewinding the consumer group's offsets.", cost: "Only while retention keeps them; offsets can be reset only while the group's consumers are stopped, and replays require idempotent landing." }
failure_modes:
  - { failure: "A load appends rows and is retried, rerun or backfilled", effect: "That day's data is duplicated in every report.", mitigation: "Replace the day's partition (delete and insert) in one transaction, keyed by the logical date." }
  - { failure: "Delete and insert run in separate transactions and the task fails in between", effect: "The day is empty in the table.", mitigation: "Do both in one transaction, or write a new partition and swap it in." }
  - { failure: "A quality check fails and is retried", effect: "Wrong data stays wrong; retries only delay the alert.", mitigation: "Raise AirflowFailException with what failed and for which date, so the alert says what to fix." }
  - { failure: "A consumer's committed offsets expire and auto.offset.reset is latest", effect: "The group silently skips events that are still in the log.", mitigation: "Use earliest for important consumers, and alert on consumer lag." }
  - { failure: "A task hangs on a network or database call", effect: "It holds a worker slot until someone notices, and the day is late.", mitigation: "Set execution_timeout on every risky task and a dagrun_timeout on the DAG; page from failure callbacks only." }
alternatives:
  - { instead_of: "Airflow", consider: "Dagster", when: "You prefer to model pipelines around the data assets they produce, with typed, testable definitions, and have no large set of Airflow DAGs to migrate." }
  - { instead_of: "Airflow", consider: "Argo Workflows", when: "Every step already runs as a container on Kubernetes and you want workflows defined as Kubernetes resources." }
  - { instead_of: "Airflow for event-triggered office automations", consider: "n8n (see Workflow automation hub with approvals)", when: "The work is a business automation started by events and built by non-developers in a visual editor, not a scheduled data pipeline." }
decision_prompts:
  - What is the grain and key of each table, and how does a rerun of one day replace exactly that day?
  - Which checks decide that a day may be published, and with which thresholds?
  - How long must Kafka keep events so that a late fix can still replay them?
  - When is each published table late, and who is alerted?
  - Which side effects (e-mails, exports) must never repeat on a rerun, and how are they guarded?
learn_more:
  - { kind: lesson, id: airflow-idempotent-etl }
  - { kind: lesson, id: airflow-backfills-and-data-quality }
  - { kind: lesson, id: kafka-offsets-retention-and-replay }
  - { kind: lab, id: airflow-backfill-safely }
  - { kind: project, id: airflow-data-quality }
capstones: [capstone-d]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape when reports and dashboards are built from data that arrives in daily slices — files, exports, event
streams — and the people reading them need numbers they can trust and correct. It is built for the everyday reality
of data work: a source sends a partial file, a bug is found after the fact, a day has to be loaded again.

It is not meant for event-triggered business automations, such as confirming a registration or routing a ticket;
the Workflow automation hub with approvals fits those, and the event-driven architecture fits services that must
react to each other's changes.

## How it works

Everything is keyed by the logical date — the day a run is responsible for, not the day it happens to run. Each task
replaces exactly its own day, in one transaction, from that day's inputs. That one rule makes retries, reruns after a
fix and backfills of whole months safe: running a day again produces the same rows, not a second copy.

The second idea is a gate. A day is written to staging, audited there, and only then published to the table reports
read. A failing check stops the publish step, so a bad file becomes a late report with a precise alert instead of a
wrong report that someone acts on. Kafka's retained log and Airflow's backfills are the two ways to go back: replay
events, or re-run dates.
