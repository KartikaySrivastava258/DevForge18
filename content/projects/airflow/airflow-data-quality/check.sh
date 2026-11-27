#!/usr/bin/env bash
# Acceptance check for "Data quality pipeline".
# Usage: bash check.sh path/to/your/project   (the folder with dags/ and data/)
# Needs Docker. Runs the official Airflow 3.4.0 image (slim, Python 3.12) with your dags/ and a copy of your
# data/ and runs the DAG with `airflow dags test` for five days of uploads — clean, a few bad rows, too many bad
# rows, duplicates, a partial upload — then reruns a day. Prints PASS or FAIL per criterion; non-zero exit on FAIL.
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
[ -d "$src/dags" ] && [ -d "$src/data/incoming" ] || { fail "$src needs dags/ and data/incoming/"; finish; }
work="$(mktemp -d)"
trap 'docker rm -f -v "$id" > /dev/null 2>&1; rm -rf "$work"' EXIT
cp -a "$src/dags" "$src/data" "$work/" && rm -rf "$work/data/warehouse" "$work/data/staging" "$work/data/quarantine" "$work/data/quality" "$work/data/alerts" && chmod -R a+rwX "$work"
docker run -d --name "$id" --user "$(id -u):0" -e AIRFLOW__CORE__LOAD_EXAMPLES=False \
  -v "$work/dags:/opt/airflow/dags" -v "$work/data:/opt/airflow/data" "$airflow" bash -c "sleep 900" > /dev/null
af() { docker exec "$id" airflow "$@" 2>&1; }
docker exec "$id" airflow db migrate > /dev/null 2>&1 || { fail "Airflow could not initialise its database"; finish; }
errors="$(docker exec -i "$id" python - 2>&1 <<'PY'
from airflow.dag_processing.dagbag import DagBag
bag = DagBag("/opt/airflow/dags")
print("@@", "ok" if "marks_quality" in bag.dags and not bag.import_errors else f"errors={dict(bag.import_errors)} dags={list(bag.dags)}")
PY
)"
if echo "$errors" | grep_quiet '^@@ ok'; then pass "the DAG marks_quality loads without import errors"; else fail "the DAG marks_quality must load: $(echo "$errors" | grep '^@@' | cut -c4-200)"; finish; fi
states=""
for day in 2026-03-02 2026-03-03 2026-03-04 2026-03-05 2026-03-06; do
  out="$(timeout 300 docker exec "$id" airflow dags test marks_quality "$day" 2>&1)"
  states="$states $day=$(echo "$out" | grep -o 'DagRun Finished.*state=[a-z_]*' | grep -o 'state=[a-z_]*$' | tail -n 1 | cut -d= -f2)"
done
snapshot() { docker exec "$id" sh -c 'cd /opt/airflow/data && for f in warehouse/marks/2026-03-03.csv quality/2026-03-03.json quarantine/2026-03-03.csv; do sha256sum "$f" 2>/dev/null; done'; }
before="$(snapshot)"
timeout 300 docker exec "$id" airflow dags test marks_quality 2026-03-03 > /dev/null 2>&1
after="$(snapshot)"
python3 - "$work/data" "$states" "$([ -n "$before" ] && [ "$before" = "$after" ] && echo same || echo different)" <<'PY' || failures=$((failures + $?))
import csv, json, os, re, sys
data, states, rerun = sys.argv[1], dict(s.split("=") for s in sys.argv[2].split()), sys.argv[3]
fails = 0
def ok(m): print(f"PASS: {m}")
def bad(m):
    global fails
    fails += 1
    print(f"FAIL: {m}")
def rows(path):
    try:
        with open(path, newline="") as f: return list(csv.DictReader(f))
    except OSError: return None
def quality(day):
    try: return json.load(open(f"{data}/quality/{day}.json"))
    except (OSError, ValueError): return None
COURSES = {"CS101", "CS201", "MA102", "HS110"}
def valid(r): return bool(re.fullmatch(r"S\d{5}", r["student_id"])) and r["course"] in COURSES and bool(re.fullmatch(r"\d{1,3}", r["mark"])) and int(r["mark"]) <= 100
inc = {d: rows(f"{data}/incoming/marks_{d}.csv") for d in ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]}
# Day 1: clean upload.
wh = rows(f"{data}/warehouse/marks/2026-03-02.csv")
q = quality("2026-03-02")
if states.get("2026-03-02") == "success" and wh == inc["2026-03-02"] and q and q.get("passed") is True and q.get("previous_rows") is None:
    ok("a clean day (2026-03-02) is published unchanged, with a passing quality report")
else: bad(f"2026-03-02 should succeed, publish all 100 rows and report passed with previous_rows null (run {states.get('2026-03-02')}, published {len(wh or [])} rows, report {q})")
# Day 2: three invalid rows are quarantined, the rest published.
want_valid = [r for r in inc["2026-03-03"] if valid(r)]
want_bad = {r["student_id"] for r in inc["2026-03-03"] if not valid(r)}
wh = rows(f"{data}/warehouse/marks/2026-03-03.csv")
qr = rows(f"{data}/quarantine/2026-03-03.csv") or []
q = quality("2026-03-03")
if states.get("2026-03-03") == "success" and wh == want_valid: ok("2026-03-03 publishes the 95 valid rows in input order")
else: bad(f"2026-03-03 should succeed and publish only its {len(want_valid)} valid rows (run {states.get('2026-03-03')}, published {len(wh or [])})")
if {r.get("student_id") for r in qr} == want_bad and all((r.get("reason") or "").strip() for r in qr): ok("the 3 invalid rows are in quarantine/2026-03-03.csv, each with a reason")
else: bad(f"quarantine/2026-03-03.csv should hold the rows of {sorted(want_bad)} with a reason column (found {[r.get('student_id') for r in qr]})")
if q and (q.get("rows_in"), q.get("rows_valid"), q.get("rows_quarantined"), q.get("duplicates"), q.get("previous_rows"), q.get("passed")) == (98, 95, 3, 0, 100, True): ok("quality/2026-03-03.json reports 98 in, 95 valid, 3 quarantined, previous 100, passed")
else: bad(f"quality/2026-03-03.json should report rows_in 98, rows_valid 95, rows_quarantined 3, duplicates 0, previous_rows 100, passed true (got {q})")
# Days 3-5: each must fail, publish nothing, explain why.
for day, what, field, value in [("2026-03-04", "12% invalid rows", "rows_quarantined", 12), ("2026-03-05", "3 duplicate rows", "duplicates", 3), ("2026-03-06", "a partial upload (30 rows after 95)", "previous_rows", 95)]:
    q = quality(day)
    published = os.path.exists(f"{data}/warehouse/marks/{day}.csv")
    alert = os.path.exists(f"{data}/alerts/{day}.txt") and open(f"{data}/alerts/{day}.txt").read().strip()
    if states.get(day) == "failed" and not published and alert and q and q.get("passed") is False and q.get("failures") and q.get(field) == value:
        ok(f"{day} ({what}) fails, publishes nothing, and writes an alert and a quality report ({field} = {value})")
    else:
        bad(f"{day} ({what}) should fail without publishing, with alerts/{day}.txt and a quality report where passed is false and {field} is {value} (run {states.get(day)}, published {published}, report {q})")
if rerun == "same": ok("running 2026-03-03 again produces identical files")
else: bad("running 2026-03-03 again must produce the same warehouse, quarantine and quality files")
sys.exit(fails)
PY
finish
