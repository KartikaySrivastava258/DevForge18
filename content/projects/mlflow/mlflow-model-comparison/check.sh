#!/usr/bin/env bash
# Acceptance check for "Model comparison dashboard".
# Usage: bash check.sh path/to/your/project   (the folder with compare.py)
# Needs Docker. In the official MLflow 3.18.0 image it fills a fresh tracking store with known runs (finished,
# failed, other data, incomplete), runs compare.py, compares comparison.md with the expected page and checks
# the registry; then adds a better run, and finally tries a store where nothing beats the baseline.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. The container is removed afterwards.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
mlflow="ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13"  # MLflow 3.18.0, released 2026-11-03
id="devforge-check-mlflow-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -f "$src/compare.py" ] || { fail "compare.py is missing"; finish; }
work="$(mktemp -d)"
trap 'docker rm -f -v "$id" > /dev/null 2>&1; rm -rf "$work"' EXIT
for n in a b; do mkdir -p "$work/$n" && cp "$src/compare.py" "$work/$n/"; done
chmod -R a+rwX "$work"
docker run -d --name "$id" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/w" "$mlflow" sleep 900 > /dev/null
cat > "$work/seed.py" <<'PY'
"""seed.py <store dir> <spec>: log runs with known metrics; spec is name:model:rmse:r2:status:dataset, ';'-separated."""
import os, sys, warnings
warnings.filterwarnings("ignore")
import mlflow, numpy as np
from sklearn.linear_model import Ridge
store, spec = sys.argv[1], sys.argv[2]
os.chdir(store)
mlflow.set_tracking_uri(f"sqlite:///{store}/mlflow.db")
mlflow.set_experiment("student-performance")
X, y = np.arange(20.0).reshape(10, 2), np.arange(10.0)
for item in spec.split(";"):
    name, model, rmse, r2, status, dataset = item.split(":")
    with mlflow.start_run(run_name=name) as run:
        mlflow.log_param("model", model)
        if rmse: mlflow.log_metrics({"rmse": float(rmse), "r2": float(r2)})
        mlflow.set_tag("dataset", dataset)
        mlflow.sklearn.log_model(Ridge().fit(X, y), name="model")
    if status != "FINISHED":
        mlflow.MlflowClient().set_terminated(run.info.run_id, status)
PY
cat > "$work/registry.py" <<'PY'
import json, sys
import mlflow
from mlflow import MlflowClient
mlflow.set_tracking_uri(f"sqlite:///{sys.argv[1]}/mlflow.db")
c = MlflowClient()
try:
    versions = c.search_model_versions("name = 'student-score'")
    champ = c.get_model_version_by_alias("student-score", "champion")
    print(json.dumps({"versions": len(versions), "run": c.get_run(champ.run_id).info.run_name}))
except Exception as e:
    print(json.dumps({"versions": 0, "run": None, "error": type(e).__name__}))
PY
seed() { docker exec "$id" python /w/seed.py "$1" "$2" > /dev/null 2>&1; }
compare() { docker exec -w "$1" -e MLFLOW_TRACKING_URI="sqlite:///$1/mlflow.db" "$id" timeout 300 python compare.py > /dev/null 2>&1; }
registry() { docker exec "$id" python /w/registry.py "$1" 2>/dev/null | tail -n 1; }

seed /w/a "ridge-a1:ridge:5.601:0.776:FINISHED:synthetic-v1;ridge-a10:ridge:5.9:0.75:FINISHED:synthetic-v1;tree-d4:decision_tree:6.2:0.71:FINISHED:synthetic-v1;forest-200:random_forest:5.123:0.812:FINISHED:synthetic-v1;baseline:baseline:9.48:-0.002:FINISHED:synthetic-v1;forest-crashed:random_forest:3.0:0.9:FAILED:synthetic-v1;ridge-otherdata:ridge:2.0:0.95:FINISHED:real-v0;tree-broken:decision_tree:::FINISHED:synthetic-v1"
compare /w/a || fail "compare.py failed on the first store"
expected="$(cat <<'MD'
# Model comparison: student-performance
## Best run per model
| model | run | rmse | r2 |
|---|---|---|---|
| random_forest | forest-200 | 5.123 | 0.812 |
| ridge | ridge-a1 | 5.601 | 0.776 |
| decision_tree | tree-d4 | 6.200 | 0.710 |
| baseline | baseline | 9.480 | -0.002 |
## Champion
random_forest (forest-200), rmse 5.123 — 46.0% lower than the baseline
## Incomplete runs
- tree-broken
MD
)"
got="$(cat "$work/a/comparison.md" 2>/dev/null)"
if [ "$got" = "$expected" ]; then pass "comparison.md is exactly as specified (failed, other-dataset and incomplete runs handled)"; else fail "comparison.md differs from the expected page:"$'\n'"$(diff <(echo "$expected") <(echo "$got") | head -n 12)"; fi
reg="$(registry /w/a)"
if [ "$reg" = '{"versions": 1, "run": "forest-200"}' ]; then pass "student-score has one version and the alias champion points at forest-200"; else fail "register the champion as student-score with alias champion (registry: $reg)"; fi
compare /w/a
reg="$(registry /w/a)"
if [ "$reg" = '{"versions": 1, "run": "forest-200"}' ]; then pass "running compare.py again registers nothing new"; else fail "a second run with the same champion must not register another version (registry: $reg)"; fi
seed /w/a "forest-300:random_forest:4.9:0.83:FINISHED:synthetic-v1"
compare /w/a
reg="$(registry /w/a)"
if [ "$reg" = '{"versions": 2, "run": "forest-300"}' ] && grep -q '^| random_forest | forest-300 | 4.900 | 0.830 |$' "$work/a/comparison.md"; then pass "a better run becomes the champion: version 2, alias moved, page updated"; else fail "after a better run (forest-300, rmse 4.9) the page and the alias must move to it as version 2 (registry: $reg)"; fi

seed /w/b "baseline:baseline:5.0:0.0:FINISHED:synthetic-v1;ridge-bad:ridge:6.0:-0.2:FINISHED:synthetic-v1"
compare /w/b || fail "compare.py failed on the second store"
if grep -q '^No model beats the baseline$' "$work/b/comparison.md" 2>/dev/null && grep -q '^- none$' "$work/b/comparison.md" && [ "$(registry /w/b | grep -o '"versions": [0-9]*')" = '"versions": 0' ]; then
  pass "when nothing beats the baseline, the page says so and nothing is registered"
else
  fail "with only a baseline and a worse model, comparison.md must say \"No model beats the baseline\", list \"- none\" as incomplete, and register nothing"
fi
finish
