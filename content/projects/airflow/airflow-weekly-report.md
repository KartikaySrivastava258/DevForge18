---
id: airflow-weekly-report
track: airflow
title: Scheduled report generation
level: intermediate
estimated_hours: 6
prerequisites: [airflow-schedules-and-catchup, airflow-passing-data-between-tasks, airflow-idempotent-etl]
related_tracks: []
user_stories:
  - As a librarian, I want last week's loans report on Monday morning so that I can reorder popular books before students ask.
  - As a noticeboard owner, I want the screen to keep showing the last good report when a run fails so that students never see a broken or half-written page.
  - As a data engineer, I want the report period to follow from the run's logical date so that rerunning or backfilling any week produces exactly that week's report.
acceptance_criteria:
  - The DAG weekly_library_report loads, runs Mondays at 07:00 (cron 0 7 * * 1) from 2026-02-02 without catch-up, and allows one run at a time.
  - A run for Monday ds reports the seven days before ds, in the specified Markdown format, to reports/library_<ds>.md.
  - The DAG parameter top_n (default 5) sets how many books are listed, and can be changed per run.
  - A week with a missing daily file fails and names the missing day.
  - reports/latest.md is replaced only after a complete report was written; a failed run leaves it unchanged.
rubric:
  - { criterion: "Time handling", excellent: "Dates come only from the logical date, the README explains the difference between the logical date and when the run happens, and the DAG would also work for a daily or monthly variant with one change.", good: "Correct week for every run.", needs_work: "datetime.now(), or all files ever written." }
  - { criterion: "Task design", excellent: "Small tasks with one job each, passing only small values between them, and the publish step separate so it runs only on success.", good: "Clear tasks in a sensible order.", needs_work: "One big task that does everything, so a failure leaves half-finished output." }
  - { criterion: "Operations", excellent: "Missing input fails fast with a clear message; parameters are validated; the README shows how to rerun one week and how to backfill a quarter.", good: "Failures are visible and safe.", needs_work: "A failed run looks successful or corrupts the published report." }
hints:
  - For a Monday logical date, the previous week runs from ds minus 7 days to ds minus 1 day. date.fromisoformat(ds) and timedelta make this easy.
  - "@weekly runs at midnight on Sundays. A cron expression gives you Mondays at 07:00: minute 0, hour 7, any day of the month, any month, day of week 1."
  - 'params={"top_n": Param(5, type="integer")} declares a parameter; a task receives the values through an argument named params. airflow dags test … -c ''{"top_n": 3}'' runs once with another value.'
  - Write the dated report first (to a temporary name, then rename it), and copy it to latest.md in a separate, last task — that task runs only if everything before it succeeded.
  - "max_active_runs=1 is a DAG setting: a second run waits until the first has finished."
stretch_goals:
  - Add a sensor that waits until 09:00 for a late daily file before failing.
  - Send the report by email or chat with a notifier, only on success.
  - Backfill February from the API of a standalone Airflow, and explain why the runs do not overlap.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college library writes one file of loans per day. Every Monday morning the librarian wants a report of the
previous week — total loans and the most borrowed books — and the noticeboard screen in the library shows whatever
is in `reports/latest.md`.

The first attempt runs at the wrong time (`@weekly` means midnight on Sundays), reads every file ever written
instead of one week, cannot be configured, and writes straight to `latest.md`, so a failing run can leave the
noticeboard empty or half-written. Rebuild it as a schedule-driven, parameterised, safely published report. The
README in the starter specifies the exact report format the check compares against.

## Getting started

1. Copy the starter folder (three weeks of sample loans are in `data/loans/`; the file for 19 February is missing
   on purpose).
2. Open a shell in the Airflow image with your folders mounted, as in the beginner project, and run
   `airflow db migrate` once.
3. Run one week: `airflow dags test weekly_library_report 2026-02-09`, then look at `data/reports/`. Try
   `-c '{"top_n": 3}'` and the week of 2026-02-23.
4. Run the check:

   ```bash
   bash check.sh path/to/your/project
   ```
