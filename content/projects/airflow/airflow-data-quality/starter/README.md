# Exam marks quality gate

Departments upload the day's exam marks to `data/incoming/marks_<date>.csv`
(`student_id,course,mark,graded_at`). Everything in `data/warehouse/marks/` is read by the results portal, so a
bad file there means wrong results shown to students. Build `dags/marks_quality.py` (DAG id `marks_quality`,
daily) as a **write–audit–publish** pipeline for the run's logical date `ds`:

**Row checks.** A row is valid when `student_id` is `S` followed by five digits, `course` is one of `CS101`,
`CS201`, `MA102`, `HS110`, and `mark` is a whole number from 0 to 100. Invalid rows go to
`data/quarantine/<ds>.csv` with the original columns plus a `reason` column; valid rows are staged.

**Dataset checks** on the staged rows. The day fails if any of these is true:

- invalid rows are more than 5% of the rows received;
- the same `student_id` and `course` appear more than once;
- fewer valid rows than half of the last published day's rows (a partial upload) — only when an earlier day
  has been published.

**Publish.** Only if every dataset check passes, the staged rows (header plus valid rows, in input order) are
written to `data/warehouse/marks/<ds>.csv`, appearing complete or not at all. If a check fails, nothing is
published for that day, the run fails, and the reasons are written to `data/alerts/<ds>.txt`.

**Quality report.** Every run writes `data/quality/<ds>.json`:
`{"rows_in": …, "rows_valid": …, "rows_quarantined": …, "duplicates": …, "previous_rows": … or null,
"passed": true/false, "failures": ["…", …]}`, where `duplicates` counts rows beyond the first for a repeated
student and course.

Running a day again gives the same files.
