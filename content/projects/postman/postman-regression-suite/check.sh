#!/usr/bin/env bash
# Acceptance check for "Automated regression suite".
# Usage: bash check.sh path/to/your/project   (the folder with run-api-tests.sh and tests/)
# Needs Docker and network access (to install Newman). Starts a throwaway Node.js 22 container, installs Newman
# 6.2.3 in it and starts the check's own copies of the events API: the current release, a release with harmless
# changes, and six releases with a regression each. It runs your run-api-tests.sh against each one, as CI would,
# and reads its exit code, the JUnit reports in results/ and the requests the API received. Prints PASS or FAIL
# per criterion; non-zero exit if any fails. The container is removed at the end.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
# node:22.23.5-alpine, digest as listed on Docker Hub (pushed 2026-11-12).
image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
newman="newman@6.2.3"
name="devforge-check-postman-regression-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
[ -f "$dir/run-api-tests.sh" ] || { fail "$dir/run-api-tests.sh is missing"; finish; }
[ -d "$dir/tests" ] || { fail "$dir/tests is missing"; finish; }

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The API under test: the same file as api/events-api.mjs in the starter.
cat > "$tmp/events-api.mjs" <<'EOF_API'
// Campus events API — the service your regression suite tests. Do not change this file: the check starts its own
// copy of it.
//
//   node api/events-api.mjs                     the current release on http://127.0.0.1:7403 (PORT=… changes the port)
//   BUG=delete-noop node api/events-api.mjs     a release with a regression (the list is below)
//   HARMLESS=1 node api/events-api.mjs          a release with harmless changes your suite must still accept
//
// Data lives in memory and starts with two events; restart the API to reset it. Every request is logged as
// "METHOD /path -> status [error [fields]]".
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 7403);
const BUG = process.env.BUG ?? "";
// Harmless changes a later release might make: an extra field, another id format, the list in another order.
// A regression suite must not fail on these — clients that follow the contract are not affected.
const HARMLESS = process.env.HARMLESS === "1";
// Regressions the check runs your suite against — each one breaks the contract in the README.
const BUGS = {
  "patch-ignored": "PATCH /events/{id} answers with the changed event but does not save the change",
  "delete-noop": "DELETE /events/{id} answers 204 but the event is still there",
  "list-stale": "GET /events leaves out events created since the API started",
  "capacity-zero": "POST /events accepts a capacity of 0 (the lower limit is off by one)",
  "impossible-date": "POST /events accepts dates that do not exist, such as 2027-02-30",
  "no-details": "validation errors no longer say which fields are invalid (details is missing)",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const events = new Map();
const seedIds = new Set();
const newId = () => (HARMLESS ? crypto.randomUUID() : `evt_${crypto.randomBytes(6).toString("hex")}`);
function store(fields, seed = false) {
  const event = { id: newId(), ...fields, createdAt: new Date().toISOString(), ...(HARMLESS ? { organiser: "Student Council" } : {}) };
  events.set(event.id, event);
  if (seed) seedIds.add(event.id);
  return event;
}
store({ title: "Freshers' orientation", date: "2027-07-20", capacity: 400, venue: "Main Auditorium" }, true);
store({ title: "Robotics club demo day", date: "2027-08-02", capacity: 60, venue: "Lab Block 3" }, true);

// Checks the fields present in `input`; with `partial` false, all four are required. Returns a list of problems.
function validate(input, partial) {
  const problems = [];
  const has = (f) => input[f] !== undefined;
  const check = (field, ok, message) => {
    if (!has(field)) {
      if (!partial) problems.push({ field, message: `${field} is required.` });
    } else if (!ok(input[field])) problems.push({ field, message });
  };
  check("title", (v) => typeof v === "string" && v.trim().length >= 3 && v.length <= 80, "title must be 3 to 80 characters.");
  check("date", (v) => typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && (BUG === "impossible-date" || realDate(v)), "date must be a real date as YYYY-MM-DD.");
  const minCapacity = BUG === "capacity-zero" ? 0 : 1;
  check("capacity", (v) => Number.isInteger(v) && v >= minCapacity && v <= 500, "capacity must be a whole number from 1 to 500.");
  check("venue", (v) => typeof v === "string" && v.trim().length > 0, "venue must not be empty.");
  for (const key of Object.keys(input)) if (!["title", "date", "capacity", "venue"].includes(key)) problems.push({ field: key, message: `${key} is not a field of an event.` });
  return problems;
}
function realDate(text) {
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function send(req, res, status, body, note = "") {
  console.log(`${req.method} ${req.url} -> ${status}${note}`);
  res.writeHead(status, body === undefined ? {} : { "content-type": "application/json; charset=utf-8" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
const fail = (req, res, status, code, message, details) => {
  const error = { code, message, ...(details && BUG !== "no-details" ? { details } : {}) };
  send(req, res, status, { error }, ` ${code}${details ? ` [${details.map((d) => d.field).join(",")}]` : ""}`);
};
function readJson(req, res, then) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return fail(req, res, 415, "unsupported_media_type", "Send the request body as application/json.");
  let text = "";
  req.on("data", (chunk) => (text += chunk));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(req, res, 400, "invalid_json", "The body is not valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(req, res, 400, "invalid_json", "The body must be a JSON object.");
    then(body);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") return send(req, res, 200, { status: "ok" });

    if (parts[0] === "events" && parts.length === 1) {
      if (req.method === "GET") {
        let list = [...events.values()];
        if (BUG === "list-stale") list = list.filter((e) => seedIds.has(e.id));
        list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        if (HARMLESS) list.reverse();
        return send(req, res, 200, { events: list });
      }
      if (req.method === "POST") {
        return readJson(req, res, (body) => {
          const problems = validate(body, false);
          if (problems.length) return fail(req, res, 400, "validation_failed", "Some fields are invalid.", problems);
          const event = store({ title: body.title, date: body.date, capacity: body.capacity, venue: body.venue });
          send(req, res, 201, { event });
        });
      }
      return fail(req, res, 405, "method_not_allowed", `${req.method} is not supported here.`);
    }

    if (parts[0] === "events" && parts.length === 2) {
      const event = events.get(parts[1]);
      if (!["GET", "PATCH", "DELETE"].includes(req.method)) return fail(req, res, 405, "method_not_allowed", `${req.method} is not supported here.`);
      if (!event) return fail(req, res, 404, "not_found", "Event not found.");
      if (req.method === "GET") return send(req, res, 200, { event });
      if (req.method === "DELETE") {
        if (BUG !== "delete-noop") events.delete(event.id);
        return send(req, res, 204);
      }
      return readJson(req, res, (body) => {
        const problems = validate(body, true);
        if (problems.length) return fail(req, res, 400, "validation_failed", "Some fields are invalid.", problems);
        const changed = { ...event, ...body };
        if (BUG !== "patch-ignored") events.set(event.id, changed);
        send(req, res, 200, { event: changed });
      });
    }

    fail(req, res, 404, "not_found", "No such endpoint.");
  })
  .listen(PORT, "127.0.0.1", () => console.log(`events API${BUG ? ` (BUG=${BUG})` : ""}${HARMLESS ? " (HARMLESS=1)" : ""} on http://127.0.0.1:${PORT}`));
EOF_API

docker run -d --name "$name" "$image" tail -f /dev/null > /dev/null || { fail "could not start the Node.js container in Docker"; finish; }
if ! docker exec "$name" npm install -g --no-audit --no-fund --loglevel=error "$newman" > "$tmp/npm.log" 2>&1; then
  fail "could not install $newman in the container (is the network available?): $(tail -n 3 "$tmp/npm.log" | tr '\n' ' ')"
  finish
fi
docker exec "$name" mkdir -p /check /project
docker cp "$tmp/events-api.mjs" "$name:/check/" > /dev/null
docker cp "$dir/." "$name:/project/" > /dev/null

bugs=(patch-ignored delete-noop list-stale capacity-zero impossible-date no-details)
declare -A why=(
  [patch-ignored]="PATCH answers with the changed event but does not save the change"
  [delete-noop]="DELETE answers 204 but the event is still there"
  [list-stale]="GET /events leaves out newly created events"
  [capacity-zero]="POST /events accepts a capacity of 0"
  [impossible-date]="POST /events accepts a date that does not exist (2027-02-30)"
  [no-details]="validation errors no longer name the invalid fields (details missing)"
)
declare -A port=([correct]=7521 [harmless]=7522)
next=7523
for bug in "${bugs[@]}"; do port[$bug]=$next; next=$((next + 1)); done
for variant in correct harmless "${bugs[@]}"; do
  bugvar=""; harmless=""
  case "$variant" in correct) ;; harmless) harmless=1 ;; *) bugvar="$variant" ;; esac
  docker exec -d -e "PORT=${port[$variant]}" -e "BUG=$bugvar" -e "HARMLESS=$harmless" "$name" sh -c "node /check/events-api.mjs > /check/api-$variant.log 2>&1"
done
for variant in correct harmless "${bugs[@]}"; do
  for _ in $(seq 1 50); do docker exec "$name" grep -q 'on http' "/check/api-$variant.log" 2> /dev/null && break; sleep 0.2; done
done

# run_suite <variant> <label>: runs the learner's runner against that API, as CI would. Leaves its exit code in
# $tmp/<label>.exit, its output in $tmp/<label>.log, and the JUnit reports (concatenated) in $tmp/<label>.xml.
run_suite() {
  docker exec -w /project "$name" sh -c 'rm -rf results' > /dev/null 2>&1
  timeout 240 docker exec -w /project "$name" sh run-api-tests.sh "http://127.0.0.1:${port[$1]}" > "$tmp/$2.log" 2>&1
  echo "$?" > "$tmp/$2.exit"
  docker exec "$name" sh -c 'cat /project/results/*.xml 2> /dev/null' > "$tmp/$2.xml"
}
exit_of() { cat "$tmp/$1.exit"; }
count() { grep -o "$2" "$tmp/$1.xml" | wc -l | tr -d ' '; }
reports() { docker exec "$name" sh -c 'ls /project/results/*.xml 2> /dev/null | wc -l' | tr -d ' '; }
first_failure() { grep -m1 -oE '<failure[^>]*message="[^"]*"' "$tmp/$1.xml" | sed -E 's/.*message="([^"]*)"/\1/' | head -c 200; }

# 1. Positive control: the current release passes, twice in a row, and the suite leaves no data behind.
ok=true
run_suite correct first
n_reports="$(reports)"
if [ "$(exit_of first)" = 0 ] && [ "$(count first '<testcase ')" -gt 0 ] && [ "$(count first '<failure')" = 0 ]; then
  pass "run-api-tests.sh passes against the current release ($(count first '<testcase ') JUnit test cases, exit code 0)"
else
  ok=false
  fail "run-api-tests.sh must exit 0 with passing JUnit reports in results/ against the current release (exit $(exit_of first), $(count first '<testcase ') test cases, $(count first '<failure') failures, ${n_reports:-0} report file(s)) $(first_failure first) $(grep -m1 -E 'Error|error' "$tmp/first.log" | head -c 200)"
fi
if [ "${n_reports:-0}" -ge 2 ]; then pass "results/ holds a JUnit report for each collection run ($n_reports files)"
else fail "results/ must hold a JUnit report per collection run (found ${n_reports:-0}) — use --reporters cli,junit --reporter-junit-export"; fi
if [ "$(count first '<testcase ')" -ge 15 ]; then pass "the suite runs at least 15 test cases (requests and data rows)"
else fail "the suite runs $(count first '<testcase ') test cases; follow the whole life of an event and test every validation rule — at least 15"; fi

run_suite correct second
if [ "$(exit_of second)" = 0 ] && [ "$(count second '<testcase ')" -gt 0 ] && [ "$(count second '<failure')" = 0 ]; then pass "a second run against the same API passes too (the suite does not depend on leftover data)"
else ok=false; fail "a second run against the same API must pass too, with its JUnit reports (exit $(exit_of second)): $(first_failure second)"; fi
# Keep what the API saw during the two runs (before the check's own request below).
apilog="$(docker exec "$name" cat /check/api-correct.log)"
remaining="$(docker exec "$name" node -e 'fetch(process.argv[1]).then((r) => r.json()).then((b) => console.log(b.events.length))' "http://127.0.0.1:${port[correct]}/events" 2>&1)"
if [ "$remaining" = 2 ]; then pass "the suite cleans up: after two runs the API holds only its two original events"
else fail "the suite must delete what it creates: after two runs the API holds $remaining events instead of 2"; fi

# 2. Coverage: what the current release saw during the two runs.
covers() { if echo "$apilog" | grep_quiet -E "$2"; then pass "the suite sends requests to $1"; else fail "the suite must send requests to $1 — none reached the API"; fi; }
covers "create an event (POST /events → 201)" '^POST /events -> 201$'
covers "read one event (GET /events/{id} → 200)" '^GET /events/[^ /]+ -> 200$'
covers "list events (GET /events → 200)" '^GET /events -> 200$'
covers "update an event (PATCH /events/{id} → 200)" '^PATCH /events/[^ /]+ -> 200$'
covers "delete an event (DELETE /events/{id} → 204)" '^DELETE /events/[^ /]+ -> 204$'
covers "read a deleted or unknown event (→ 404)" '^GET /events/[^ /]+ -> 404 not_found$'
for field in title date capacity venue; do
  covers "create an event with an invalid $field (→ 400 naming $field)" "^POST /events -> 400 validation_failed \\[$field\\]$"
done
per_run=$(( $(echo "$apilog" | grep -cE '^POST /events -> 400 validation_failed') / 2 ))
if [ "$per_run" -ge 6 ]; then pass "the suite sends at least 6 invalid events per run ($per_run)"
else fail "the suite sends $per_run invalid events per run; cover every rule and its limits — at least 6, best from a data file"; fi

# 3. Harmless changes (extra field, another id format, another list order) must not fail the suite.
if [ "$ok" = true ]; then
  run_suite harmless harmless
  if [ "$(exit_of harmless)" = 0 ]; then pass "the suite accepts a release with harmless changes (an extra field, UUID ids, the list in another order)"
  else fail "the suite fails on a release with only harmless changes — test the contract, not incidental details: $(first_failure harmless)"; fi
else
  fail "not checked until the suite passes against the current release: does it accept harmless changes?"
fi

# 4. Each regression must make the run fail through a failing test.
for bug in "${bugs[@]}"; do
  if [ "$ok" != true ]; then fail "not checked until the suite passes against the current release: does it catch that ${why[$bug]}?"; continue; fi
  run_suite "$bug" "$bug"
  if [ "$(exit_of "$bug")" = 0 ]; then
    fail "run-api-tests.sh exits 0 against a release in which ${why[$bug]} (BUG=$bug) — add a test that would notice, and make sure the exit code reports it"
  elif [ "$(count "$bug" '<failure')" -gt 0 ] && ! grep -q ECONNREFUSED "$tmp/$bug.log"; then
    pass "the suite catches the regression: ${why[$bug]} ($(first_failure "$bug"))"
  else
    fail "against BUG=$bug the runner failed, but no JUnit report records a failing test"
  fi
done

# 5. Automation: a pinned runner and a workflow that runs it on pull requests and keeps the reports.
if grep -Eq 'newman@[0-9]+\.[0-9]+\.[0-9]+' "$dir/run-api-tests.sh"; then pass "run-api-tests.sh pins an exact Newman version"
else fail "run-api-tests.sh must pin an exact Newman version (for example npx --yes newman@6.2.3)"; fi
workflow=""
for f in "$dir"/.github/workflows/*.yml "$dir"/.github/workflows/*.yaml; do [ -f "$f" ] && grep -q 'run-api-tests.sh' "$f" && workflow="$f"; done
if [ -z "$workflow" ]; then
  fail "no workflow in .github/workflows runs run-api-tests.sh"
else
  if grep -Eq '^[[:space:]]*pull_request:?' "$workflow"; then pass "the workflow runs on pull requests"; else fail "the workflow must run on pull_request"; fi
  if grep -q 'upload-artifact' "$workflow" && grep -Eq 'if:[[:space:]]*always\(\)' "$workflow" && grep -q 'results' "$workflow"; then
    pass "the workflow keeps the JUnit reports from results/, even when tests fail (if: always())"
  else
    fail "the workflow must upload results/ with actions/upload-artifact and if: always(), so failed runs keep their reports"
  fi
fi
finish
