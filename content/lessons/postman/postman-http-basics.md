---
id: postman-http-basics
title: HTTP requests and responses
track: postman
order: 1
level: beginner
estimated_minutes: 35
prerequisites: []
learning_objectives:
  - Name the parts of an HTTP request (method, URL, headers, body) and of a response (status, headers, body).
  - Read status codes by family and explain what 200, 204, 400, 401, 403, 404, 405 and 415 mean.
  - Send GET and POST requests with curl, including headers and a JSON body.
  - Send the same requests in Postman and read the status, headers and body it shows.
resources:
  - title: Get started in Postman
    url: https://learning.postman.com/docs/getting-started/overview/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Official starting point for sending requests and reading responses in Postman.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Postman Learning Center
    url: https://learning.postman.com/
    publisher: Postman
    type: documentation
    level: all
    official: true
    why: Postman changes its interface regularly; the Learning Center always describes the current version.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: unauthenticated-vs-forbidden
    prompt: A signed-in student calls an admin-only endpoint. Which status code fits best, and why?
    options:
      - { id: a, text: "401, because the request failed" }
      - { id: b, text: "403: the server knows who they are, but they are not allowed to do this; 401 means the server does not know who you are" }
      - { id: c, text: "404, because admins only exist in the admin area" }
    answer: b
    explanation: 401 means "not authenticated — sign in first". 403 means "authenticated, but not permitted". DevForge returns 401 for anonymous requests to admin routes and 403 for signed-in students, which is exactly what its access-control tests check.
  - id: whose-fault
    prompt: A request returns a 4xx status. What does that tell you first?
    options:
      - { id: a, text: "The server crashed and the team should be paged" }
      - { id: b, text: "The server understood the request but rejected something about it — fix the request (method, URL, headers, body or credentials)" }
      - { id: c, text: "The network is down" }
    answer: b
    explanation: 4xx codes describe a problem with the request; 5xx codes describe a failure on the server. Reading the family first tells you where to look.
  - id: unsupported-media
    prompt: "A POST returns 415 with the message \"Send the request body as application/json.\" What should you change?"
    options:
      - { id: a, text: "Use GET instead of POST" }
      - { id: b, text: "Send the body as JSON and set the Content-Type header to application/json" }
      - { id: c, text: "Add more fields to the body" }
    answer: b
    explanation: 415 Unsupported Media Type means the server will not accept the format of the body you sent. curl -d sends form data by default; in Postman choose Body → raw → JSON, which also sets the header.
  - id: custom-header
    prompt: Why does DevForge reject a JSON POST that lacks the X-DevForge-CSRF header, even with a correct password?
    options:
      - { id: a, text: "Custom headers make requests faster" }
      - { id: b, text: "It is part of the protection against cross-site request forgery: another website cannot make a visitor's browser send that custom header to DevForge" }
      - { id: c, text: "It is required by the HTTP standard for every POST" }
    answer: b
    explanation: Browsers refuse to let a page on another site add custom headers to a request without the target server's permission, which DevForge never grants. Requiring the header blocks forged requests while costing your own frontend nothing. The check runs before anything else, which is why it fails first.
verification:
  method: executed
  details: Every curl command is run by the test suite against a real DevForge server, and its output is compared with what this lesson shows; values that change on every request are shown as "…". The Postman interface steps were written from Postman's documentation and are not executed, because Postman is a desktop application.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

An API is used by sending **HTTP requests** — a method, a URL, headers and sometimes a body — and reading the **response**: a status code, headers and a body; **Postman** is a tool for building, sending, saving and testing those requests.

## Explain it like I'm twelve

Ordering at a canteen counter works like HTTP. You say *what you want to do* (order, cancel, ask a question — the **method**), *what it is about* (which dish — the **URL**), add *notes* (no onions, paying by card — the **headers**) and sometimes *details* (your full order — the **body**). The counter answers with a quick verdict (here you go; sold out; you are not on the staff list — the **status code**) and maybe a tray of food (the **response body**).

Where the analogy breaks: the counter remembers your face, but HTTP does not remember you between requests. Each request must carry everything the server needs, which is why sign-in uses cookies or tokens — the subject of the next lesson.

## What problem it solves

Frontends, mobile apps, scripts and other services all talk to backends over HTTP. When something breaks, you need to see the exact request sent and the exact response received, without the noise of a whole application around it. Tools like **curl** (a command-line HTTP client) and **Postman** (a desktop application) let you send one precise request, inspect every part of the answer, save requests to reuse, share them with your team and turn them into automated tests.

## How it works

![](media:postman/http-anatomy.svg)


- **Method**: `GET` reads, `POST` creates or performs an action, `PUT` replaces or sets, `PATCH` changes part of something, `DELETE` removes.
- **URL**: scheme, host and port (`http://localhost:8080`), path (`/api/tracks/docker`) and optional query string (`?q=k8s&limit=1`).
- **Headers**: metadata, such as the body's format (`Content-Type`) or credentials.
- **Status code families**: `2xx` success, `3xx` go somewhere else, `4xx` problem with the request, `5xx` problem on the server.
- **Body**: often **JSON** — nested `{"key": value}` objects and `[lists]`.

## Try it yourself

> **Local lab** — the API you will practise on is DevForge itself. In a terminal, go to your DevForge folder and run `npm start`; leave it running. Open a second terminal for the commands below. On Windows, use Git Bash (curl is included). Every curl command here is run automatically in DevForge's tests against a real DevForge server.

> **Playground** — no terminal at hand? The [request playground](/tracks/postman/playground) sends real requests from your browser to the DevForge server you are reading this on, as you, and explains every 4xx answer. It allows only a short list of safe endpoints (no sign-in requests), so use curl or Postman for the sign-in steps below.

Store the address in a variable so you do not have to type it every time — Postman calls this an *environment variable*, and you will meet it there later:

```bash
API=http://localhost:8080
```

### 1. Your first request

```bash run
curl -s "$API/api/health"
```

```text output
{"status":"ok"}
```

`curl` sent a `GET` request (the default method) and printed the response body. `-s` (silent) hides curl's progress meter.

### 2. See the whole response

`-i` includes the status line and headers:

```bash run
curl -si "$API/api/health"
```

```text output
HTTP/1.1 200 OK
X-Request-Id: …
Content-Security-Policy: default-src 'self'; …
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
Content-Length: 15
Date: …
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok"}
```

Values that change on every request are shown as `…`. Read it from the top: `200 OK` is the status; `Content-Type` says the body is JSON; `Content-Length: 15` is the body's size in bytes; `Cache-Control: no-store` tells browsers not to keep a copy; `X-Request-Id` is a unique ID that DevForge also writes to its logs, so a bug report quoting it can be traced. The security headers in the middle instruct browsers how to protect pages from this site.

### 3. Path parameters, query strings and errors

The last part of `/api/tracks/docker` identifies *which* track. Ask for one that does not exist:

```bash run
curl -s "$API/api/tracks/cobol"
```

```text output
{"error":{"code":"not_found","message":"Track not found.","requestId":"…"}}
```

To see just the status code, discard the body (`-o /dev/null`) and print the code (`-w`):

```bash run
curl -s -o /dev/null -w "%{http_code}\n" "$API/api/tracks/cobol"
curl -s -o /dev/null -w "%{http_code}\n" "$API/api/tracks/docker"
```

```text output
404
200
```

A query string passes options after `?`, separated by `&`:

```bash run
curl -s "$API/api/search?q=k8s&limit=1"
```

```text output
{"query":"k8s","results":[{"type":"track","id":"kubernetes","title":"Kubernetes — Container Orchestration","url":"/tracks/kubernetes","snippet":"Kubernetes is a control system that keeps the desired number of application containers running across a cluster.","context":"Track 3","score":…}]}
```

Quote URLs that contain `&` or `?`: without quotes the shell treats `&` as "run in the background".

### 4. Methods matter

The same URL can accept some methods and refuse others:

```bash run
curl -s -X DELETE "$API/api/tracks"
```

```text output
{"error":{"code":"method_not_allowed","message":"DELETE is not supported here.","requestId":"…"}}
```

`-X` sets the method; this endpoint only supports `GET`, so the answer is `405 Method Not Allowed`.

### 5. Sending data with POST

Signing in sends an email and password. Try it step by step and read each error — this is exactly how you debug a real API.

First, a JSON body with the right header, but without DevForge's CSRF header:

```bash run
curl -s -X POST "$API/api/auth/login" -H "Content-Type: application/json" -d '{"email":"asha@example.edu","password":"orbit lantern cobalt river"}'
```

```text output
{"error":{"code":"csrf_failed","message":"Request blocked by cross-site request protection.","requestId":"…"}}
```

`403 Forbidden`: DevForge requires the custom header `X-DevForge-CSRF: 1` on every request that changes something (see the self-check for why). Add it, but send form data instead of JSON — `-d` on its own sends form-encoded data:

```bash run
curl -s -X POST "$API/api/auth/login" -H "X-DevForge-CSRF: 1" -d 'email=asha@example.edu'
```

```text output
{"error":{"code":"unsupported_media_type","message":"Send the request body as application/json.","requestId":"…"}}
```

`415 Unsupported Media Type`. Now everything correct, but for an account that does not exist yet:

```bash run
curl -s -X POST "$API/api/auth/login" -H "X-DevForge-CSRF: 1" -H "Content-Type: application/json" -d '{"email":"asha@example.edu","password":"orbit lantern cobalt river"}'
```

```text output
{"error":{"code":"invalid_credentials","message":"Email or password is incorrect.","requestId":"…"}}
```

`401 Unauthorized`. The message deliberately does not say whether the email or the password was wrong, so attackers cannot use it to discover which accounts exist. Finally, a request whose fields fail validation:

```bash run
curl -s -X POST "$API/api/auth/register" -H "X-DevForge-CSRF: 1" -H "Content-Type: application/json" -d '{"email":"asha@example.edu","displayName":"Asha","password":"short"}'
```

```text output
{"error":{"code":"validation_failed","message":"Some fields are invalid.","details":[{"field":"password","message":"Password must be at least 10 characters."}],"requestId":"…"}}
```

`400 Bad Request`, with `details` naming the field to fix. Every DevForge error has the same shape — `code`, `message`, optional `details`, `requestId` — which makes errors easy to handle in code. A consistent error format is a sign of a well-designed API.

### 6. The same requests in Postman

> Postman's interface changes between versions; if a label below differs, the Postman Learning Center (linked in the resources) shows the current one. These steps are not executed by DevForge's tests.

1. Install Postman from the official website and open it. You can create a free account or, where offered, use it without signing in.
2. Create a new **HTTP request**. Leave the method as `GET`, enter `http://localhost:8080/api/health` and select **Send**. The response panel shows the body, the status (`200 OK`), the time taken and the size; the **Headers** tab of the response shows the headers you saw with `curl -i`.
3. Change the method to `POST` and the URL to `http://localhost:8080/api/auth/login`.
4. In the request's **Headers** tab, add the key `X-DevForge-CSRF` with the value `1`.
5. In the **Body** tab choose **raw** and **JSON**, then enter `{"email":"asha@example.edu","password":"orbit lantern cobalt river"}`. Choosing JSON also sets the `Content-Type` header for you.
6. Send it and compare the result with step 5 above. Then remove the CSRF header and send again to reproduce the `403`.
7. Save the requests into a new **collection** called *DevForge API*. You will add environments, sign-in and automated tests to it in the next lesson.

## Common mistakes

- **Treating every non-200 as "the server is broken".** Read the family: 4xx means fix the request; 5xx means investigate the server.
- **Forgetting `Content-Type: application/json`.** Many servers reject or misread a JSON body without it.
- **Not quoting URLs with `&` or `?`** in the shell.
- **Sending real passwords or tokens in requests you share.** Saved requests and screenshots travel; use test accounts.
- **Ignoring the response body of an error.** Good APIs explain what went wrong; read `message` and `details` before guessing.

## Where this fits in a real system

Every frontend action you take in DevForge is one of these requests. **Nginx** may sit in front of the API and add its own status codes (such as `502 Bad Gateway` when the backend is down); **GitHub Actions** can run saved API checks on every change; and **n8n** workflows are largely chains of HTTP requests, so this lesson is also the foundation of the automation track.
