---
id: airflow-schedules-and-catchup
title: Schedules, logical dates and catchup
track: airflow
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [airflow-dags-and-tasks]
learning_objectives:
  - Give a DAG a schedule and explain the logical date of each run.
  - Predict which runs Airflow creates for past dates, with and without catchup.
  - Use the logical date inside a task so that each run processes its own day.
resources:
  - title: DAG runs
    url: https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html
    publisher: The Apache Software Foundation
    type: documentation
    level: beginner
    official: true
    why: Logical dates, data intervals, timetables and catchup, including its default in Airflow 3.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Timetables
    url: https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/timetable.html
    publisher: The Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: How a cron schedule such as @daily becomes a timetable in Airflow 3, and which run is created first when catchup is off.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: catchup-default
    prompt: In Airflow 3 you deploy a daily DAG with start_date one month ago and no catchup setting. How many runs does Airflow create for the past month?
    options:
      - { id: a, text: "About 30, one per missed day" }
      - { id: b, text: "One, for the most recent midnight: catchup is off by default in Airflow 3, so the earlier days are not backfilled" }
      - { id: c, text: "Exactly one for every day, but only on weekdays" }
    answer: b
    explanation: Catchup is off by default (scheduler.catchup_by_default=False), and the timetables documentation says the daily trigger timetable then creates a run for the most recent schedule time straight away. Set catchup=True on the DAG, or backfill deliberately, when you want the earlier days processed.
  - id: logical-date-use
    prompt: Your daily report task reads "today's" orders using datetime.now(). Why is the logical date better?
    options:
      - { id: a, text: "It is faster to compute" }
      - { id: b, text: "Each run then works on its own date, so a backfilled or re-run run for 3 January processes 3 January — not the day the re-run happens" }
      - { id: c, text: "datetime.now() is not allowed in Airflow" }
    answer: b
    explanation: A run's logical date says which date it is responsible for. Using it makes runs reproducible; using the clock makes every re-run process a different day.
  - id: end-date
    prompt: A DAG has start_date 1 January, end_date 5 January, schedule @daily and catchup=False, and it is deployed in November. What runs are created?
    options:
      - { id: a, text: "Five runs, 1–5 January" }
      - { id: b, text: "None: without catchup only the most recent schedule time would be run, and that is long after end_date" }
      - { id: c, text: "One run, today" }
    answer: b
    explanation: You will see exactly this in the lesson. Catchup would create the five past runs; without it, the only candidate is the most recent midnight, which is outside the DAG's dates.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with apache/airflow:slim-3.4.0-python3.12 (pinned by digest), after the previous lesson; the output shown was recorded from that run. Facts about logical dates, timetables and catchup were checked against the Airflow 3.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **schedule** tells Airflow when to create runs of a DAG; each scheduled run gets a **logical date** — the date it is responsible for — and **catchup** decides whether Airflow also creates the runs it missed in the past.

## Explain it like I'm twelve

A school newspaper comes out every day. Each issue has a date printed on top, and it is about that day — even if the printer was broken and issue 3 is printed a week late, it still says "3 January" and still tells the news of 3 January. If the printer was broken for a whole week, the editor decides: print all the missing issues (catch up), or just carry on from today.

The printed date is the **logical date**; printing the missing issues is **catchup**.

Where the analogy breaks: Airflow decides about catching up when the DAG is scheduled, not by asking an editor each time.

## What problem it solves

Daily jobs must process each day exactly once, even when they run late, are re-run after a bug fix, or are added long after the data started arriving. Tying each run to a logical date — instead of "whatever time it is now" — makes runs repeatable, and catchup or backfills fill in the history on purpose rather than by accident.

## How it works

![](media:airflow/catchup.svg)

- `schedule="@daily"` asks for a run at midnight each day, from `start_date` to `end_date` (if one is set).
- In Airflow 3 the default timetable for such a schedule triggers at those times, and each run's **logical date** is its trigger time (its data interval starts and ends there).
- With `catchup=True`, Airflow creates a run for every schedule time between `start_date` and now that has not run yet. Without it — the default in Airflow 3 — it runs only the most recent schedule time and skips the earlier ones.
- Inside a task, the logical date is available from the task's context.

## Try it yourself

> **Local lab** — continue with the `devforge-airflow` container from the previous lesson, from inside `airflow-lab`. If you opened a new terminal, set `AF` and define `af` again (steps 2–3 of the previous lesson). Every command is run automatically in DevForge's tests.

### 1. Two DAGs for the same five days

Both run daily from 1 to 5 January 2026 — dates that have passed. One catches up; the other does not:

```bash run
for catchup in True False; do
  name=$([ "$catchup" = True ] && echo daily_report || echo daily_report_no_catchup)
  cat > "dags/$name.py" <<EOF
from datetime import datetime
from airflow.sdk import dag, task

@dag(dag_id="$name", schedule="@daily", start_date=datetime(2026, 1, 1),
     end_date=datetime(2026, 1, 5), catchup=$catchup)
def $name():
    @task
    def report(**context):
        print("report for", context["logical_date"].date())

    report()

$name()
EOF
done
ls dags
```

```text output
daily_report.py
daily_report_no_catchup.py
orders_etl.py
```

The heredoc is not quoted here, so `$name` and `$catchup` are filled in: the loop writes two files that differ only in their name and `catchup`. `context["logical_date"]` is how the task finds out which day it is responsible for.

### 2. Watch catchup create the past runs

Airflow picks the new files up within seconds. Wait until all five catch-up runs have finished:

```bash run
for i in $(seq 1 180); do
  [ "$(af "$AF/api/v2/dags/daily_report/dagRuns?state=success" | grep -o '"dag_run_id"' | wc -l)" -ge 5 ] && break
  sleep 1
done
af "$AF/api/v2/dags/daily_report/dagRuns?order_by=logical_date" \
  | grep -o '"logical_date":"[^"]*"\|"run_type":"[a-z_]*"\|"state":"[a-z_]*"' | paste - - -
```

```text output
"logical_date":"2026-01-01T00:00:00Z"	"run_type":"scheduled"	"state":"success"
"logical_date":"2026-01-02T00:00:00Z"	"run_type":"scheduled"	"state":"success"
"logical_date":"2026-01-03T00:00:00Z"	"run_type":"scheduled"	"state":"success"
"logical_date":"2026-01-04T00:00:00Z"	"run_type":"scheduled"	"state":"success"
"logical_date":"2026-01-05T00:00:00Z"	"run_type":"scheduled"	"state":"success"
```

- Five **scheduled** runs, one per day from 1 to 5 January — although it is much later now. Each run's logical date is the midnight it stands for.
- `?state=success` and `?order_by=logical_date` filter and sort on the server.

### 3. And without catchup

```bash run
for i in $(seq 1 60); do af "$AF/api/v2/dags/daily_report_no_catchup" | grep -q '"dag_id"' && break; sleep 1; done
af "$AF/api/v2/dags/daily_report_no_catchup" | grep -o '"next_dagrun_run_after":[a-z0-9"]*'
af "$AF/api/v2/dags/daily_report_no_catchup/dagRuns" | grep -o '"total_entries":[0-9]*'
```

```text output
"next_dagrun_run_after":null
"total_entries":0
```

- The loop waits until Airflow has parsed the second file (the two files are not always picked up at the same moment).
- `next_dagrun_run_after` is `null`: Airflow has no future time at which to run this DAG.

No runs at all. Without catchup, Airflow skips the missed times and would only run the most recent one — last midnight — but that is long after the DAG's `end_date`. With no `end_date`, this DAG would get one run for last midnight straight away and then one a day.

**Keep the container running** for the next lesson.

## Try it in the simulation

Move time forward a day at a time and watch which runs the scheduler creates, then fill in the dates it skipped with a backfill. It is a labelled teaching model of Airflow's scheduler, not a real Airflow.

```simulation airflow-scheduler-timeline scenario=deployed-late
```

## Common mistakes

- **Expecting catchup by default.** Airflow 3 does not backfill missed schedule times (beyond the most recent one) unless the DAG sets `catchup=True`; older Airflow versions did, so older tutorials may say otherwise.
- **Using `datetime.now()` in a task.** A re-run or backfill would then process the wrong day; use the logical date.
- **A `start_date` that moves**, such as `datetime.now()`. The schedule needs a fixed starting point.
- **Turning catchup on for a DAG with a start date years ago.** Airflow will create a run for every missed time — possibly thousands.
- **Confusing the logical date with the time the run actually started.** A late or re-run run keeps its logical date.

## Where this fits in a real system

Daily and hourly DAGs load the previous period's data from **PostgreSQL** or **Kafka** into reports, and train models each night that are tracked in **MLflow**. When a bug is fixed, re-running the affected logical dates rebuilds exactly those days; monitoring in **Prometheus** and **Grafana** shows runs that are late or failing.
