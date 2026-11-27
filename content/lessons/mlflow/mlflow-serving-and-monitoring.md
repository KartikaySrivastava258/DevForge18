---
id: mlflow-serving-and-monitoring
title: Serving and monitoring models
track: mlflow
order: 6
level: advanced
estimated_minutes: 55
prerequisites: [mlflow-reproducible-pipelines-with-airflow]
starts_fresh: true
learning_objectives:
  - Serve a registered model by alias with mlflow models serve, and call its REST endpoints (/ping, /version, /invocations).
  - Show the model signature rejecting malformed input before it reaches the model.
  - Promote and roll back by moving an alias, and explain why a running server must be reloaded to pick up the change.
  - Log predictions and measure input drift with the population stability index (PSI), and explain what else production monitoring needs.
resources:
  - title: MLflow Model Serving (local REST server)
    url: https://mlflow.org/docs/latest/ml/deployment/deploy-model-locally/
    publisher: MLflow (Linux Foundation project)
    type: documentation
    level: intermediate
    official: true
    why: mlflow models serve starts a REST server with /ping, /health, /version and /invocations; the input formats (dataframe_split, dataframe_records, instances, inputs).
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Model signatures and input examples
    url: https://mlflow.org/docs/latest/ml/model/signatures/
    publisher: MLflow (Linux Foundation project)
    type: documentation
    level: intermediate
    official: true
    why: A signature describes the expected inputs and outputs; MLflow enforces it when the model is loaded as a pyfunc and served.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Model Registry — aliases
    url: https://mlflow.org/docs/latest/ml/model-registry/
    publisher: MLflow (Linux Foundation project)
    type: documentation
    level: intermediate
    official: true
    why: Aliases are mutable named references to model versions, used as models:/<name>@<alias> to deploy and to roll back.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: alias
    prompt: You moved the champion alias from version 1 to version 2, but the server still returns version 1's predictions. Why?
    options:
      - { id: a, text: "The alias update failed" }
      - { id: b, text: "The server resolved models:/…@champion once, when it loaded the model; it must be restarted or redeployed to load the version the alias now points to" }
      - { id: c, text: "Version 2 is broken" }
    answer: b
    explanation: The lab shows the prediction change only after the serving container restarts. Rollback works the same way.
  - id: signature
    prompt: A client sends only two of the ten features. What should happen, and what does?
    options:
      - { id: a, text: "The model fills in zeros" }
      - { id: b, text: "The request is rejected (HTTP 400) by signature enforcement, with a message naming the expected columns — the model never sees bad input" }
      - { id: c, text: "The server crashes" }
    answer: b
    explanation: Log models with a signature; it is your first line of defence.
  - id: drift
    prompt: Accuracy cannot be measured yet because true outcomes arrive weeks later. What can you watch today?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "The inputs (drift against the training data, missing values, out-of-range values) and the predictions' distribution, plus latency and error rates" }
      - { id: c, text: "Only CPU usage" }
    answer: b
    explanation: Input drift is an early warning; it does not prove the model is wrong, but it tells you to look.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official ghcr.io/mlflow/mlflow:v3.18.0 image (pinned by digest), starting from nothing; output is compared with this lesson. The "live" traffic is the held-out test set, and the shifted traffic is the same rows with one feature increased on purpose — a labelled simulation, not real data. The PSI alert threshold is this lab's choice. Checked against the MLflow documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

**Serving** turns a registered model into an HTTP endpoint (`mlflow models serve -m models:/<name>@<alias>`), the **signature** guards its inputs, **aliases** make promotion and rollback a pointer change plus a reload, and **monitoring** watches latency, errors and how the incoming data **drifts** away from what the model was trained on.

## Explain it like I'm twelve

The canteen has a recipe card on the wall labelled "today's soup" (the alias). Cooks make whatever that card says — but only after they read it at the start of the shift; change the card at noon and the cooks keep making the morning soup until they look again (a reload). The serving hatch refuses orders written on the wrong form (the signature). And someone counts what people order: if suddenly everyone asks for extra salt, the recipe may no longer suit the customers (drift).

## What problem it solves

A model in a notebook helps nobody; a model behind an API can be used by an app. But APIs receive malformed requests, new versions sometimes behave worse, and the world changes after training. Serving with signatures, aliases and monitoring makes deployment routine, rollback fast, and silent degradation visible.

## How it works

![](media:mlflow/serving-and-monitoring.svg)

- `mlflow models serve` loads a model (here from the registry by alias) as a *pyfunc* and starts a REST server: `/ping` and `/health` for health checks, `/version` for the MLflow version, `/invocations` for predictions (JSON such as `{"dataframe_split": {"columns": […], "data": […]}}`).
- The **signature** logged with the model is enforced on every request: missing columns or wrong types are rejected with HTTP 400.
- **Aliases** (`champion`, `challenger`) are resolved when the model is loaded. Moving an alias changes what the *next* load gets.
- **Monitoring** is mostly yours to add: log requests and predictions, compare input distributions with the training data (for example with the population stability index), track latency and error rates, and — when true outcomes arrive — accuracy.

## Try it yourself

> **Local lab** — needs Docker. A tracking server and a separate model server run from the official MLflow image on the `devforge-mlflow-net` network. Every command is run automatically in DevForge's tests.

### 1. A tracking server and a registered model with a signature

```bash run
mkdir -p mlflow-serving && cd mlflow-serving
IMAGE=ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13
docker pull -q "$IMAGE" > /dev/null
docker network create devforge-mlflow-net > /dev/null
docker run -d --name devforge-mlflow --hostname mlflow --network devforge-mlflow-net -p 127.0.0.1:5051:5000 -v "$PWD:/lab" "$IMAGE" \
  mlflow server --host 0.0.0.0 --port 5000 --allowed-hosts "mlflow:5000,127.0.0.1:5051,127.0.0.1:5000" > /dev/null
MLF=http://127.0.0.1:5051
for i in $(seq 1 90); do curl -sf "$MLF/health" > /dev/null && break; sleep 1; done
cat > train.py <<'EOF'
import sys, mlflow
from mlflow.models import infer_signature
from sklearn.datasets import load_diabetes
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split
alpha = float(sys.argv[1])
X, y = load_diabetes(return_X_y=True, as_frame=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
X_train.to_csv("/lab/train_features.csv", index=False)       # kept for drift checks
X_test.to_csv("/lab/live_features.csv", index=False)         # stands in for live traffic
mlflow.set_experiment("serving")
with mlflow.start_run():
    model = Ridge(alpha=alpha).fit(X_train, y_train)
    info = mlflow.sklearn.log_model(model, name="model", registered_model_name="diabetes-serving",
                                    signature=infer_signature(X_train, model.predict(X_train)))
    print(f"registered version {info.registered_model_version} (alpha={alpha})")
EOF
ml() { docker exec -i -e MLFLOW_TRACKING_URI=http://127.0.0.1:5000 -e MLFLOW_SUPPRESS_PRINTING_URL_TO_STDOUT=true \
  -e MLFLOW_LOGGING_LEVEL=WARNING -e GIT_PYTHON_REFRESH=quiet devforge-mlflow python "$@" 2>&1 | grep -v "^Successfully registered\|^Created version\|^Registered model"; }
alias_to() { curl -s -X POST "$MLF/api/2.0/mlflow/registered-models/alias" -H 'Content-Type: application/json' \
  -d "{\"name\": \"diabetes-serving\", \"alias\": \"champion\", \"version\": \"$1\"}" > /dev/null; echo "champion → version $1"; }
ml /lab/train.py 0.5
alias_to 1
```

```text output
registered version 1 (alpha=0.5)
champion → version 1
```

### 2. Serve the champion

```bash run
docker run -d --name devforge-mlflow-serve --network devforge-mlflow-net -p 127.0.0.1:5052:5001 \
  -e MLFLOW_TRACKING_URI=http://mlflow:5000 -e GIT_PYTHON_REFRESH=quiet "$IMAGE" \
  mlflow models serve -m models:/diabetes-serving@champion --env-manager local --host 0.0.0.0 --port 5001 > /dev/null
SRV=http://127.0.0.1:5052
wait_serving() { for i in $(seq 1 120); do curl -sf "$SRV/ping" > /dev/null && break; sleep 1; done; }
wait_serving
echo "/ping    → HTTP $(curl -s -o /dev/null -w '%{http_code}' "$SRV/ping")"
echo "/version → $(curl -s "$SRV/version")"
COLUMNS_JSON='["age","sex","bmi","bp","s1","s2","s3","s4","s5","s6"]'
predict() { curl -s -X POST "$SRV/invocations" -H 'Content-Type: application/json' \
  -d "{\"dataframe_split\": {\"columns\": $COLUMNS_JSON, \"data\": [[0.038,0.051,0.062,0.022,-0.044,-0.035,-0.043,-0.003,0.020,-0.018]]}}" \
  | python3 -c 'import json, sys; print("prediction:", round(json.load(sys.stdin)["predictions"][0], 2))'; }
predict
```

```text output
/ping    → HTTP 200
/version → 3.18.0
prediction: 191.06
```

- `--env-manager local` uses the libraries already in the image instead of creating a fresh environment from the model's requirements; production images are built with exactly those requirements.
- The model server knows only the tracking server's URL; it resolved `models:/diabetes-serving@champion` to version 1 and downloaded the model at start-up.

### 3. The signature guards the inputs

```bash run
curl -s -o reply.json -w 'HTTP %{http_code}\n' -X POST "$SRV/invocations" -H 'Content-Type: application/json' \
  -d '{"dataframe_split": {"columns": ["age", "bmi"], "data": [[0.03, 0.06]]}}'
python3 -c 'import json; r = json.load(open("reply.json")); print(r["error_code"]); print("names the missing columns:", all(c in r["message"] for c in ["sex", "bp", "s6"]))'
```

```text output
HTTP 400
INVALID_PARAMETER_VALUE
names the missing columns: True
```

The request had two columns instead of ten. Signature enforcement rejected it before the model ran, with an error message that lists the expected columns — far better than a silent wrong prediction.

### 4. Promote, notice the reload, roll back

```bash run
ml /lab/train.py 5.0
alias_to 2
echo "before reload: $(predict)"
docker restart devforge-mlflow-serve > /dev/null; wait_serving
echo "after reload:  $(predict)"
alias_to 1
docker restart devforge-mlflow-serve > /dev/null; wait_serving
echo "rolled back:   $(predict)"
```

```text output
registered version 2 (alpha=5.0)
champion → version 2
before reload: prediction: 191.06
after reload:  prediction: 164.64
champion → version 1
rolled back:   prediction: 191.06
```

- Moving the alias changed nothing for the running server: it had resolved `@champion` at start-up. Only the restart — in production, a rolling redeploy — loaded version 2.
- Rolling back was the same two steps in reverse; no files were copied and version 2 is still in the registry for later analysis.
- Version 2 (a much stronger penalty, `alpha=5.0`) predicts very differently for the same person — exactly why a new version should pass an evaluation gate before the alias moves.

### 5. Log predictions and check for drift

```bash run
cat > monitor.py <<'EOF'
"""Send 'live' rows to the model, log each request and prediction, then compare inputs with the training data."""
import json, math, sys, urllib.request
import pandas as pd

def predict(df):
    body = json.dumps({"dataframe_split": {"columns": list(df.columns), "data": df.values.tolist()}}).encode()
    req = urllib.request.Request("http://devforge-mlflow-serve:5001/invocations", body, {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["predictions"]

def psi(expected, actual, bins=10):
    """Population stability index over the training data's deciles."""
    edges = list(expected.quantile([i / bins for i in range(1, bins)]))
    share = lambda s: [max(((s > lo) & (s <= hi)).mean(), 1e-4)
                       for lo, hi in zip([-math.inf] + edges, edges + [math.inf])]
    return sum((a - e) * math.log(a / e) for e, a in zip(share(expected), share(actual)))

train = pd.read_csv("/lab/train_features.csv")
live = pd.read_csv("/lab/live_features.csv")
if sys.argv[1] == "shifted":                     # simulation: the population's BMI rises
    live["bmi"] = live["bmi"] + 0.03
predictions = predict(live)
with open(f"/lab/predictions-{sys.argv[1]}.jsonl", "w") as log:
    for row, p in zip(live.to_dict("records"), predictions):
        log.write(json.dumps({"features": row, "prediction": p}) + "\n")
value = psi(train["bmi"], live["bmi"])
print(f"{sys.argv[1]:8} traffic: {len(predictions)} predictions logged, "
      f"mean prediction {sum(predictions) / len(predictions):.1f}, bmi PSI {value:.2f} → {'ALERT' if value > 0.2 else 'ok'}")
EOF
ml /lab/monitor.py normal
ml /lab/monitor.py shifted
echo "log lines: $(cat predictions-normal.jsonl | wc -l) + $(cat predictions-shifted.jsonl | wc -l)"
```

```text output
normal   traffic: 111 predictions logged, mean prediction 145.6, bmi PSI 0.18 → ok
shifted  traffic: 111 predictions logged, mean prediction 156.5, bmi PSI 0.37 → ALERT
log lines: 111 + 111
```

- Every request and prediction is written to a log — the raw material for all monitoring. The scoring server does not do this for you; a wrapper, a gateway or the calling service must.
- The **population stability index** compares how the live values of a feature spread across the training data's deciles. The held-out rows come from the same population, yet score 0.18, not 0: 111 rows spread over 10 bins is a small sample, so chance alone moves a few rows between bins. The simulated rise in BMI doubles the score and pushes it over the line, and the mean prediction rises with it. The 0.2 alert threshold is this lab's choice — teams set thresholds per feature from their own history and use larger windows of traffic so that noise stays well below them.
- Drift says "look", not "the model is wrong". Confirm with accuracy once true outcomes arrive, then retrain through the pipeline from the previous lesson.

### 6. Clean up

```bash run
docker rm -f devforge-mlflow-serve devforge-mlflow > /dev/null
docker network rm devforge-mlflow-net > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Serving a model without a signature.** Malformed requests produce nonsense instead of errors.
- **Pointing production at a version number baked into the deployment.** Use an alias, so promotion and rollback do not need a code change — and remember the reload.
- **Assuming an alias change is instant.** Running servers keep what they loaded; redeploy (or reload) deliberately.
- **Monitoring only CPU and memory.** Log inputs and predictions, and watch drift, latency and error rates per model version.
- **Treating drift as proof of failure.** Investigate, compare with outcomes, and retrain through the reproducible pipeline.

## Where this fits in a real system

The model server is packaged as an image (`mlflow models build-docker`, or a custom image) and run on **Kubernetes** behind a Service, with **Nginx** or an ingress in front; a rollout is triggered when the alias moves, often by **GitHub Actions** or **Jenkins**. Request logs flow through **Kafka** to storage, a scheduled **Airflow** job computes drift and accuracy, and **Prometheus** with **Grafana** alert on latency, errors and drift scores. Traces from **OpenTelemetry** connect a slow prediction to the request that caused it.
