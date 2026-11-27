---
id: postman-college-api-tests
track: postman
title: API test suite for a college service
level: beginner
estimated_hours: 5
prerequisites: [postman-http-basics, postman-sessions-and-tests, postman-collections-environments-newman]
related_tracks: [github-actions]
user_stories:
  - As a student using the course portal, I want "course not found" when I mistype a course code so that I do not think the course exists and has no details.
  - As a member of the academic office, I want a full course to refuse further enrolments so that we never promise seats we do not have.
  - As a developer of the API, I want one command that re-checks every endpoint and error so that I can change the code without clicking through requests by hand.
acceptance_criteria:
  - college-api.postman_collection.json and college.postman_environment.json are valid Postman files, and every request uses {{baseUrl}} instead of a fixed address.
  - Run with Newman against the correct API, every assertion passes; every request has at least one test, no test script crashes, and the suite makes at least 15 assertions.
  - The suite sends requests that list all courses, filter by department, read one course, ask for an unknown course (404), enrol a student (201), send an invalid enrolment (400) and enrol in a full course (409).
  - Against each of five deliberately broken versions of the API — unknown course answers 200, wrong course returned, department filter ignored, invalid student IDs accepted, full course accepts enrolments — at least one assertion fails.
rubric:
  - { criterion: "What the tests check", excellent: "Every request checks the status and the fields a client uses (the requested course, the department, the error code and the field named in details), with no assertions on values that change by themselves.", good: "Status codes and the main body fields are checked.", needs_work: "Mostly status codes; a wrong body with the right status would pass." }
  - { criterion: "Error paths", excellent: "Each documented error (400, 404, 409) has its own request with a test of the error code, and the invalid input is chosen to show one rule at a time.", good: "The 404 and at least one enrolment error are tested.", needs_work: "Only the happy path is tested." }
  - { criterion: "Variables and chaining", excellent: "{{baseUrl}} everywhere; test data (course codes, student ID) in collection variables; the seat count is read from one response and compared with the next.", good: "{{baseUrl}} everywhere, with some values repeated in requests.", needs_work: "Addresses or values typed into each request." }
  - { criterion: "Readability", excellent: "Request and test names read like a specification (\"Unknown course → status is 404\"), so a failing run explains itself.", good: "Names say what each request does.", needs_work: "Default names such as \"New Request\" or tests named \"test 1\"." }
hints:
  - Start the API in one terminal (node api/college-api.mjs) and send each request from the table in the README by hand first, in Postman or with curl -i. Write the test after you have seen the real response.
  - A test that only checks pm.response.to.have.status(200) passes when the API returns the wrong course. Compare a body field with what you asked for, for example the course code with the code in the URL.
  - To prove your suite catches a bug, start a broken copy on another port — BUG=wrong-course PORT=7402 node api/college-api.mjs — and run Newman with --env-var "baseUrl=http://127.0.0.1:7402". It must fail.
  - For "one seat fewer", save the seats from the list response with pm.collectionVariables.set and compare them with seatsLeft in the enrolment response.
stretch_goals:
  - Add a data file with several invalid student IDs (empty, lower-case s, five digits) and run the invalid-enrolment request once per row with -d, as in "Collections in CI".
  - Test the 415 response for a body sent as form data, and the 405 response for DELETE /courses.
  - Write a GitHub Actions workflow that starts the API and runs the collection on every pull request.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The academic office's course API serves the student portal and the mobile app. Releases have been checked by
someone clicking through a few requests, and two bugs reached students last term: a mistyped course code showed
an empty page instead of "not found", and a full course kept accepting enrolments.

You will write the **Postman collection** that checks the API's whole contract — the four endpoints and every
documented error — so that **Newman** can run it on every change. The starter contains the API (a small Node.js
program you run locally and must not change), an environment with `baseUrl`, and a collection with a single
health check. The README in the starter is the API's contract.

A test suite is only useful if it fails when the API is wrong. The check therefore runs your collection twice
over: against the correct API, where everything must pass, and against five deliberately broken copies, where
something must fail.

## Getting started

1. Copy the starter files into a new folder. In one terminal, start the API (Node.js 22 or later):

   ```bash
   node api/college-api.mjs
   ```

2. In a second terminal, install Newman into the folder, as in *Collections, environments and Newman*, and run
   the starter collection:

   ```bash
   npm install --no-save --no-audit --no-fund --loglevel=error newman@6.2.3
   npx newman run college-api.postman_collection.json -e college.postman_environment.json
   ```

3. Import the collection and the environment into Postman (or edit the JSON directly). Add one request per row
   of the contract table, send it, look at the response, then write its tests. Export the collection back to
   `college-api.postman_collection.json` (format v2.1) after each change.
4. Try your suite against a broken API: start `BUG=missing-404 PORT=7402 node api/college-api.mjs` and run
   Newman with `--env-var "baseUrl=http://127.0.0.1:7402"`. The run must fail. The list of bugs is at the top of
   `api/college-api.mjs`.
5. Run the check. It needs Docker and network access; it starts a throwaway Node.js container, installs Newman
   6.2.3 in it and starts its own copies of the API:

   ```bash
   bash check.sh path/to/your/project
   ```
