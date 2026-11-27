#!/usr/bin/env bash
# Acceptance check for "Scheduled report generation".
# Usage: bash check.sh path/to/your/project   (the folder with dags/ and data/)
# Needs Docker. Runs the official Airflow 3.4.0 image (slim, Python 3.12) with your dags/ and a copy of your
# data/, loads the DAG, and runs it with `airflow dags test` for three Mondays — one with a parameter, one
# with a missing input file. Prints PASS or FAIL per criterion; exits non-zero if any fails.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
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
[ -d "$src/dags" ] && [ -d "$src/data/loans" ] || { fail "$src needs dags/ and data/loans/"; finish; }
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
d = bag.dags.get("weekly_library_report")
if d:
    p = d.params.get_param("top_n") if "top_n" in d.params else None
    out.update(catchup=d.catchup, start=d.start_date.date().isoformat() if d.start_date else None,
               max_active_runs=d.max_active_runs, top_n=None if p is None else p.value, tasks=[t.task_id for t in d.tasks])
print("@@" + json.dumps(out, default=str))
PY
)"
af dags reserialize > /dev/null
schedule="$(af dags details weekly_library_report -o json | grep -o '"timetable_summary": "[^"]*"' | head -n 1)"
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
elif "tasks" not in info: bad("no DAG with the id weekly_library_report")
else: ok("the DAG weekly_library_report loads without import errors")
if "tasks" not in info: sys.exit(fails or 1)
if '"0 7 * * 1"' in sys.argv[2] and info["start"] == "2026-02-02" and info["catchup"] is False: ok("scheduled Mondays at 07:00 from 2026-02-02, without catch-up")
else: bad(f"schedule it with the cron 0 7 * * 1 from 2026-02-02 and catchup=False (found {sys.argv[2] or 'no schedule'}, start {info['start']}, catchup {info['catchup']})")
if info["max_active_runs"] == 1: ok("at most one run at a time")
else: bad(f"set max_active_runs=1 (found {info['max_active_runs']})")
if info["top_n"] == 5: ok("the parameter top_n defaults to 5")
else: bad(f"add a DAG parameter top_n with default 5 (found {info['top_n']})")
sys.exit(fails)
PY

# expected <monday> <top_n>: the report computed from the data, as the README specifies.
expected() { python3 - "$work/data/loans" "$1" "$2" <<'PY'
import csv, datetime, sys
from collections import Counter
folder, monday, n = sys.argv[1], datetime.date.fromisoformat(sys.argv[2]), int(sys.argv[3])
days = [(monday - datetime.timedelta(days=k)).isoformat() for k in range(7, 0, -1)]
c = Counter()
for d in days:
    for r in csv.DictReader(open(f"{folder}/{d}.csv", newline="")): c[r["title"]] += 1
top = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
print("\n".join([f"# Library report: {days[0]} to {days[-1]}", f"Total loans: {sum(c.values())}", "## Top books"] + [f"{i}. {t} ({k})" for i, (t, k) in enumerate(top, 1)]))
PY
}
show() { docker exec "$id" cat "/opt/airflow/data/reports/$1" 2>/dev/null; }
run1="$(timeout 300 docker exec "$id" airflow dags test weekly_library_report 2026-02-09 2>&1)"
want1="$(expected 2026-02-09 5)"
if [ "$(show library_2026-02-09.md)" = "$want1" ]; then pass "the run for Monday 2026-02-09 reports 2026-02-02 to 2026-02-08 exactly as specified"; else fail "reports/library_2026-02-09.md should be:"$'\n'"$want1"$'\n'"got:"$'\n'"$(show library_2026-02-09.md | head -n 8)"; fi
if [ "$(show latest.md)" = "$want1" ]; then pass "latest.md shows the new report"; else fail "after a successful run, reports/latest.md must be a copy of that week's report"; fi
run2="$(timeout 300 docker exec "$id" airflow dags test weekly_library_report 2026-02-16 -c '{"top_n": 3}' 2>&1)"
want2="$(expected 2026-02-16 3)"
if [ "$(show library_2026-02-16.md)" = "$want2" ]; then pass "top_n=3 passed as run configuration lists three books for the week of 2026-02-09"; else fail "a run for 2026-02-16 with {\"top_n\": 3} should give:"$'\n'"$want2"$'\n'"got:"$'\n'"$(show library_2026-02-16.md | head -n 8)"; fi
run3="$(timeout 300 docker exec "$id" airflow dags test weekly_library_report 2026-02-23 2>&1)"
if echo "$run3" | grep_quiet 'state=failed' && echo "$run3" | grep_quiet '2026-02-19'; then pass "a week with a missing file (2026-02-19) fails and names the missing day"; else fail "the run for 2026-02-23 must fail and name the missing day 2026-02-19 (run state: $(echo "$run3" | grep -o 'state=[a-z_]*' | tail -n 1))"; fi
if [ "$(show latest.md)" = "$want2" ] && [ -z "$(show library_2026-02-23.md)" ]; then pass "the failed run changed neither latest.md nor wrote a report"; else fail "a failed run must leave latest.md as it was and write no library_2026-02-23.md"; fi
finish
