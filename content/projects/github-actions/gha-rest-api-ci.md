---
id: gha-rest-api-ci
track: github-actions
title: Full CI pipeline for a REST API
level: beginner
estimated_hours: 6
prerequisites: [github-actions-first-workflow, github-actions-pull-requests-and-safety, github-actions-caching-and-artifacts]
related_tracks: [git-github, jenkins]
user_stories:
  - As a developer on the team, I want every pull request linted, tested and built automatically so that I find out about a broken change before it reaches main.
  - As a reviewer, I want a red cross when a test fails so that I never approve a change on the strength of a check that is always green.
  - As a team member who deploys, I want the build that CI tested to be downloadable so that I deploy exactly what passed.
  - As a user of the notes app, I want a note with a blank title to be refused so that the list never fills with empty entries.
acceptance_criteria:
  - .github/workflows/ci.yml runs on pushes to main and on pull requests.
  - "Every job's token is read-only (permissions: contents: read), and every action is pinned to a release or a full commit SHA."
  - The job uses actions/setup-node with the npm cache keyed on package-lock.json, and installs with npm ci.
  - Run as a push to main, the workflow succeeds and runs lint, test and build, then uploads dist/ (with BUILD_INFO.json recording the commit) as an artifact.
  - The run fails when a test fails or when lint finds a problem, and nothing is uploaded after a failed test.
  - A title of only spaces is rejected with 400, and titles are limited to 120 characters after trimming.
  - Your tests pass and fail against each of six faulty versions of src/app.js (wrong status code, missing Location header, blank or over-long title accepted, unknown id answered with 200, delete that keeps the note).
rubric:
  - { criterion: "Pipeline design", excellent: "Lint, test and build run in a sensible order in one short workflow; the artifact has a clear name and a retention period; superseded runs are cancelled with concurrency; a timeout stops a stuck job.", good: "The workflow runs every required step and goes red on any failure.", needs_work: "Steps are missing, or failures are hidden with || true or continue-on-error." }
  - { criterion: "Security hygiene", excellent: "Read-only token, actions pinned to commit SHAs with the version in a comment, no secrets needed or printed.", good: "Read-only token and actions pinned to release tags.", needs_work: "No permissions block, or actions pinned to a branch such as @main." }
  - { criterion: "Tests", excellent: "Each endpoint and rule has a focused test with a clear name, including edge cases (exactly 120 characters, a tab-only title, invalid JSON); tests are independent of each other.", good: "Every endpoint is tested and all faulty versions are caught.", needs_work: "Tests check only that requests succeed, so faulty versions still pass." }
  - { criterion: "Bug fix", excellent: "A failing test reproduced the whitespace bug before the fix; the fix trims once and stores the trimmed title.", good: "The bug is fixed and covered by a test.", needs_work: "The bug is fixed without a test, or the fix breaks other rules." }
hints:
  - Start by making CI honest. Remove || true from the starter's workflow, push (or run the check), and watch it go red for the right reason before you add anything else.
  - The lesson "Caching and artifacts" has a complete build workflow. With actions/setup-node, cache npm adds a cache keyed on package-lock.json for you; npm ci needs that lockfile and fails if it does not match package.json.
  - Write one test per rule in README.md. For the status codes, compare with assert.equal(res.status, 201); for the Location header, res.headers.get("location").
  - The check swaps faulty versions of src/app.js in. If one survives, ask what your tests would need to notice — for "DELETE keeps the note", fetching the note again after deleting it.
  - Write the whitespace test first, see it fail, then fix validateNote. "   ".trim() is an empty string.
stretch_goals:
  - Run the tests on Node.js 22 and 24 with a matrix (the intermediate project goes much further).
  - Make the workflow a required status check for main with a ruleset, as in the lesson on pull requests.
  - Add Dependabot updates for the pinned actions (package-ecosystem github-actions).
  - Add a job that starts the built server from the artifact and calls /health, depending on the build job with needs.
starter: starter
solution: solution
check_needs: [docker, node]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The Campus Notes API is a small REST service for course notes, built on Node.js with no dependencies. It
already has a CI workflow — written in a hurry, run only on pushes, with an unpinned action, `npm install` and
`npm test || true`. It has been green on every commit, including the one where a user could create a note whose
title is nothing but spaces.

Build the pipeline the team should have had from the start: on every push to `main` and every pull request,
install exactly the locked dependencies, lint, test and build, keep the build as an artifact, and fail loudly
when anything fails. Then make the tests worth running — cover every endpoint and rule in the README — and fix
the bug they find.

The check does not just read your YAML. It **runs your workflow locally** in a pinned Node.js container as if
you had pushed to `main`: your `run` steps really execute, and the artifact is collected. It runs it again with
a failing test and with a lint problem slipped in, to prove the pipeline goes red, runs DevForge's own API
tests, and swaps six faulty versions of `src/app.js` in to see whether your tests notice each one.

What the local run cannot show: GitHub's own behaviour (the cache really being restored, the artifact on the
run page, required checks). Push the repository to GitHub to see those.

## Getting started

1. Copy the starter folder, read its README (the API, the rules and the fixed interface), and run it:

   ```bash
   npm ci && npm test && npm run lint && npm run build
   ```

2. Run the check to see where you stand (it needs Docker and Node.js; the first run downloads a Node.js image
   and the YAML parser):

   ```bash
   bash check.sh path/to/campus-notes-api
   ```

3. Rewrite `.github/workflows/ci.yml` step by step, re-running the check as you go. Pin actions to the SHAs
   from the lesson "Supply-chain hardening" (or at least to release tags).
4. Add tests until no faulty version survives, then fix the whitespace bug.
5. Optional: push to a GitHub repository and open a pull request to see the workflow run there.
