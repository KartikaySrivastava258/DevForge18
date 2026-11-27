#!/usr/bin/env bash
# Acceptance check for "Daily student attendance pipeline".
# Usage: bash check.sh path/to/your/project   (the folder with dags/ and data/)
# Needs Docker. Runs the official Airflow 3.4.0 image (slim, Python 3.12) with your dags/ and a copy of your
# data/, loads the DAG, runs it with `airflow dags test` for a day, and runs single tasks with `airflow tasks
# test`. Prints PASS or FAIL per criterion and exits non-zero if any fails. The container is removed afterwards.
set -uo pipefail
src="$(cd "${1:-.}" 2> /dev/null && pwd)" || { echo "FAIL: folder ${1:-.} not found"; exit 1; }
airflow="apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f"  # published 2026-11-06
id="devforge-check-airflow-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
}
[ -d "$src/dags" ] && [ -d "$src/data/attendance" ] || { fail "$src needs dags/ and data/attendance/"; finish; }
work="$(mktemp -d)"
trap 'docker rm -f -v "$id" > /dev/null 2>&1; rm -rf "$work"' EXIT
cp -a "$src/dags" "$src/data" "$work/" && rm -rf "$work/data/reports" && chmod -R a+rwX "$work"
docker run -d --name "$id" --user "$(id -u):0" -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -v "$work/dags:/opt/airflow/dags" -v "$work/data:/opt/airflow/data" "$airflow" bash -c "sleep 900" > /dev/null
af() { docker exec "$id" airflow "$@" 2>&1; }
docker exec "$id" airflow db migrate > /dev/null 2>&1 || { fail "Airflow could not initialise its database"; finish; }

info="$(docker exec -i "$id" python - 2>&1 <<'PY'
import json
from airflow.dag_processing.dagbag import DagBag
bag = DagBag("/opt/airflow/dags")
out = {"errors": {k: v.strip().splitlines()[-1] for k, v in bag.import_errors.items()}}
d = bag.dags.get("attendance_daily")
if d:
    out.update(
        catchup=d.catchup, start=d.start_date.date().isoformat() if d.start_date else None,
        tags=sorted(d.tags or []),
        tasks={t.task_id: {"retries": t.retries, "delay": t.retry_delay.total_seconds(), "up": sorted(t.upstream_task_ids)} for t in d.tasks},
    )
print("@@" + json.dumps(out, default=str))
PY
)"
af dags reserialize > /dev/null
schedule="$(af dags details attendance_daily -o json | grep -o '"timetable_summary": "[^"]*"' | head -n 1)"
python3 - "$(echo "$info" | sed -n 's/^@@//p')" "$schedule" <<'PY' || failures=$((failures + $?))
import json, sys
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
try: info = json.loads(sys.argv[1])
except ValueError: print("FAIL: the DAG folder could not be loaded"); sys.exit(1)
if info["errors"]: bad(f"import errors: {info['errors']}")
elif "tasks" not in info: bad("no DAG with the id attendance_daily")
else: ok("the DAG attendance_daily loads without import errors")
if "tasks" not in info: sys.exit(fails or 1)
sched = sys.argv[2]
if '"0 0 * * *"' in sched and info["start"] == "2026-02-01": ok("scheduled daily (@daily) from 2026-02-01")
else: bad(f"schedule it @daily from 2026-02-01 (found {sched[:80]}, start {info['start']})")
if info["catchup"] is False: ok("catch-up is off")
else: bad("set catchup=False, or switching the DAG on runs every day since the start date")
if "attendance" in info["tags"]: ok("tagged attendance")
else: bad("tag the DAG attendance")
t = info["tasks"]
if set(t) >= {"extract", "summarise", "load"} and t["summarise"]["up"] == ["extract"] and t["load"]["up"] == ["summarise"]: ok("tasks run extract → summarise → load")
else: bad(f"the tasks must be extract → summarise → load (found {[(k, v['up']) for k, v in t.items()]})")
weak = [k for k, v in t.items() if v["retries"] != 2 or v["delay"] != 300]
if not weak: ok("every task retries twice, five minutes apart")
else: bad(f"every task needs retries=2 and retry_delay of 5 minutes (not: {', '.join(weak)})")
sys.exit(fails)
PY

run="$(af dags test attendance_daily 2026-02-03)"
report="$(docker exec "$id" cat /opt/airflow/data/reports/attendance_2026-02-03.json 2>/dev/null)"
expected='{"CS-A": 90.0, "CS-B": 92.9, "EC-A": 88.0}'
same() { python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1]) == json.loads(sys.argv[2]) else 1)' "$1" "$2" 2> /dev/null; }
if echo "$run" | grep -q 'state=success' && same "$report" "$expected"; then pass "a run for 2026-02-03 writes reports/attendance_2026-02-03.json with each class's percentage"; else fail "a run for 2026-02-03 should succeed and write $expected to reports/attendance_2026-02-03.json (run: $(echo "$run" | grep -o 'state=[a-z_]*' | tail -n 1); file: ${report:-missing})"; fi
af dags test attendance_daily 2026-02-03 > /dev/null
again="$(docker exec "$id" cat /opt/airflow/data/reports/attendance_2026-02-03.json 2>/dev/null)"
if same "$again" "$expected"; then pass "running the same day again gives the same file (idempotent)"; else fail "running 2026-02-03 again must replace the report with the same content (got: $(echo "$again" | head -c 120))"; fi
af dags test attendance_daily 2026-02-04 > /dev/null
other="$(docker exec "$id" cat /opt/airflow/data/reports/attendance_2026-02-04.json 2>/dev/null)"
if [ -n "$other" ] && ! same "$other" "$expected"; then pass "each day reads its own file (2026-02-04 gives a different report)"; else fail "a run for 2026-02-04 must read data/attendance/2026-02-04.csv and write attendance_2026-02-04.json"; fi
missing="$(af tasks test attendance_daily extract 2026-02-09)"; status=$?
if [ "$status" -ne 0 ] || echo "$missing" | grep -Eq 'state=failed|FileNotFoundError'; then pass "extract fails when the day's file is missing"; else fail "extract must fail when data/attendance/<ds>.csv does not exist"; fi
finish
