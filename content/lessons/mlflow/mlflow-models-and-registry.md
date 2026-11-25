---
id: mlflow-models-and-registry
title: Models, signatures and the registry
track: mlflow
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [mlflow-comparing-runs]
learning_objectives:
  - Log a trained model with a signature, and register it as a new version.
  - Point an alias such as champion at a version, and load the model by its alias.
  - Promote a new version by moving the alias, without changing the code that uses the model.
resources:
  - title: MLflow Model Registry
    url: https://mlflow.org/docs/latest/ml/model-registry/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: beginner
    official: true
    why: Registered models, versions and aliases, and the models:/<name>@<alias> URI.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Model signatures and input examples
    url: https://mlflow.org/docs/latest/ml/model/signatures/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: intermediate
    official: true
    why: What a signature describes and when MLflow checks inputs against it.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: What's new in MLflow 3
    url: https://mlflow.org/docs/latest/ml/mlflow-3/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: intermediate
    official: true
    why: Models as first-class entities and the name parameter of log_model.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: alias-why
    prompt: The serving code loads models:/diabetes-ridge@champion. A better version 3 is ready. How do you ship it?
    options:
      - { id: a, text: "Change the serving code to load version 3 and redeploy it" }
      - { id: b, text: "Move the champion alias to version 3; code that loads @champion gets version 3 the next time it loads the model" }
      - { id: c, text: "Delete versions 1 and 2" }
    answer: b
    explanation: An alias is a movable name for one version. The code asks for "the champion", and promoting or rolling back is moving that name — no code change.
  - id: signature-why
    prompt: A caller sends data without the bmi column. With a signature logged, what happens?
    options:
      - { id: a, text: "The model predicts anyway, with a wrong result" }
      - { id: b, text: "Loading the model through MLflow's pyfunc interface checks the input against the signature and refuses it, naming the missing column" }
      - { id: c, text: "MLflow fills in bmi with zero" }
    answer: b
    explanation: You see this in the lesson. Without a signature, a wrongly shaped input could produce silent nonsense; with one, it fails loudly at the boundary.
  - id: version-immutable
    prompt: Why does registering again create version 2 instead of replacing version 1?
    options:
      - { id: a, text: "It is a bug" }
      - { id: b, text: "Versions are kept so you can compare, audit and roll back to any of them" }
      - { id: c, text: "MLflow cannot overwrite files" }
    answer: b
    explanation: Each version points to the run and the model files that produced it, so you can always see what was deployed and go back to it.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with ghcr.io/mlflow/mlflow:v3.18.0 (pinned by digest), after the previous lessons; the output shown was recorded from that run. Facts about the registry, aliases and signatures were checked against the MLflow documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

MLflow can store a trained **model** with a **signature** (the inputs and outputs it expects), and the **Model Registry** gives it a name with numbered **versions** — and **aliases** such as `champion` that point at one version, so code can load "the champion" and promotion is just moving the alias.

## Explain it like I'm twelve

A football team has many players, each with a shirt number that never changes. One of them wears the captain's armband. When the coach picks a new captain, the armband moves — the players keep their numbers, and everyone still knows to listen to "the captain".

The players are model **versions**, the armband is an **alias**, and the team is the **registered model**.

Where the analogy breaks: a model's "shirt" also says exactly what it was trained on, so you can always check where it came from.

## What problem it solves

A good run is not useful until something can load its model. Without a registry, "the model in production" is a file path in a config, nobody knows which run produced it, and rolling back means finding the old file. With the registry, each model has a name, versions linked to their runs, and an alias the serving code uses — so promoting, auditing and rolling back are one call.

## How it works

![](media:mlflow/registry-aliases.svg)

- `mlflow.sklearn.log_model(model, name="model", signature=…, registered_model_name=…)` stores the model files with the run and registers them as the next version of a named model.
- A **signature** lists the model's input columns and their types and its output; `infer_signature` builds one from example data.
- An **alias** is a movable, named reference to one version. `models:/diabetes-ridge@champion` loads whichever version the alias points to now.

## Try it yourself

> **Local lab** — continue with the `devforge-mlflow` container, from inside `mlflow-lab`, with `MLF` and `mlpy` defined (lesson 1). Every command is run automatically in DevForge's tests.

### 1. Log and register two models

```bash run
cat > register.py <<'EOF'
import sys
import mlflow
from mlflow.models import infer_signature
from sklearn.datasets import load_diabetes
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split

alpha = float(sys.argv[1])
X, y = load_diabetes(return_X_y=True, as_frame=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)

mlflow.set_experiment("diabetes")
with mlflow.start_run(run_name=f"ridge-{alpha}-registered"):
    model = Ridge(alpha=alpha).fit(X_train, y_train)
    mlflow.log_param("alpha", alpha)
    signature = infer_signature(X_train, model.predict(X_train))
    info = mlflow.sklearn.log_model(model, name="model", signature=signature, input_example=X_train.head(2),
                                    registered_model_name="diabetes-ridge")
    print("version", info.registered_model_version, "inputs:", ", ".join(signature.inputs.input_names()))
EOF
mlpy 1.0 < register.py
mlpy 0.1 < register.py
```

```text output
Successfully registered model 'diabetes-ridge'.
Created version '1' of model 'diabetes-ridge'.
version 1 inputs: age, sex, bmi, bp, s1, s2, s3, s4, s5, s6
Registered model 'diabetes-ridge' already exists. Creating a new version of this model...
Created version '2' of model 'diabetes-ridge'.
version 2 inputs: age, sex, bmi, bp, s1, s2, s3, s4, s5, s6
```

- `as_frame=True` loads the data as a pandas table with named columns, so the signature lists them by name.
- This lesson registers Ridge models only, so the two versions differ in one setting. (Lasso with `alpha` 0.1 did slightly better in the previous lesson; registering it would work the same way.)
- The first call creates the registered model **diabetes-ridge** with version 1; the second adds version 2. Earlier versions are never overwritten.

### 2. Make version 1 the champion, and use it

```bash run
cat > predict.py <<'EOF'
import mlflow
from sklearn.datasets import load_diabetes

model = mlflow.pyfunc.load_model("models:/diabetes-ridge@champion")
X, _ = load_diabetes(return_X_y=True, as_frame=True)
print("predictions for 3 patients:", model.predict(X.head(3)).round(1).tolist())
EOF
mlpy <<'EOF'
from mlflow import MlflowClient
MlflowClient().set_registered_model_alias("diabetes-ridge", "champion", "1")
EOF
mlpy < predict.py
```

```text output
predictions for 3 patients: [182.4, 96.3, 168.4]
```

`predict.py` stands for the code that uses the model — a web service, a batch job. It never mentions a version: it asks for the **champion**.

### 3. Promote version 2 by moving the alias

Version 2 (`alpha` 0.1) had the lower error of the two in lesson 1. Promote it — and run the *same* `predict.py`:

```bash run
mlpy <<'EOF'
from mlflow import MlflowClient
MlflowClient().set_registered_model_alias("diabetes-ridge", "champion", "2")
EOF
mlpy < predict.py
curl -s "$MLF/api/2.0/mlflow/registered-models/alias?name=diabetes-ridge&alias=champion" | tr -d ' \n' | grep -o '"version":"[0-9]*"'
```

```text output
predictions for 3 patients: [204.6, 76.0, 180.3]
"version":"2"
```

- The predictions changed because a different model answered — with no change to `predict.py`. Rolling back would be moving the alias back to `1`.
- The REST API confirms which version the alias points to.

### 4. The signature guards the door

```bash run
mlpy <<'EOF'
import mlflow
from sklearn.datasets import load_diabetes

model = mlflow.pyfunc.load_model("models:/diabetes-ridge@champion")
X, _ = load_diabetes(return_X_y=True, as_frame=True)
try:
    model.predict(X.drop(columns=["bmi"]).head(1))
except mlflow.exceptions.MlflowException as e:
    print("refused:", str(e).split("Error: ")[-1])
EOF
```

```text output
refused: Model is missing inputs ['bmi'].
```

A caller forgot the `bmi` column. Instead of predicting nonsense, MLflow checks the input against the signature and refuses, naming the missing column.

### 5. Clean up

This removes the MLflow server, its database and every stored model:

```bash run
docker rm -f devforge-mlflow
```

```text output
devforge-mlflow
```

Your scripts stay in `mlflow-lab`.

## Try it in the simulation

A too-slow version was promoted to champion. Fix it by moving the alias — no retraining. It is a labelled teaching model with invented numbers, not a real MLflow server.

```simulation mlflow-experiment-explorer scenario=over-budget
```

## Common mistakes

- **Loading models by file path or run ID in serving code.** Use `models:/<name>@<alias>` so promotion and rollback do not need a code change.
- **Logging models without a signature.** Then nothing checks inputs, and a missing or renamed column produces silent garbage.
- **Moving the alias before checking the new version.** Compare it against the current champion first — on data it was not chosen with.
- **Forgetting that the registry depends on the tracking server's storage.** If the database or artifact store is lost, so are the versions; back them up like any production data.

## Where this fits in a real system

A training pipeline in **Airflow** logs and registers a new version; checks compare it with the champion; a person or an automated gate moves the alias. The serving service — often a **Docker** container on **Kubernetes** — loads `@champion`, and **Prometheus** and **Grafana** watch its predictions and latency so a bad promotion can be rolled back quickly.
