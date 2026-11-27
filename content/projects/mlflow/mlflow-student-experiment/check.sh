#!/usr/bin/env bash
# Acceptance check for "Student performance prediction experiment using synthetic data".
# Usage: bash check.sh path/to/your/project   (the folder with train.py and data.py)
# Needs Docker. Runs train.py twice in the official MLflow 3.18.0 image (which includes scikit-learn and
# pandas), each time into a fresh tracking store, then inspects the runs with MLflow's client: parameters,
# metrics, tags, artifacts, reproducibility — and reloads every logged model to recompute its test error.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. The container is removed afterwards.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
mlflow="ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13"  # MLflow 3.18.0, released 2026-11-03
data_sha="3815295f75bcabaeceba5e4d552e66dbd4a179d232409747a3fa81ec445a53f1"
id="devforge-check-mlflow-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in train.py data.py; do [ -f "$src/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish
if [ "$(sha256sum < "$src/data.py" | cut -d' ' -f1)" = "$data_sha" ]; then pass "data.py is unchanged"; else fail "data.py was changed — the check regenerates the data from the original"; fi
work="$(mktemp -d)"
trap 'docker rm -f -v "$id" > /dev/null 2>&1; rm -rf "$work"' EXIT
for n in 1 2; do mkdir -p "$work/run$n" && cp -a "$src/." "$work/run$n/"; done
chmod -R a+rwX "$work"
docker run -d --name "$id" --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/w" "$mlflow" sleep 900 > /dev/null
for n in 1 2; do
  out="$(docker exec -w "/w/run$n" -e MLFLOW_TRACKING_URI="sqlite:////w/run$n/mlflow.db" "$id" timeout 600 python train.py 2>&1)"; status=$?
  [ "$status" -eq 0 ] || { fail "train.py failed: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; finish; }
done
pass "train.py runs"

docker exec -i -w /w/run1 "$id" python - > "$work/result.json" 2> "$work/err.txt" <<'PY'
import json, os
import mlflow
from mlflow import MlflowClient
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import train_test_split
from data import FEATURES, TARGET, make_students

def summary(db):
    mlflow.set_tracking_uri(f"sqlite:///{db}")
    client = MlflowClient()
    exp = client.get_experiment_by_name("student-performance")
    if exp is None:
        return None
    runs = []
    for r in client.search_runs([exp.experiment_id]):
        files = {a.path for a in client.list_artifacts(r.info.run_id)}
        model_files, recomputed = [], None
        if True:  # MLflow 3 keeps a model logged with name="model" as a logged model; runs:/<id>/model resolves it
            try:
                df = make_students(n=600, seed=42)
                _, X_test, _, y_test = train_test_split(df[FEATURES], df[TARGET], test_size=0.25, random_state=42)
                model = mlflow.pyfunc.load_model(f"runs:/{r.info.run_id}/model")
                recomputed = float(mean_squared_error(y_test, model.predict(X_test)) ** 0.5)
                model_files = ["MLmodel"]
            except Exception as e:
                recomputed = f"error: {type(e).__name__}: {e}"[:200]
        runs.append({"params": r.data.params, "metrics": r.data.metrics, "tags": {k: v for k, v in r.data.tags.items() if not k.startswith("mlflow.")},
                     "files": sorted(files), "model_files": sorted(model_files), "recomputed": recomputed})
    return runs

print(json.dumps({"first": summary("/w/run1/mlflow.db"), "second": summary("/w/run2/mlflow.db")}))
PY
python3 - "$work/result.json" "$work/err.txt" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try: res = json.load(open(sys.argv[1]))
except ValueError:
    print(f"FAIL: could not read the runs: {open(sys.argv[2]).read()[-300:]}"); sys.exit(1)
runs = res["first"]
if runs is None: print('FAIL: there is no experiment named "student-performance"'); sys.exit(1)
names = [r["params"].get("model") for r in runs]
real = [n for n in names if n and n != "baseline"]
if "baseline" in names and len(set(real)) >= 3: ok(f"the experiment has a baseline and {len(set(real))} real models ({', '.join(sorted(set(real)))})")
else: bad(f"log one run per model: baseline plus at least three real models (found models: {names})")
missing = [n or "?" for n, r in zip(names, runs) if not ({"model", "seed"} <= set(r["params"]) and r["params"].get("seed") == "42" and {"rmse", "r2"} <= set(r["metrics"]) and r["tags"].get("dataset") == "synthetic-v1")]
if runs and not missing: ok("every run logs model and seed=42, rmse and r2, and the tag dataset=synthetic-v1")
else: bad(f"every run needs params model and seed (42), metrics rmse and r2, and the tag dataset=synthetic-v1 (incomplete: {', '.join(missing)})")
no_art = [n or "?" for n, r in zip(names, runs) if "data_card.md" not in r["files"] or not r["model_files"]]
if runs and not no_art: ok("every run has the model (MLmodel) and data_card.md as artifacts")
else: bad(f"every run needs the fitted model logged as 'model' and a data_card.md artifact (missing in: {', '.join(no_art)})")
honest = [n for n, r in zip(names, runs) if isinstance(r["recomputed"], float) and abs(r["recomputed"] - r["metrics"].get("rmse", -1)) < 1e-6]
if runs and len(honest) == len(runs): ok("each logged rmse equals the rmse of the logged model on the held-out test set")
else: bad(f"each run's rmse must be measured on the test split (test_size=0.25, random_state=42) with the logged model; matches only for {honest or 'none'} ({[r['recomputed'] for r in runs][:2]})")
base = [r["metrics"].get("rmse") for r in runs if r["params"].get("model") == "baseline"]
best = min([r["metrics"].get("rmse", 1e9) for r in runs if r["params"].get("model") not in (None, "baseline")], default=None)
if base and best is not None and best < base[0]: ok(f"the best model beats the baseline (rmse {best:.2f} vs {base[0]:.2f})")
else: bad("the best real model must have a lower rmse than the baseline")
def key(rs): return sorted((r["params"].get("model"), round(r["metrics"].get("rmse", -1), 9), round(r["metrics"].get("r2", -1), 9)) for r in rs or [])
if runs and key(runs) == key(res["second"]): ok("a second run of train.py gives exactly the same metrics (reproducible)")
else: bad("running train.py again must give identical metrics — seed every random step")
sys.exit(fails)
PY
finish
