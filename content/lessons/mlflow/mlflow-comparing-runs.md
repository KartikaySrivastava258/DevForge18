---
id: mlflow-comparing-runs
title: Comparing and searching runs
track: mlflow
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [mlflow-tracking-runs]
learning_objectives:
  - Log a small sweep of settings as separate runs.
  - Search and sort runs by their metrics, and filter them by parameters.
  - Choose a run with a stated reason, not just the lowest number.
resources:
  - title: MLflow Tracking
    url: https://mlflow.org/docs/latest/ml/tracking/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: beginner
    official: true
    why: Searching runs, ordering them by a metric, and comparing them in the web interface.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: filter-quotes
    prompt: Why does the filter in this lesson write params.model = 'lasso' with quotes, but metrics.r2 > 0.4 without?
    options:
      - { id: a, text: "Quotes are optional everywhere" }
      - { id: b, text: "Parameters are stored as text, so they are compared with text values; metrics are numbers" }
      - { id: c, text: "Metrics cannot be filtered" }
    answer: b
    explanation: Every parameter is logged as a string — even alpha=0.1 is stored as "0.1" — so a filter compares it with a quoted value. Metrics are numbers and can be compared with < and >.
  - id: test-set-choice
    prompt: You compared twenty settings on the same test set and picked the one with the lowest error. What is the risk?
    options:
      - { id: a, text: "None — the lowest error is always best" }
      - { id: b, text: "With many tries, the winner may be partly lucky on that particular test set; confirm it on data it was not chosen with" }
      - { id: c, text: "MLflow cannot compare twenty runs" }
    answer: b
    explanation: Choosing among many runs on one test set slowly fits the choice to that data. Keep a final set aside (or use cross-validation) for the chosen model.
  - id: not-just-lowest
    prompt: Two runs differ by 0.1 in RMSE; one model is far simpler. Which should you prefer?
    options:
      - { id: a, text: "Always the lower RMSE" }
      - { id: b, text: "Often the simpler one — such a small difference may be noise, and simpler models are easier to explain and run" }
      - { id: c, text: "Neither" }
    answer: b
    explanation: A metric is one input to a decision. When the difference is tiny, simplicity, speed and robustness usually matter more — and MLflow's record lets you show why you chose.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with ghcr.io/mlflow/mlflow:v3.18.0 (pinned by digest), after the previous lesson; the output shown was recorded from that run. Facts about searching runs were checked against the MLflow documentation on 2026-11-25; the filter syntax is shown working rather than asserted.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Once every training run is recorded, choosing a model becomes a **query**: search the experiment's runs, sort them by a metric, filter them by their parameters — and keep the record of why you picked the one you did.

## Explain it like I'm twelve

After twenty batches of cookies, your notebook has twenty lines. To find the best, you do not reread the whole notebook — you sort the lines by taste score, maybe only looking at batches with brown sugar. That is searching runs.

Where the analogy breaks: the best-tasting batch might just have been lucky; with models, you check the winner again on data you did not use to choose it.

## What problem it solves

Hyperparameter sweeps produce dozens or hundreds of runs. Comparing them by eye in a spreadsheet is slow and error-prone. MLflow's search — in Python, in the REST API and in the web interface — answers "which runs did best, and with which settings?" in one call, the same way for everyone on the team.

## How it works

```diagram steps=mlflow/sweep-and-search
```

- Each setting you try is its own run, with its parameters and metrics.
- A search names an experiment, an optional **filter** (`metrics.r2 > 0.4 and params.model = 'lasso'`) and an **order** (`metrics.rmse ASC`).
- In Python, `mlflow.search_runs` returns the runs as a pandas table, one row per run and a column per parameter and metric.

## Try it yourself

> **Local lab** — continue with the `devforge-mlflow` container from the previous lesson, from inside `mlflow-lab`. If you opened a new terminal, set `MLF` and define `mlpy` again (steps 1–2 of the previous lesson). Every command is run automatically in DevForge's tests.

### 1. A small sweep

Two kinds of model, a few values of `alpha` each — six more runs:

```bash run
for alpha in 0.01 0.5 2.0; do mlpy ridge $alpha < train.py; done
for alpha in 0.1 0.5 1.0; do mlpy lasso $alpha < train.py; done
```

```text output
ridge alpha=0.01: rmse=53.26
ridge alpha=0.5: rmse=53.85
ridge alpha=2.0: rmse=58.95
lasso alpha=0.1: rmse=52.48
lasso alpha=0.5: rmse=53.80
lasso alpha=1.0: rmse=58.59
```

**Lasso** is another linear model. Unlike Ridge, it can drive some coefficients to exactly zero, ignoring those inputs; the larger `alpha`, the more it drops — which costs accuracy here at `alpha` 1.0.

### 2. Sort every run by its error

```bash run
mlpy <<'EOF'
import mlflow
runs = mlflow.search_runs(experiment_names=["diabetes"], order_by=["metrics.rmse ASC"])
print(len(runs), "runs")
table = runs[["tags.mlflow.runName", "params.alpha", "metrics.rmse", "metrics.r2"]]
print(table.round(2).to_string(index=False))
EOF
```

```text output
8 runs
tags.mlflow.runName params.alpha  metrics.rmse  metrics.r2
          lasso-0.1          0.1         52.48        0.50
          ridge-0.1          0.1         53.01        0.49
         ridge-0.01         0.01         53.26        0.49
          lasso-0.5          0.5         53.80        0.48
          ridge-0.5          0.5         53.85        0.48
          ridge-1.0          1.0         55.73        0.44
          lasso-1.0          1.0         58.59        0.38
          ridge-2.0          2.0         58.95        0.37
```

- `search_runs` returns a pandas DataFrame: parameters appear as `params.…` columns, metrics as `metrics.…`, and the run's name as the tag `tags.mlflow.runName`.
- Sorted by RMSE, the best runs are at the top: **lasso-0.1** wins. Notice how close the best five are — 52.48 to 53.85.

### 3. Filter by parameters and metrics

```bash run
mlpy <<'EOF'
import mlflow
lasso = mlflow.search_runs(
    experiment_names=["diabetes"],
    filter_string="params.model = 'lasso' and metrics.r2 > 0.4",
    order_by=["metrics.rmse ASC"],
)
print(lasso[["tags.mlflow.runName", "metrics.rmse"]].round(2).to_string(index=False))
EOF
```

```text output
tags.mlflow.runName  metrics.rmse
          lasso-0.1         52.48
          lasso-0.5         53.80
```

- Parameters are compared as text, so the value is quoted: `params.model = 'lasso'`. Metrics are numbers: `metrics.r2 > 0.4`.
- Only the Lasso runs that explain more than 40 % of the variation are left.

### 4. Pick the best run — and record why

```bash run
mlpy <<'EOF'
import mlflow
best = mlflow.search_runs(experiment_names=["diabetes"], order_by=["metrics.rmse ASC"], max_results=1).iloc[0]
print("best:", best["tags.mlflow.runName"], "rmse", round(best["metrics.rmse"], 2))
mlflow.MlflowClient().set_tag(best["run_id"], "decision", "lowest test RMSE in the first sweep")
EOF
curl -s -X POST "$MLF/api/2.0/mlflow/runs/search" -H 'Content-Type: application/json' -d @- <<'EOF' \
  | tr -d ' \n' | grep -o '"run_name":"[^"]*"'
{"experiment_ids": ["1"], "filter": "tags.decision LIKE '%RMSE%'"}
EOF
```

```text output
best: lasso-0.1 rmse 52.48
"run_name":"lasso-0.1"
```

- `max_results=1` with an order returns only the best run.
- A **tag** is free-form text on a run. Writing the reason for a choice next to the run keeps the decision with the evidence.
- The REST search finds the run again by its tag. `-d @-` sends the JSON written below the command, which avoids a tangle of quotes.

**Keep the container running** for the next lesson.

## Try it in the simulation

Ten runs of three kinds of model, with error *and* latency. Find the most accurate one — then the most accurate one that is fast enough for a 5 ms budget. It is a labelled teaching model with invented numbers, not a real MLflow server.

```simulation mlflow-experiment-explorer scenario=latency-budget
```

## Common mistakes

- **Choosing on the test set again and again.** After many comparisons, confirm the winner on data it was not chosen with.
- **Changing two things at once.** If the model and `alpha` both change between runs, you cannot tell which helped.
- **Unquoted parameter values in filters.** `params.alpha = 0.1` does not work; parameters are strings: `params.alpha = '0.1'`.
- **Comparing runs that used different data.** Log which data a run used (a version, a date or a hash), or comparisons are meaningless.
- **Treating a tiny difference as a win.** A 0.1 change in RMSE may be noise; prefer the simpler model when results are this close.

## Where this fits in a real system

Sweeps are often launched by **Airflow** or a CI job in **GitHub Actions**; each trial logs a run, and a final step searches the experiment and registers the best model (next lesson). Dashboards in **Grafana** can then track the chosen model's metrics once it serves traffic.
