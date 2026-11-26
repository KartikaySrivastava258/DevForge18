---
id: postman-collections-environments-newman
title: Collections, environments and Newman
track: postman
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [postman-sessions-and-tests]
learning_objectives:
  - Write a collection whose requests use variables, and an environment that gives them values.
  - Run the collection and its tests from the command line with Newman.
  - Switch or override variables to test another target, and read a failing run.
resources:
  - title: Newman (README)
    url: https://github.com/postmanlabs/newman#readme
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Running collections from the command line, environments and --env-var.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Store and reuse values using variables
    url: https://learning.postman.com/docs/use/send-requests/variables/variables/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Variable syntax, scopes and which value wins when names clash.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Manage environments
    url: https://learning.postman.com/docs/postman/variables-and-environments/managing-environments/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: What an environment is and how scripts read its values.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-env
    prompt: Why put the server address in an environment instead of typing it into every request?
    options:
      - { id: a, text: "Postman requires it" }
      - { id: b, text: "The same collection can then run against your laptop, a test server or production just by switching environment — no request changes" }
      - { id: c, text: "Environments make requests faster" }
    answer: b
    explanation: Postman's documentation describes environments as sets of variables you switch between; every {{variable}} in the requests takes the current environment's value.
  - id: scope
    prompt: trackSlug is "kafka" in the environment, and you run Newman with --env-var "trackSlug=docker". Which value do the requests use?
    options:
      - { id: a, text: "kafka" }
      - { id: b, text: "docker — --env-var sets the environment variable from the command line, overriding the file" }
      - { id: c, text: "Both, one after the other" }
    answer: b
    explanation: You see it in the lesson. Command-line values are handy in CI, where the target differs per job.
  - id: exit-code
    prompt: Why does it matter that Newman exits with a non-zero code when an assertion fails?
    options:
      - { id: a, text: "It does not matter" }
      - { id: b, text: "A CI step fails on a non-zero exit code, so a broken API stops the pipeline instead of being reported and ignored" }
      - { id: c, text: "It deletes the collection" }
    answer: b
    explanation: The lesson shows the exit code. That is what lets a collection run be a quality gate in GitHub Actions or Jenkins.
verification:
  method: executed
  details: Every command is run by the test suite against a real DevForge server, with Newman 6.2.3 installed from npm; the output shown was recorded from that run, with timings and sizes left out. The Postman application steps were checked against Postman's documentation (2026-11-26) but are not executed, because Postman is a desktop application.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **collection** saves requests and their **tests** so they can be run again; **variables** such as `{{baseUrl}}` keep the details out of the requests, an **environment** supplies their values, and **Newman** runs the whole collection from the command line — the same way on your laptop and in CI.

## Explain it like I'm twelve

A school fire drill has a checklist: open these doors, count everyone, check these rooms. The checklist is the same for every building — only the building's name and room list change. Before each drill you clip the right building's sheet to it.

The checklist is the **collection**, the building's sheet is the **environment**, and doing the drill without a teacher standing by is **Newman**.

Where the analogy breaks: Newman does not just do the checks — it reports every one that failed and tells the build system the drill went wrong.

## What problem it solves

Clicking through requests by hand does not scale: nobody re-checks the whole API after every change, and "it worked on my machine" is all you learn. A collection with tests, run by Newman in CI against the right environment, re-checks everything on every change and fails the build when the API breaks.

## How it works

![](media:postman/newman-run.svg)

- A collection is a JSON file of requests; each can have a **test script** using `pm.test` and assertions such as `pm.response.to.have.status(200)`.
- In requests, `{{name}}` is replaced by a variable's value. An environment is a set of variables; scripts read it with `pm.environment.get`.
- Variables live in scopes — global, collection, environment, data and local, from broadest to narrowest — and the narrowest one wins when names clash.
- `newman run collection.json -e environment.json` runs every request in order and its tests; `--env-var "name=value"` sets an environment variable from the command line. Postman also offers a newer Postman CLI with similar uses; Newman is the open-source runner used here.

## Try it yourself

> **Local lab** — keep DevForge running and `API` set, as in the previous lessons. Newman is installed into the lab folder with npm, so nothing is installed globally. Every command is run automatically in DevForge's tests against a real DevForge server.

### 1. Install Newman

```bash run
mkdir -p newman-lab && cd newman-lab
npm install --no-save --no-audit --no-fund --loglevel=error newman@6.2.3 > npm.log 2>&1 || cat npm.log
npx newman --version
```

```text output
6.2.3
```

`newman@6.2.3` pins an exact version, so the run is the same everywhere.

### 2. A collection with variables and tests

```bash run
cat > devforge.postman_collection.json <<'EOF'
{
  "info": {
    "name": "DevForge API checks",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/health" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 200', () => pm.response.to.have.status(200));",
        "pm.test('says ok', () => pm.expect(pm.response.json().status).to.eql('ok'));"
      ] } }]
    },
    {
      "name": "Track",
      "request": { "method": "GET", "url": "{{baseUrl}}/api/tracks/{{trackSlug}}" },
      "event": [{ "listen": "test", "script": { "exec": [
        "pm.test('status is 200', () => pm.response.to.have.status(200));",
        "pm.test('is the requested track', () => pm.expect(pm.response.json().track.slug).to.eql(pm.environment.get('trackSlug')));"
      ] } }]
    }
  ]
}
EOF
cat > local.postman_environment.json <<EOF
{
  "name": "local",
  "values": [
    { "key": "baseUrl", "value": "$API", "enabled": true },
    { "key": "trackSlug", "value": "kafka", "enabled": true }
  ]
}
EOF
grep -o '{{[a-zA-Z]*}}' devforge.postman_collection.json | sort -u
```

```text output
{{baseUrl}}
{{trackSlug}}
```

- This is the file Postman exports when you save a collection (format v2.1). Neither request contains the server address: both use `{{baseUrl}}`.
- The environment file gives `baseUrl` the address of your DevForge (`$API`; the heredoc is not quoted, so the shell fills it in) and `trackSlug` the value `kafka`.

### 3. Run it

```bash run
npx newman run devforge.postman_collection.json -e local.postman_environment.json --color off | grep -E '^→|  ✓|  [0-9]+\. '
```

```text output
→ Health
  ✓  status is 200
  ✓  says ok
→ Track
  ✓  status is 200
  ✓  is the requested track
```

Every request ran, and every assertion passed. (`grep` keeps only the requests and checks; Newman also prints a summary table with timings.)

### 4. Override a variable from the command line

```bash run
npx newman run devforge.postman_collection.json -e local.postman_environment.json --env-var "trackSlug=docker" --color off \
  | grep -E '^→|GET|  ✓' | sed -E 's/ \[.*\]$//' | sed "s#$API#\$API#"
```

```text output
→ Health
  GET $API/api/health
  ✓  status is 200
  ✓  says ok
→ Track
  GET $API/api/tracks/docker
  ✓  status is 200
  ✓  is the requested track
```

The same collection and environment, but the request now asks for the `docker` track — and the test, which reads the same variable, still agrees. (The two `sed` commands drop the timing after each request and show your server's address as `$API`.)

### 5. A failing run

```bash run
npx newman run devforge.postman_collection.json -e local.postman_environment.json --env-var "trackSlug=no-such-track" --color off > run.log || echo "newman exit code: $?"
grep -E '  [0-9]+\. ' run.log
```

```text output
newman exit code: 1
  1. status is 200
  2. is the requested track
```

The track does not exist, so the API answers 404 and two assertions fail. Newman lists them — and exits with a non-zero code, which is what makes a CI step fail.

## Try it in the simulation

Build requests against a model of DevForge's API — method, CSRF header, cookie, body — and read each status code and what it means. It is a labelled model with the real API's status codes, not live requests.

```simulation postman-request-builder scenario=signed-out
```

## Common mistakes

- **Server addresses or tokens typed into requests.** Put them in environment variables; keep secrets out of exported files you commit.
- **Tests that only check the status code.** Also check the body — the right track, the right fields.
- **Requests that depend on data someone created by hand.** A collection should create what it needs, or use data you control.
- **Ignoring Newman's exit code** (for example with `|| true` in CI). Then failures are printed and forgotten.
- **Unpinned Newman versions in CI.** Pin a version so runs do not change under you.

## Where this fits in a real system

A CI job in **GitHub Actions** or **Jenkins** starts the API (perhaps with **Docker** Compose and **PostgreSQL**), runs `newman run` against a test environment, and stops the pipeline on any failure. The same collection, with another environment, checks a staging deployment after release.
