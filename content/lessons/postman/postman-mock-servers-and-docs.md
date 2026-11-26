---
id: postman-mock-servers-and-docs
title: Mock servers and API documentation
track: postman
order: 5
level: intermediate
estimated_minutes: 35
prerequisites: [postman-http-basics]
learning_objectives:
  - Describe an API in an OpenAPI document — paths, parameters, schemas and examples — as its documentation and contract.
  - Run a mock server from that document and develop against it before the real API exists.
  - Use the mock to try error responses and to catch requests that break the contract.
resources:
  - title: OpenAPI Specification 3.1.0
    url: https://spec.openapis.org/oas/v3.1.0.html
    publisher: OpenAPI Initiative
    type: reference
    level: advanced
    official: true
    why: The format of an OpenAPI document — paths, parameters, responses, schemas and examples.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Prism — mocking guide
    url: https://github.com/stoplightio/prism/blob/main/docs/guides/01-mocking.md
    publisher: Stoplight (Prism project)
    type: documentation
    level: intermediate
    official: true
    why: How Prism chooses a response (the lowest 2XX unless a status code is requested) and the Prefer header.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Postman Docs — Mock APIs overview
    url: https://learning.postman.com/docs/design-apis/mock-apis/overview/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Postman's own mock servers, built from collections and examples.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: why-mock
    prompt: The backend for a new course API will be ready in three weeks. How does a mock server help the frontend team?
    options:
      - { id: a, text: "It makes the backend faster" }
      - { id: b, text: "They can build and test against realistic responses from the agreed contract now, instead of waiting" }
      - { id: c, text: "It replaces the backend permanently" }
    answer: b
    explanation: The mock answers from the examples and schemas in the API description, so both teams can work in parallel — as long as the real API later keeps to the same contract.
  - id: openapi
    prompt: What does an OpenAPI document describe?
    options:
      - { id: a, text: "How the server is implemented" }
      - { id: b, text: "The API's interface: its paths, methods, parameters, request and response formats — readable by people and by tools" }
      - { id: c, text: "Only the URL of the API" }
    answer: b
    explanation: The OpenAPI Specification defines a language-agnostic interface description for HTTP APIs, used for documentation, mocks, client generation and tests.
  - id: contract-422
    prompt: The mock answers 422 for GET /courses/db201 but 200 for /courses/DB201. Why?
    options:
      - { id: a, text: "The mock is broken" }
      - { id: b, text: "The contract says the code must match ^[A-Z]{2}[0-9]{3}$; the mock validates requests and rejects ones that break it" }
      - { id: c, text: "Lower-case URLs are not allowed in HTTP" }
    answer: b
    explanation: A validating mock catches client bugs early — before they meet the real API.
verification:
  method: executed
  details: Every command is run by the test suite with Prism 5.16.0 installed from npm into the lab folder, and its output is compared with this lesson. Postman's own mock servers were checked against Postman's documentation (2026-11-26), not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Describe the API first in an **OpenAPI** document — its paths, parameters, schemas and examples — and that one file becomes the **documentation**, a **mock server** that others can build against today, and later the **contract** the real API is tested against.

## Explain it like I'm twelve

Before building a new playground, the school draws a plan: where each slide goes and how tall it is. Parents can read the plan, children can play on a cardboard model of it, and when the real playground is built, an inspector checks it against the plan.

The plan is the **OpenAPI document**, the cardboard model is the **mock server**, and the inspection is **contract testing**.

Where the analogy breaks: the "cardboard" API answers real HTTP requests, so the frontend team can actually use it.

## What problem it solves

Teams waste weeks waiting for each other: the frontend waits for the backend, the backend guesses what the frontend needs, and the result does not fit. Agreeing on the API's shape first, in a file both sides can read and run, lets work happen in parallel and makes disagreements visible on day one.

## How it works

![](media:postman/openapi-uses.svg)

- An **OpenAPI** document lists each path and method, its parameters (with rules such as patterns), and each possible response with a schema and an **example**.
- A **mock server** answers requests from those examples. Prism, an open-source mock server, picks the lowest 2XX response by default; a client can ask for another documented status with the `Prefer` header.
- The mock **validates requests** against the contract and answers with an error when a request breaks it.
- Postman can import OpenAPI documents into collections and run its own cloud **mock servers** from saved examples; the idea is the same.

## Try it yourself

> **Local lab** — needs Node.js and `npm`. Prism is installed into the lab folder from npm (about 75 MB, once), so nothing is installed globally. Every command is run automatically in DevForge's tests.

### 1. Describe the API

```bash run
mkdir -p mock-lab && cd mock-lab
cat > courses-api.yaml <<'EOF'
openapi: 3.1.0
info:
  title: Courses API
  version: 1.0.0
  description: Look up a course and how many seats are left.
paths:
  /courses/{code}:
    get:
      summary: Get one course
      parameters:
        - name: code
          in: path
          required: true
          description: Two capital letters and three digits, for example DB201.
          schema: { type: string, pattern: "^[A-Z]{2}[0-9]{3}$" }
      responses:
        "200":
          description: The course
          content:
            application/json:
              schema:
                type: object
                required: [code, title, seats]
                properties:
                  code: { type: string }
                  title: { type: string }
                  seats: { type: integer, minimum: 0 }
              example: { code: DB201, title: Database Systems, seats: 2 }
        "404":
          description: No course has this code
          content:
            application/json:
              example: { error: not_found }
EOF
grep -c 'example' courses-api.yaml
```

```text output
3
```

The document is the API's **documentation**: the summary, the parameter's description and its rule, both possible responses and an example of each. Import it into Postman (**Import** → the file) and it becomes a collection with these requests.

### 2. Start a mock server from it

```bash run
npm install --no-save --no-audit --no-fund --loglevel=error @stoplight/prism-cli@5.16.0 > npm.log 2>&1 || cat npm.log
npx prism --version
npx prism mock -h 127.0.0.1 -p 4010 courses-api.yaml > prism.log 2>&1 &
echo $! > prism.pid
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:4010/ && break; sleep 0.5; done
M=http://127.0.0.1:4010
```

```text output
5.16.0
```

### 3. Build against it

```bash run
curl -s -w ' %{http_code}\n' "$M/courses/DB201"
curl -s -w ' %{http_code}\n' -H 'Prefer: code=404' "$M/courses/XX999"
```

```text output
{"code":"DB201","title":"Database Systems","seats":2} 200
{"error":"not_found"} 404
```

- The mock answered with the documented example — the frontend can render a course page today.
- `Prefer: code=404` asks for the documented 404 example, so the error screen can be built and tested too — without finding a course code that does not exist.

### 4. The mock checks the contract

```bash run
curl -s -w ' %{http_code}\n' "$M/courses/db201" | sed 's/.*"message":"\([^"]*\)".*} \([0-9]*\)$/\2 \1/'
curl -s -w ' %{http_code}\n' "$M/students/1" | sed 's/.*"title":"\([^"]*\)".*} \([0-9]*\)$/\2 \1/'
```

```text output
422 Request path parameter code must match pattern \
404 Route not resolved, no path matched
```

A lower-case code breaks the parameter's rule, and `/students/1` is not in the contract at all. The mock tells the client exactly what is wrong — before anyone writes backend code. (`sed` just picks the message out of Prism's JSON.)

### 5. Stop the mock

```bash run
kill "$(cat prism.pid)"
```

## Common mistakes

- **Examples that break their own schema.** A mock built from a wrong example teaches the frontend the wrong thing. Keep examples valid — linters and contract tests catch this.
- **Letting the document drift.** If the real API changes and the document does not, the documentation lies. Test the real API against the contract (the *Contract testing* lesson).
- **Documenting only the happy path.** Clients need the 400, 401, 404 and 409 responses too; document them with examples.
- **Treating a mock as a test of the backend.** A mock only proves the client works with the contract; it says nothing about the real server.

## Where this fits in a real system

The OpenAPI document lives in the repository next to the code, is reviewed in pull requests on **GitHub**, linted and contract-tested in **GitHub Actions**, and imported into **Postman** to generate collections; mock servers let mobile and web teams start before the backend — and **Nginx** or an API gateway can route a path to the mock during development.
