---
id: postman-sessions-and-tests
title: Sessions, chained requests and API tests
track: postman
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [postman-http-basics]
learning_objectives:
  - Explain how a session cookie lets a stateless HTTP API recognise a signed-in user.
  - Chain requests that depend on each other (sign up, act, sign out) with curl and in Postman.
  - Use variables and environments so the same requests work against different servers.
  - Write automated checks on status codes and response bodies, and know how to run them in CI.
resources:
  - title: Write scripts to test API response data in Postman
    url: https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: The official guide to post-response scripts, pm.test, pm.response and the Test Results tab used in this lesson.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Postman Learning Center
    url: https://learning.postman.com/
    publisher: Postman
    type: documentation
    level: all
    official: true
    why: Covers variables, environments, cookies, writing test scripts and running collections from the command line.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: stateless
    prompt: HTTP is stateless. How, then, does /api/auth/me know who you are after you sign in?
    options:
      - { id: a, text: "The server remembers your computer's IP address" }
      - { id: b, text: "Signing in sets a session cookie; the client sends it back with every later request, and the server looks the session up" }
      - { id: c, text: "The password is sent again automatically with every request" }
    answer: b
    explanation: The Set-Cookie header in the sign-in response gives the client a random session token. Browsers, Postman's cookie jar and curl's -b option send it back, and the server finds the session it belongs to. Without the cookie, the same request is anonymous.
  - id: logout-replay
    prompt: After signing out, someone replays the old session cookie. What should a secure API do?
    options:
      - { id: a, text: "Accept it until the cookie's expiry date" }
      - { id: b, text: "Reject it, because signing out deleted the session on the server, so the token no longer refers to anything" }
      - { id: c, text: "Sign the user back in automatically" }
    answer: b
    explanation: Server-side sessions can be revoked instantly. DevForge deletes the session at sign-out, so the replayed token is meaningless — which is why the bookmarks request returned 401 at the end of the lab.
  - id: environments
    prompt: Why put the server address in an environment variable such as {{baseUrl}} instead of typing it into each request?
    options:
      - { id: a, text: "Postman refuses requests without variables" }
      - { id: b, text: "The same collection can run against your laptop, a test server or CI by switching environments, without editing any request" }
      - { id: c, text: "Variables make requests faster" }
    answer: b
    explanation: Environments separate what a request does from where it is sent. Switching from Local to Staging changes one value instead of every saved request — and keeps environment-specific secrets out of the requests themselves.
  - id: what-to-assert
    prompt: Which check is the most useful in an automated API test for "sign in with a wrong password"?
    options:
      - { id: a, text: "The response arrives in under 10 seconds" }
      - { id: b, text: "The status is 401 and the body's error code is invalid_credentials" }
      - { id: c, text: "The response body is not empty" }
    answer: b
    explanation: Assert the contract — status and the meaningful fields — so the test fails if behaviour changes. Vague checks such as "not empty" pass even when the API returns the wrong error.
verification:
  method: executed
  details: Every curl and shell command is run by the test suite against a real DevForge server, and its output is compared with what this lesson shows; values that change on every request are shown as "…". The Postman steps and pm.test scripts were written from Postman's documentation and are not executed, because Postman is a desktop application.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

Real API work is a **sequence** of requests that depend on each other — sign in, use the session, sign out — and every important response should be **checked automatically** rather than by eye.

## Explain it like I'm twelve

At a school event you show your ID at the gate and get a wristband. For the rest of the day you just show the wristband, not your ID. When you leave, the wristband is cut off, and a copy of it would not get anyone back in.

The **session cookie** is the wristband: you prove who you are once, then the cookie proves it on every request. Where the analogy breaks: a wristband can be seen across the room, but a cookie should never be visible to other websites or written into shared files.

## What problem it solves

HTTP does not remember anything between requests. Without sessions, you would send your password with every click. Without chaining, testing anything behind a sign-in — saving a bookmark, changing a setting — would be impossible to automate. And without automated checks, someone must re-test every endpoint by hand after every change, which nobody does reliably.

## How it works

```text
 1. POST /api/auth/register  ──▶  201 Created
                                  Set-Cookie: df_session=<random token>; HttpOnly; SameSite=Lax
 2. GET  /api/auth/me        ──▶  Cookie: df_session=<token>   →  200 {"user":{…}}
 3. PUT  /api/me/bookmarks/… ──▶  Cookie: df_session=<token>   →  200 {"bookmarked":true}
 4. POST /api/auth/logout    ──▶  session deleted on the server, cookie cleared
 5. GET  /api/me/bookmarks   ──▶  old token is now meaningless →  401
```

The client's job is to keep the cookie and send it back. Browsers do this automatically; Postman keeps a **cookie jar** per domain; with curl you choose a file to store cookies in.

## Try it yourself

> **Local lab** — keep DevForge running (`npm start`) and use the second terminal from the previous lesson with `API=http://localhost:8080` set. Every curl command below is run automatically in DevForge's tests against a real DevForge server. Use a made-up test account, not your real details.

### 1. Sign up and keep the session cookie

`-c cookies.txt` tells curl to save any cookies the server sets into a file:

```bash run
curl -s -c cookies.txt -X POST "$API/api/auth/register" -H "X-DevForge-CSRF: 1" -H "Content-Type: application/json" -d '{"email":"asha@example.edu","displayName":"Asha Rao","password":"orbit lantern cobalt river"}'
```

```text output
{"user":{"id":"…","email":"asha@example.edu","displayName":"Asha Rao","role":"student","createdAt":"…"}}
```

The new account is a `student`, whatever the request says — self-registration can never create an administrator.

### 2. With and without the cookie

The same request, first without the cookie and then with it (`-b` sends cookies from the file):

```bash run
curl -s "$API/api/auth/me"
echo
curl -s -b cookies.txt "$API/api/auth/me"
```

```text output
{"user":null}
{"user":{"id":"…","email":"asha@example.edu","displayName":"Asha Rao","role":"student","createdAt":"…"}}
```

(`echo` just adds a line break between the two responses.) The only difference is the cookie. Treat `cookies.txt` like a password: anyone with it is signed in as you until the session ends.

### 3. Chain requests that need the session

Save the Kafka track as a bookmark, then list bookmarks:

```bash run
curl -s -b cookies.txt -X PUT "$API/api/me/bookmarks/track/kafka" -H "X-DevForge-CSRF: 1"
echo
curl -s -b cookies.txt "$API/api/me/bookmarks"
```

```text output
{"bookmarked":true}
{"bookmarks":[{"type":"track","id":"kafka","createdAt":"…","title":"Apache Kafka — Event Streaming","url":"/tracks/kafka","available":true}]}
```

### 4. Sign out, then try to reuse the session

```bash run
curl -s -b cookies.txt -c cookies.txt -X POST "$API/api/auth/logout" -H "X-DevForge-CSRF: 1" -w "%{http_code}\n"
curl -s -b cookies.txt "$API/api/me/bookmarks"
```

```text output
204
{"error":{"code":"unauthenticated","message":"You need to sign in to do that.","requestId":"…"}}
```

`204 No Content` means success with no body. The server deleted the session, so the bookmarks request is now anonymous and gets `401`.

### 5. Check responses automatically

Looking at output works once; tests work forever. A small shell check of the status code:

```bash run
status=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/health")
if [ "$status" = "200" ]; then echo "PASS health returns 200"; else echo "FAIL health returned $status"; fi
```

```text output
PASS health returns 200
```

That is the core of every API test: make a request, compare the result with what the contract promises, report pass or fail. Postman makes these checks much easier to write and run.

### 6. The same workflow in Postman

> Postman's interface changes between versions; if a label differs, check the Postman Learning Center. These steps and scripts are not executed by DevForge's tests.

**Use an environment for the address.** Create an environment named *Local* with a variable `baseUrl` set to `http://localhost:8080`, and select it. In your saved requests, replace `http://localhost:8080` with `{{baseUrl}}`, for example `{{baseUrl}}/api/auth/me`. To test another server later, create a second environment and switch to it — no request changes.

**Let the cookie jar keep the session.** Send the *register* (or *login*) request from the *DevForge API* collection. Postman stores the `df_session` cookie for `localhost` automatically, so a following `GET {{baseUrl}}/api/auth/me` returns your user. You can inspect or delete stored cookies from the request's **Cookies** link.

**Add tests.** In a request's post-response script area (the tab is labelled *Scripts* → *Post-response* in recent versions, *Tests* in older ones), add:

```javascript
pm.test("status is 200", function () {
  pm.response.to.have.status(200);
});

pm.test("service reports ok", function () {
  const body = pm.response.json();
  pm.expect(body.status).to.eql("ok");
});
```

After sending, the **Test Results** tab shows each check as passed or failed. For the wrong-password request, assert the contract precisely:

```javascript
pm.test("wrong password is rejected with 401 invalid_credentials", function () {
  pm.response.to.have.status(401);
  pm.expect(pm.response.json().error.code).to.eql("invalid_credentials");
});
```

**Run the whole collection.** Order the requests (register, me, bookmark, list, logout, list again) and use the **Collection Runner** to execute them in sequence with their tests. To run the same collection in a CI pipeline such as GitHub Actions, export it and use the **Postman CLI** or **Newman** (the open-source collection runner); see the Learning Center for current installation instructions.

**Keep secrets out of shared collections.** Collections and environments can be shared and synced. Never store real passwords or tokens in a collection; keep them in environment variables marked as secret, and check Postman's documentation for exactly which values are shared with your workspace.

## Common mistakes

- **Testing only the happy path.** The wrong-password, missing-header and signed-out cases are where security bugs hide.
- **Asserting too little** ("body is not empty") or **too much** (exact timestamps, random IDs). Check the contract: status and meaningful fields.
- **Hard-coding `http://localhost:8080`** in every request instead of `{{baseUrl}}`.
- **Committing `cookies.txt`, exported environments or tokens** to Git. Add them to `.gitignore` (Git lesson 2).
- **Tests that depend on leftover data.** A test run should create what it needs — like the register step here — so it passes on a fresh server.

## Where this fits in a real system

The chain you built is an **API regression suite**. In a real team it runs on every pull request in **GitHub Actions** or **Jenkins**, against a fresh test server, before anything is deployed. The same sequence is what an **n8n** workflow automates for business processes, and what **OpenTelemetry** traces when a step is slow. DevForge's own `server/test` folder contains the same kind of chained checks, written in code.
