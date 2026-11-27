#!/bin/sh
# Runs the campus events API regression suite and writes JUnit reports to results/.
# Usage: sh run-api-tests.sh [base URL]   (default http://127.0.0.1:7403)
# Exits non-zero when any test fails, so the CI step that runs it fails too.
set -u
base_url="${1:-http://127.0.0.1:7403}"
newman="npx --yes newman@6.2.3" # pinned: an unpinned runner can change behaviour on any day

rm -rf results
mkdir -p results
status=0
# Both runs always happen (no early exit), so CI keeps both reports even when the first run fails.
$newman run tests/events-regression.postman_collection.json --env-var "baseUrl=$base_url" --color off \
  --reporters cli,junit --reporter-junit-export results/regression.xml || status=1
$newman run tests/events-validation.postman_collection.json -d tests/validation-cases.csv --env-var "baseUrl=$base_url" --color off \
  --reporters cli,junit --reporter-junit-export results/validation.xml || status=1
exit "$status"
