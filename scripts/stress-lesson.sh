#!/usr/bin/env bash
# Reproduce timing-dependent lesson failures: run one lesson's test several times while busy processes keep
# every CPU core occupied (as on a slow, shared CI runner). Each run's full log is kept.
#
#   npm run lessons:stress -- <lesson-or-lab-id> [runs, default 3] [busy processes, default: number of cores]
#
# Set the same opt-ins as for the lesson itself (DEVFORGE_DOCKER_TEST=1, DEVFORGE_REDIS_TEST=1, PG*, PATH).
set -euo pipefail
id="${1:?usage: npm run lessons:stress -- <lesson-or-lab-id> [runs] [busy-processes]}"
runs="${2:-3}"
busy="${3:-$(nproc)}"
logs="$(mktemp -d "${TMPDIR:-/tmp}/devforge-stress-XXXXXX")"
pids=()
stop_busy() { for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2> /dev/null || true; done; }
trap stop_busy EXIT
for _ in $(seq 1 "$busy"); do (while :; do :; done) & pids+=("$!"); done
echo "$busy busy process(es) running; $runs run(s) of $id; logs in $logs"
passed=0
for run in $(seq 1 "$runs"); do
  log="$logs/run-$run.log"
  start=$(date +%s)
  if node --disable-warning=ExperimentalWarning --test --test-name-pattern="^(lab )?${id} " scripts/lib/lesson-runner.test.ts > "$log" 2>&1 \
    && grep -q '^# pass [1-9]' "$log"; then
    passed=$((passed + 1)); echo "run $run: pass ($(( $(date +%s) - start )) s)"
  else
    echo "run $run: FAIL ($(( $(date +%s) - start )) s) — see $log"
  fi
done
echo "$passed of $runs passed under load"
[ "$passed" -eq "$runs" ]
