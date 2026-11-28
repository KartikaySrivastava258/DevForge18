---
id: postman-collections-in-ci
title: Running collections in CI
track: postman
order: 6
level: advanced
estimated_minutes: 35
prerequisites: [postman-collections-environments-newman]
learning_objectives:
  - Run one request for many inputs with a data file, and read the result of each iteration.
  - Produce a JUnit XML report that CI systems display, and use Newman's exit code to fail a pipeline.
  - Write a GitHub Actions workflow that starts the API and runs the collection on every pull request.
resources:
  - title: Newman (README) — command-line options and reporters
    url: https://github.com/postmanlabs/newman
    publisher: Postman (postmanlabs on GitHub)
    type: documentation
    level: intermediate
    official: true
    why: -d/--iteration-data, --reporters, the JUnit reporter's export option, and exit codes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Postman Docs — Run a collection using data from a file
    url: https://learning.postman.com/docs/tests-and-scripts/running-collections/test-data/working-with-data-files/
    publisher: Postman
    type: documentation
    level: intermediate
    official: true
    why: CSV and JSON data files, and reading each row's values in scripts.
    verification: { status: verified, checked_on: 2026-11-28 }
self_check:
  - id: iteration-data
    prompt: A CSV data file has a header row and three data rows. How many times does Newman run the collection?
    options:
      - { id: a, text: "Once" }
      - { id: b, text: "Three times — one iteration per data row; the header names the variables" }
      - { id: c, text: "Four times" }
    answer: b
    explanation: Each row becomes an iteration, and its columns are available as variables such as {{slug}} and through pm.iterationData.
  - id: exit-code
    prompt: How does a CI job know that the API tests failed?
    options:
      - { id: a, text: "Someone reads the log" }
      - { id: b, text: "Newman exits with a non-zero code when any test fails, so the step — and the job — fails" }
      - { id: c, text: "The JUnit file is emailed to the team" }
    answer: b
    explanation: CI decides by exit codes. The JUnit report adds detail (which test, which iteration) that CI systems can display, but the exit code is what fails the job.
  - id: start-api
    prompt: Why does the workflow start the API before running Newman?
    options:
      - { id: a, text: "Newman needs the API's source code" }
      - { id: b, text: "The collection sends real HTTP requests; something must be listening on the base URL in the CI environment" }
      - { id: c, text: "It is optional" }
    answer: b
    explanation: The job starts the API (or uses a deployed test environment), waits until it answers, and points the collection at it with an environment or --env-var.
verification:
  method: executed
  details: The Newman runs are executed by the test suite with Newman 6.2.3 against a real DevForge server, and their output is compared with this lesson; the workflow file is checked by DevForge's workflow checker. Running the workflow needs a repository on GitHub and is not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

In CI, a Postman collection is just another test suite: **Newman** runs it against a freshly started API, repeats requests for every row of a **data file**, writes a **JUnit report** for humans, and returns an **exit code** that passes or fails the pipeline.

## Explain it like I'm twelve

A teacher has a list of 30 spelling words and a robot that tests a pupil on each one, marks every answer, prints a report card, and rings a bell only if something was wrong.

The list is the **data file**, each word is an **iteration**, the report card is the **JUnit report**, and the bell is the **exit code**.

Where the analogy breaks: in CI, a ringing bell stops the change from being merged.

## What problem it solves

Clicking **Send** in Postman checks the API once, on one machine, when someone remembers. Running the collection on every pull request checks every change, the same way, before it is merged — and data files let one request cover many cases without copying it twenty times.

## How it works

![](media:postman/newman-ci.svg)

- `newman run collection.json -d data.csv` runs the collection once per data row. Column names become variables (`{{slug}}`), and scripts read the row with `pm.iterationData.get("…")`.
- `--reporters cli,junit --reporter-junit-export file.xml` keeps the console output and also writes JUnit XML, the format CI systems such as GitHub Actions (with a test-report action) and Jenkins (with the `junit` step) understand.
- Newman exits with **0** when every test passed and **non-zero** when any failed, so the CI step fails.
- In the pipeline, a job checks out the code, starts the API, waits for it, and runs Newman with an environment pointing at it.

## Try it yourself

> **Local lab** — continue in the `newman-lab` folder from *Collections, environments and Newman*, with DevForge running and `API` set. Every Newman run is executed automatically in DevForge's tests.

### 1. One request, many cases

```bash run
cat > tracks.postman_collection.json <<'EOF'
{
  "info": { "name": "Track lookups", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": [
    {
      "name": "Track lookup",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/tracks/{{slug}}" },
      "event": [{ "listen": "test", "script": { "exec": [
        "const expected = Number(pm.iterationData.get('expected'));",
        "pm.test(`status is ${expected}`, () => pm.response.to.have.status(expected));",
        "if (expected === 200) pm.test('it is the requested track', () => pm.expect(pm.response.json().track.slug).to.eql(pm.iterationData.get('slug')));"
      ] } }]
    }
  ]
}
EOF
printf 'slug,expected\nkafka,200\ndocker,200\nno-such-track,404\n' > tracks.csv
npx newman run tracks.postman_collection.json -e local.postman_environment.json -d tracks.csv --color off | grep -E '^Iteration|^→|  ✓|  [0-9]+\. '
```

```text output
Iteration 1/3
→ Track lookup
  ✓  status is 200
  ✓  it is the requested track
Iteration 2/3
→ Track lookup
  ✓  status is 200
  ✓  it is the requested track
Iteration 3/3
→ Track lookup
  ✓  status is 404
```

One request, three iterations, one per CSV row (Newman prints the request's name, not the filled-in URL). The expected status comes from the data, so adding a case means adding a line — not another request.

### 2. A report for CI

```bash run
npx newman run tracks.postman_collection.json -e local.postman_environment.json -d tracks.csv \
  --reporters cli,junit --reporter-junit-export results/newman.xml > /dev/null
echo "exit code: $?"
echo "test cases: $(grep -o '<testcase ' results/newman.xml | wc -l), failures: $(grep -o '<failure' results/newman.xml | wc -l)"
```

```text output
exit code: 0
test cases: 3, failures: 0
```

Three test cases — Newman's JUnit report has one per request run, that is per iteration, with that run's assertions inside — no failures, exit code 0. Jenkins' `junit` step (see the Jenkins track) or a test-report action on GitHub turns this file into a test page.

### 3. A failing case fails the run

```bash run fails
printf 'redis,404\n' >> tracks.csv
npx newman run tracks.postman_collection.json -e local.postman_environment.json -d tracks.csv --color off > run.log
echo "exit code: $?"
grep -A1 'AssertionError' run.log
```

```text output
exit code: 1
 1.  AssertionError  status is 404
     iteration: 4    expected response to have status code 404 but got 200
```

The new row claims `redis` does not exist, but it does: the fourth iteration fails, and Newman exits with **1**. In CI, that red step blocks the merge until either the data or the API is fixed.

### 4. The workflow

```bash run
mkdir -p .github/workflows
cat > .github/workflows/api-tests.yml <<'EOF'
name: API tests

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  api-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out the repository
        uses: actions/checkout@v7
      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
      - name: Start the API
        run: |
          npm ci
          npm start > api.log 2>&1 &
          for i in $(seq 1 60); do curl -sf http://127.0.0.1:8080/api/health && break; sleep 1; done
      - name: Run the API tests
        run: >
          npx --yes newman@6.2.3 run tests/tracks.postman_collection.json
          --env-var baseUrl=http://127.0.0.1:8080 -d tests/tracks.csv
          --reporters cli,junit --reporter-junit-export results/newman.xml
      - name: Keep the test report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: newman-report
          path: results/newman.xml
EOF
grep -c 'uses:' .github/workflows/api-tests.yml
```

```text output
3
```

- The job starts the API in the background and waits until `/api/health` answers — the same wait loop as in the lessons.
- `--env-var baseUrl=…` points the collection at the CI copy of the API, without a separate environment file.
- `newman@6.2.3` pins the exact version, as in the earlier lesson; the actions are pinned to major versions.
- `if: always()` keeps the report even when the tests fail — exactly when you want to read it.

The collection and data file would live in the repository's `tests` folder. DevForge's tests check this workflow file with the same checker that checks DevForge's own workflows.

## Common mistakes

- **Running against production.** CI tests create and change data; point them at a throwaway or test environment.
- **Not waiting for the API.** The first requests fail with "connection refused" if the API is still starting; wait for a health check.
- **Secrets in the collection or data file.** Pass tokens with `--env-var` from CI secrets (and mask them), not in committed files.
- **Unpinned tool versions.** `npx newman` without a version can change behaviour on any day; pin it.

## Where this fits in a real system

This is the API-test stage of a delivery pipeline: **GitHub Actions** or **Jenkins** runs it on every pull request, **Docker Compose** can start the API and its **PostgreSQL** and **Redis** for the job, and the JUnit report joins the unit-test results on the pull request.
