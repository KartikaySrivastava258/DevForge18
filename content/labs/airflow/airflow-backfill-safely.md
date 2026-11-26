---
id: airflow-backfill-safely
title: Backfill a date range safely
track: airflow
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [airflow-schedules-and-catchup]
objectives:
  - Backfill a date range through Airflow's REST API and wait for the backfill to complete.
  - Show that a task which appends output duplicates data when a date is backfilled again.
  - Make the task idempotent — one output per logical date, replaced on every run — and prove a re-run changes nothing.
checkpoints:
  - { id: duplicates, text: "After the second backfill, the appending DAG had every date twice" }
  - { id: idempotent, text: "The fixed DAG gave the same three lines after two backfills" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Backfill
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/backfill.html
    publisher: Apache Airflow documentation (3.4.0)
    type: documentation
    level: intermediate
    official: true
    why: Creating backfills from the CLI or REST API, and the three reprocessing behaviours.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with apache/airflow:slim-3.4.0-python3.12 (pinned by digest) in standalone mode, after the previous lessons, and their output is compared with this page. The reprocessing behaviours were checked against the Airflow 3.4.0 documentation on 2026-11-26. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 2
---

## Goal

A DAG counts each day's sign-ups. You backfill three days of history — then a bug fix means backfilling them **again**. The first version of the task appends its result, so the second backfill doubles the data. You rewrite the task so each run **replaces** the output for its own logical date, and prove that backfilling twice now gives exactly the same result.

## Before you start

Continue from *Schedules, logical dates and catchup*: Airflow running in the container `devforge-airflow`, your terminal in `airflow-lab`, and `AF` and the `af` function defined (define them again from the first lesson if you opened a new terminal).

## Steps

### 1. Some data, and a task that appends

```bash run
mkdir -p dags/data
printf 'date,student\n2026-01-01,asha\n2026-01-01,ravi\n2026-01-02,meera\n2026-01-03,nikhil\n2026-01-03,sara\n2026-01-03,tom\n' > dags/data/signups.csv
cat > dags/daily_signups_v1.py <<'EOF'
from datetime import datetime

from airflow.sdk import dag, task


@dag(schedule="@daily", start_date=datetime(2026, 1, 1), end_date=datetime(2026, 1, 31), catchup=False)
def daily_signups_v1():
    @task
    def count(ds=None):
        rows = open("/opt/airflow/dags/data/signups.csv").read().splitlines()[1:]
        n = sum(1 for row in rows if row.startswith(ds + ","))
        with open("/tmp/totals.csv", "a") as out:  # "a" appends: every run adds a line
            out.write(f"{ds},{n}\n")

    count()


daily_signups_v1()
EOF
for i in $(seq 1 60); do af "$AF/api/v2/dags/daily_signups_v1" | grep -q '"dag_id"' && break; sleep 1; done
af "$AF/api/v2/dags/daily_signups_v1" | grep -o '"dag_id":"[a-z0-9_]*"'
```

```text output
"dag_id":"daily_signups_v1"
```

- `ds` is the run's logical date as `YYYY-MM-DD`, so each run counts *its own* day — the habit from the previous lesson.
- The result goes to `/tmp` inside the container. The task runs as Airflow's own user, which may not be allowed to write into your `dags` folder.
- `end_date` stops the schedule after January, so the only runs are the ones you ask for.

### 2. Backfill three days

A backfill is created with `POST /api/v2/backfills`. It answers with an `id`; the backfill has finished when its `completed_at` is set.

```bash run
backfill() {  # usage: backfill <dag_id> <none|failed|completed>
  local id="" reply
  # Airflow refuses a new backfill while one for the same DAG is still finishing; try again for a while.
  for i in $(seq 1 30); do
    reply=$(af -X POST -H 'Content-Type: application/json' \
      -d "{\"dag_id\":\"$1\",\"from_date\":\"2026-01-01T00:00:00Z\",\"to_date\":\"2026-01-03T00:00:00Z\",\"reprocess_behavior\":\"$2\",\"max_active_runs\":1}" \
      "$AF/api/v2/backfills")
    id=$(echo "$reply" | grep -o '"id":[0-9]*' | head -n 1 | cut -d: -f2 || true)
    [ -n "$id" ] && break
    sleep 2
  done
  [ -n "$id" ] || { echo "Airflow did not start the backfill: $reply"; return 1; }
  for i in $(seq 1 180); do
    af "$AF/api/v2/backfills/$id" | grep -q '"completed_at":"' && break
    sleep 1
  done
  echo "backfill of $1 ($2) completed"
}
backfill daily_signups_v1 none
af "$AF/api/v2/dags/daily_signups_v1/dagRuns" | grep -o '"dag_run_id":"[^"]*"\|"state":"[a-z]*"' | paste - -
docker exec devforge-airflow cat /tmp/totals.csv
```

```text output
backfill of daily_signups_v1 (none) completed
"dag_run_id":"backfill__2026-01-01T00:00:00+00:00"	"state":"success"
"dag_run_id":"backfill__2026-01-02T00:00:00+00:00"	"state":"success"
"dag_run_id":"backfill__2026-01-03T00:00:00+00:00"	"state":"success"
2026-01-01,2
2026-01-02,1
2026-01-03,3
```

Three runs, one per logical date, each counting its own day. Correct — so far.

### 3. Backfill again

Suppose the counting logic was fixed and every day must be recomputed. `reprocess_behavior` decides which dates get a new run: `none` only fills **missing** dates, `failed` also re-runs failed ones, `completed` re-runs **all** of them.

```bash run
backfill daily_signups_v1 completed
docker exec devforge-airflow cat /tmp/totals.csv
echo "--- dates that appear more than once:"
docker exec devforge-airflow cut -d, -f1 /tmp/totals.csv | sort | uniq -d
```

```text output
backfill of daily_signups_v1 (completed) completed
2026-01-01,2
2026-01-02,1
2026-01-03,3
2026-01-01,2
2026-01-02,1
2026-01-03,3
--- dates that appear more than once:
2026-01-01
2026-01-02
2026-01-03
```

Every run succeeded, and the data is now wrong: anything that sums this file counts twelve sign-ups instead of six. Airflow did exactly what it was asked — it is the **task** that is not safe to run twice.

### 4. Make the task idempotent

A task is **idempotent** when running it again for the same logical date gives the same result. The usual way: each run writes *its own* output, keyed by the logical date, and replaces it.

```bash run
cat > dags/daily_signups_v2.py <<'EOF'
from datetime import datetime
from pathlib import Path

from airflow.sdk import dag, task


@dag(schedule="@daily", start_date=datetime(2026, 1, 1), end_date=datetime(2026, 1, 31), catchup=False)
def daily_signups_v2():
    @task
    def count(ds=None):
        rows = open("/opt/airflow/dags/data/signups.csv").read().splitlines()[1:]
        n = sum(1 for row in rows if row.startswith(ds + ","))
        out = Path("/tmp/signups") / f"{ds}.csv"  # one file per logical date
        out.parent.mkdir(exist_ok=True)
        out.write_text(f"{ds},{n}\n")  # write_text replaces the file

    count()


daily_signups_v2()
EOF
for i in $(seq 1 60); do af "$AF/api/v2/dags/daily_signups_v2" | grep -q '"dag_id"' && break; sleep 1; done
backfill daily_signups_v2 none
backfill daily_signups_v2 completed
docker exec devforge-airflow sh -c 'cat /tmp/signups/*.csv'
```

```text output
backfill of daily_signups_v2 (none) completed
backfill of daily_signups_v2 (completed) completed
2026-01-01,2
2026-01-02,1
2026-01-03,3
```

Two backfills, the same three lines. The second run for each date overwrote the first run's file instead of adding to it. In a database, the same idea is "delete this date's rows, then insert" inside one transaction, or an upsert keyed by the date.

## Check your work

Run this inside `airflow-lab` while Airflow is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
AF=http://127.0.0.1:8095
password=$(docker exec devforge-airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated 2> /dev/null | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
check "the idempotent DAG file exists" '[ -f dags/daily_signups_v2.py ]'
check "it does not append to its output" '! grep -qE "open\([^)]*\"a\"" dags/daily_signups_v2.py'
check "Airflow has loaded daily_signups_v2" 'af "$AF/api/v2/dags/daily_signups_v2" | grep -q "\"dag_id\":\"daily_signups_v2\""'
check "it has a successful run for each of the three dates" '[ "$(af "$AF/api/v2/dags/daily_signups_v2/dagRuns?state=success" | grep -o "\"dag_run_id\":\"backfill__2026-01-0[123]" | sort -u | wc -l)" = 3 ]'
check "its output has one line per date with the right counts" '[ "$(docker exec devforge-airflow sh -c "cat /tmp/signups/*.csv" | sort | tr "\n" " ")" = "2026-01-01,2 2026-01-02,1 2026-01-03,3 " ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the idempotent DAG file exists
PASS: it does not append to its output
PASS: Airflow has loaded daily_signups_v2
PASS: it has a successful run for each of the three dates
PASS: its output has one line per date with the right counts
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-airflow
```

```text output
devforge-airflow
```

## Reset

Remove the container (as above), start Airflow again with step 2 of *DAGs, tasks and the REST API*, then begin this lab at step 1.

## What you practised

Airflow will run a task again whenever you backfill, clear or retry it, so the task must be safe to repeat. Key every output by the logical date and replace it — then a backfill with `completed` is a routine repair, not a data incident.
