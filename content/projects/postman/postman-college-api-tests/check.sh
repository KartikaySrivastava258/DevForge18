#!/usr/bin/env bash
# Acceptance check for "API test suite for a college service".
# Usage: bash check.sh path/to/your/project   (the folder with college-api.postman_collection.json)
# Needs Docker and network access (to install Newman). Starts a throwaway Node.js 22 container, installs Newman
# 6.2.3 in it, starts the check's own copy of the college API — the correct version and five deliberately
# broken ones — and runs your collection against each with Newman. Your suite must pass against the correct API
# and fail, with a failed assertion, against every broken one. Prints PASS or FAIL per criterion; non-zero exit
# if any fails. The container is removed at the end.
set -uo pipefail
dir="${1:-.}"
# node:22.23.5-alpine, digest as listed on Docker Hub (pushed 2026-11-12).
image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
newman="newman@6.2.3"
name="devforge-check-postman-college-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
collection="college-api.postman_collection.json"
environment="college.postman_environment.json"
for f in "$collection" "$environment"; do [ -f "$dir/$f" ] || { fail "$dir/$f is missing"; finish; }; done

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The API under test: the same file as api/college-api.mjs in the starter.
cat > "$tmp/college-api.mjs" <<'EOF_API'
// College course catalogue API — the service your Postman collection tests. Do not change this file:
// the check starts its own copy of it.
//
//   node api/college-api.mjs                 the correct API on http://127.0.0.1:7401 (PORT=… changes the port)
//   BUG=missing-404 node api/college-api.mjs a deliberately broken version (the list of bugs is below)
//
// Data lives in memory: restart the API to get the original seats back. Every request is logged as
// "METHOD /path?query -> status".
import http from "node:http";

const PORT = Number(process.env.PORT ?? 7401);
const BUG = process.env.BUG ?? "";
// The broken versions the check runs your collection against. A test suite that still passes against one of
// these would let that bug reach students.
const BUGS = {
  "missing-404": "GET /courses/<unknown code> answers 200 with course: null instead of 404",
  "wrong-course": "GET /courses/<code> answers with the next course in the list, not the one asked for",
  "filter-ignored": "GET /courses?dept=… ignores dept and lists every course",
  "no-validation": "POST …/enrolments accepts a missing or malformed studentId",
  "full-course": "POST …/enrolments enrols students in a course with no seats left",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const courses = [
  { code: "CS101", title: "Programming Fundamentals", dept: "CS", credits: 4, seats: 40 },
  { code: "CS205", title: "Data Structures", dept: "CS", credits: 4, seats: 0 },
  { code: "MA102", title: "Linear Algebra", dept: "MA", credits: 3, seats: 60 },
  { code: "PH110", title: "Engineering Physics", dept: "PH", credits: 3, seats: 12 },
];
const enrolments = [];

function send(req, res, status, body) {
  console.log(`${req.method} ${req.url} -> ${status}`);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const error = (code, message, details) => ({ error: { code, message, ...(details ? { details } : {}) } });

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") return send(req, res, 200, { status: "ok" });

    if (parts[0] === "courses" && parts.length === 1) {
      if (req.method !== "GET") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      const dept = url.searchParams.get("dept");
      const list = dept && BUG !== "filter-ignored" ? courses.filter((c) => c.dept === dept) : courses;
      return send(req, res, 200, { courses: list });
    }

    if (parts[0] === "courses" && parts.length === 2) {
      if (req.method !== "GET") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      const index = courses.findIndex((c) => c.code === parts[1]);
      if (index === -1) {
        if (BUG === "missing-404") return send(req, res, 200, { course: null });
        return send(req, res, 404, error("not_found", "Course not found."));
      }
      const course = BUG === "wrong-course" ? courses[(index + 1) % courses.length] : courses[index];
      return send(req, res, 200, { course });
    }

    if (parts[0] === "courses" && parts[2] === "enrolments" && parts.length === 3) {
      if (req.method !== "POST") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return send(req, res, 415, error("unsupported_media_type", "Send the request body as application/json."));
      }
      let text = "";
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(text || "{}");
        } catch {
          return send(req, res, 400, error("invalid_json", "The body is not valid JSON."));
        }
        const course = courses.find((c) => c.code === parts[1]);
        if (!course) return send(req, res, 404, error("not_found", "Course not found."));
        const studentId = body?.studentId;
        if (BUG !== "no-validation" && (typeof studentId !== "string" || !/^S[0-9]{4}$/.test(studentId))) {
          return send(req, res, 400, error("validation_failed", "Some fields are invalid.", [
            { field: "studentId", message: "studentId must be S followed by four digits, for example S1024." },
          ]));
        }
        if (course.seats === 0 && BUG !== "full-course") return send(req, res, 409, error("course_full", "This course has no seats left."));
        course.seats = Math.max(0, course.seats - 1);
        enrolments.push({ courseCode: course.code, studentId });
        return send(req, res, 201, { enrolment: { courseCode: course.code, studentId }, seatsLeft: course.seats });
      });
      return;
    }

    send(req, res, 404, error("not_found", "No such endpoint."));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`college API${BUG ? ` (BUG=${BUG})` : ""} on http://127.0.0.1:${PORT}`));
EOF_API

# Reads Newman's JSON report and prints one key=value per line.
cat > "$tmp/summary.mjs" <<'EOF_SUMMARY'
import { readFileSync } from "node:fs";
const run = JSON.parse(readFileSync(process.argv[2], "utf8")).run;
const s = run.stats;
const line = (k, v) => console.log(`${k}=${String(v).replace(/\s+/g, " ")}`);
line("assertions", s.assertions.total);
line("assertions_failed", s.assertions.failed);
line("request_errors", s.requests.failed);
line("script_errors", s.testScripts.failed + s.prerequestScripts.failed);
line("untested", run.executions.filter((e) => !(e.assertions ?? []).length).map((e) => e.item.name).join(", "));
const first = run.failures[0];
line("first_failure", first ? `${first.source?.name ?? "?"}: ${first.error?.test ? `"${first.error.test}" — ` : ""}${first.error?.message ?? first.error?.name}` : "");
EOF_SUMMARY

docker run -d --name "$name" "$image" tail -f /dev/null > /dev/null || { fail "could not start the Node.js container in Docker"; finish; }
if ! docker exec "$name" npm install -g --no-audit --no-fund --loglevel=error "$newman" > "$tmp/npm.log" 2>&1; then
  fail "could not install $newman in the container (is the network available?): $(tail -n 3 "$tmp/npm.log" | tr '\n' ' ')"
  finish
fi
docker exec "$name" mkdir -p /check /project
docker cp "$tmp/." "$name:/check/" > /dev/null
docker cp "$dir/." "$name:/project/" > /dev/null

if out="$(docker exec -w /project "$name" node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(c.item) || !c.info) throw new Error("not a Postman collection (no info or item)");
  JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));' "$collection" "$environment" 2>&1)"; then
  pass "the collection and the environment are valid Postman JSON files"
else
  fail "the collection or the environment is not valid: $(echo "$out" | grep -m1 -E 'Error|error' || echo "$out" | head -n 1)"
  finish
fi

# Start the correct API and every broken version, each on its own port inside the container.
bugs=(missing-404 wrong-course filter-ignored no-validation full-course)
declare -A why=(
  [missing-404]="an unknown course answers 200 instead of 404"
  [wrong-course]="GET /courses/<code> returns a different course from the one asked for"
  [filter-ignored]="the dept filter is ignored and every course is listed"
  [no-validation]="enrolments with a missing or malformed studentId are accepted"
  [full-course]="students are enrolled in a course with no seats left"
)
declare -A port=([correct]=7501)
next=7502
for bug in "${bugs[@]}"; do port[$bug]=$next; next=$((next + 1)); done
for variant in correct "${bugs[@]}"; do
  bugvar=""; [ "$variant" = correct ] || bugvar="$variant"
  docker exec -d -e "PORT=${port[$variant]}" -e "BUG=$bugvar" "$name" sh -c "node /check/college-api.mjs > /check/api-$variant.log 2>&1"
done
for variant in correct "${bugs[@]}"; do
  for _ in $(seq 1 50); do docker exec "$name" wget -q -O /dev/null "http://127.0.0.1:${port[$variant]}/health" 2> /dev/null && break; sleep 0.2; done
done

# run_suite <variant>: runs the collection against that API and leaves the summary in $tmp/<variant>.summary.
run_suite() {
  docker exec -w /project "$name" newman run "$collection" -e "$environment" --env-var "baseUrl=http://127.0.0.1:${port[$1]}" \
    --color off --timeout-request 5000 --reporters cli,json --reporter-json-export "/check/run-$1.json" > "$tmp/$1.log" 2>&1
  echo "exit=$?" > "$tmp/$1.summary"
  docker exec "$name" node /check/summary.mjs "/check/run-$1.json" >> "$tmp/$1.summary" 2> /dev/null
}
get() { sed -n "s/^$2=//p" "$tmp/$1.summary"; }

# 1. Positive control: against the correct API every assertion must pass.
run_suite correct
ok=true
if [ "$(get correct exit)" = 0 ] && [ "$(get correct assertions_failed)" = 0 ]; then
  pass "the suite passes against the correct API ($(get correct assertions) assertions)"
else
  ok=false
  first="$(get correct first_failure)"
  fail "the suite must pass against the correct API: ${first:-$(grep -m1 -iE 'error' "$tmp/correct.log")}"
fi
errors="$(get correct request_errors)"
if [ "${errors:-1}" = 0 ]; then pass "every request reaches the API through {{baseUrl}}"
else ok=false; fail "$errors request(s) could not reach the API — use {{baseUrl}} in every URL instead of a fixed address"; fi
untested="$(get correct untested)"
if [ -z "$untested" ] && [ "$(get correct script_errors)" = 0 ]; then pass "every request has at least one test, and no test script crashes"
else fail "every request needs a test and no script may crash (requests without tests: ${untested:-none}; crashed scripts: $(get correct script_errors))"; fi
if [ "$(get correct assertions)" -ge 15 ] 2> /dev/null; then pass "the suite makes at least 15 assertions"
else fail "the suite makes $(get correct assertions) assertions; check status codes and bodies — at least 15 in all"; fi

# 2. Coverage: what the API saw during the correct run.
apilog="$(docker exec "$name" cat /check/api-correct.log)"
covers() { if echo "$apilog" | grep -Eq "$2"; then pass "the suite sends a request to $1"; else fail "the suite must send a request to $1 — no such request reached the API"; fi; }
covers "list all courses (GET /courses → 200)" '^GET /courses -> 200$'
covers "filter courses by department (GET /courses?dept=… → 200)" '^GET /courses\?dept=[A-Z]+ -> 200$'
covers "read one course (GET /courses/<code> → 200)" '^GET /courses/[A-Z]{2}[0-9]{3} -> 200$'
covers "ask for a course that does not exist (→ 404)" '^GET /courses/[^ ?]+ -> 404$'
covers "enrol a student (POST /courses/<code>/enrolments → 201)" '^POST /courses/[A-Z]{2}[0-9]{3}/enrolments -> 201$'
covers "make an invalid enrolment (→ 400)" '^POST /courses/[A-Z]{2}[0-9]{3}/enrolments -> 400$'
covers "enrol in a full course (→ 409)" '^POST /courses/[A-Z]{2}[0-9]{3}/enrolments -> 409$'

# 3. The suite must catch each deliberately broken API with a failing assertion.
for bug in "${bugs[@]}"; do
  if [ "$ok" != true ]; then fail "not checked until the suite passes against the correct API: does it catch that ${why[$bug]}?"; continue; fi
  run_suite "$bug"
  if [ "$(get "$bug" exit)" = 0 ]; then
    fail "the suite passes against a broken API in which ${why[$bug]} (BUG=$bug) — add a test that would notice"
  elif [ "$(get "$bug" assertions_failed)" -gt 0 ] 2> /dev/null && [ "$(get "$bug" request_errors)" = 0 ]; then
    pass "the suite catches the bug: ${why[$bug]} ($(get "$bug" first_failure))"
  else
    fail "against BUG=$bug the run failed, but not through a failed assertion: $(get "$bug" first_failure)"
  fi
done
finish
