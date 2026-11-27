---
id: airflow-deployment-and-executors
title: Deployment and executors
track: airflow
order: 8
level: advanced
estimated_minutes: 55
prerequisites: [airflow-backfills-and-data-quality]
starts_fresh: true
learning_objectives:
  - Name Airflow 3's components — metadata database, API server, scheduler (with its executor), DAG processor, triggerer — and what each does.
  - Extend the official image with a provider the safe way (pinned Airflow version and constraints), and run each component as its own container.
  - Explain how LocalExecutor, CeleryExecutor and KubernetesExecutor run tasks, and show parallelism limiting concurrent tasks.
  - Read the health endpoint, and show what happens to runs while the scheduler is down.
resources:
  - title: Architecture overview (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/overview.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: 'Required components: scheduler (the executor is a configuration of the scheduler and runs in its process), DAG processor, API server, metadata database; the optional triggerer for deferred tasks.'
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Executor (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/core-concepts/executor/index.html
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: Local executors run tasks inside the scheduler process; queued/remote executors (CeleryExecutor) use long-running workers; containerised executors (KubernetesExecutor) start a pod per task; several executors can be configured together since 2.10.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Building the image — adding PyPI packages
    url: https://airflow.apache.org/docs/docker-stack/build.html
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: Add apache-airflow==<version> to every pip install so Airflow is not upgraded or downgraded by accident; the image's own constraints file is at ${HOME}/constraints.txt.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Checking Airflow health status (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/administration-and-deployment/logging-monitoring/check-health.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: The /api/v2/monitor/health fields; a component is healthy if any instance's heartbeat is within its health-check threshold.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: executor
    prompt: Where does the executor run?
    options:
      - { id: a, text: "In its own container" }
      - { id: b, text: "Inside the scheduler process — it is a setting of the scheduler. With LocalExecutor the tasks themselves also run on the scheduler's machine; with Celery or Kubernetes they run on workers or pods" }
      - { id: c, text: "In the API server" }
    answer: b
    explanation: The lab shows every task reporting the scheduler container's hostname.
  - id: scheduler-down
    prompt: The scheduler container stops. What happens to a run you trigger?
    options:
      - { id: a, text: "It fails" }
      - { id: b, text: "It is accepted by the API server and stays queued; nothing runs until a scheduler is back, then it proceeds" }
      - { id: c, text: "The API server runs it" }
    answer: b
    explanation: That is why production runs more than one scheduler and alerts on the health endpoint.
  - id: image
    prompt: Why pin apache-airflow==3.4.0 when you only want to add the PostgreSQL provider?
    options:
      - { id: a, text: "Pip needs it" }
      - { id: b, text: "Otherwise pip may upgrade or downgrade Airflow itself to satisfy the provider's requirements; the pin and the constraints file keep the image exactly the version you tested" }
      - { id: c, text: "Licensing" }
    answer: b
    explanation: The build documentation asks for it explicitly.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with an image built FROM apache/airflow:slim-3.4.0-python3.12 (pinned by digest) plus apache-airflow-providers-postgres 7.1.1 from the image's own constraints file, and postgres 16.15-alpine3.23 (pinned by digest), started with Docker Compose from nothing; output is compared with this lesson. CeleryExecutor and KubernetesExecutor are described, not run. Checked against the Airflow 3.4.0 documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

`airflow standalone` packs everything into one process for learning; in production Airflow is **several components** sharing a **metadata database** — an API server, one or more schedulers (each with an **executor** that decides *where* tasks run), a DAG processor and a triggerer — usually in containers built from the **official image**.

## Explain it like I'm twelve

A school play has a ticket office (the **API server** — everyone talks to it), a director who decides who goes on stage next (the **scheduler**), someone who reads the scripts and makes the running order (the **DAG processor**), someone who waits by the door for late actors (the **triggerer**), and a big notebook everyone writes in (the **metadata database**). The director's way of getting actors on stage is the **executor**: send them from the wings (local), call them from a waiting room (Celery workers), or hire a new actor for each scene (Kubernetes pods).

## What problem it solves

One process on one laptop is fine for writing DAGs. Production needs restarts without losing runs, more task capacity, isolation between teams' dependencies, and visibility into whether each part is alive. Splitting Airflow into components — and choosing an executor — answers those needs, but every component must be configured consistently and monitored.

## How it works

![](media:airflow/components.svg)

- **Metadata database** (PostgreSQL or MySQL in production): DAG runs, task states, serialised DAGs, connections. Every component uses it except workers, which talk to the API server's **task execution API** in Airflow 3.
- **API server**: the REST API and web UI, and the execution API that tasks use.
- **Scheduler**: creates runs and queues tasks; its **executor** runs them. You can run several schedulers for availability.
- **DAG processor**: parses DAG files and stores serialised DAGs in the database.
- **Triggerer**: runs deferred tasks (waiting without occupying a worker).
- **Executors**: `LocalExecutor` (processes on the scheduler's machine, limited by `parallelism`); `CeleryExecutor` (a queue plus long-running workers that scale horizontally); `KubernetesExecutor` (a pod per task — isolation and scale-to-zero, with start-up latency). Several can be configured at once.

## Try it yourself

> **Local lab** — needs Docker with Compose and about 3 GB of free memory. You build an image, then start PostgreSQL and four Airflow components as separate containers in the Compose project `devforge-airflow-prod`. Every command is run automatically in DevForge's tests.

### 1. Extend the official image

```bash run
mkdir -p airflow-deploy/dags && cd airflow-deploy
cat > Dockerfile <<'EOF'
FROM apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
# Pin Airflow itself and use the image's own constraints, so pip cannot move Airflow to another version.
RUN pip install --no-cache-dir "apache-airflow==3.4.0" "apache-airflow-providers-postgres==7.1.1" \
    --constraint /home/airflow/constraints.txt
EOF
printf 'dags\n' > .dockerignore
docker build -q -t devforge-airflow-pg:lab . > build.log 2>&1 || { cat build.log; exit 1; }
docker run --rm --entrypoint python devforge-airflow-pg:lab -c \
  'from importlib.metadata import version as v; print("airflow", v("apache-airflow"), "| postgres provider", v("apache-airflow-providers-postgres"), "| psycopg", v("psycopg"))'
```

```text output
airflow 3.4.0 | postgres provider 7.1.1 | psycopg 3.3.6
```

- The *slim* image has no PostgreSQL driver; the provider brings one. Adding it in a `Dockerfile` — rather than installing packages when containers start — means every container runs the same, tested image.
- `apache-airflow==3.4.0` in the same `pip install` stops pip from changing Airflow's version; `--constraint` pins every dependency to the versions the image was built with (the file the official image ships at `/home/airflow/constraints.txt`).

### 2. Describe the deployment

```bash run
cat > compose.yaml <<'EOF'
x-airflow: &airflow
  image: devforge-airflow-pg:lab
  user: "${AIRFLOW_UID}:0"                  # run as your user; the image needs group 0
  environment:
    AIRFLOW__CORE__EXECUTOR: LocalExecutor
    AIRFLOW__CORE__PARALLELISM: "2"         # at most 2 task processes at once
    AIRFLOW__DATABASE__SQL_ALCHEMY_CONN: postgresql+psycopg://airflow:airflow@postgres/airflow
    AIRFLOW__CORE__EXECUTION_API_SERVER_URL: http://api-server:8080/execution/
    AIRFLOW__API_AUTH__JWT_SECRET: lab-only-not-a-secret   # shared by all components; use a real secret in production
    AIRFLOW__CORE__LOAD_EXAMPLES: "false"
    AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION: "false"
    AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL: "5"
  volumes:
    - ./dags:/opt/airflow/dags
services:
  postgres:
    image: postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
    environment: { POSTGRES_USER: airflow, POSTGRES_PASSWORD: airflow, POSTGRES_DB: airflow }
    healthcheck: { test: ["CMD", "pg_isready", "-U", "airflow"], interval: 2s, retries: 30 }
  migrate:                                   # creates or upgrades the database schema, then exits
    <<: *airflow
    command: db migrate
    depends_on: { postgres: { condition: service_healthy } }
  api-server:
    <<: *airflow
    command: api-server
    ports: ["127.0.0.1:8096:8080"]
    depends_on: { migrate: { condition: service_completed_successfully } }
  scheduler:
    <<: *airflow
    command: scheduler
    depends_on: { migrate: { condition: service_completed_successfully } }
  dag-processor:
    <<: *airflow
    command: dag-processor
    depends_on: { migrate: { condition: service_completed_successfully } }
  triggerer:
    <<: *airflow
    command: triggerer
    depends_on: { migrate: { condition: service_completed_successfully } }
EOF
cat > dags/fan_out.py <<'EOF'
import time
from datetime import datetime
from airflow.sdk import dag, task

@dag(dag_id="fan_out", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def fan_out():
    @task
    def work(n):
        time.sleep(4)
        return n

    work.expand(n=[1, 2, 3, 4])     # four copies of the task, one per value

fan_out()
EOF
AIRFLOW_UID=$(id -u) docker compose -p devforge-airflow-prod config --services | sort
```

```text output
api-server
dag-processor
migrate
postgres
scheduler
triggerer
```

- One `x-airflow` block holds the settings every Airflow component must share — the image, the database, the executor, the execution API address and the JWT secret — and each service only adds its command.
- `migrate` runs `airflow db migrate` once; the other components wait for it to finish (`service_completed_successfully`).
- Production deployments do the same with the official Helm chart or a managed service; the components are identical.

### 3. Start it and check every component

```bash run
export AIRFLOW_UID=$(id -u)
docker compose -p devforge-airflow-prod up -d --quiet-pull > compose-up.log 2>&1 || { cat compose-up.log; exit 1; }
AF=http://127.0.0.1:8096
for i in $(seq 1 180); do curl -sf -o /dev/null "$AF/api/v2/monitor/health" && break; sleep 1; done
health() { curl -s "$AF/api/v2/monitor/health" | grep -o '"\(metadatabase\|scheduler\|triggerer\|dag_processor\)":{"status":"[a-z]*"' | sed 's/:{"status"/ /'; }
for i in $(seq 1 60); do [ "$(health | grep -c '"healthy"')" = 4 ] && break; sleep 1; done
health
docker compose -p devforge-airflow-prod ps -a --format '{{.Service}} {{.State}}' | sort
```

```text output
"metadatabase" :"healthy"
"scheduler" :"healthy"
"triggerer" :"healthy"
"dag_processor" :"healthy"
api-server running
dag-processor running
migrate exited
postgres running
scheduler running
triggerer running
```

The API server reports the database and every component with a recent heartbeat as healthy. `migrate` has done its job and exited.

### 4. Where tasks run, and how many at once

```bash run
for i in $(seq 1 60); do docker compose -p devforge-airflow-prod exec -T api-server test -f /opt/airflow/simple_auth_manager_passwords.json.generated && break; sleep 1; done
password=$(docker compose -p devforge-airflow-prod exec -T api-server cat /opt/airflow/simple_auth_manager_passwords.json.generated | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
for i in $(seq 1 60); do af "$AF/api/v2/dags/fan_out" | grep '"dag_id"' > /dev/null && break; sleep 1; done
wait_run() { for i in $(seq 1 180); do s=$(af "$AF/api/v2/dags/fan_out/dagRuns/$1" | grep -o '"state":"[a-z_]*"' | head -n 1 | cut -d'"' -f4); [ "$s" = success ] || [ "$s" = failed ] && break; sleep 1; done; echo "run: $s"; }
RUN=$(af -X POST -H 'Content-Type: application/json' -d '{"logical_date": null}' "$AF/api/v2/dags/fan_out/dagRuns" | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4)
wait_run "$RUN"
af "$AF/api/v2/dags/fan_out/dagRuns/$RUN/taskInstances" > tasks.json
SCHEDULER_HOST=$(docker inspect -f '{{.Config.Hostname}}' "$(docker compose -p devforge-airflow-prod ps -q scheduler)") python3 - <<'PY'
import json, os
from datetime import datetime
tasks = json.load(open("tasks.json"))["task_instances"]
t = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
events = sorted([(t(x["start_date"]), 1) for x in tasks] + [(t(x["end_date"]), -1) for x in tasks])
running = peak = 0
for _, change in events:
    running += change
    peak = max(peak, running)
print(f"{len(tasks)} tasks; at most {peak} ran at the same time")
print("every task ran in the scheduler's container:", all(x["hostname"] == os.environ["SCHEDULER_HOST"] for x in tasks))
PY
```

```text output
run: success
4 tasks; at most 2 ran at the same time
every task ran in the scheduler's container: True
```

- `work.expand(...)` created four task instances that could all run at once, but `parallelism = 2` let LocalExecutor start only two processes; the other two waited.
- Every task reported the scheduler container's hostname: with LocalExecutor the scheduler's machine is the worker. To run more tasks you scale that machine — or switch to **CeleryExecutor** (add a broker such as Redis and `airflow celery worker` containers, scaled out) or **KubernetesExecutor** (each task becomes a pod, with its own image and resources).

### 5. The scheduler goes down

```bash run
docker compose -p devforge-airflow-prod stop scheduler > /dev/null 2>&1
RUN=$(af -X POST -H 'Content-Type: application/json' -d '{"logical_date": null}' "$AF/api/v2/dags/fan_out/dagRuns" | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4)
for i in $(seq 1 90); do health | grep '"scheduler" :"unhealthy"' > /dev/null && break; sleep 1; done
health | grep scheduler
echo "the new run while the scheduler is down: $(af "$AF/api/v2/dags/fan_out/dagRuns/$RUN" | grep -o '"state":"[a-z_]*"' | head -n 1)"
docker compose -p devforge-airflow-prod start scheduler > /dev/null 2>&1
wait_run "$RUN"
```

```text output
"scheduler" :"unhealthy"
the new run while the scheduler is down: "state":"queued"
run: success
```

The API server still accepted the run — it only writes to the database — but nothing moved it forward: it stayed `queued`. Once the scheduler's heartbeat was older than the health-check threshold, the health endpoint reported it `unhealthy`, which is what monitoring should alert on. When the scheduler came back, it picked the run up from the database and finished it. Production runs two or more schedulers so that one can fail without anything waiting.

### 6. Clean up

```bash run
docker compose -p devforge-airflow-prod down -v --remove-orphans > /dev/null 2>&1
docker image rm devforge-airflow-pg:lab > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Using `airflow standalone` or SQLite in production.** They are for development; use PostgreSQL (or MySQL) and separate components.
- **Installing packages at container start** (`pip install` in the entrypoint). Builds become slow and unrepeatable; extend the image.
- **Different settings on different components** — a different JWT secret or database URL breaks task execution in confusing ways. Share one configuration block, as here.
- **Choosing KubernetesExecutor for many tiny tasks.** Each task pays for pod start-up; Celery or Local may fit better, or several executors together.
- **Monitoring only the web UI.** Alert on the health endpoint and on scheduler heartbeats.

## Where this fits in a real system

In **Kubernetes**, the official Helm chart runs exactly these components as Deployments, with PostgreSQL managed separately; images are built and pushed by **GitHub Actions** or **Jenkins**, and the health endpoint and Airflow's metrics feed **Prometheus** and **Grafana**. DAG files come from a Git repository (DAG bundles) instead of a mounted folder, so a merged pull request is a deployment.
