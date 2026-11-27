#!/usr/bin/env bash
# Acceptance check for "Authentication flow test collection".
# Usage: bash check.sh path/to/your/project   (the folder with results-auth.postman_collection.json)
# Needs Docker and network access (to install Newman). Starts a throwaway Node.js 22 container, installs Newman
# 6.2.3 in it, starts the check's own copy of the results API — the correct version and five deliberately
# broken ones, all with a fresh random API key and client secret — and runs your collection against each with
# Newman, passing those secrets with --env-var. Your suite must pass against the correct API
# and fail, with a failed assertion, against every broken one. Prints PASS or FAIL per criterion; non-zero exit
# if any fails. The container is removed at the end.
set -uo pipefail
# grep -q stops reading at its first match; under pipefail the writer then dies of SIGPIPE and the pipeline
# fails at random (CI run 46038301566). grep_quiet reads all of its input.
grep_quiet() { grep "$@" > /dev/null; }
dir="${1:-.}"
# node:22.23.5-alpine, digest as listed on Docker Hub (pushed 2026-11-12).
image="node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a"
newman="newman@6.2.3"
name="devforge-check-postman-auth-$$"
failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}
collection="results-auth.postman_collection.json"
environment="results.postman_environment.json"
for f in "$collection" "$environment"; do [ -f "$dir/$f" ] || { fail "$dir/$f is missing"; finish; }; done

tmp="$(mktemp -d)"
trap 'docker rm -f -v "$name" > /dev/null 2>&1; rm -rf "$tmp"' EXIT

# The API under test: the same file as api/results-api.mjs in the starter.
cat > "$tmp/results-api.mjs" <<'EOF_API'
// College results API — the service your Postman collection tests. Do not change this file: the check starts its
// own copy of it, with secrets of its own.
//
//   node api/results-api.mjs                     the correct API on http://127.0.0.1:7402 (PORT=… changes the port)
//   BUG=scope-ignored node api/results-api.mjs   a deliberately broken version (the list of bugs is below)
//
// The API key and the client's ID and secret come from the environment variables API_KEY, CLIENT_ID and
// CLIENT_SECRET; the defaults below are demonstration values, the same as in results.postman_environment.json.
// Every request is logged as "METHOD /path -> status [error (reason)]".
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 7402);
const API_KEY = process.env.API_KEY ?? "demo-key-R4nd0m";
const CLIENT_ID = process.env.CLIENT_ID ?? "results-portal";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "demo-secret-Xq81";
const TOKEN_SECONDS = 60;
const SCOPES = ["grades:read", "timetable:read"];
const BUG = process.env.BUG ?? "";
// The broken versions the check runs your collection against. A suite that still passes against one of these
// would let an authentication hole reach production.
const BUGS = {
  "key-ignored": "GET /status answers 200 without a valid API key",
  "any-secret": "POST /oauth/token issues tokens to a client with the wrong secret",
  "no-signature-check": "GET /grades accepts tokens whose signature does not match",
  "scope-ignored": "GET /grades accepts a valid token without the grades:read scope",
  "status-mixup": "GET /grades answers 403 instead of 401 when there is no token",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const SIGNING_KEY = crypto.randomBytes(32); // new on every start: tokens from an earlier run stop working
const b64 = (data) => Buffer.from(data).toString("base64url");
const sign = (text) => crypto.createHmac("sha256", SIGNING_KEY).update(text).digest("base64url");
const sameText = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function issueToken(client, scope) {
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ sub: client, scope, exp: Math.floor(Date.now() / 1000) + TOKEN_SECONDS }))}`;
  return `${body}.${sign(body)}`;
}
function checkToken(header) {
  const [scheme, token = ""] = (header ?? "").split(" ");
  const [head, payload, signature] = token.split(".");
  if (scheme !== "Bearer" || !signature) return { error: "invalid_token", why: "no bearer token" };
  if (BUG !== "no-signature-check" && !sameText(sign(`${head}.${payload}`), signature)) return { error: "invalid_token", why: "bad signature" };
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return { error: "invalid_token", why: "unreadable payload" };
  }
  if (!(claims.exp >= Date.now() / 1000)) return { error: "invalid_token", why: "expired" };
  return { claims };
}

function send(req, res, status, body, headers = {}) {
  const note = body?.error ? ` ${body.error}${body.reason ? ` (${body.reason})` : ""}` : "";
  console.log(`${req.method} ${req.url} -> ${status}${note}`);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/status") {
      const key = req.headers["x-api-key"] ?? "";
      if (BUG !== "key-ignored" && !sameText(key, API_KEY)) return send(req, res, 401, { error: "invalid_api_key" });
      return send(req, res, 200, { status: "ok" });
    }

    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let form = "";
      req.on("data", (chunk) => (form += chunk));
      req.on("end", () => {
        // The client authenticates with HTTP Basic: base64("id:secret").
        const basic = (req.headers.authorization ?? "").replace(/^Basic /, "");
        const [id = "", secret = ""] = Buffer.from(basic, "base64").toString().split(":");
        const params = new URLSearchParams(form);
        if (id !== CLIENT_ID || (BUG !== "any-secret" && !sameText(secret, CLIENT_SECRET))) {
          return send(req, res, 401, { error: "invalid_client" }, { "www-authenticate": 'Basic realm="token"' });
        }
        if (params.get("grant_type") !== "client_credentials") return send(req, res, 400, { error: "unsupported_grant_type" });
        const scope = params.get("scope") ?? "";
        if (!scope.split(" ").every((s) => SCOPES.includes(s))) return send(req, res, 400, { error: "invalid_scope" });
        send(req, res, 200, { access_token: issueToken(id, scope), token_type: "Bearer", expires_in: TOKEN_SECONDS, scope });
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/grades") {
      const result = checkToken(req.headers.authorization);
      if (result.error) {
        const status = BUG === "status-mixup" && result.why === "no bearer token" ? 403 : 401;
        return send(req, res, status, { error: result.error, reason: result.why }, { "www-authenticate": `Bearer error="${result.error}"` });
      }
      if (BUG !== "scope-ignored" && !result.claims.scope.split(" ").includes("grades:read")) {
        return send(req, res, 403, { error: "insufficient_scope" }, { "www-authenticate": 'Bearer error="insufficient_scope", scope="grades:read"' });
      }
      return send(req, res, 200, { client: result.claims.sub, grades: [{ studentId: "S1024", course: "DB201", grade: "A" }] });
    }

    send(req, res, 404, { error: "not_found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`results API${BUG ? ` (BUG=${BUG})` : ""} on http://127.0.0.1:${PORT}`));
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
bugs=(key-ignored any-secret no-signature-check scope-ignored status-mixup)
declare -A why=(
  [key-ignored]="GET /status answers 200 without a valid API key"
  [any-secret]="the token endpoint issues tokens to a client with the wrong secret"
  [no-signature-check]="GET /grades accepts a token whose signature does not match"
  [scope-ignored]="GET /grades accepts a valid token without the grades:read scope"
  [status-mixup]="GET /grades answers 403 instead of 401 when no token is sent"
)
declare -A port=([correct]=7511)
next=7512
# Fresh secrets for this run: a collection that hard-codes the demonstration values cannot pass.
random() { od -An -N12 -tx1 /dev/urandom | tr -d ' \n'; }
api_key="check-key-$(random)"; client_id="check-client-$(random)"; client_secret="check-secret-$(random)"
for bug in "${bugs[@]}"; do port[$bug]=$next; next=$((next + 1)); done
for variant in correct "${bugs[@]}"; do
  bugvar=""; [ "$variant" = correct ] || bugvar="$variant"
  docker exec -d -e "PORT=${port[$variant]}" -e "BUG=$bugvar" -e "API_KEY=$api_key" -e "CLIENT_ID=$client_id" -e "CLIENT_SECRET=$client_secret" \
    "$name" sh -c "node /check/results-api.mjs > /check/api-$variant.log 2>&1"
done
for variant in correct "${bugs[@]}"; do
  for _ in $(seq 1 50); do docker exec "$name" grep -q 'on http' "/check/api-$variant.log" 2> /dev/null && break; sleep 0.2; done
done

# run_suite <variant>: runs the collection against that API and leaves the summary in $tmp/<variant>.summary.
run_suite() {
  docker exec -w /project "$name" newman run "$collection" -e "$environment" --env-var "baseUrl=http://127.0.0.1:${port[$1]}" \
    --env-var "apiKey=$api_key" --env-var "clientId=$client_id" --env-var "clientSecret=$client_secret" \
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
  fail "the suite must pass against the correct API, using the apiKey, clientId and clientSecret it is given: ${first:-$(grep -m1 -iE 'error' "$tmp/correct.log")}"
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
covers() { if echo "$apilog" | grep_quiet -E "$2"; then pass "the suite sends a request to $1"; else fail "the suite must send a request to $1 — no such request reached the API"; fi; }
covers "/status with the API key (→ 200)" '^GET /status -> 200$'
covers "/status without a valid API key (→ 401 invalid_api_key)" '^GET /status -> 401 invalid_api_key$'
covers "the token endpoint with the client's ID and secret (→ 200)" '^POST /oauth/token -> 200$'
covers "the token endpoint with a wrong client secret (→ 401 invalid_client)" '^POST /oauth/token -> 401 invalid_client$'
covers "/grades with a grades:read token from this run (→ 200)" '^GET /grades -> 200$'
covers "/grades without a token (→ 401)" '^GET /grades -> 401 invalid_token \(no bearer token\)$'
covers "/grades with a token whose signature does not match (→ 401)" '^GET /grades -> 401 invalid_token \(bad signature\)$'
covers "/grades with a token for another scope (→ 403 insufficient_scope)" '^GET /grades -> 403 insufficient_scope$'

# 3. Secrets stay out of the collection: the demonstration values from the starter environment must not appear in it.
leaked=""
for secret in demo-key-R4nd0m demo-secret-Xq81; do grep -qF "$secret" "$dir/$collection" && leaked="$leaked $secret"; done
if [ -z "$leaked" ]; then pass "the collection contains no API key or client secret (they come from the environment)"
else fail "the collection contains secrets:$leaked — use {{apiKey}} and {{clientSecret}} from the environment"; fi

# 4. The suite must catch each deliberately broken API with a failing assertion.
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
