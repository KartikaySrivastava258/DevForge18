---
id: postman-regression-suite
track: postman
title: Automated regression suite
level: advanced
estimated_hours: 9
prerequisites: [postman-collections-environments-newman, postman-collections-in-ci, postman-contract-testing]
related_tracks: [github-actions, jenkins]
user_stories:
  - As a student using the events app, I want an edited or cancelled event to show its real state so that I do not turn up to something that has moved or been cancelled.
  - As a maintainer of the events API, I want every pull request to run the whole API contract so that a regression is caught before it is merged, not by students.
  - As a reviewer reading a failed pipeline, I want a JUnit report that names the failing request and data row so that I know what broke without re-running anything.
  - As a maintainer of the API, I want the suite to ignore changes the contract allows so that it does not block harmless releases and get switched off.
acceptance_criteria:
  - sh run-api-tests.sh <base URL> exits 0 against the current release, writes a JUnit report per collection run into results/, and runs at least 15 test cases.
  - A second run against the same API also passes, and after two runs the API holds only its two original events (the suite deletes what it creates).
  - The suite creates, reads, lists, updates and deletes an event and reads it after the delete (404), and sends at least 6 invalid events per run that between them break the title, date, capacity and venue rules.
  - The suite passes against a release with harmless changes (an extra field, UUID ids, a different list order).
  - Against each of six releases with a regression — update not saved, delete not done, new events missing from the list, capacity 0 accepted, impossible date accepted, validation details missing — run-api-tests.sh exits non-zero and a JUnit report records a failing test.
  - "run-api-tests.sh pins an exact Newman version, and a workflow in .github/workflows runs it on pull requests and uploads results/ even when tests fail (if: always())."
rubric:
  - { criterion: "Read-after-write checks", excellent: "Every change (create, update, delete) is confirmed by a separate read, and the list is checked by id rather than position or length.", good: "Create, update and delete are each confirmed at least once.", needs_work: "The suite trusts each response's own claim that a change was saved." }
  - { criterion: "Data-driven validation", excellent: "One request and a data file with one invalid field per row, covering both sides of every limit (0 and 501, 2.5), with test names that include the row's case.", good: "A data file covers each rule at least once.", needs_work: "A copy of the request per case, or only one invalid input." }
  - { criterion: "Robustness", excellent: "Unique test data per run, cleanup at the end, no assertions on ids' format, order, timestamps or unknown fields; the README explains each choice.", good: "Passes twice in a row and on the harmless release.", needs_work: "Fails on a second run or on harmless changes, so people learn to ignore it." }
  - { criterion: "CI integration", excellent: "One runner script with a pinned Newman that runs every collection, keeps every report and combines the exit codes; a workflow with read-only permissions, a timeout, a readiness wait and reports kept on failure.", good: "A workflow runs the suite on pull requests and fails when tests fail.", needs_work: "The pipeline can pass when a test failed (lost exit code), or reports are lost on failure." }
hints:
  - Chain the life of one event with a collection variable — save event.id from the create response and use {{eventId}} in every later URL. Then ask again after each change; the response to a PATCH or DELETE is the API's claim, the next GET is the evidence.
  - For validation, write one request whose body uses {{title}}, {{date}}, {{capacity}} and {{venue}}, and a CSV file with one row per invalid event plus a column for the field that should be named. Leave {{capacity}} unquoted in the JSON so the row's value is sent as a number.
  - A title made unique in a pre-request script (for example with Date.now()) and a DELETE at the end make the suite independent of what earlier runs left behind.
  - In a shell script, the exit code of a line that is not checked is lost. Record each Newman run's result (… || status=1) and exit with it at the end, after every collection has run.
  - Start the harmless release with HARMLESS=1 node api/events-api.mjs and run your suite against it. Every failure there is a test of something the contract does not promise.
stretch_goals:
  - Add boundary rows that must be accepted (capacity 1 and 500, a title of exactly 80 characters) and delete the events they create.
  - Run the suite through a Prism validating proxy with an OpenAPI description of the contract, as in "Contract testing".
  - Make the workflow publish the JUnit reports as a test summary on the pull request.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The student council's events API has shipped three releases this term, and two of them broke something that had
worked before: once an edit answered "saved" without saving, once deleted events kept appearing in the app.
Students found both bugs first. You will build the **regression suite** that would have stopped them: Postman
collections that cover the API's whole contract, a runner script that CI calls, and a GitHub Actions workflow that
runs it on every pull request.

A regression suite has to earn trust in two directions. It must **fail** on every release that breaks the
contract — so the check runs it against six releases with a typical regression each. And it must **pass** on
releases that do not — a second run against the same API, and a release with changes the contract allows — or
people learn to ignore it.

The starter contains the API (run it locally; do not change it), a collection with two requests and a minimal
runner. The README in the starter is the contract.

## Getting started

1. Copy the starter files into a new folder, start the API (Node.js 22 or later) and run the starter suite:

   ```bash
   node api/events-api.mjs
   # in a second terminal:
   sh run-api-tests.sh http://127.0.0.1:7403
   ```

2. Build the event's life cycle in `tests/`, then the data-driven validation cases. *Collections in CI* shows
   `-d` with a CSV file and the JUnit reporter.
3. Run the suite twice in a row, then against `HARMLESS=1 PORT=7404 node api/events-api.mjs`. Both must pass.
4. Try a regression, for example `BUG=patch-ignored PORT=7405 node api/events-api.mjs`; the runner must exit
   non-zero (`echo $?`) and a report in `results/` must show the failing test. The list of regressions is at
   the top of `api/events-api.mjs`.
5. Write the workflow in `.github/workflows/`: start the API, wait for `/health`, run `sh run-api-tests.sh`, and
   keep `results/`.
6. Run the check (it needs Docker and network access; it installs Newman 6.2.3 in a throwaway container and runs
   your runner there, as CI would):

   ```bash
   bash check.sh path/to/your/project
   ```
