---
id: airflow-data-quality
track: airflow
title: Data quality pipeline
level: advanced
estimated_hours: 8
prerequisites: [airflow-backfills-and-data-quality, airflow-idempotent-etl, airflow-retries-and-failures]
related_tracks: [postgresql]
user_stories:
  - As a student, I want the results portal to show only marks that passed the checks so that a broken upload never shows me a wrong result.
  - As a department administrator, I want the rows that were rejected, with a reason, so that I can correct them instead of guessing what went wrong.
  - As a data platform owner, I want every day's quality measured and stored so that I can show trends and prove the checks run.
acceptance_criteria:
  - The DAG marks_quality loads without import errors.
  - Invalid rows (malformed student_id, unknown course, mark not a whole number from 0 to 100) go to quarantine/<ds>.csv with a reason; valid rows are staged.
  - A day is published to warehouse/marks/<ds>.csv only if invalid rows are at most 5%, there are no duplicate student and course rows, and it has at least half the rows of the last published day.
  - A failing day publishes nothing, fails the run and writes alerts/<ds>.txt with the reasons.
  - Every run writes quality/<ds>.json with the row counts, duplicates, previous_rows, passed and failures.
  - Running a day again produces identical files.
rubric:
  - { criterion: "Write–audit–publish", excellent: "Staging, audit and publish are separate tasks; publish is the only writer of the warehouse and writes atomically; the README explains why checking after publishing is too late.", good: "Bad days never reach the warehouse.", needs_work: "Checks run after the data is already visible, or publish writes partial files." }
  - { criterion: "Check design", excellent: "Row and dataset checks are distinguished deliberately, thresholds are named constants with reasons, and the volume check copes with the first day and with gaps.", good: "All specified checks work.", needs_work: "Checks that only print warnings." }
  - { criterion: "Observability", excellent: "Quality reports are machine-readable and complete, alerts say exactly what to fix, and a rerun after a correction clears the alert.", good: "Reports and alerts are written as specified.", needs_work: "Failures visible only in task logs." }
  - { criterion: "Idempotence", excellent: "Every output is derived from the logical date and the inputs only; reruns and backfills give identical files; temporary files never leak.", good: "Reruns give the same result.", needs_work: "Appends or timestamps make every run different." }
hints:
  - Draw the tasks first — validate_rows (write), audit (check), publish — and decide which files each one owns.
  - The audit task can write the quality report and then raise an exception when a check fails. Because publish depends on it, publish does not run and the run is failed.
  - Duplicates are about the key (student_id and course), not about whole lines. Count every row beyond the first for a key.
  - For the volume check, look for the newest warehouse file dated before ds; on the first day there is none, so the check does not apply.
  - Write files to a temporary name and os.replace() them into place, so readers never see half a file.
stretch_goals:
  - Load the published marks into PostgreSQL in the publish task, inside one transaction (see the PostgreSQL track).
  - Make the thresholds DAG parameters and record them in the quality report.
  - Add a task that compares today's mark distribution with last week's and warns about a large shift.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Departments upload each day's exam marks as a CSV file, and everything in the warehouse folder is shown to
students on the results portal. Today the pipeline copies uploads straight into the warehouse — so a file with a
mark of 105, a malformed student ID, duplicated rows or only a third of the expected rows goes straight to students.

Build a **write–audit–publish** pipeline: validate rows and quarantine the bad ones with a reason, audit the
staged day as a whole (invalid share, duplicates, volume against the last published day), and publish only days
that pass — atomically, so the portal never sees a half-written file. Every run leaves a machine-readable quality
report, and a failed day leaves an alert that says what to fix.

The starter includes five days of uploads that exercise every rule: a clean day, a day with three bad rows,
a day with too many bad rows, a day with duplicates and a partial upload. The README in the starter is the
specification.

## Getting started

1. Copy the starter folder and open a shell in the Airflow 3.4 image with `dags/` and `data/` mounted, as in the
   beginner project; run `airflow db migrate` once.
2. Run the days in order — `airflow dags test marks_quality 2026-03-02`, then 2026-03-03 to 2026-03-06 — and look
   at what appears under `data/`.
3. Delete `data/warehouse`, `data/staging`, `data/quarantine`, `data/quality` and `data/alerts` before each full
   rerun, because later days depend on what earlier days published.
4. Run the check (it starts from your `incoming/` files only):

   ```bash
   bash check.sh path/to/your/project
   ```
