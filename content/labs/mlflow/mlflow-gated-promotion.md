---
id: mlflow-gated-promotion
title: Register and promote a model using the current MLflow workflow
track: mlflow
level: advanced
mode: local
estimated_minutes: 40
prerequisites: [mlflow-comparing-runs]
objectives:
  - Register candidate models as new versions and promote one by moving the champion alias.
  - Write a promotion gate that evaluates the candidate and the current champion on the same held-out data and only promotes a better candidate.
  - Record each gate decision on the model version itself, so the registry explains why the champion is the champion.
checkpoints:
  - { id: promoted, text: "Version 2 replaced version 1 as champion because its error was lower" }
  - { id: rejected, text: "Version 3 was rejected, the gate exited with code 1 and the champion stayed version 2" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: MLflow Model Registry
    url: https://mlflow.org/docs/latest/ml/model-registry/
    publisher: MLflow documentation
    type: documentation
    level: intermediate
    official: true
    why: Registered models, versions, aliases and tags — the pieces the gate uses.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with MLflow 3.18.0 (ghcr.io/mlflow/mlflow, pinned by digest) in Docker, after the previous lessons, and their output is compared with this page. The data is scikit-learn's built-in diabetes dataset with a fixed split, so the errors are the same on every run. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Moving an alias is one line of code — which is why promotions need a **gate**. You write a script that a CI job could run for every new model version: it evaluates the candidate and the current champion on the same held-out data, promotes the candidate only if it is better, records its decision on the version, and exits non-zero when it refuses. Then you send it a good candidate and a bad one.

## Before you start

Continue from *Comparing runs*: the MLflow server running in `devforge-mlflow`, your terminal in `mlflow-lab`, and `MLF` and `mlpy` defined (define them again from the first lesson if you opened a new terminal).

## Steps

### 1. A script that registers a candidate

```bash run
cat > candidate.py <<'EOF'
import sys
import mlflow
from mlflow.models import infer_signature
from sklearn.datasets import load_diabetes
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split

alpha = float(sys.argv[1])
X, y = load_diabetes(return_X_y=True, as_frame=True)
X_train, _, y_train, _ = train_test_split(X, y, test_size=0.25, random_state=42)

mlflow.set_experiment("diabetes-gated")
with mlflow.start_run(run_name=f"ridge-{alpha}"):
    model = Ridge(alpha=alpha).fit(X_train, y_train)
    mlflow.log_param("alpha", alpha)
    info = mlflow.sklearn.log_model(model, name="model", signature=infer_signature(X_train, model.predict(X_train)),
                                    registered_model_name="diabetes-gated")
    print(f"registered version {info.registered_model_version} (alpha={alpha})")
EOF
mlpy 1.0 < candidate.py 2>&1 | grep '^registered'
```

```text output
registered version 1 (alpha=1.0)
```

The candidate is trained only on the training part of the split. The other quarter — the **held-out** data — is kept for judging it.

### 2. The gate

```bash run
cat > gate.py <<'EOF'
# Usage: gate.py <registered model> <candidate version>
# Promotes the candidate to @champion only if it beats the current champion
# on the same held-out data. Exit code 0 = promoted, 1 = rejected.
import sys
import mlflow
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException
from sklearn.datasets import load_diabetes
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import train_test_split

name, candidate = sys.argv[1], sys.argv[2]
client = MlflowClient()
X, y = load_diabetes(return_X_y=True, as_frame=True)
_, X_test, _, y_test = train_test_split(X, y, test_size=0.25, random_state=42)


def rmse(model_uri):
    return mean_squared_error(y_test, mlflow.pyfunc.load_model(model_uri).predict(X_test)) ** 0.5


new = rmse(f"models:/{name}/{candidate}")
try:
    champion = client.get_model_version_by_alias(name, "champion").version
    old = rmse(f"models:/{name}@champion")
except MlflowException:  # no champion yet
    champion, old = None, None

passed = old is None or new < old
client.set_model_version_tag(name, candidate, "gate", "passed" if passed else "failed")
client.set_model_version_tag(name, candidate, "gate_rmse", f"{new:.2f}")
if passed:
    client.set_registered_model_alias(name, "champion", candidate)
    against = "there is no champion yet" if old is None else f"beats version {champion} ({old:.2f})"
    print(f"version {candidate}: rmse {new:.2f}, {against} -> promoted to champion")
else:
    print(f"version {candidate}: rmse {new:.2f}, not better than version {champion} ({old:.2f}) -> rejected")
sys.exit(0 if passed else 1)
EOF
mlpy diabetes-gated 1 < gate.py 2>&1 | grep '^version'
```

```text output
version 1: rmse 55.73, there is no champion yet -> promoted to champion
```

- Both models are judged on **the same** held-out rows, loaded through the registry (`models:/…`) exactly as a service would load them.
- The decision is written onto the version as **tags**, so anyone looking at the registry later sees why it was promoted or not.
- The exit code lets a CI job fail when a candidate is rejected.

### 3. A better candidate

```bash run
mlpy 0.1 < candidate.py 2>&1 | grep '^registered'
mlpy diabetes-gated 2 < gate.py 2>&1 | grep '^version'
```

```text output
registered version 2 (alpha=0.1)
version 2: rmse 53.01, beats version 1 (55.73) -> promoted to champion
```

### 4. A worse candidate

Someone trains with far too much regularisation:

```bash run
mlpy 100 < candidate.py 2>&1 | grep '^registered'
mlpy diabetes-gated 3 < gate.py > gate.log 2>&1 || echo "gate exit code: $?"
grep '^version' gate.log
```

```text output
registered version 3 (alpha=100.0)
gate exit code: 1
version 3: rmse 74.02, not better than version 2 (53.01) -> rejected
```

Version 3 is registered — the registry keeps every version — but it is **not** the champion, and in a CI pipeline the red exit code would stop the release.

### 5. Read the registry's record

```bash run
mlpy <<'EOF' 2>&1 | grep -v '^$'
from mlflow import MlflowClient
client = MlflowClient()
champion = client.get_model_version_by_alias("diabetes-gated", "champion").version
for v in sorted(client.search_model_versions("name='diabetes-gated'"), key=lambda v: int(v.version)):
    mark = "  <- champion" if v.version == champion else ""
    print(f"version {v.version}: gate={v.tags.get('gate')}{mark}")
EOF
```

```text output
version 1: gate=passed
version 2: gate=passed  <- champion
version 3: gate=failed
```

Version 1 also passed — it was the best model *at the time*. The registry now answers "which model is serving, and why" without anyone's memory. Rolling back would still be one alias move; the gate only decides what moves forward.

## Check your work

Run this inside `mlflow-lab` while the MLflow server is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
MLF=http://127.0.0.1:5050
version() { curl -s "$MLF/api/2.0/mlflow/model-versions/get?name=diabetes-gated&version=$1" | tr -d ' \n'; }
check "gate.py exists and exits 1 when it rejects" '[ -f gate.py ] && grep -q "sys.exit(0 if passed else 1)" gate.py'
check "the champion alias points to version 2" 'curl -s "$MLF/api/2.0/mlflow/registered-models/alias?name=diabetes-gated&alias=champion" | tr -d " \n" | grep "\"version\":\"2\"" > /dev/null'
check "version 2 is tagged gate=passed" 'version 2 | grep "{\"key\":\"gate\",\"value\":\"passed\"}" > /dev/null'
check "version 3 is registered and tagged gate=failed" 'version 3 | grep "{\"key\":\"gate\",\"value\":\"failed\"}" > /dev/null'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: gate.py exists and exits 1 when it rejects
PASS: the champion alias points to version 2
PASS: version 2 is tagged gate=passed
PASS: version 3 is registered and tagged gate=failed
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-mlflow
```

```text output
devforge-mlflow
```

## Reset

Remove the container (as above), start MLflow again with step 1 of *Tracking runs* and define `mlpy`, then begin this lab at step 1.

## What you practised

A model registry records versions; a gate decides which one serves. Evaluate candidate and champion on the same held-out data, promote only improvements, write the decision onto the version, and let the exit code fail the pipeline — then promotion is a reviewed, repeatable step instead of a judgement call at a keyboard.
