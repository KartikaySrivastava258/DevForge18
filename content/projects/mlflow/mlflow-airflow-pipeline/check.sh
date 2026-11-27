#!/usr/bin/env bash
# Acceptance check for "Reproducible training pipeline coordinated by Airflow".
# Usage: bash check.sh path/to/your/project   (the folder with dags/)
# Needs Docker (and network access for the image build). Builds Airflow 3.4.0 with the pinned MLflow client and
# scikit-learn (the same Dockerfile as the starter), starts an MLflow 3.18.0 tracking server next to it, runs the
# DAG with `airflow dags test` for 2026-03-02 twice and for 2026-03-03, and inspects the runs and the registry.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. Removes the containers, network and image.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
mlflow="ghcr.io/mlflow/mlflow:v3.18.0@sha256:257204c77980b0f3450a26eb6089e487603fcdd4509529eadaf88f90669f5c13"  # released 2026-11-03
students_sha="3815295f75bcabaeceba5e4d552e66dbd4a179d232409747a3fa81ec445a53f1"
id="devforge-check-mlpipe-$$"
image="devforge-check-airflow-ml-$$:check"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
for f in dags/training.py dags/students.py; do [ -f "$src/$f" ] || fail "$f is missing"; done
[ "$failures" -eq 0 ] || finish
if [ "$(sha256sum < "$src/dags/students.py" | cut -d' ' -f1)" = "$students_sha" ]; then pass "dags/students.py is unchanged"; else fail "dags/students.py was changed"; fi
work="$(mktemp -d)"
cleanup() {
  docker rm -f -v "$id-airflow" "$id-mlflow" > /dev/null 2>&1
  docker network rm "$id" > /dev/null 2>&1
  docker rmi -f "$image" > /dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/build" "$work/data" && cp -a "$src/dags" "$work/" && chmod -R a+rwX "$work"
cat > "$work/build/Dockerfile" <<'DOCKERFILE'
FROM apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
RUN pip install --no-cache-dir "apache-airflow==3.4.0" "mlflow-skinny==3.18.0" "scikit-learn==1.9.1" \
    "pandas==3.1.0" "skops==0.16.0" --constraint /home/airflow/constraints.txt
DOCKERFILE
docker build -q -t "$image" "$work/build" > "$work/build.log" 2>&1 || { fail "building the Airflow image failed: $(tail -n 3 "$work/build.log" | tr '\n' ' ')"; finish; }
docker network create "$id" > /dev/null
docker run -d --name "$id-mlflow" --hostname mlflow --network "$id" "$mlflow" \
  mlflow server --host 0.0.0.0 --port 5000 --allowed-hosts "mlflow:5000,localhost:5000" > /dev/null
docker run -d --name "$id-airflow" --network "$id" --user "$(id -u):0" -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -e MLFLOW_TRACKING_URI=http://mlflow:5000 -e GIT_PYTHON_REFRESH=quiet \
  -v "$work/dags:/opt/airflow/dags" -v "$work/data:/opt/airflow/data" "$image" bash -c "sleep 1800" > /dev/null
docker exec "$id-airflow" airflow db migrate > /dev/null 2>&1 || { fail "Airflow could not initialise its database"; finish; }
for _ in $(seq 1 90); do docker exec "$id-airflow" python -c 'import urllib.request; urllib.request.urlopen("http://mlflow:5000/health", timeout=2)' 2> /dev/null && break; sleep 1; done

structure="$(docker exec -i "$id-airflow" python - 2>&1 <<'PY'
import sys
sys.path.insert(0, "/opt/airflow/dags")   # as Airflow does: modules next to the DAG files can be imported
from airflow.dag_processing.dagbag import DagBag
bag = DagBag("/opt/airflow/dags")
d = bag.dags.get("student_model_training")
if bag.import_errors or not d:
    print("@@", "errors", dict(bag.import_errors))
else:
    up = {t.task_id: sorted(t.upstream_task_ids) for t in d.tasks}
    print("@@", "ok" if up.get("train") == ["prepare_data"] and up.get("evaluate_and_promote") == ["train"] else f"tasks {up}")
PY
)"
if echo "$structure" | grep_quiet '^@@ ok'; then pass "the DAG loads with prepare_data → train → evaluate_and_promote"; else fail "the DAG student_model_training must load with tasks prepare_data → train → evaluate_and_promote ($(echo "$structure" | grep '^@@' | cut -c4-200))"; fi
states=""
for day in 2026-03-02 2026-03-02 2026-03-03; do
  out="$(timeout 600 docker exec "$id-airflow" airflow dags test student_model_training "$day" 2>&1)"
  states="$states $(echo "$out" | grep -o 'DagRun Finished.*state=[a-z_]*' | grep -o 'state=[a-z_]*$' | tail -n 1 | cut -d= -f2)"
done
if [ "$(echo $states)" = "success success success" ]; then pass "three runs (2026-03-02 twice, 2026-03-03) succeed"; else fail "the runs should succeed (states:$states)"; fi
docker exec -i "$id-airflow" python - > "$work/runs.json" 2> "$work/runs.err" <<'PY'
import hashlib, json
from mlflow import MlflowClient
c = MlflowClient()
exp = c.get_experiment_by_name("student-pipeline")
runs = []
if exp:
    for r in c.search_runs([exp.experiment_id], order_by=["attributes.start_time ASC"]):
        runs.append({"id": r.info.run_id, "params": r.data.params, "metrics": r.data.metrics,
                     "tags": {k: v for k, v in r.data.tags.items() if not k.startswith("mlflow.")}})
files = {}
for day in ("2026-03-02", "2026-03-03"):
    try: files[day] = hashlib.sha256(open(f"/opt/airflow/data/students_{day}.csv", "rb").read()).hexdigest()
    except OSError: files[day] = None
try:
    versions = sorted((int(v.version), v.run_id) for v in c.search_model_versions("name = 'student-pipeline-model'"))
    champion = c.get_model_version_by_alias("student-pipeline-model", "champion").run_id
except Exception:
    versions, champion = [], None
print(json.dumps({"runs": runs, "files": files, "versions": versions, "champion": champion}))
PY
python3 - "$work/runs.json" "$work/runs.err" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try: res = json.load(open(sys.argv[1]))
except ValueError: print(f"FAIL: could not read MLflow: {open(sys.argv[2]).read()[-300:]}"); sys.exit(1)
runs, files = res["runs"], res["files"]
if len(runs) == 3: ok("each DAG run logged one MLflow run in the experiment student-pipeline")
else: bad(f"expected 3 runs in the experiment student-pipeline, found {len(runs)}"); sys.exit(fails)
a, b, c = runs
if files["2026-03-02"] and a["params"].get("data_sha256") == files["2026-03-02"] and c["params"].get("data_sha256") == files["2026-03-03"] and files["2026-03-02"] != files["2026-03-03"]:
    ok("each run records the SHA-256 of the exact data file it trained on")
else: bad(f"log the parameter data_sha256 = the hash of /opt/airflow/data/students_<ds>.csv (files {files}, logged {[r['params'].get('data_sha256') for r in runs]})")
tags_ok = all(r["tags"].get("airflow_dag_id") == "student_model_training" and r["tags"].get("airflow_run_id") and r["tags"].get("logical_date") == d for r, d in zip(runs, ["2026-03-02", "2026-03-02", "2026-03-03"]))
if tags_ok: ok("each run is tagged with its Airflow DAG id, run id and logical date")
else: bad(f"tag every run with airflow_dag_id, airflow_run_id and logical_date (found {[r['tags'] for r in runs]})")
if "rmse" in a["metrics"] and a["metrics"].get("rmse") == b["metrics"].get("rmse") and a["params"].get("data_sha256") == b["params"].get("data_sha256"):
    ok(f"rerunning 2026-03-02 reproduces the same data and rmse ({a['metrics']['rmse']:.4f})")
else: bad(f"rerunning the same logical date must give the same data hash and rmse (got {a['metrics'].get('rmse')} and {b['metrics'].get('rmse')})")
# Promotion: the first run becomes champion; the identical rerun is not better; the third depends on its rmse.
expect_c = "promoted" if c["metrics"].get("rmse", 1e9) < a["metrics"].get("rmse", -1) else "kept"
decisions = [r["tags"].get("promotion") for r in runs]
if decisions == ["promoted", "kept", expect_c]: ok(f"promotion decisions are recorded and correct ({', '.join(decisions)})")
else: bad(f"expected promotion tags promoted, kept, {expect_c} (got {decisions})")
want_versions = [a["id"]] + ([c["id"]] if expect_c == "promoted" else [])
want_champion = c["id"] if expect_c == "promoted" else a["id"]
if [v[1] for v in res["versions"]] == want_versions and res["champion"] == want_champion:
    ok("only promoted models are registered, and the alias champion points at the best one")
else: bad(f"student-pipeline-model should hold versions for the promoted runs only, with champion on the best (versions {res['versions']}, champion {res['champion']})")
sys.exit(fails)
PY
finish
