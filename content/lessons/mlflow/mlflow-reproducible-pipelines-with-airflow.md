---
id: mlflow-reproducible-pipelines-with-airflow
title: Reproducible training pipelines with Airflow
track: mlflow
order: 5
level: advanced
estimated_minutes: 55
prerequisites: [mlflow-tracking-server-and-stores]
starts_fresh: true
learning_objectives:
  - Run training as an Airflow DAG that logs to an MLflow tracking server, with pinned libraries in a custom image.
  - Make a training run reproducible — fixed seeds, data written per logical date, fixed hyperparameters — and prove it by re-running.
  - Record lineage as MLflow tags (Airflow run, data hash, code hash) and trace a registered model version back to them.
  - Show how a change in code changes both the hash and the result, and why that matters for audits.
resources:
  - title: mlflow.sklearn (MLflow Python API)
    url: https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html
    publisher: MLflow (Linux Foundation project)
    type: reference
    level: advanced
    official: true
    why: log_model with registered_model_name registers each logged model as a new version; serialization_format can be pickle, cloudpickle or skops.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Best practices — reproducibility of tasks (Airflow 3.4.0)
    url: https://airflow.apache.org/docs/apache-airflow/3.4.0/best-practices.html
    publisher: Apache Software Foundation
    type: documentation
    level: intermediate
    official: true
    why: Tasks should produce the same outcome on every re-run, reading and writing data for the run's own partition.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Building the Airflow image — adding PyPI packages
    url: https://airflow.apache.org/docs/docker-stack/build.html
    publisher: Apache Software Foundation
    type: documentation
    level: advanced
    official: true
    why: Pin apache-airflow==<version> in the same pip install and use the image's constraints file.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: reproduce
    prompt: What made the two training runs for 15 January produce exactly the same RMSE?
    options:
      - { id: a, text: "MLflow caches results" }
      - { id: b, text: "The same data split (fixed random_state, written for the run's date), the same code and hyperparameters, and the same pinned library versions" }
      - { id: c, text: "Luck" }
    answer: b
    explanation: Remove any one — an unseeded split, "latest" data, an unpinned scikit-learn — and reruns can drift.
  - id: lineage
    prompt: An auditor asks which data and code produced model version 3. Where do you look?
    options:
      - { id: a, text: "In the model file" }
      - { id: b, text: "Version 3 names its MLflow run; the run's tags hold the Airflow run ID, the data hash and the code hash, which point to the exact inputs" }
      - { id: c, text: "Nowhere — that is not recorded" }
    answer: b
    explanation: Lineage only exists if the pipeline records it. Tags cost nothing to add.
  - id: why-airflow
    prompt: Why run training from Airflow instead of a notebook?
    options:
      - { id: a, text: "Notebooks cannot use MLflow" }
      - { id: b, text: "Scheduling, retries and backfills come for free, every run is tied to a date and a run ID, and the same code runs every time instead of whatever cells were executed" }
      - { id: c, text: "It is faster" }
    answer: b
    explanation: Notebooks are good for exploration; pipelines are for results others depend on.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with an image built FROM apache/airflow:slim-3.4.0-python3.12 (pinned by digest) plus mlflow-skinny 3.18.0, scikit-learn 1.9.1, pandas 3.1.0 and skops 0.16.0, and the official ghcr.io/mlflow/mlflow:v3.18.0 image (pinned by digest), starting from nothing; output is compared with this lesson. The dataset is scikit-learn's bundled diabetes data. Checked against the MLflow and Airflow 3.4.0 documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

A training **pipeline** — Airflow tasks that prepare data for a date and train a model that is logged to MLflow — is **reproducible** when every input is fixed (seeds, data partition, code, library versions) and **auditable** when each MLflow run records *which* inputs it used.

## Explain it like I'm twelve

A science-fair experiment counts only if someone else can repeat it and get the same result. So you write down the recipe exactly: which seeds, which soil, how much water, which day. Then, when the judges ask "how did you get this plant?", you point to the page in your notebook. MLflow is the notebook; the tags are the "which seeds, which soil" lines; Airflow makes sure the recipe is followed the same way every time.

## What problem it solves

"The model was better last week and nobody knows why" is the classic machine-learning failure. Notebooks run cells in any order, datasets change under the code, and library upgrades shift results. Regulators and teammates increasingly ask *which data and code produced this model?* A scheduled pipeline with pinned dependencies and recorded lineage answers that question — and lets you reproduce a result before changing it.

## How it works

![](media:mlflow/pipeline-lineage.svg)

- **Image**: the Airflow image extended with exact versions of MLflow's client, scikit-learn and their needs, so training code behaves the same everywhere.
- **prepare** task: splits the data with a fixed `random_state` and writes it under the run's date (`ds`); returns the folder and a SHA-256 hash of the training file.
- **train** task: reads that folder, trains with fixed hyperparameters, and logs to MLflow (`MLFLOW_TRACKING_URI`) — parameters, the metric, the model (registered as a new version), and **tags**: the Airflow DAG and run IDs, the data hash and the hash of the DAG file's code.
- **Re-running** the same Airflow run (clearing it) must reproduce the metric exactly; a change in code or data shows up as a different hash.

## Try it yourself

> **Local lab** — needs Docker and about 3 GB of downloads. MLflow and Airflow run as containers on the `devforge-ml-net` network; Airflow's tasks reach MLflow at `http://mlflow:5000`. Every command is run automatically in DevForge's tests.

### 1. An Airflow image that can train and log

```bash run
mkdir -p ml-pipeline/dags ml-pipeline/data && cd ml-pipeline
cat > Dockerfile <<'EOF'
FROM apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
# Exact versions: the MLflow client matching the server, scikit-learn, and what mlflow.sklearn needs.
RUN pip install --no-cache-dir "apache-airflow==3.4.0" "mlflow-skinny==3.18.0" "scikit-learn==1.9.1" \
    "pandas==3.1.0" "skops==0.16.0" --constraint /home/airflow/constraints.txt
EOF
printf 'dags\ndata\n' > .dockerignore
docker build -q -t devforge-airflow-ml:lab . > build.log 2>&1 || { cat build.log; exit 1; }
docker run --rm --entrypoint python devforge-airflow-ml:lab -c \
  'from importlib.metadata import version as v; print(", ".join(f"{p} {v(p)}" for p in ["apache-airflow", "mlflow-skinny", "scikit-learn"]))'
```

```text output
apache-airflow 3.4.0, mlflow-skinny 3.18.0, scikit-learn 1.9.1
```

`mlflow-skinny` is MLflow's client without the server and UI. `mlflow.sklearn` also needs pandas, and `skops` — the format MLflow 3.18 uses to save scikit-learn models by default here (a missing `skops` made the first version of this lab fail). Pinning them all, with Airflow's constraints, keeps the image identical on every machine.

### 2. The pipeline

```bash run
cat > dags/train_diabetes.py <<'EOF'
import csv, hashlib, os
from datetime import datetime
from airflow.sdk import dag, get_current_context, task

DATA = "/opt/airflow/data"

def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

@dag(dag_id="train_diabetes", schedule=None, start_date=datetime(2026, 1, 1), catchup=False)
def train_diabetes():
    @task
    def prepare():
        from sklearn.datasets import load_diabetes
        from sklearn.model_selection import train_test_split
        X, y = load_diabetes(return_X_y=True)
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
        folder = f"{DATA}/{get_current_context()['ds']}"          # data for this run's date
        os.makedirs(folder, exist_ok=True)
        for name, X_, y_ in [("train", X_train, y_train), ("test", X_test, y_test)]:
            with open(f"{folder}/{name}.csv", "w", newline="") as f:
                writer = csv.writer(f)
                for row, target in zip(X_, y_):
                    writer.writerow([f"{v:.6f}" for v in row] + [f"{target:.1f}"])
        return {"folder": folder, "data_sha256": sha256(f"{folder}/train.csv")}

    @task
    def train(prepared):
        import mlflow, mlflow.sklearn
        from sklearn.linear_model import Ridge
        from sklearn.metrics import mean_squared_error
        read = lambda name: [[float(v) for v in row] for row in csv.reader(open(f"{prepared['folder']}/{name}.csv"))]
        train_rows, test_rows = read("train"), read("test")
        ctx = get_current_context()
        mlflow.set_experiment("diabetes-pipeline")
        with mlflow.start_run(run_name=f"ridge-{ctx['ds']}") as run:
            mlflow.set_tags({"airflow.dag_id": ctx["dag"].dag_id, "airflow.run_id": ctx["run_id"],
                             "data.sha256": prepared["data_sha256"], "code.sha256": sha256(__file__)})
            model = Ridge(alpha=0.5).fit([r[:-1] for r in train_rows], [r[-1] for r in train_rows])
            rmse = mean_squared_error([r[-1] for r in test_rows], model.predict([r[:-1] for r in test_rows])) ** 0.5
            mlflow.log_params({"model": "Ridge", "alpha": 0.5, "random_state": 42})
            mlflow.log_metric("rmse", round(rmse, 4))
            mlflow.sklearn.log_model(model, name="model", registered_model_name="diabetes-pipeline")
            return run.info.run_id

    train(prepare())

train_diabetes()
EOF
python3 -m py_compile dags/train_diabetes.py && echo "DAG file is valid Python"
```

```text output
DAG file is valid Python
```

- `prepare` writes the split under `data/<ds>/` and hashes the training file; the hash travels to `train` as a small XCom (see *Passing data between tasks*).
- `train` records lineage as tags before doing anything else, so even a failed run says what it was trying.
- `sha256(__file__)` hashes the DAG file itself — a simple stand-in for the Git commit a real pipeline would record.

### 3. Start MLflow and Airflow, and train for 15 January

```bash run
MLFLOW_IMAGE=ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
docker pull -q "$MLFLOW_IMAGE" > /dev/null
docker network create devforge-ml-net > /dev/null
docker run -d --name devforge-mlflow --hostname mlflow --network devforge-ml-net -p 127.0.0.1:5051:5000 "$MLFLOW_IMAGE" \
  mlflow server --host 0.0.0.0 --port 5000 --allowed-hosts "mlflow:5000,127.0.0.1:5051" > /dev/null
docker run -d --name devforge-airflow --network devforge-ml-net --user "$(id -u):0" -p 127.0.0.1:8095:8080 \
  -v "$PWD/dags:/opt/airflow/dags" -v "$PWD/data:/opt/airflow/data" \
  -e AIRFLOW__CORE__LOAD_EXAMPLES=False -e AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION=False \
  -e AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL=5 \
  -e MLFLOW_TRACKING_URI=http://mlflow:5000 -e GIT_PYTHON_REFRESH=quiet \
  devforge-airflow-ml:lab standalone > /dev/null
MLF=http://127.0.0.1:5051
AF=http://127.0.0.1:8095
for i in $(seq 1 90); do curl -sf "$MLF/health" > /dev/null && break; sleep 1; done
for i in $(seq 1 180); do curl -sf -o /dev/null "$AF/api/v2/monitor/health" && break; sleep 1; done
for i in $(seq 1 60); do docker exec devforge-airflow test -f /opt/airflow/simple_auth_manager_passwords.json.generated && break; sleep 1; done
password=$(docker exec devforge-airflow cat /opt/airflow/simple_auth_manager_passwords.json.generated | grep -o '"admin": *"[^"]*"' | cut -d'"' -f4)
TOKEN=$(curl -s -X POST "$AF/auth/token" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$password\"}" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
af() { curl -s -H "Authorization: Bearer $TOKEN" "$@"; }
for i in $(seq 1 60); do af "$AF/api/v2/dags/train_diabetes" | grep '"dag_id"' > /dev/null && break; sleep 1; done
trigger() { af -X POST -H 'Content-Type: application/json' -d "{\"logical_date\": \"$1T00:00:00Z\"}" "$AF/api/v2/dags/train_diabetes/dagRuns" \
  | grep -o '"dag_run_id":"[^"]*"' | cut -d'"' -f4; }
# wait until the train task of run $1 has finished attempt $2; print its state
wait_train() {
  for i in $(seq 1 300); do
    ti=$(af "$AF/api/v2/dags/train_diabetes/dagRuns/$1/taskInstances/train")
    echo "$ti" | grep "\"try_number\":$2" > /dev/null && echo "$ti" | grep -E '"state":"(success|failed)"' > /dev/null && break
    sleep 1
  done
  echo "train: $(echo "$ti" | grep -o '"state":"[a-z_]*"' | head -n 1)"
}
# one line per MLflow run: name, metric, and the start of each lineage hash
cat > runs.py <<'PYEOF'
import json, sys
for r in json.load(sys.stdin).get("runs", []):
    tags = {t["key"]: t["value"] for t in r["data"]["tags"]}
    rmse = {m["key"]: m["value"] for m in r["data"]["metrics"]}["rmse"]
    name, airflow_run = r["info"]["run_name"], tags["airflow.run_id"].split("__")[0]
    print(f"  {name}  rmse {rmse}  data {tags['data.sha256'][:12]}  code {tags['code.sha256'][:12]}  airflow {airflow_run}")
PYEOF
mlflow_runs() { curl -s -X POST "$MLF/api/2.0/mlflow/runs/search" -H 'Content-Type: application/json' \
  -d '{"experiment_ids": ["1"], "order_by": ["attributes.start_time ASC"]}' | python3 runs.py; }
RUN15=$(trigger 2026-01-15)
wait_train "$RUN15" 1
mlflow_runs
```

```text output
train: "state":"success"
  ridge-2026-01-15  rmse 53.8471  data e0104c0f6eb1  code 03908adb42d6  airflow manual
```

The Airflow run prepared the data for 15 January, trained, and left an MLflow run with its metric and lineage tags (the hashes are shortened to 12 characters here).

### 4. Re-run it: the same inputs give the same result

```bash run
af -X POST -H 'Content-Type: application/json' \
  -d "{\"dry_run\": false, \"dag_run_id\": \"$RUN15\", \"reset_dag_runs\": true, \"only_failed\": false}" \
  "$AF/api/v2/dags/train_diabetes/clearTaskInstances" > /dev/null
wait_train "$RUN15" 2
mlflow_runs
```

```text output
train: "state":"success"
  ridge-2026-01-15  rmse 53.8471  data e0104c0f6eb1  code 03908adb42d6  airflow manual
  ridge-2026-01-15  rmse 53.8471  data e0104c0f6eb1  code 03908adb42d6  airflow manual
```

Clearing the Airflow run executed both tasks again. The new MLflow run has the same RMSE to four decimals, the same data hash and the same code hash: the result is reproducible, and the matching hashes say *why* it should be. (Each attempt is a separate MLflow run, so the history keeps both; MLflow runs are records of attempts, not of dates.)

### 5. Change the code, and the lineage shows it

```bash run
sed -i 's/alpha=0.5/alpha=1.0/; s/"alpha": 0.5/"alpha": 1.0/' dags/train_diabetes.py
for i in $(seq 1 60); do af "$AF/api/v2/dagSources/train_diabetes" | grep 'alpha=1.0' > /dev/null && break; sleep 1; done
RUN16=$(trigger 2026-01-16)
wait_train "$RUN16" 1
mlflow_runs | tail -n 1
curl -s "$MLF/api/2.0/mlflow/registered-models/get?name=diabetes-pipeline" \
  | python3 -c 'import json, sys; print("latest model version:", max(int(v["version"]) for v in json.load(sys.stdin)["registered_model"]["latest_versions"]))'
```

```text output
train: "state":"success"
  ridge-2026-01-16  rmse 55.7267  data e0104c0f6eb1  code b40b2742351c  airflow manual
latest model version: 3
```

The DAG processor picked up the edited file (`/api/v2/dagSources` serves the parsed source), and the run for 16 January used `alpha=1.0`. The data hash is unchanged — same seed, same split — but the code hash changed, and so did the RMSE. Every training run registered a model version, so version 3 is the `alpha=1.0` model; its MLflow run tells an auditor exactly which code, data and Airflow run produced it.

### 6. Clean up

```bash run
docker rm -f devforge-airflow devforge-mlflow > /dev/null
docker network rm devforge-ml-net > /dev/null
docker image rm devforge-airflow-ml:lab > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Unseeded randomness** — data splits, model initialisation, sampling. Fix every seed you can, and log them as parameters.
- **Training on "the latest" data.** Write and read data for the run's date, or record a snapshot ID; otherwise a rerun trains on different data.
- **Unpinned libraries.** A scikit-learn upgrade can change results; pin versions in the image, as here.
- **Registering every run as a candidate for production.** Register freely, but promote with an alias only after an evaluation gate (see the registry lesson and the lab).
- **Logging lineage at the end.** If training crashes, the run should still say what it was trying; set tags first.

## Where this fits in a real system

The image is built in **GitHub Actions** or **Jenkins** and stored in a registry; **Airflow** (often on **Kubernetes**, where heavy training runs in its own pod) schedules the pipeline; **MLflow** records runs and versions in **PostgreSQL** and object storage, as in the previous lesson; the next lesson serves and monitors the resulting model.
