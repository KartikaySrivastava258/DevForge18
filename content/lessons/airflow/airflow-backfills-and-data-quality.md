---
id: airflow-backfills-and-data-quality
title: Backfills and data-quality checks
track: airflow
order: 7
level: advanced
estimated_minutes: 50
prerequisites: [airflow-idempotent-etl]
starts_fresh: true
learning_objectives:
  - Structure a load as write, audit, publish, so that data that fails its checks never reaches the table people use.
  - Write data-quality checks as tasks that fail the run with a clear reason (AirflowFailException).
  - Backfill a date range through the REST API, and re-process only failed dates with reprocess_behavior.
  - Explain why backfills are only safe when every task is idempotent.
resources:
  - title: Backfill (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/backfill.html
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: 'Backfills from the UI, CLI and REST API; reprocess behaviour none (missing runs), failed (missing and errored runs) and completed (all runs); a backfill''s own max_active_runs.'
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Tasks — special exceptions (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/tasks.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: AirflowFailException marks the task failed and ignores remaining retries — right for a quality check, which a retry cannot fix.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Best practices — writing a DAG (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/best-practices.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Tasks should produce the same outcome on every re-run, and should not leave incomplete data at the end of a task — the basis for staging and publishing.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: wap
    prompt: Why load into a staging table and publish after the checks, instead of checking the final table?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "Bad data is caught before anyone can read it; checking the final table means dashboards and other jobs may already have used it" }
      - { id: c, text: "Airflow requires it" }
    answer: b
    explanation: This pattern is often called write–audit–publish. In the lab, 3 January's duplicates and negative amount never reached the sales table.
  - id: reprocess
    prompt: A four-day backfill finished with one failed day. You fixed the source. Which reprocess behaviour re-runs only that day?
    options:
      - { id: a, text: "none" }
      - { id: b, text: "failed — it creates runs for missing dates and re-runs dates whose run failed; successful days are left alone" }
      - { id: c, text: "completed" }
    answer: b
    explanation: none would skip the date because a run exists; completed would re-run all four days.
  - id: check-failure
    prompt: Should a data-quality check retry on failure?
    options:
      - { id: a, text: "Yes, three times" }
      - { id: b, text: "No — the data will be just as wrong on the next attempt; fail at once with AirflowFailException and a message that says what is wrong" }
      - { id: c, text: "Only on weekends" }
    answer: b
    explanation: Retries are for transient errors (network, locks), not for wrong data.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/airflow:slim-3.4.0-python3.12 image (pinned by digest) running airflow standalone, starting from nothing, and its output is compared with this lesson. A SQLite file stands in for the warehouse. Checked against the Airflow 3.4.0 documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

Load each day in three steps — **write** it to staging, **audit** it with quality checks, **publish** it only if the checks pass — and use **backfills** to process ranges of past days, re-processing only the **failed** ones after a fix.

## Explain it like I'm twelve

Before the school magazine goes to print, each article goes into a "draft" tray, an editor checks it for mistakes, and only checked articles go to the printer. If one article had mistakes, it stays out of this issue; once the writer fixes it, only that article needs checking again — not the whole magazine.

## What problem it solves

New pipelines need history ("load all of last month"), and fixed pipelines need repairs ("re-load the days the bug affected"). Without checks, a bad source file — duplicated rows, impossible values — flows straight into reports. Without targeted reprocessing, one bad day forces re-running everything. Write–audit–publish plus selective backfills keep bad data out and repairs small.

## How it works

![](media:airflow/write-audit-publish.svg)

- **Write**: replace the day in a **staging** table (idempotent, as in the previous lesson).
- **Audit**: query staging for the day — row count, duplicate keys, impossible values, totals against a control figure — and raise `AirflowFailException("…what is wrong…")` on any problem.
- **Publish**: replace the day in the table everyone reads, from staging. It runs only if the audit succeeded; otherwise it is `upstream_failed`.
- **Backfill** (`POST /api/v2/backfills` with `dag_id`, `from_date`, `to_date`): creates a run for each schedule date in the range; `max_active_runs` limits how many run at once; `reprocess_behavior` decides what happens to dates that already have runs — `none` (skip them), `failed` (re-run failed ones), `completed` (re-run all).

## Try it yourself

> **Local lab** — needs Docker. Airflow runs as `airflow standalone` with a `data` folder holding one raw file per day and a SQLite "warehouse". Every command is run automatically in DevForge's tests.

### 1. Four days of data — one of them bad — and a write–audit–publish DAG

```bash run
mkdir -p airflow-quality/dags airflow-quality/data/raw && cd airflow-quality
printf 'order_id,amount\nA-1,100\nA-2,250\n'          > data/raw/2026-01-01.csv
printf 'order_id,amount\nB-1,80\nB-2,40\nB-3,120\n'   > data/raw/2026-01-02.csv
printf 'order_id,amount\nC-1,300\nC-1,300\nC-2,-75\n' > data/raw/2026-01-03.csv   # a duplicate and a negative amount
printf 'order_id,amount\nD-1,60\n'                    > data/raw/2026-01-04.csv
cat > dags/daily_revenue.py <<'EOF'
import csv, sqlite3
from datetime import datetime
from airflow.exceptions import AirflowFailException
from airflow.sdk import dag, get_current_context, task

RAW = "/opt/airflow/data/raw/{day}.csv"
WAREHOUSE = "/opt/airflow/data/warehouse.db"

def connect():
    db = sqlite3.connect(WAREHOUSE)
    db.execute("CREATE TABLE IF NOT EXISTS staging (order_id TEXT, day TEXT, amount INT)")
    db.execute("CREATE TABLE IF NOT EXISTS sales (order_id TEXT, day TEXT, amount INT)")
    return db

@dag(dag_id="daily_revenue", schedule="@daily", start_date=datetime(2026, 1, 1), end_date=datetime(2026, 1, 31),
     catchup=False, max_active_runs=1)
def daily_revenue():
    @task
    def write():                                   # 1. replace the day in staging
        day = get_current_context()["ds"]
        with open(RAW.format(day=day)) as f:
            rows = [(r["order_id"], day, int(r["amount"])) for r in csv.DictReader(f)]
        with connect() as db:
            db.execute("DELETE FROM staging WHERE day = ?", (day,))
            db.executemany("INSERT INTO staging VALUES (?, ?, ?)", rows)

    @task
    def audit():                                   # 2. check staging before anyone can see it
        day = get_current_context()["ds"]
        with connect() as db:
            rows, dupes, negative = db.execute(
                "SELECT count(*), count(*) - count(DISTINCT order_id), coalesce(sum(amount < 0), 0)"
                " FROM staging WHERE day = ?", (day,)).fetchone()
        problems = [text for text, bad in [("no rows", rows == 0),
                                           (f"{dupes} duplicate order IDs", dupes),
                                           (f"{negative} negative amounts", negative)] if bad]
        if problems:
            raise AirflowFailException(f"quality check failed for {day}: " + ", ".join(problems))

    @task
    def publish():                                 # 3. only checked data reaches the sales table
        day = get_current_context()["ds"]
        with connect() as db:
            db.execute("DELETE FROM sales WHERE day = ?", (day,))
            db.execute("INSERT INTO sales SELECT * FROM staging WHERE day = ?", (day,))

    write() >> audit() >> publish()

daily_revenue()
EOF
python3 -m py_compile dags/daily_revenue.py && echo "DAG file is valid Python"
```

```text output
DAG file is valid Python
```

- `end_date` stops the schedule after January, so the scheduler does not add a run for today while you work with past days. (With catchup off, an active DAG otherwise gets a run for the most recent schedule time.)
- `max_active_runs=1` keeps one day at a time, in order.

### 2. Start Airflow

```bash run
IMAGE=apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-airflow --user "$(id -u):0" -p 127.0.0.1:8095:8080 \
  -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/data:/opt/airflow/data" \
  -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -e AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION=False \
  -e AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL=5 \
  "$IMAGE" standalone > /dev/null
AF=http://127.0.0.1:8095
for i in $(seq 1 180); do curl -sf -o /dev/null "$AF/api/v2/monitor/health" && break; sleep 1; done
for i in $(seq 1 60); do docker exec devforge-airflow test -f /opt/airflow/simple_auth_manager_passwords.json.generated && break; sleep 1; done
password=$(docker exec devforge-airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
for i in $(seq 1 60); do af "$AF/api/v2/dags/daily_revenue" | grep '"dag_id"' > /dev/null && break; sleep 1; done
echo "runs so far: $(af "$AF/api/v2/dags/daily_revenue/dagRuns" | grep -o '"total_entries":[0-9]*')"
```

```text output
runs so far: "total_entries":0
```

### 3. Backfill the first four days of January

```bash run
backfill() {
  local id
  id=$(af -X POST -H 'Content-Type: application/json' \
    -d "{\"dag_id\": \"daily_revenue\", \"from_date\": \"2026-01-01T00:00:00Z\", \"to_date\": \"2026-01-04T00:00:00Z\",
         \"reprocess_behavior\": \"$1\", \"max_active_runs\": 1}" \
    "$AF/api/v2/backfills" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2)
  for i in $(seq 1 300); do af "$AF/api/v2/backfills/$id" | grep '"completed_at":"' > /dev/null && break; sleep 1; done
  af "$AF/api/v2/backfills/$id" | grep '"completed_at":"' > /dev/null && echo "backfill ($1) completed"
}
# one line per run: date, state, and how many times its write task has run
runs() {
  for run in $(af "$AF/api/v2/dags/daily_revenue/dagRuns?order_by=logical_date" | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4); do
    state=$(af "$AF/api/v2/dags/daily_revenue/dagRuns/$run" | grep -o '"state":"[a-z_]*"' | head -n 1 | cut -d'"' -f4) || state="?"
    tries=$(af "$AF/api/v2/dags/daily_revenue/dagRuns/$run/taskInstances/write" | grep -o '"try_number":[0-9]*' | cut -d: -f2) || tries="?"
    echo "  ${run#backfill__}" | cut -c1-12 | tr -d '\n'; echo "  $state (write ran $tries time(s))"
  done
}
published() { docker exec -i devforge-airflow python - <<'PY'
import sqlite3
db = sqlite3.connect("/opt/airflow/data/warehouse.db")
for day, rows, revenue in db.execute("SELECT day, count(*), sum(amount) FROM sales GROUP BY day ORDER BY day"):
    print(f"  {day}: {rows} order{'s' if rows != 1 else ''}, revenue {revenue}")
PY
}
backfill none
runs
echo "published:"; published
```

```text output
backfill (none) completed
  2026-01-01  success (write ran 1 time(s))
  2026-01-02  success (write ran 1 time(s))
  2026-01-03  failed (write ran 1 time(s))
  2026-01-04  success (write ran 1 time(s))
published:
  2026-01-01: 2 orders, revenue 350
  2026-01-02: 3 orders, revenue 240
  2026-01-04: 1 order, revenue 60
```

The backfill created one run per day. 3 January failed — and is simply **absent** from the published table: its bad rows reached staging but never `sales`. Where did it stop, and why?

```bash run
RUN="backfill__2026-01-03T00:00:00+00:00"
af "$AF/api/v2/dags/daily_revenue/dagRuns/$RUN/taskInstances" | grep -o '"task_id":"[a-z]*"\|"state":"[a-z_]*"' | paste - - | sort
af "$AF/api/v2/dags/daily_revenue/dagRuns/$RUN/taskInstances/audit/logs/1?full_content=true" \
  | grep -o 'quality check failed for 2026[^"\\]*' | head -n 1
```

```text output
"task_id":"audit"	"state":"failed"
"task_id":"publish"	"state":"upstream_failed"
"task_id":"write"	"state":"success"
quality check failed for 2026-01-03: 1 duplicate order IDs, 1 negative amounts
```

`write` succeeded, `audit` failed with a message that says exactly what is wrong (read here from the task's log through the API), and `publish` never ran (`upstream_failed`). Backfill run IDs are `backfill__` plus the logical date.

### 4. Fix the source, re-process only the failed day

The shop sends a corrected file: `C-1` once, and `C-2` was 75, not −75.

```bash run
printf 'order_id,amount\nC-1,300\nC-2,75\n' > data/raw/2026-01-03.csv
backfill failed
runs
echo "published:"; published
```

```text output
backfill (failed) completed
  2026-01-01  success (write ran 1 time(s))
  2026-01-02  success (write ran 1 time(s))
  2026-01-03  success (write ran 2 time(s))
  2026-01-04  success (write ran 1 time(s))
published:
  2026-01-01: 2 orders, revenue 350
  2026-01-02: 3 orders, revenue 240
  2026-01-03: 2 orders, revenue 375
  2026-01-04: 1 order, revenue 60
```

With `reprocess_behavior: failed`, the backfill ran 3 January again and left the three good days alone — their `write` tasks still ran only once. Had you used `completed`, all four days would have been processed again; that is safe here only because every task replaces its day.

### 5. Clean up

```bash run
docker rm -f devforge-airflow > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Checking after publishing.** Consumers may read bad data before the check fails; check staging, then publish.
- **Vague failures** ("check failed"). Say what failed and for which date, so the fix is obvious from the alert.
- **Retrying quality checks.** Wrong data stays wrong; fail with `AirflowFailException`.
- **Backfilling non-idempotent DAGs.** Every repeated day is duplicated; fix the load first (previous lesson).
- **Unbounded backfills.** A year of runs at full concurrency can overload sources and warehouses; set `max_active_runs`.

## Where this fits in a real system

The audit step often uses dedicated tools — SQL check operators from Airflow's common SQL provider, or data-quality frameworks — against **PostgreSQL** or a warehouse, and failures go to the alert path from *Timeouts and failure callbacks*. Data that flows in from **Kafka** gets the same checks before it is published, and **MLflow** training jobs should read only published, checked tables. The same "check before promote" idea appears in **GitHub Actions** environments with required reviewers.
