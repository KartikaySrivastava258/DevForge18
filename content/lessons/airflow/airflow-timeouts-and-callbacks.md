---
id: airflow-timeouts-and-callbacks
title: Timeouts and failure callbacks
track: airflow
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [airflow-retries-and-failures]
starts_fresh: true
learning_objectives:
  - Stop a hanging task with execution_timeout and a whole run with dagrun_timeout, and read the resulting states.
  - React to failures and retries with on_failure_callback and on_retry_callback, at task and DAG level.
  - Fail a task at once, skipping its retries, with AirflowFailException when retrying cannot help.
  - Decide which timeout and which alert belong where in a production DAG.
resources:
  - title: Tasks — timeouts and special exceptions (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/tasks.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: execution_timeout raises AirflowTaskTimeout (the task supervisor also enforces it from outside the task process); AirflowFailException fails a task ignoring remaining retries.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Callbacks (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/administration-and-deployment/logging-monitoring/callbacks.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The five callback types (success, failure, retry, execute, skipped), which apply to DAGs and which to tasks, the context passed to them, and Deadline Alert callbacks.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: which-timeout
    prompt: A task that calls a slow warehouse sometimes hangs for hours. Which setting stops it?
    options:
      - { id: a, text: "retries" }
      - { id: b, text: "execution_timeout on that task — each attempt is stopped with AirflowTaskTimeout, and retries then apply as usual" }
      - { id: c, text: "schedule" }
    answer: b
    explanation: dagrun_timeout limits the whole run; execution_timeout limits one attempt of one task.
  - id: fail-fast
    prompt: The input file is empty. Retrying will not change that. What should the task do?
    options:
      - { id: a, text: "Raise any exception and let the three retries run" }
      - { id: b, text: "Raise AirflowFailException — the task fails at once, without using its retries" }
      - { id: c, text: "Return None" }
    answer: b
    explanation: The lab's validate task fails on try 1 despite retries=3.
  - id: callback
    prompt: Where should a failure alert run, and what must it never do?
    options:
      - { id: a, text: "In the task code; it may raise to fail the task" }
      - { id: b, text: "In on_failure_callback (or a notifier), invoked once the task has failed; keep it short and reliable — it reports the outcome, it should not do the work or decide the state" }
      - { id: c, text: "In the scheduler configuration" }
    answer: b
    explanation: Keep callbacks small and reliable — send a message, write a record — and put real work in tasks, where retries and timeouts apply.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/airflow:slim-3.4.0-python3.12 image (pinned by digest) running airflow standalone, starting from nothing, and its output is compared with this lesson. Callbacks write to a mounted folder so their effect can be checked. Checked against the Airflow 3.4.0 documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Retries handle failures that go away; **timeouts** handle work that never finishes (`execution_timeout` per task attempt, `dagrun_timeout` per run); **callbacks** tell people or systems when something failed; and **`AirflowFailException`** skips retries that cannot help.

## Explain it like I'm twelve

At a school sports day each race has a **stopwatch limit**: a runner who has not finished in 3 minutes is stopped — that is `execution_timeout`. The whole sports day must end by 4 pm whatever happens — `dagrun_timeout`. When a runner drops out, a teacher **phones the parents** — a callback. And if a runner turns up with a broken leg, they don't get "three more tries" — they are out straight away: `AirflowFailException`.

## What problem it solves

A task that hangs is worse than one that fails: it holds a worker slot, blocks downstream tasks, and nobody is told. Without timeouts, a stuck run can sit for days; without callbacks, a failure is noticed only when someone asks where the report is. Production DAGs need both, plus a way to stop wasting retries on errors that will not fix themselves.

## How it works

![](media:airflow/timeouts-and-callbacks.svg)

- **`execution_timeout`** (a `timedelta`, per task): each attempt that runs longer raises `AirflowTaskTimeout`. The task then follows its retry rules like any other failure. The task supervisor also enforces it from outside the task process, so even code stuck in native libraries is stopped.
- **`dagrun_timeout`** (per DAG): a run still going after this long is marked **failed**; its unfinished tasks are stopped.
- **Callbacks**: `on_failure_callback`, `on_retry_callback`, `on_success_callback`, `on_execute_callback` and `on_skipped_callback` receive a context (task instance, run, exception…). Task callbacks run with the task; DAG callbacks run when the run finishes, with a `reason` such as `timed_out`.
- **`AirflowFailException`** fails at once, ignoring retries; **`AirflowSkipException`** marks the task skipped.

## Try it yourself

> **Local lab** — needs Docker. Airflow runs as `airflow standalone` in a container, as in *DAGs, tasks and runs*, with one more shared folder, `alerts`, where the callbacks write. Every command is run automatically in DevForge's tests.

### 1. Two DAGs with timeouts and callbacks

```bash run
mkdir -p airflow-alerts/dags airflow-alerts/alerts && cd airflow-alerts
cat > dags/nightly_export.py <<'EOF'
import time
from datetime import datetime, timedelta
from airflow.exceptions import AirflowFailException
from airflow.sdk import dag, task

def note(kind, context):
    ti = context["ti"]
    with open("/opt/airflow/alerts/alerts.log", "a") as f:
        f.write(f"{kind} {ti.task_id} try {ti.try_number}: {type(context.get('exception')).__name__}\n")

@dag(dag_id="nightly_export", schedule=None, start_date=datetime(2026, 1, 1), catchup=False,
     default_args={"retries": 1, "retry_delay": timedelta(seconds=1),
                   "on_retry_callback": lambda ctx: note("RETRY ", ctx),
                   "on_failure_callback": lambda ctx: note("FAILED", ctx)})
def nightly_export():
    @task(execution_timeout=timedelta(seconds=3))
    def export():
        time.sleep(30)               # the warehouse is hanging

    @task(retries=3)
    def validate():
        raise AirflowFailException("input file is empty: retrying will not help")

    export()
    validate()

nightly_export()
EOF
cat > dags/slow_report.py <<'EOF'
import time
from datetime import datetime, timedelta
from airflow.sdk import dag, task

def run_failed(context):
    with open("/opt/airflow/alerts/alerts.log", "a") as f:
        f.write(f"RUN FAILED {context['dag_run'].dag_id}: reason={context.get('reason')}\n")

@dag(dag_id="slow_report", schedule=None, start_date=datetime(2026, 1, 1), catchup=False,
     dagrun_timeout=timedelta(seconds=10), on_failure_callback=run_failed)
def slow_report():
    @task
    def build():
        time.sleep(60)               # no execution_timeout here: only the run's limit applies
    build()

slow_report()
EOF
python3 -m py_compile dags/*.py && echo "both DAG files are valid Python"
```

```text output
both DAG files are valid Python
```

- `nightly_export` gives every task one retry and two callbacks through `default_args`. `export` may run 3 seconds per attempt; `validate` has 3 retries but fails in a way retries cannot fix.
- `slow_report` has no task timeout, only a 10-second limit for the whole run, and a DAG-level failure callback.
- The callbacks append a line to `alerts/alerts.log`, standing in for a chat message or a ticket.

### 2. Start Airflow and get a token

```bash run
IMAGE=apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-airflow --user "$(id -u):0" -p 127.0.0.1:8095:8080 -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/alerts:/opt/airflow/alerts" \
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
for dag in nightly_export slow_report; do
  for i in $(seq 1 60); do af "$AF/api/v2/dags/$dag" | grep '"dag_id"' > /dev/null && break; sleep 1; done
done
af "$AF/api/v2/importErrors" | grep -o '"total_entries":[0-9]*'
```

```text output
"total_entries":0
```

The same start-up as in the first Airflow lesson; both DAGs were parsed without import errors. The container runs as your own user ID (`--user "$(id -u):0"`; the image accepts any user ID as long as the group is 0), so the files Airflow writes into the shared folders belong to you and you can edit or delete them.

### 3. A hanging task and a hopeless one

```bash run
run_dag() {
  local dag=$1 run state
  run=$(af -X POST -H 'Content-Type: application/json' -d '{"logical_date": null}' "$AF/api/v2/dags/$dag/dagRuns" \
    | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4)
  for i in $(seq 1 180); do
    state=$(af "$AF/api/v2/dags/$dag/dagRuns/$run" | grep -o '"state":"[a-z_]*"' | head -n 1 | cut -d'"' -f4)
    [ "$state" = success ] || [ "$state" = failed ] && break
    sleep 1
  done
  echo "$run"
}
tasks() { af "$AF/api/v2/dags/$1/dagRuns/$2/taskInstances" | grep -o '"task_id":"[a-z_]*"\|"state":"[a-z_]*"\|"try_number":[0-9]*' | paste - - - | sort; }
RUN=$(run_dag nightly_export)
af "$AF/api/v2/dags/nightly_export/dagRuns/$RUN" | grep -o '"state":"[a-z_]*"' | head -n 1
tasks nightly_export "$RUN"
echo "--- alerts.log"
grep ' export ' alerts/alerts.log
grep ' validate ' alerts/alerts.log
```

```text output
"state":"failed"
"task_id":"export"	"state":"failed"	"try_number":2
"task_id":"validate"	"state":"failed"	"try_number":1
--- alerts.log
RETRY  export try 1: AirflowTaskTimeout
FAILED export try 2: AirflowTaskTimeout
FAILED validate try 1: AirflowFailException
```

- `export` was stopped after 3 seconds with `AirflowTaskTimeout`, retried once (the retry callback fired), timed out again, and failed (the failure callback fired) — two attempts instead of a 30-second hang.
- `validate` had 3 retries but used none: `AirflowFailException` failed it on try 1.
- The alerts are grouped by task here (`grep`), because the two tasks run at the same time and their lines can interleave.

### 4. A run that takes too long

```bash run
RUN=$(run_dag slow_report)
af "$AF/api/v2/dags/slow_report/dagRuns/$RUN" | grep -o '"state":"[a-z_]*"' | head -n 1
tasks slow_report "$RUN"
# DAG-level callbacks run after the run has finished, so wait for the line to appear
for i in $(seq 1 60); do grep 'RUN FAILED' alerts/alerts.log > /dev/null && break; sleep 1; done
grep 'RUN FAILED' alerts/alerts.log
```

```text output
"state":"failed"
"task_id":"build"	"state":"skipped"	"try_number":1
RUN FAILED slow_report: reason=timed_out
```

After 10 seconds Airflow failed the whole run. The `build` task, still sleeping, was stopped and marked **skipped** — not failed: the task did nothing wrong, the run ran out of time. The DAG-level callback received `reason=timed_out`, so an alert can say *why* the run failed. Use `dagrun_timeout` for "this report must be ready by 7 a.m.", and `execution_timeout` for "this one call must not hang".

### 5. Clean up

```bash run
docker rm -f devforge-airflow > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **No `execution_timeout` on tasks that call networks or databases.** One hung connection can hold a worker slot until someone notices.
- **Retrying errors that cannot fix themselves.** Bad input, missing permissions or a wrong schema: raise `AirflowFailException`.
- **Heavy or fragile work in callbacks.** Callbacks report an outcome that has already happened; real work belongs in tasks, where retries and timeouts apply. Test callbacks like any other code.
- **Alerting on every retry.** Use `on_retry_callback` for logs or metrics, and page people from `on_failure_callback` only.
- **Expecting `dagrun_timeout` to limit a single task.** It limits the run; set `execution_timeout` for each risky task as well.

## Where this fits in a real system

Failure callbacks usually call a notifier — a chat or incident tool — or an **n8n** webhook that routes the alert. Airflow's own metrics (task failures, durations) can be scraped by **Prometheus**, and **OpenTelemetry** traces from tasks show where a timed-out task was stuck. The same pattern — bounded retries, timeouts on every external call, and an alert path — applies to **Jenkins** stages and **GitHub Actions** jobs (`timeout-minutes`).
