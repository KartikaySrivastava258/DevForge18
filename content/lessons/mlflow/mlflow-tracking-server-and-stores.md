---
id: mlflow-tracking-server-and-stores
title: The tracking server and its stores in depth
track: mlflow
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [mlflow-models-and-registry]
starts_fresh: true
learning_objectives:
  - Distinguish the backend store (runs, parameters, metrics, registry) from the artifact store (files and models), and find where each lives.
  - Show that a server with default settings loses everything when its container is replaced.
  - Run a team-style server — PostgreSQL backend, proxied artifact store on a volume — and log to it from a separate client that has no storage access.
  - Explain artifact proxying (--serve-artifacts), direct artifact access, and schema upgrades with mlflow db upgrade.
resources:
  - title: Backend store (MLflow documentation)
    url: https://mlflow.org/docs/latest/self-hosting/architecture/backend-store/
    publisher: MLflow (Linux Foundation project)
    type: documentation
    level: intermediate
    official: true
    why: SQLite (sqlite:///mlflow.db in the current directory) is the default backend store; PostgreSQL, MySQL and MSSQL through SQLAlchemy; run mlflow db upgrade before starting a server against an older schema.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Tracking server architecture (MLflow documentation)
    url: https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/
    publisher: MLflow (Linux Foundation project)
    type: documentation
    level: intermediate
    official: true
    why: Proxied artifact access through the server (--artifacts-destination) versus direct access to remote storage (--no-serve-artifacts with --default-artifact-root); --backend-store-uri for PostgreSQL or MySQL.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: stores
    prompt: Where does MLflow keep a run's RMSE, and where its model file?
    options:
      - { id: a, text: "Both in the database" }
      - { id: b, text: "The metric in the backend store (a database); the model file in the artifact store (a folder or bucket)" }
      - { id: c, text: "Both in the client" }
    answer: b
    explanation: Small structured data goes to the database; files go to artifact storage. They are configured separately.
  - id: proxy
    prompt: Your training jobs run on laptops and CI runners. Why proxy artifacts through the tracking server?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "Clients then need only the server's URL; only the server holds storage credentials, and access control happens in one place" }
      - { id: c, text: "MLflow requires it" }
    answer: b
    explanation: The lab's client container logs a file without any access to the artifact folder. The trade-off is that every artifact byte passes through the server.
  - id: lost
    prompt: A colleague runs mlflow server in a container with no options and no volume, then upgrades the image. What happens to the experiments?
    options:
      - { id: a, text: "They are migrated" }
      - { id: b, text: "They are gone — mlflow.db and mlartifacts were inside the replaced container" }
      - { id: c, text: "They move to the new image" }
    answer: b
    explanation: The lab shows the run count drop to zero after replacing the container.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official ghcr.io/mlflow/mlflow:v3.18.0 image (pinned by digest) — extended with psycopg[binary] 3.3.7 for PostgreSQL — and postgres 16.15-alpine3.23 (pinned by digest), starting from nothing, and its output is compared with this lesson. Checked against the MLflow documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

An MLflow tracking server keeps two kinds of data in two places — **metadata** (experiments, runs, parameters, metrics, the model registry) in a **backend store** database, and **files** (artifacts and models) in an **artifact store** — and a team server needs both to live outside the server's container.

## Explain it like I'm twelve

A school library has a **catalogue** (which book, who borrowed it, when) and **shelves** with the books themselves. Lose the catalogue and nobody can find anything; lose the shelves and the catalogue points at nothing. A librarian at the desk (the **tracking server**) can fetch books for you, so pupils never need a key to the stockroom — that is **artifact proxying**.

## What problem it solves

Experiment history is valuable: it shows which data and settings produced the model in production. Run MLflow carelessly — one container, default settings, no volume — and an upgrade silently deletes that history. Splitting the stores, putting them on durable services, and letting clients talk only to the server makes the tracking service safe to upgrade and safe to share.

## How it works

![](media:mlflow/tracking-stores.svg)

- **Backend store** (`--backend-store-uri`): a SQLAlchemy URL. With no option, MLflow uses `sqlite:///mlflow.db` in the server's working directory. Teams use PostgreSQL or MySQL. The model registry uses the same database unless `--registry-store-uri` says otherwise.
- **Artifact store**: with `--serve-artifacts` (the default), clients upload and download through the server (`mlflow-artifacts:/…` URIs) and the server writes to `--artifacts-destination` — a folder, or a bucket such as `s3://…`. With `--no-serve-artifacts` and `--default-artifact-root s3://…`, clients write to the bucket directly and need credentials themselves.
- **Schema upgrades**: a newer MLflow may need a newer database schema; run `mlflow db upgrade <db-uri>` (after a backup) before starting the new server.

## Try it yourself

> **Local lab** — needs Docker. You first run a throwaway server, then a team-style one with PostgreSQL and an artifact folder on your disk, on the `devforge-mlflow-net` network. Every command is run automatically in DevForge's tests.

### 1. The throwaway server

```bash run
mkdir -p mlflow-stores/artifacts && cd mlflow-stores
IMAGE=ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
docker pull -q "$IMAGE" > /dev/null
quiet=(-e MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT=true -e MLFLOW_LOGGING_LEVEL=WARNING -e GIT_PYTHON_REFRESH=quiet)
start_default() {
  docker run -d --name devforge-mlflow -p 127.0.0.1:5051:5000 "$IMAGE" mlflow server --host 0.0.0.0 --port 5000 > /dev/null
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:5051/health > /dev/null && break; sleep 1; done
}
count_runs() { curl -s -X POST http://127.0.0.1:5051/api/2.0/mlflow/runs/search -H 'Content-Type: application/json' \
  -d '{"experiment_ids": ["0", "1"]}' | python3 -c 'import json, sys; print("runs on the server:", len(json.load(sys.stdin).get("runs", [])))'; }
start_default
docker exec -i "${quiet[@]}" -e MLFLOW_TRACKING_URI=http://127.0.0.1:5000 devforge-mlflow python - <<'PY'
import mlflow
mlflow.set_experiment("store-demo")
with mlflow.start_run():
    mlflow.log_metric("rmse", 53.1)
    mlflow.log_text("trained on the diabetes data\n", "notes.txt")
PY
count_runs
echo "files the server created in its working directory: $(docker exec devforge-mlflow sh -c 'ls -d /mlflow.db /mlartifacts' | tr '\n' ' ')"
docker rm -f devforge-mlflow > /dev/null    # e.g. an image upgrade
start_default
count_runs
docker rm -f devforge-mlflow > /dev/null
```

```text output
runs on the server: 1
files the server created in its working directory: /mlartifacts /mlflow.db
runs on the server: 0
```

With no options, the server used `sqlite:///mlflow.db` and an `mlartifacts` folder — both inside the container. Replacing the container replaced them: the run is gone. (A volume for `/` would "fix" this, but it still leaves a single SQLite file that only one server can use.)

### 2. A team-style server: PostgreSQL and a proxied artifact store

```bash run
cat > Dockerfile <<'EOF'
FROM ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
# The official image has no PostgreSQL driver; MLflow 3.18 uses psycopg (version 3) for postgresql:// URLs.
RUN pip install --no-cache-dir "psycopg[binary]==3.3.7"
EOF
docker build -q -t devforge-mlflow-pg:lab . > build.log 2>&1 || { cat build.log; exit 1; }
PG_IMAGE=postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
docker pull -q "$PG_IMAGE" > /dev/null
docker network create devforge-mlflow-net > /dev/null
docker run -d --name devforge-mlflow-db --hostname db --network devforge-mlflow-net \
  -e POSTGRES_USER=mlflow -e POSTGRES_PASSWORD=mlflow -e POSTGRES_DB=mlflow "$PG_IMAGE" > /dev/null
for i in $(seq 1 60); do docker exec devforge-mlflow-db pg_isready -U mlflow -h 127.0.0.1 > /dev/null 2>&1 && break; sleep 1; done
start_team() {
  docker run -d --name devforge-mlflow --hostname mlflow --network devforge-mlflow-net --user "$(id -u):0" \
    -p 127.0.0.1:5051:5000 -v "$PWD/artifacts:/artifacts" devforge-mlflow-pg:lab \
    mlflow server --host 0.0.0.0 --port 5000 \
      --backend-store-uri postgresql://mlflow:mlflow@db/mlflow \
      --artifacts-destination /artifacts \
      --allowed-hosts "mlflow:5000,127.0.0.1:5051" > /dev/null
  for i in $(seq 1 90); do curl -sf http://127.0.0.1:5051/health > /dev/null && break; sleep 1; done
}
start_team
curl -s http://127.0.0.1:5051/health; echo
```

```text output
OK
```

- `--backend-store-uri postgresql://…` puts metadata in PostgreSQL (the `db` container). MLflow creates its tables on first start.
- `--artifacts-destination /artifacts` is where the server writes artifacts; the folder is your `artifacts` directory, mounted into the server only.
- `--allowed-hosts` lists the host names clients may use. MLflow's security middleware accepts only `localhost` by default, so the in-network name `mlflow:5000` must be added.

### 3. Log from a client that cannot see the storage

```bash run
cat > log_run.py <<'EOF'
import mlflow
mlflow.set_experiment("store-demo")
with mlflow.start_run(run_name="ridge-0.5") as run:
    mlflow.log_param("alpha", 0.5)
    mlflow.log_metric("rmse", 53.1)
    mlflow.log_text("trained on the diabetes data\n", "notes.txt")
    print("artifact URI:", run.info.artifact_uri.split("/")[0] + "/<experiment>/<run>/artifacts")
EOF
docker run --rm --network devforge-mlflow-net "${quiet[@]}" -e MLFLOW_TRACKING_URI=http://mlflow:5000 \
  -v "$PWD/log_run.py:/log_run.py:ro" devforge-mlflow-pg:lab python /log_run.py
echo "in the artifact store: $(find artifacts -type f | sed 's|artifacts/[0-9]*/[0-9a-f]*/|artifacts/<experiment>/<run>/|')"
echo "in PostgreSQL:"
docker exec devforge-mlflow-db psql -U mlflow -At -c "SELECT '  experiment ' || name FROM experiments ORDER BY experiment_id" \
  -c "SELECT '  metric ' || key || ' = ' || value FROM metrics" -c "SELECT '  param ' || key || ' = ' || value FROM params"
```

```text output
artifact URI: mlflow-artifacts:/<experiment>/<run>/artifacts
in the artifact store: artifacts/<experiment>/<run>/artifacts/notes.txt
in PostgreSQL:
  experiment Default
  experiment store-demo
  metric rmse = 53.1
  param alpha = 0.5
```

- The client container knew only `MLFLOW_TRACKING_URI`. Its artifact URI starts with `mlflow-artifacts:`, meaning "through the tracking server", and the server wrote `notes.txt` into the artifact folder on your disk.
- The parameter and metric are rows in PostgreSQL's `params` and `metrics` tables; the `Default` experiment is created automatically. (Reading MLflow's tables directly is fine for learning; tools should use the REST API, because the schema changes between versions.)

### 4. Replace the server — the history stays

```bash run
docker rm -f devforge-mlflow > /dev/null
start_team
curl -s -X POST http://127.0.0.1:5051/api/2.0/mlflow/runs/search -H 'Content-Type: application/json' -d '{"experiment_ids": ["1"]}' \
  | python3 -c '
import json, sys
for r in json.load(sys.stdin)["runs"]:
    print(r["info"]["run_name"], {m["key"]: m["value"] for m in r["data"]["metrics"]}, r["info"]["artifact_uri"].split(":")[0])'
curl -s "http://127.0.0.1:5051/api/2.0/mlflow-artifacts/artifacts?path=$(find artifacts -type f -name notes.txt | sed 's|^artifacts/||; s|/notes.txt$||')" | python3 -c 'import json, sys; print([f["path"] for f in json.load(sys.stdin)["files"]])'
```

```text output
ridge-0.5 {'rmse': 53.1} mlflow-artifacts
['notes.txt']
```

The new server container found the run in PostgreSQL and the file in the artifact folder: the server is now stateless and can be upgraded, restarted or run as several copies behind a load balancer. Before upgrading MLflow itself, back up the database and run `mlflow db upgrade postgresql://…` with the new version.

### 5. Clean up

```bash run
docker rm -f devforge-mlflow devforge-mlflow-db > /dev/null
docker network rm devforge-mlflow-net > /dev/null
docker image rm devforge-mlflow-pg:lab > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Default settings in a shared container.** Everything lives inside the container and disappears with it.
- **Backing up only the database.** Runs then point at artifacts that no longer exist; back up both stores together.
- **Proxying very large artifacts through one small server.** Every byte passes through it; scale the server or let clients write to the bucket directly.
- **Opening the server to the network without authentication.** Anyone who can reach it can read and delete experiments; put it behind authentication and restrict `--allowed-hosts`.
- **Upgrading MLflow without `mlflow db upgrade`.** The new server refuses an out-of-date schema.

## Where this fits in a real system

In **Kubernetes**, the tracking server runs as a stateless Deployment with a managed **PostgreSQL** database and an object-storage bucket; **Terraform** creates the database and bucket; **Prometheus** can scrape the server (`--expose-prometheus`). Training jobs started by **Airflow** or **GitHub Actions** only need `MLFLOW_TRACKING_URI` — the next lesson builds such a pipeline.
