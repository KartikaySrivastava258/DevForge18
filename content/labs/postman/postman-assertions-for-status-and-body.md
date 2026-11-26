---
id: postman-assertions-for-status-and-body
title: Write assertions for status and response body
track: postman
level: intermediate
mode: local
estimated_minutes: 35
prerequisites: [postman-collections-environments-newman]
objectives:
  - Assert on status codes, headers and the shape of JSON bodies, not only on "it returned 200".
  - Chain requests by saving a value from one response into a variable for the next.
  - Test the failure paths (404, 403) as deliberately as the happy path, and read a failing assertion.
checkpoints:
  - { id: chained, text: "The second request used the slug saved from the first response" }
  - { id: failure-read, text: "I read a failing assertion's expected and actual values in Newman's report" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Write scripts to test API response data in Postman
    url: https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/
    publisher: Postman Docs
    type: documentation
    level: intermediate
    official: true
    why: pm.test, pm.expect and pm.response, the functions used in every test here.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Newman (README)
    url: https://github.com/postmanlabs/newman
    publisher: Postman (postmanlabs on GitHub)
    type: documentation
    level: intermediate
    official: true
    why: Running collections from the command line, environment variables, reporters and exit codes.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Newman 6.2.3 against a real DevForge server, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

A test that only checks for `200 OK` passes even when the body is wrong. You write a collection that checks what a client really relies on — status, headers, the shape and values of the JSON, and the errors — chain one request's answer into the next, watch an assertion fail on purpose, and finish with a check script that runs the whole suite.

## Before you start

Keep DevForge running and `API` set, and continue in the `newman-lab` folder from *Collections, environments and Newman* (Newman 6.2.3 is installed there).

## Steps

### 1. A collection that tests more than the status

```bash run
cat > assertions.postman_collection.json <<'EOF'
{
  "info": {
    "name": "DevForge API assertions",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "List tracks",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/tracks" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 200', () => pm.response.to.have.status(200));",
        "pm.test('body is JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json'));",
        "const tracks = pm.response.json().tracks;",
        "pm.test('lists the expected number of tracks', () => pm.expect(tracks).to.be.an('array').with.lengthOf(Number(pm.environment.get('expectedTracks'))));",
        "pm.test('every track has a slug and a title', () => tracks.forEach((t) => { pm.expect(t.slug).to.be.a('string').and.match(/^[a-z0-9-]+$/); pm.expect(t.title).to.be.a('string').and.not.be.empty; }));",
        "pm.collectionVariables.set('firstSlug', tracks[0].slug);"
      ] } }]
    },
    {
      "name": "First track (chained)",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/tracks/{{firstSlug}}" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 200', () => pm.response.to.have.status(200));",
        "pm.test('is the track from the list', () => pm.expect(pm.response.json().track.slug).to.eql(pm.collectionVariables.get('firstSlug')));",
        "pm.test('has published lessons', () => pm.expect(pm.response.json().lessons).to.be.an('array').that.is.not.empty);"
      ] } }]
    },
    {
      "name": "Unknown track",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/tracks/no-such-track" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 404', () => pm.response.to.have.status(404));",
        "pm.test('error code is not_found', () => pm.expect(pm.response.json().error.code).to.eql('not_found'));"
      ] } }]
    },
    {
      "name": "Write without the CSRF header",
      "request": { "method": "PUT", "url": "{{baseUrl}}/api/me/bookmarks/track/kafka" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 403', () => pm.response.to.have.status(403));",
        "pm.test('error code is csrf_failed', () => pm.expect(pm.response.json().error.code).to.eql('csrf_failed'));",
        "pm.test('responses are not cached', () => pm.expect(pm.response.headers.get('Cache-Control')).to.eql('no-store'));"
      ] } }]
    }
  ]
}
EOF
cat > lab.postman_environment.json <<EOF
{
  "name": "lab",
  "values": [
    { "key": "baseUrl", "value": "$API", "enabled": true },
    { "key": "expectedTracks", "value": "18", "enabled": true }
  ]
}
EOF
npx newman run assertions.postman_collection.json -e lab.postman_environment.json --color off | grep -E '^→|  ✓|  [0-9]+\. '
```

```text output
→ List tracks
  ✓  status is 200
  ✓  body is JSON
  ✓  lists the expected number of tracks
  ✓  every track has a slug and a title
→ First track (chained)
  ✓  status is 200
  ✓  is the track from the list
  ✓  has published lessons
→ Unknown track
  ✓  status is 404
  ✓  error code is not_found
→ Write without the CSRF header
  ✓  status is 403
  ✓  error code is csrf_failed
  ✓  responses are not cached
```

Some things worth noticing:

- **Shape, not just status.** "Every track has a slug and a title" fails if one track comes back with a missing field, even though the status is still 200.
- **Chaining.** `pm.collectionVariables.set('firstSlug', …)` stores a value from the first response; the next request's URL uses `{{firstSlug}}`. Real suites chain IDs this way — create something, then read, update and delete *that* thing.
- **Failure paths.** The 404 and 403 requests are expected to fail, and the tests check *how*: the right status and the right error code. A client depends on those as much as on the success case.
- **No magic numbers in tests.** The expected track count comes from the environment, so another environment can expect a different number.

### 2. Watch an assertion fail

Pretend a new track was announced but has not been released yet. Run the suite expecting 19:

```bash run fails
npx newman run assertions.postman_collection.json -e lab.postman_environment.json --env-var "expectedTracks=19" --color off > run.log || echo "newman exit code: $?"
grep -E '^  [0-9]+\. ' run.log
grep -A1 'AssertionError' run.log
```

```text output
newman exit code: 1
  1. lists the expected number of tracks
 1.  AssertionError  lists the expected number of tracks
                     expected [ Array(18) ] to have a length of 19 but got 18
```

Newman lists each failing assertion with its expected and actual values, and exits with code 1 — which is what makes a CI job fail. Read failures like this from the bottom up: *what* was expected (19), *what* came back (18), and only then decide whether the API or the test is wrong.

## Check your work

Run this inside `newman-lab` while DevForge is running and `API` is set. It runs your collection, then reads Newman's JSON report.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
count() { node -e "const r=require('./report.json').run; const a=r.executions.flatMap((e)=>e.assertions||[]); console.log($1)"; }
check "the collection and environment exist" '[ -f assertions.postman_collection.json ] && [ -f lab.postman_environment.json ]'
check "the whole suite passes" '[ -f assertions.postman_collection.json ] && npx newman run assertions.postman_collection.json -e lab.postman_environment.json --reporters json --reporter-json-export report.json'
check "it makes at least 10 assertions" '[ "$(count "a.length")" -ge 10 ]'
check "it tests a 404 and a 403" '[ "$(count "a.filter((x)=>/404|403/.test(x.assertion)).length")" -ge 2 ]'
check "a request uses a value saved from an earlier response" 'grep -q "{{firstSlug}}" assertions.postman_collection.json && grep -q "collectionVariables.set" assertions.postman_collection.json'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the collection and environment exist
PASS: the whole suite passes
PASS: it makes at least 10 assertions
PASS: it tests a 404 and a 403
PASS: a request uses a value saved from an earlier response
All checks passed
```

## Reset

Delete `assertions.postman_collection.json`, `lab.postman_environment.json`, `run.log` and `report.json`, then start again at step 1. The lab does not change any data in DevForge.

## What you practised

Good API tests check what clients rely on: the status, the headers, the shape and values of the body, and the error responses. Chaining makes a suite follow a real workflow, and a failing assertion's expected-versus-actual line is where every investigation starts.
