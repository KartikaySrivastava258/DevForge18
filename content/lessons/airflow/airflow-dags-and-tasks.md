---
id: airflow-dags-and-tasks
title: DAGs, tasks and dependencies
track: airflow
order: 1
level: beginner
estimated_minutes: 40
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain what a DAG, a task and a dependency are, and what Airflow does with them.
  - Write a small DAG in Python with the TaskFlow API and run Airflow locally.
  - Trigger a run and check each task's state through Airflow's REST API.
resources:
  - title: Apache Airflow documentation (stable)
    url: https://airflow.apache.org/docs/apache-airflow/stable/
    publisher: The Apache Software Foundation
    type: documentation
    level: all
    official: true
    why: Concepts, tutorials and reference for the current Airflow release.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Airflow quick start
    url: https://airflow.apache.org/docs/apache-airflow/stable/start.html
    publisher: The Apache Software Foundation
    type: tutorial
    level: beginner
    official: true
    why: What airflow standalone runs, and why it is for trying Airflow and developing DAGs only.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Airflow REST API — authentication
    url: https://airflow.apache.org/docs/apache-airflow/stable/security/api.html
    publisher: The Apache Software Foundation
    type: reference
    level: intermediate
    official: true
    why: How to get a token from /auth/token and call the /api/v2 endpoints with it.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: dag-meaning
    prompt: What does the "acyclic" in Directed Acyclic Graph rule out?
    options:
      - { id: a, text: "Tasks running in parallel" }
      - { id: b, text: "A chain of dependencies that loops back to an earlier task, which would never be able to start" }
      - { id: c, text: "More than three tasks" }
    answer: b
    explanation: Edges have a direction (this task before that one), and there are no cycles. If A waited for B and B waited for A, neither could ever run, so Airflow refuses such a DAG.
  - id: what-airflow-runs
    prompt: Airflow shows the DAG, but nothing happens at 09:00 even though you expected a run. Which part of Airflow decides when a run should start?
    options:
      - { id: a, text: "The DAG processor, which reads DAG files" }
      - { id: b, text: "The scheduler, which creates runs from each DAG's schedule and starts tasks whose dependencies are met" }
      - { id: c, text: "The API server" }
    answer: b
    explanation: The DAG processor parses files so Airflow knows the DAGs; the scheduler decides when runs happen and which tasks are ready; the API server serves the UI and API. A paused DAG, a schedule of None or a start date in the future are common reasons for no run.
  - id: xcom-size
    prompt: transform returns a value that load receives. Your transform produces a 2 GB table. What should it return instead?
    options:
      - { id: a, text: "The table itself — Airflow passes anything" }
      - { id: b, text: "A reference such as a file path or object-store key, with the table itself written to storage" }
      - { id: c, text: "Nothing; tasks cannot share data" }
    answer: b
    explanation: Returned values travel as XComs, which by default are stored in Airflow's own database and are meant for small data. Large data belongs in storage such as an object store, and the task passes its location.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official apache/airflow:slim-3.4.0-python3.12 image (pinned by digest) running airflow standalone; the output shown was recorded from that run. Facts about DAG runs, XComs, the REST API and standalone mode were checked against the Airflow 3.4 documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Apache Airflow** runs workflows written in Python: a **DAG** (directed acyclic graph) lists **tasks** and the order between them, and Airflow starts each task once the tasks it depends on have succeeded, records every attempt, and shows the result.

## Explain it like I'm twelve

Think of making a sandwich lunch for a class: buy bread, then slice it, then make sandwiches, then pack them. Some steps must wait for others; some can happen at the same time (washing fruit while slicing bread). Write the steps and their order on a card, and a helper does them in the right order, ticking each off — and if one fails, the helper writes down exactly which one and why.

The card is the **DAG**, each step is a **task**, the arrows between them are **dependencies**, and the helper is **Airflow**.

Where the analogy breaks: Airflow does not do the work itself in any clever way; it runs your Python code for each task and keeps careful records.

## What problem it solves

Data jobs are chains of steps — fetch yesterday's orders, clean them, load them into a report — that must run in order, often every day, and must be retried or investigated when one fails. Cron can start a script at a time, but it does not know about dependencies between steps, keep a history of every run, retry a single failed step, or show where a chain broke. Airflow does all of that and lets you write the chain as code that can be reviewed in Git.

## How it works

![](media:airflow/airflow-parts.svg)

- A **DAG file** is Python. The **DAG processor**, a separate process, parses it and stores the DAG in Airflow's **metadata database**.
- The **scheduler** reads the database, creates **DAG runs** (from the schedule, or when triggered), decides which tasks are ready and hands them to its **executor**.
- A **worker** runs each task in a new process. The task reports its state back through the **API server** — in Airflow 3, task code never reaches the database directly.
- The same API server serves the web interface and the REST API you will use here.
- With the **TaskFlow API**, a Python function becomes a task with `@task`, and passing one function's return value to another creates the dependency.

## Try it yourself

> **Local lab** — needs Docker. Airflow runs in a container as `airflow standalone`, which starts every part of Airflow together with a small SQLite database: the quick start describes it as a way to try Airflow and develop DAGs, not for production. Every command is run automatically in DevForge's tests. Run it where nothing else is called `devforge-airflow`; the last lesson of this series removes it.

### 1. Write a DAG

```bash run
mkdir -p airflow-lab/dags && cd airflow-lab
cat > dags/orders_etl.py <<'EOF'
from datetime import datetime
from airflow.sdk import dag, task

@dag(dag_id="orders_etl", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def orders_etl():
    @task
    def extract():
        return [12, 7, 30]

    @task
    def transform(amounts):
        return sum(amounts)

    @task
    def load(total):
        print(f"total of today's orders: {total}")

    load(transform(extract()))

orders_etl()
EOF
```

- `@dag` turns the function into a DAG named `orders_etl`. `schedule=None` means it runs only when triggered; the next lesson adds a schedule.
- Each `@task` function is a task. `load(transform(extract()))` both passes values along and declares the order: extract, then transform, then load.
- `from airflow.sdk import …` is the Airflow 3 way to import the authoring interface.

### 2. Start Airflow

```bash run
IMAGE=apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
docker pull -q "$IMAGE"
docker run -d --name devforge-airflow -p 127.0.0.1:8095:8080 -v "$PWD/dags:/opt/airflow/dags" \
  -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -e AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION=False \
  -e AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL=5 \
  "$IMAGE" standalone > /dev/null
AF=http://127.0.0.1:8095
for i in $(seq 1 180); do curl -sf -o /dev/null "$AF/api/v2/monitor/health" && break; sleep 1; done
curl -s "$AF/api/v2/monitor/health" | grep -o '"metadatabase":{"status":"[a-z]*"}'
```

```text output
docker.io/apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
"metadatabase":{"status":"healthy"}
```

- The official image, the *slim* variant (Airflow without optional extras, about 800 MB), pinned by version and digest. `docker pull -q` downloads it once and prints only its name.
- `-v "$PWD/dags:/opt/airflow/dags"` shares your `dags` folder with the container, where Airflow looks for DAG files.
- Settings are passed as `AIRFLOW__<SECTION>__<KEY>` environment variables: no example DAGs, new DAGs start unpaused, and the folder is checked for new or changed files every 5 seconds (the default is 300).
- Airflow's web interface is at <http://localhost:8095> (port 8095, because DevForge uses 8080).

### 3. Get a token for the API

`standalone` creates an `admin` user with a generated password, which it keeps in a file inside the container. Read it, then exchange it for a token:

```bash run
for i in $(seq 1 60); do docker exec devforge-airflow test -f /opt/airflow/simple_auth_manager_passwords.json.generated && break; sleep 1; done
password=$(docker exec devforge-airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
af -o /dev/null -w 'with a token: %{http_code}\n' "$AF/api/v2/dags"
curl -s -o /dev/null -w 'without one: %{http_code}\n' "$AF/api/v2/dags"
```

```text output
with a token: 200
without one: 401
```

- `POST /auth/token` returns a JSON Web Token in `access_token`; every API request then sends it as `Authorization: Bearer …`. `af` is a small function that adds it for you (define it again if you open a new terminal).
- `grep -o … | cut -d'"' -f4` picks one value out of the JSON without extra tools.
- This *simple auth manager* is meant for development and testing; real deployments use a proper one.

### 4. Look at the DAG through the API

```bash run
for i in $(seq 1 60); do af "$AF/api/v2/dags/orders_etl" | grep -q '"dag_id"' && break; sleep 1; done
af "$AF/api/v2/dags/orders_etl/tasks" | grep -o '"task_id":"[a-z_]*"\|"downstream_task_ids":\[[^]]*\]' | paste - - | sort
```

```text output
"task_id":"extract"	"downstream_task_ids":["transform"]
"task_id":"load"	"downstream_task_ids":[]
"task_id":"transform"	"downstream_task_ids":["load"]
```

Airflow found the file and built the graph: `extract` → `transform` → `load`. `paste - -` joins every two lines into one.

### 5. Trigger a run and wait for it

```bash run
run_dag() {
  local dag=$1 run state
  run=$(af -X POST -H 'Content-Type: application/json' -d '{"logical_date": null}' "$AF/api/v2/dags/$dag/dagRuns" \
    | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4)
  for i in $(seq 1 120); do
    state=$(af "$AF/api/v2/dags/$dag/dagRuns/$run" | grep -o '"state":"[a-z_]*"' | head -n 1 | cut -d'"' -f4)
    [ "$state" = success ] || [ "$state" = failed ] && break
    sleep 1
  done
  echo "$run"
}
RUN=$(run_dag orders_etl)
echo "run type: ${RUN%%__*}"
af "$AF/api/v2/dags/orders_etl/dagRuns/$RUN" | grep -o '"state":"[a-z_]*"' | head -n 1
```

```text output
run type: manual
"state":"success"
```

- `POST …/dagRuns` creates a run. `"logical_date": null` is fine for a manual run; the next lesson explains logical dates.
- The run ID starts with how the run was created (`manual__…`); `${RUN%%__*}` keeps that part.
- The loop polls the run's state until it is `success` or `failed`, for at most two minutes.

### 6. Check every task, and the value passed between them

```bash run
af "$AF/api/v2/dags/orders_etl/dagRuns/$RUN/taskInstances" \
  | grep -o '"task_id":"[a-z_]*"\|"state":"[a-z_]*"\|"try_number":[0-9]*' | paste - - - | sort
af "$AF/api/v2/dags/orders_etl/dagRuns/$RUN/taskInstances/transform/xcomEntries/return_value" | grep -o '"value":[^,}]*'
```

```text output
"task_id":"extract"	"state":"success"	"try_number":1
"task_id":"load"	"state":"success"	"try_number":1
"task_id":"transform"	"state":"success"	"try_number":1
"value":49
```

- Each **task instance** — one task in one run — succeeded on its first try.
- `transform` returned 12 + 7 + 30 = 49. Returned values are stored as **XComs** in Airflow's database, which is why they are only for small data.

**Keep the `devforge-airflow` container running** for the next lesson. Open <http://localhost:8095>, sign in as `admin` with the password from step 3, and look at the run's graph: this step is not part of the automatic tests.

## Common mistakes

- **Doing heavy work at the top level of a DAG file.** The file is read again and again by the DAG processor; put work inside tasks.
- **Passing large data between tasks.** XComs are for small values; write big data to storage and pass its location.
- **Expecting a new DAG to run by itself.** Without a schedule it only runs when triggered, and by default new DAGs start paused (this lab turns that off).
- **A dependency cycle.** Airflow rejects a DAG whose dependencies loop.
- **Running `standalone` in production.** It is for trying Airflow and developing DAGs; production deployments run the parts separately with a real database and a real auth manager.

## Where this fits in a real system

Airflow often orchestrates the data side of a system: extracting from **PostgreSQL** or **Kafka**, training models tracked in **MLflow**, and loading results for dashboards. DAG files live in **Git** and are deployed by **GitHub Actions** or **Jenkins**; in **Kubernetes**, each task can run in its own Pod.
