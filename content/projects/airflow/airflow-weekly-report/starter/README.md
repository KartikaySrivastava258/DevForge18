# Weekly library report

The library writes one file of loans per day, `data/loans/<date>.csv` (`book,title,student`). Every Monday at
07:00 the librarian wants a report of **the previous week** (Monday to Sunday), and the noticeboard screen shows
whatever is in `reports/latest.md`.

Build `dags/weekly_report.py`:

- DAG id `weekly_library_report`, cron schedule `0 7 * * 1` (Mondays at 07:00) from 2026-02-02, no catch-up, and
  at most **one run at a time** (`max_active_runs=1`), so two reports never overwrite each other's files.
- A run with logical date `ds` (a Monday) reports the seven days **before** it: `ds − 7 days` to `ds − 1 day`.
  The first task checks that all seven daily files exist and fails the run, naming the missing days, if not.
- A DAG parameter `top_n` (default 5) sets how many books the report lists.
- The report is written to `reports/library_<ds>.md`, in exactly this form:

  ```text
  # Library report: 2026-02-02 to 2026-02-08
  Total loans: 123
  ## Top books
  1. Database System Concepts (21)
  2. …
  ```

  (books with equal counts in alphabetical order).
- Only after that file is complete is it copied to `reports/latest.md` — a failed run must never change
  `latest.md`.

The starter reads every file ever written, runs `@weekly` (midnight on Sundays) and writes `latest.md` directly.
