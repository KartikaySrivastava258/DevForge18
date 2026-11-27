---
id: airflow-attendance-pipeline
track: airflow
title: Daily student attendance pipeline
level: beginner
estimated_hours: 4
prerequisites: [airflow-dags-and-tasks, airflow-schedules-and-catchup, airflow-retries-and-failures]
related_tracks: []
user_stories:
  - As a head of department, I want each class's attendance percentage for every day so that I can follow up with classes whose attendance drops.
  - As a data engineer, I want each run to process its own day's file so that rerunning an old day fixes that day and nothing else.
  - As an operator, I want a missing file to fail the run, after a couple of retries, so that someone notices instead of the report silently showing nothing.
acceptance_criteria:
  - The DAG attendance_daily loads without import errors, is scheduled daily from 2026-02-01 without catch-up, and is tagged attendance.
  - Its tasks run extract → summarise → load, and every task retries twice, five minutes apart.
  - A run for a day reads data/attendance/<ds>.csv and writes reports/attendance_<ds>.json with each class's attendance percentage.
  - Running the same day again replaces the report with the same content.
  - extract fails when the day's file is missing.
rubric:
  - { criterion: "Using the logical date", excellent: "Every path and query is derived from ds (or the data interval), never from 'today', and the README explains why a backfill of last week then just works.", good: "Each run reads and writes its own day.", needs_work: "Hard-coded dates or datetime.now()." }
  - { criterion: "Idempotence", excellent: "Output written to a temporary file and renamed into place, one file per day, safe to rerun at any time.", good: "Rerunning a day gives the same file.", needs_work: "Appending, so every rerun adds a duplicate line." }
  - { criterion: "Failure behaviour", excellent: "Missing or malformed input fails loudly with a clear message; retries are set for transient problems only, with a reason in a comment.", good: "Missing input fails the run.", needs_work: "Errors swallowed so the run looks green." }
hints:
  - Run your DAG for one day without a scheduler — airflow dags test attendance_daily 2026-02-03 — and look at the files it writes.
  - A task can receive the logical date by declaring a parameter named ds (def extract(ds=None)). Use it in the file name.
  - default_args on the @dag decorator apply to every task — the place for retries and retry_delay.
  - Appending to a file is never idempotent. Write the whole report, then replace the old one (os.replace).
  - airflow tasks test attendance_daily extract 2026-02-09 runs one task alone — handy for checking the missing-file case.
stretch_goals:
  - Add a fourth task that flags classes below 75% and writes them to a separate file.
  - Run the DAG in airflow standalone (as in the lessons) and trigger a backfill for 2026-02-03 and 2026-02-04 from the UI or the API.
  - Add a failure callback that writes the failed run's date to an alerts file (see "Timeouts and failure callbacks").
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Every evening the college's attendance system drops one CSV file per day: one row per student and class, with
`present` 1 or 0. The head of department wants each class's attendance percentage for every day — computed
automatically, every day, without anyone watching.

The starter is a first DAG that "worked once": it always reads the file for 3 February, appends to a single report
file, has no retries, and fails on the second day. Turn it into a pipeline that Airflow can run, rerun and backfill
safely — every run working on **its own day's data**, writing **its own report**, and failing loudly when the data
is missing.

The check loads your DAG in the official Airflow 3.4 image, inspects its settings, runs it for two days with
`airflow dags test`, reruns one day, and tries a day without a file.

## Getting started

1. Copy the starter folder (it includes two days of sample data in `data/attendance/`).
2. Run Airflow's commands in a container with your folders mounted:

   ```bash
   IMAGE=apache/airflow:slim-3.4.0-python3.12
   docker run --rm -it --user "$(id -u):0" -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/data:/opt/airflow/data" \
     -e AIRFLOW__CORE__LOAD_EXAMPLES=False "$IMAGE" bash
   airflow db migrate                                   # inside the container: a small SQLite database
   airflow dags test attendance_daily 2026-02-03
   cat /opt/airflow/data/reports/*
   ```

3. Fix the DAG one requirement at a time and run it again for 2026-02-03 and 2026-02-04.
4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
