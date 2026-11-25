---
id: mlflow-tracking-runs
title: Experiments, runs, parameters and metrics
track: mlflow
order: 1
level: beginner
estimated_minutes: 35
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain what MLflow records for a run — parameters, metrics and artifacts — and how runs are grouped into experiments.
  - Start an MLflow tracking server locally and log a scikit-learn training run to it.
  - Read the logged runs back through MLflow's REST API.
resources:
  - title: MLflow Tracking
    url: https://mlflow.org/docs/latest/ml/tracking/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: beginner
    official: true
    why: Runs, experiments, what a run records, and the backend and artifact stores.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: MLflow tracking server
    url: https://mlflow.org/docs/latest/self-hosting/architecture/tracking-server/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: intermediate
    official: true
    why: What mlflow server runs, its defaults (127.0.0.1:5000, SQLite) and how it serves artifacts.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: param-or-metric
    prompt: You train a model with a learning rate of 0.01 and it reaches an error of 53.0 on test data. How should each be logged?
    options:
      - { id: a, text: "Both as metrics" }
      - { id: b, text: "The learning rate as a parameter (an input you chose) and the error as a metric (a result you measured)" }
      - { id: c, text: "Both as artifacts" }
    answer: b
    explanation: Parameters are the settings that went into a run; metrics are the numbers that came out. Keeping them apart is what lets you ask "which settings gave the lowest error?" later.
  - id: what-is-a-run
    prompt: What is an MLflow run?
    options:
      - { id: a, text: "One execution of your training code — for example one python train.py — with everything it recorded" }
      - { id: b, text: "A saved model file" }
      - { id: c, text: "A server process" }
    answer: a
    explanation: The MLflow documentation describes runs as executions of some piece of data science code. Each records parameters, metrics, start and end times and artifacts; an experiment groups related runs.
  - id: why-server
    prompt: Why do teams run a shared MLflow tracking server instead of each person logging to a folder on their laptop?
    options:
      - { id: a, text: "It makes training faster" }
      - { id: b, text: "Everyone's runs land in one place, so they can be compared, searched and reproduced by the whole team" }
      - { id: c, text: "MLflow cannot log locally" }
    answer: b
    explanation: MLflow can log to a local folder, but then nobody else can see the runs. A tracking server keeps metadata in a database and artifacts in storage that the whole team uses.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official ghcr.io/mlflow/mlflow:v3.18.0 image (pinned by digest); the output shown was recorded from that run. Facts about runs, experiments and the tracking server were checked against the MLflow documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**MLflow** keeps a lab notebook for machine learning: every time you train a model it records a **run** — the **parameters** you chose, the **metrics** you measured and the files you produced (**artifacts**) — and groups related runs into **experiments**, so you can compare them later.

## Explain it like I'm twelve

You are trying to bake the perfect cookie. Each batch you change something — more sugar, a hotter oven — and taste the result. If you do not write it down, after ten batches you cannot remember which oven setting made the best ones.

So you keep a notebook: one line per batch, with what you changed and how it tasted. The notebook is **MLflow**, each line is a **run**, what you changed is a **parameter**, the taste score is a **metric**, and the whole "perfect cookie" project is an **experiment**.

Where the analogy breaks: MLflow also keeps the cookies — the trained model files — so you can pick the best one up again later.

## What problem it solves

Training a model means trying many settings. Without a record, results live in terminal scrollback and notebook cells, nobody can tell which code and settings produced the model in production, and "the good run from last Tuesday" is lost. MLflow records every run the same way, in one place, from a few lines of code.

## How it works

![](media:mlflow/tracking-parts.svg)

- Your training code calls MLflow's Python API: `mlflow.log_param`, `mlflow.log_metric`, and functions that log files and models.
- The calls go to a **tracking server** (or straight to a local folder). The server keeps run metadata — parameters, metrics, times — in its **backend store**, a database, and larger files in its **artifact store**.
- The server also serves the MLflow web interface and a REST API for searching runs.

## Try it yourself

> **Local lab** — needs Docker. MLflow runs in the official container, which also contains Python, scikit-learn and pandas, so nothing is installed on your computer. Every command is run automatically in DevForge's tests. Run it where nothing else is called `devforge-mlflow`; the last lesson of this series removes it.

### 1. Start a tracking server

```bash run
mkdir -p mlflow-lab && cd mlflow-lab
IMAGE=ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
docker pull -q "$IMAGE"
docker run -d --name devforge-mlflow -p 127.0.0.1:5050:5000 "$IMAGE" mlflow server --host 0.0.0.0 --port 5000 > /dev/null
MLF=http://127.0.0.1:5050
for i in $(seq 1 90); do curl -sf "$MLF/health" > /dev/null && break; sleep 1; done
curl -s "$MLF/health"; echo
```

```text output
ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
OK
```

- The image is MLflow's official one, pinned to version 3.18.0 *and* its digest. `docker pull -q` downloads it (about 1 GB, once) and prints only its name.
- `mlflow server` listens on `127.0.0.1` by default, which inside a container means "only from inside the container". `--host 0.0.0.0` makes it reachable through the published port, and `-p 127.0.0.1:5050:5000` keeps that port on your own computer only.
- With no other options, the server keeps run metadata in a SQLite database file and artifacts in a local folder — fine for learning; a team would use a real database and object storage.
- The loop waits until `/health` answers, for at most 90 seconds.

### 2. A training script that logs to MLflow

```bash run
cat > train.py <<'EOF'
import sys
import mlflow
from sklearn.datasets import load_diabetes
from sklearn.linear_model import Lasso, Ridge
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

kind, alpha = sys.argv[1], float(sys.argv[2])
X, y = load_diabetes(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)

mlflow.set_experiment("diabetes")
with mlflow.start_run(run_name=f"{kind}-{alpha}"):
    model = (Ridge if kind == "ridge" else Lasso)(alpha=alpha).fit(X_train, y_train)
    pred = model.predict(X_test)
    rmse = mean_squared_error(y_test, pred) ** 0.5
    mlflow.log_param("model", kind)
    mlflow.log_param("alpha", alpha)
    mlflow.log_metric("rmse", rmse)
    mlflow.log_metric("r2", r2_score(y_test, pred))
    print(f"{kind} alpha={alpha}: rmse={rmse:.2f}")
EOF
mlpy() {
  docker exec -i -e MLFLOW_TRACKING_URI=http://127.0.0.1:5000 -e MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT=true \
    -e MLFLOW_LOGGING_LEVEL=WARNING -e GIT_PYTHON_REFRESH=quiet devforge-mlflow python - "$@"
}
```

- The script trains a linear model on scikit-learn's built-in **diabetes** dataset (442 patients; it predicts how a disease progresses after a year). The data ships with scikit-learn, so nothing is downloaded, and `random_state=42` makes the train/test split the same every time.
- `mlflow.set_experiment("diabetes")` picks the experiment (and creates it the first time). Everything inside `with mlflow.start_run()` belongs to one run.
- **RMSE** (root mean squared error) is the typical size of a prediction's error — lower is better. **R²** says how much of the variation the model explains — closer to 1 is better.
- `mlpy` is a shell function that feeds a Python script to the container's Python. `MLFLOW_TRACKING_URI` tells MLflow where the server is (from inside the container, it is on port 5000). The other settings only quieten messages: the run's web address, MLflow's informational logging, and a warning that Git is not installed in the container. If you open a new terminal, define `mlpy` again.

### 3. Log two runs

```bash run
mlpy ridge 1.0 < train.py
mlpy ridge 0.1 < train.py
```

```text output
ridge alpha=1.0: rmse=55.73
ridge alpha=0.1: rmse=53.01
```

Two runs, two settings, two results: the smaller `alpha` (less regularisation) predicts better on this data. You would see the same numbers — the data and the split are fixed.

### 4. Read the runs back through the REST API

```bash run
curl -s "$MLF/api/2.0/mlflow/experiments/get-by-name?experiment_name=diabetes" | tr -d ' \n' | grep -o '"experiment_id":"[0-9]*"'
curl -s -X POST "$MLF/api/2.0/mlflow/runs/search" -H 'Content-Type: application/json' \
  -d '{"experiment_ids": ["1"], "order_by": ["metrics.rmse ASC"], "max_results": 1}' \
  | tr -d ' \n' | grep -o '"run_name":"[^"]*"\|"key":"[a-z0-9]*","value":"\{0,1\}[^,"}]*' \
  | sed 's/"key":"\([a-z0-9]*\)","value":"\{0,1\}/\1 = /' | sort
```

```text output
"experiment_id":"1"
"run_name":"ridge-0.1"
alpha = 0.1
model = ridge
r2 = 0.49…
rmse = 53.0…
```

- The first experiment you create gets ID `1` (`0` is the built-in Default experiment).
- `runs/search` finds runs in an experiment — here sorted by RMSE, lowest first, and only the best one. The answer is JSON; `tr`, `grep`, `sed` and `sort` only shorten it to the run's name, parameters and metrics, in a fixed order.
- The metrics come back with every digit MLflow stored; the output above is cut short with `…`.

Open <http://localhost:5050> in a browser to see the same runs in MLflow's web interface: click the **diabetes** experiment and compare the two rows. This step is not part of the automatic tests.

**Keep the container running** for the next lesson.

## Common mistakes

- **Logging results as parameters (or settings as metrics).** Parameters are inputs, metrics are measured outputs; mixing them up breaks every comparison.
- **Not fixing random seeds.** If the data split or the model's randomness changes every run, a better metric may be luck. Fix `random_state` while comparing settings.
- **Logging to a local folder by accident.** Without a tracking URI, MLflow writes to the current directory — runs your team cannot see.
- **Exposing a tracking server to the network without authentication.** The plain server has no login; keep it on localhost or behind an authenticating proxy.

## Where this fits in a real system

Training jobs — often scheduled by **Airflow** — log every run to a shared MLflow server backed by **PostgreSQL** and object storage. The best model is registered and deployed in a **Docker** image, and the team compares new runs against it before anything ships; **GitHub Actions** can run training on each change and log the results to the same server.
