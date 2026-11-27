# Daily attendance summary

Every evening the attendance system drops one file per day into `data/attendance/<date>.csv`
(`student,class,present` with present 1 or 0). The head of department wants, for every day, each class's
attendance percentage. Make `dags/attendance.py` a DAG Airflow can run every day without anyone watching it:

- DAG id `attendance_daily`, scheduled `@daily` from 2026-02-01, **no catch-up** of past days when it is first
  switched on, tagged `attendance`.
- Three tasks in a row: `extract` → `summarise` → `load`.
- `extract` reads the file **of the run's logical date** (`ds`, for example `2026-02-03`) from
  `/opt/airflow/data/attendance/`. If the file is missing, the task fails (so the run fails and someone is told).
- `summarise` computes, for each class, the percentage of present marks, rounded to one decimal place.
- `load` writes `/opt/airflow/data/reports/attendance_<ds>.json` as a JSON object `{"CS-A": 86.7, …}`. Running the
  same day again replaces that file with the same content (the task is idempotent).
- Every task is retried twice, five minutes apart, before it counts as failed.

In the containers the check uses, `data/` is mounted at `/opt/airflow/data`.
