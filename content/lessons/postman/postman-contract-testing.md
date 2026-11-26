---
id: postman-contract-testing
title: Contract testing
track: postman
order: 7
level: advanced
estimated_minutes: 35
prerequisites: [postman-mock-servers-and-docs]
learning_objectives:
  - Write a contract for part of a real API, and check the API's real responses against it with a validating proxy.
  - Read a contract violation and decide whether the API or the contract must change.
  - Compare provider-side contract checks with consumer-driven contracts (such as Pact), and say what each catches.
resources:
  - title: Prism — validation proxy guide
    url: https://github.com/stoplightio/prism/blob/main/docs/guides/03-validation-proxy.md
    publisher: Stoplight (Prism project)
    type: documentation
    level: advanced
    official: true
    why: Running Prism in front of a real API to validate requests and responses, and the --errors flag.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Pact — Introduction
    url: https://docs.pact.io/
    publisher: Pact Foundation
    type: documentation
    level: advanced
    official: true
    why: Consumer-driven contract testing, where the contract comes from the consumer's tests.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: what-contract
    prompt: What does a contract test check that an ordinary functional test may not?
    options:
      - { id: a, text: "That the server is fast" }
      - { id: b, text: "That requests and responses keep the agreed shape — required fields, types, status codes — so clients built against the contract keep working" }
      - { id: c, text: "That the database is backed up" }
    answer: b
    explanation: Functional tests check behaviour for chosen cases; a contract test checks every exchange against the shared description, catching renamed, removed or retyped fields.
  - id: violation
    prompt: The proxy reports "Response body property track must have required property 'lessonCount'". What does it mean?
    options:
      - { id: a, text: "The API crashed" }
      - { id: b, text: "The contract promises a field the API does not send; either the API must add it, or the contract (and the clients relying on it) must change" }
      - { id: c, text: "The request was malformed" }
    answer: b
    explanation: A violation is a disagreement between the description and reality. Which side changes is a decision for the teams involved — but it must be made, not ignored.
  - id: consumer-driven
    prompt: How do consumer-driven contracts (Pact) differ from checking an API against an OpenAPI document?
    options:
      - { id: a, text: "They do not use HTTP" }
      - { id: b, text: "The contract is generated from each consumer's own tests, so it contains exactly the parts each consumer uses, and the provider is verified against all of them" }
      - { id: c, text: "They only run in production" }
    answer: b
    explanation: Pact's documentation describes the contract as generated during the consumer's tests, so only parts of the communication the consumer actually uses get tested — the provider can change everything else freely.
verification:
  method: executed
  details: Every command is run by the test suite with Prism 5.16.0 as a validating proxy in front of a real DevForge server, after the previous lessons, and its output is compared with this lesson. Pact was checked against its documentation (2026-11-26), not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

A **contract test** checks that a real API's requests and responses still match the agreed description — so documentation, mocks and every client built against it cannot silently drift — and a **violation** forces a decision about which side must change.

## Explain it like I'm twelve

A school orders sports kits from a supplier. The order form says every shirt has a number on the back. When boxes arrive, someone checks each shirt against the form — not whether it is a nice shirt, but whether it has what was promised. A shirt without a number goes back.

The order form is the **contract**, the checker is the **validating proxy**, and the shirt without a number is a **violation**.

Where the analogy breaks: sometimes the form was wrong, not the shirt — and then the form changes.

## What problem it solves

APIs change: a field is renamed, a number becomes a string, an error format moves. Each change can break a mobile app or a partner integration nobody on the API team remembers. Contract tests catch such changes in CI, at the moment they happen, with the exact field that broke.

## How it works

![](media:postman/contract-proxy.svg)

- The **contract** is an OpenAPI document listing, for each path, the required fields, their types and the possible status codes.
- A **validating proxy** — here Prism in proxy mode — forwards every request to the real API and checks request and response against the contract. With `--errors`, a mismatch replaces the response with an error describing the violation.
- Running a collection *through* the proxy turns every functional test into a contract test as well.
- In **consumer-driven** contract testing (Pact), each consumer's tests record the interactions they rely on; the provider is then verified against those contracts, so it knows exactly which changes would break whom.

## Try it yourself

> **Local lab** — continue in the `mock-lab` folder from *Mock servers and API documentation* (Prism installed there), with DevForge running and `API` set. Every command is run automatically in DevForge's tests.

### 1. A contract for part of DevForge's API

```bash run
cat > devforge-contract.yaml <<'EOF'
openapi: 3.1.0
info:
  title: DevForge — tracks
  version: 1.0.0
paths:
  /api/tracks/{slug}:
    get:
      parameters:
        - { name: slug, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: One track with its published lessons
          content:
            application/json:
              schema:
                type: object
                required: [track, lessons]
                properties:
                  track:
                    type: object
                    required: [slug, title, number]
                    properties:
                      slug: { type: string }
                      title: { type: string }
                      number: { type: integer, minimum: 1, maximum: 18 }
                  lessons:
                    type: array
                    items: { type: object, required: [id, title] }
        "404":
          description: No track with this slug
          content:
            application/json:
              schema:
                type: object
                required: [error]
                properties:
                  error:
                    type: object
                    required: [code]
                    properties: { code: { const: not_found } }
EOF
echo "contract written"
```

```text output
contract written
```

The contract only lists what clients rely on. DevForge returns more fields; extra fields are allowed unless the contract forbids them, so adding a field never breaks the contract — removing or retyping one does.

### 2. Put a validating proxy in front of the real API

```bash run
start_proxy() {
  ./node_modules/.bin/prism proxy -h 127.0.0.1 -p 4011 devforge-contract.yaml "$API" --errors > proxy.log 2>&1 &
  echo $! > proxy.pid
  for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:4011/ && break; sleep 0.5; done
}
start_proxy
P=http://127.0.0.1:4011
echo "kafka:         $(curl -s -o /dev/null -w '%{http_code}' "$P/api/tracks/kafka")"
echo "no-such-track: $(curl -s -o /dev/null -w '%{http_code}' "$P/api/tracks/no-such-track")"
```

```text output
kafka:         200
no-such-track: 404
```

Both requests went to the real DevForge, and both responses matched the contract, so the proxy passed them through unchanged.

### 3. The contract and the API disagree

A mobile team asked for a `lessonCount` on every track and added it to the contract as required — but nobody changed the API:

```bash run
kill "$(cat proxy.pid)"
sed -i.bak 's/required: \[slug, title, number\]/required: [slug, title, number, lessonCount]/' devforge-contract.yaml && rm devforge-contract.yaml.bak
start_proxy
curl -s -w ' %{http_code}\n' "$P/api/tracks/kafka" | sed 's/.*"message":"\([^"]*\)".*} \([0-9]*\)$/\2 \1/'
```

```text output
500 Response body property track must have required property 'lessonCount'
```

The real response lacks a field the contract promises, so the proxy reports a **violation** — naming the exact field — instead of passing the response on. In CI, running the collection through the proxy turns this into a failing build. Now the teams must decide: add `lessonCount` to the API, or take it out of the contract and tell the mobile team to count `lessons` themselves.

### 4. Settle it, and check again

Here, the decision is to keep the API as it is: the client can count the `lessons` array.

```bash run
kill "$(cat proxy.pid)"
sed -i.bak 's/required: \[slug, title, number, lessonCount\]/required: [slug, title, number]/' devforge-contract.yaml && rm devforge-contract.yaml.bak
start_proxy
echo "kafka: $(curl -s -o /dev/null -w '%{http_code}' "$P/api/tracks/kafka")"
kill "$(cat proxy.pid)"
```

```text output
kafka: 200
```

## Common mistakes

- **Contracts nobody runs.** An OpenAPI file that is never checked against the API drifts within weeks. Run the contract check in CI.
- **Contracts that require everything.** Listing every field as required makes harmless additions fail; require what clients really use.
- **Testing only the happy path.** Error responses are part of the contract — clients parse them too.
- **Breaking changes without versioning.** Removing a field clients use needs a new API version or a deprecation period, not a silent change.

## Where this fits in a real system

The contract lives in the API's repository; **GitHub Actions** runs the **Newman** collection through a validating proxy on every pull request; teams with many services add consumer-driven contracts (Pact) so each service knows its consumers' needs — and **Kafka** event schemas get the same treatment with schema registries.
