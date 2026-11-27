---
id: airflow-idempotent-etl
title: Building an idempotent ETL
track: airflow
order: 6
level: intermediate
estimated_minutes: 45
prerequisites: [airflow-passing-data-between-tasks]
starts_fresh: true
learning_objectives:
  - Explain what makes a task idempotent, and why Airflow assumes tasks can be re-run safely.
  - Show an append-only load doubling its data when a run is re-run, and a partition-overwrite load staying correct.
  - Re-run a past run through the REST API by clearing its task instances.
  - Use the run's date (ds / data interval) instead of the current time, and handle corrected source data.
resources:
  - title: Best practices — writing a DAG (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/best-practices.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: 'States that tasks "should produce the same outcome on every re-run"; do not INSERT on re-runs (the page suggests UPSERT); read and write a specific partition, such as data_interval_start; never call datetime.now() inside a task.'
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: DAG runs — data intervals and re-running (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/dag-run.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Each run covers a data interval and has a logical date; clearing task instances re-runs them.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: definition
    prompt: What does "idempotent" mean for an ETL task?
    options:
      - { id: a, text: "It never fails" }
      - { id: b, text: "Running it once or many times for the same date leaves the target in the same state" }
      - { id: c, text: "It runs only once" }
    answer: b
    explanation: Retries, reruns after a fix and backfills all re-execute tasks; only idempotent tasks make that safe.
  - id: overwrite
    prompt: The source file for 2 January was corrected — one order was removed. Which load gets the warehouse right on rerun?
    options:
      - { id: a, text: "INSERT the file's rows again" }
      - { id: b, text: "Replace the day: delete that day's rows and insert the file's rows in one transaction" }
      - { id: c, text: "UPSERT each row by order ID" }
    answer: b
    explanation: An upsert updates and adds rows but never removes the one that disappeared from the source; replacing the partition does.
  - id: now
    prompt: A task loads "yesterday" using datetime.now() - 1 day. Why is that a problem?
    options:
      - { id: a, text: "It is slow" }
      - { id: b, text: "A rerun or backfill a week later loads the wrong day; the run's own date (ds or the data interval) stays the same however late the task runs" }
      - { id: c, text: "Time zones" }
    answer: b
    explanation: The lab's loads use ds, so re-running the 2 January run still loads 2 January.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/airflow:slim-3.4.0-python3.12 image (pinned by digest) running airflow standalone, starting from nothing, and its output is compared with this lesson. A SQLite file stands in for the warehouse, so no database server is needed; the same statements work on PostgreSQL. Checked against the Airflow 3.4.0 documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

Airflow re-runs tasks all the time — retries, reruns after a fix, backfills — so every load must be **idempotent**: for a given date it should **replace** that date's data, computed from **the run's date**, so that running it once or ten times gives the same result.

## Explain it like I'm twelve

The class keeps a scrapbook with one page per day. A careless helper who is asked to "do Tuesday again" glues Tuesday's photos onto the page a second time — now Tuesday has double the photos. A careful helper takes Tuesday's page out, makes a fresh one from the photos and puts it back. Ask the careful helper ten times and Tuesday still looks right.

## What problem it solves

Pipelines fail halfway, sources send corrections, and bugs are fixed after the fact. Each case ends with "run it again". If the load appends, every rerun inflates revenue and row counts — silently, until a dashboard looks wrong. Idempotent loads turn "run it again" from a risk into the normal way to repair data.

## How it works

![](media:airflow/idempotent-load.svg)

- **Use the run's date**: `ds` (the logical date as `YYYY-MM-DD`) or `data_interval_start` / `data_interval_end`, never `datetime.now()`. A rerun of the 2 January run must still process 2 January. With Airflow 3's default timetable a daily run's logical date is its trigger time (see *Schedules, logical dates and catchup*), so a run at midnight that should load the day before computes it from `ds` — still from the run, never from the clock.
- **Replace, don't append**: in one transaction, delete the target partition (`WHERE day = ds`) and insert the fresh rows — or write to a new partition and swap it in.
- **Upserts** (`INSERT … ON CONFLICT DO UPDATE`) handle repeated rows but not rows that vanished from the source.
- **Re-running** a run: clear its task instances (UI "Clear", `airflow tasks clear`, or the REST API's `clearTaskInstances`); Airflow runs them again with the same date.
- A manual run triggered with a `logical_date` gets that date as its `ds`; only one run may exist per DAG and logical date.

## Try it yourself

> **Local lab** — needs Docker. Airflow runs as `airflow standalone`, as in the previous lessons, with a `data` folder holding a raw file per day and a SQLite "warehouse". Every command is run automatically in DevForge's tests.

### 1. Raw data and two loads

```bash run
mkdir -p airflow-etl/dags airflow-etl/data/raw && cd airflow-etl
printf 'order_id,amount\nA-101,450\nA-102,120\nA-103,99\n' > data/raw/2026-01-02.csv
cat > dags/sales.py <<'EOF'
import csv, sqlite3
from datetime import datetime
from airflow.sdk import dag, get_current_context, task

RAW = "/opt/airflow/data/raw/{day}.csv"
WAREHOUSE = "/opt/airflow/data/warehouse.db"     # SQLite stands in for the warehouse

def read_day(day):
    with open(RAW.format(day=day)) as f:
        return [(row["order_id"], day, int(row["amount"])) for row in csv.DictReader(f)]

@dag(dag_id="sales_naive", schedule="@daily", start_date=datetime(2026, 1, 1), catchup=False)
def sales_naive():
    @task
    def load():
        day = get_current_context()["ds"]
        with sqlite3.connect(WAREHOUSE) as db:
            db.execute("CREATE TABLE IF NOT EXISTS sales_naive (order_id TEXT, day TEXT, amount INT)")
            db.executemany("INSERT INTO sales_naive VALUES (?, ?, ?)", read_day(day))   # appends every time
    load()

sales_naive()

@dag(dag_id="sales_idempotent", schedule="@daily", start_date=datetime(2026, 1, 1), catchup=False)
def sales_idempotent():
    @task
    def load():
        day = get_current_context()["ds"]                # the run's date, never datetime.now()
        rows = read_day(day)
        with sqlite3.connect(WAREHOUSE) as db:           # one transaction: replace the whole day
            db.execute("CREATE TABLE IF NOT EXISTS sales (order_id TEXT PRIMARY KEY, day TEXT, amount INT)")
            db.execute("DELETE FROM sales WHERE day = ?", (day,))
            db.executemany("INSERT INTO sales VALUES (?, ?, ?)", rows)
        return len(rows)
    load()

sales_idempotent()
EOF
python3 -m py_compile dags/sales.py && echo "DAG file is valid Python"
```

```text output
DAG file is valid Python
```

Both DAGs load the raw file for the run's day. `sales_naive` appends; `sales_idempotent` deletes that day's rows and inserts the file's rows inside one transaction (`with sqlite3.connect(...)` commits at the end, or rolls back on an error).

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
for dag in sales_naive sales_idempotent; do
  for i in $(seq 1 60); do af "$AF/api/v2/dags/$dag" | grep '"dag_id"' > /dev/null && break; sleep 1; done
done
af "$AF/api/v2/importErrors" | grep -o '"total_entries":[0-9]*'
```

```text output
"total_entries":0
```

As before, the container runs as your own user (`--user "$(id -u):0"`), so the warehouse file it creates in `data` belongs to you.

### 3. Load 2 January with both DAGs

```bash run
# trigger a run for a given logical date; print its run ID
trigger() { af -X POST -H 'Content-Type: application/json' -d "{\"logical_date\": \"$2T00:00:00Z\"}" "$AF/api/v2/dags/$1/dagRuns" \
  | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4; }
# wait until the run's load task has finished attempt number $3 and the scheduler has marked the whole run done
# (clearing a run the scheduler has not yet closed can be undone by it, leaving the task never rescheduled)
wait_try() {
  for i in $(seq 1 180); do
    ti=$(af "$AF/api/v2/dags/$1/dagRuns/$2/taskInstances/load")
    echo "$ti" | grep "\"try_number\":$3" > /dev/null && echo "$ti" | grep '"state":"success"' > /dev/null &&
      af "$AF/api/v2/dags/$1/dagRuns/$2" | grep '"state":"success"' > /dev/null && return 0
    sleep 1
  done
  echo "$1: attempt $3 did not succeed (last seen: $(echo "$ti" | grep -o '"try_number":[0-9]*\|"state":"[a-z_]*"' | tr '\n' ' '))"; return 1
}
totals() { docker exec -i devforge-airflow python - <<'PY'
import sqlite3
db = sqlite3.connect("/opt/airflow/data/warehouse.db")
for table in ["sales_naive", "sales"]:
    rows, revenue = db.execute(f"SELECT count(*), coalesce(sum(amount), 0) FROM {table} WHERE day = '2026-01-02'").fetchone()
    print(f"  {table:12} rows {rows}, revenue {revenue}")
PY
}
NAIVE=$(trigger sales_naive 2026-01-02)
IDEM=$(trigger sales_idempotent 2026-01-02)
wait_try sales_naive "$NAIVE" 1 && wait_try sales_idempotent "$IDEM" 1
echo "run ID: ${IDEM%%__*}__<time of triggering>"
echo "after the first run:"; totals
```

```text output
run ID: manual__<time of triggering>
after the first run:
  sales_naive  rows 3, revenue 669
  sales        rows 3, revenue 669
```

Each DAG got a manual run for logical date 2 January; inside the task, `ds` is `2026-01-02`, so both loaded that day's file. So far they agree. (A second run for the same DAG and logical date would be refused — reruns go through clearing, next.)

### 4. Re-run the same day

Clearing a run's task instances sets them back to be scheduled again — what you do after fixing a bug, or what a retry does automatically:

```bash run
rerun() { af -X POST -H 'Content-Type: application/json' \
  -d "{\"dry_run\": false, \"dag_run_id\": \"$2\", \"reset_dag_runs\": true, \"only_failed\": false}" \
  "$AF/api/v2/dags/$1/clearTaskInstances" | grep -o '"task_id":"[a-z_]*"' | sed "s/^/  cleared $1: /"; }
rerun sales_naive "$NAIVE"
rerun sales_idempotent "$IDEM"
wait_try sales_naive "$NAIVE" 2 && wait_try sales_idempotent "$IDEM" 2
echo "after re-running the same day:"; totals
```

```text output
  cleared sales_naive: "task_id":"load"
  cleared sales_idempotent: "task_id":"load"
after re-running the same day:
  sales_naive  rows 6, revenue 1338
  sales        rows 3, revenue 669
```

The append-only load counted 2 January twice: six rows, double the revenue — and nothing failed, so no alert fired. The idempotent load replaced the day and still shows the true figures.

### 5. The source is corrected

The shop reports that order `A-102` was cancelled and `A-103` was really 109:

```bash run
printf 'order_id,amount\nA-101,450\nA-103,109\n' > data/raw/2026-01-02.csv
rerun sales_naive "$NAIVE" > /dev/null
rerun sales_idempotent "$IDEM" > /dev/null
wait_try sales_naive "$NAIVE" 3 && wait_try sales_idempotent "$IDEM" 3
echo "after the corrected file:"; totals
```

```text output
after the corrected file:
  sales_naive  rows 8, revenue 1897
  sales        rows 2, revenue 559
```

- The idempotent load now matches the corrected source exactly: two orders, 450 + 109 = 559.
- The naive table is beyond repair without manual clean-up — it still holds the cancelled order twice and the old amounts.
- An upsert by `order_id` would have fixed the amount of `A-103` but kept the cancelled `A-102`. Replacing the whole partition is what makes deletions in the source flow through.

### 6. Clean up

```bash run
docker rm -f devforge-airflow > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **`INSERT` without a key or a partition overwrite.** Every retry, rerun or backfill duplicates data.
- **`datetime.now()` or "latest file" inside a task.** A rerun next week processes the wrong day; use `ds` or the data interval.
- **Deleting in one transaction and inserting in another.** A failure in between leaves the day empty; do both in one transaction.
- **Side effects that cannot be repeated** — emails, payments, API calls that create things. Make them check first (an idempotency key) or move them to a separate, guarded task.
- **Relying on "it only runs once".** Retries alone guarantee it won't.

## Where this fits in a real system

The same pattern scales from SQLite to **PostgreSQL** (`DELETE … WHERE day = %s` plus `INSERT`, or `INSERT … ON CONFLICT`), to warehouse partitions (`INSERT OVERWRITE PARTITION`), and to object storage (write `day=2026-01-02/` then replace it). Events arriving through **Kafka** need the same thinking — at-least-once delivery means consumers must tolerate repeats. The next lesson backfills a whole range of days, which is only safe because each day's load is idempotent.
