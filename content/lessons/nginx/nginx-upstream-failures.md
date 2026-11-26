---
id: nginx-upstream-failures
title: Upstream health and failure handling
track: nginx
order: 7
level: advanced
estimated_minutes: 40
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Show Nginx passing a request to the next backend when one refuses connections, and then skipping the failed one for a while.
  - Decide which failures should be retried (proxy_next_upstream), and why requests such as POST are not retried by default.
  - Turn a hung backend into a quick 504 with proxy timeouts.
resources:
  - title: Module ngx_http_upstream_module (server parameters)
    url: https://nginx.org/en/docs/http/ngx_http_upstream_module.html
    publisher: nginx.org
    type: documentation
    level: advanced
    official: true
    why: max_fails, fail_timeout (both default to 1 and 10 s) and backup servers.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_proxy_module (proxy_next_upstream, timeouts)
    url: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
    publisher: nginx.org
    type: documentation
    level: advanced
    official: true
    why: Which failures pass a request to the next server (default error and timeout), non_idempotent, and proxy_read_timeout.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: retry
    prompt: Backend B refuses connections; backend A is fine. A user's request is sent to B first. What does the user see?
    options:
      - { id: a, text: "A 502 error" }
      - { id: b, text: "A normal 200 from A: a connection error is in proxy_next_upstream's default list, so Nginx passed the request on" }
      - { id: c, text: "Nothing until B comes back" }
    answer: b
    explanation: The default is proxy_next_upstream error timeout. With max_fails=1, Nginx then stops sending requests to B for fail_timeout.
  - id: http-500
    prompt: Backend B answers 500 Internal Server Error. With default settings, what does the user get when the request goes to B?
    options:
      - { id: a, text: "A retry on A" }
      - { id: b, text: "The 500: an HTTP error status is a valid response, and http_500 is not in the default retry list" }
      - { id: c, text: "A 504" }
    answer: b
    explanation: You can add http_500 (or 502, 503 …) to proxy_next_upstream — for requests that are safe to repeat.
  - id: post
    prompt: Why does Nginx, by default, not retry a POST that was already sent to a backend that then failed?
    options:
      - { id: a, text: "POST is slower" }
      - { id: b, text: "POST may not be safe to repeat: the first backend may have processed it (charged the card) before failing, and sending it again could do it twice" }
      - { id: c, text: "POST has no body" }
    answer: b
    explanation: The documentation says non-idempotent methods (POST, LOCK, PATCH) are not passed to the next server once sent, unless non_idempotent is set — make such endpoints idempotent before enabling it.
verification:
  method: executed
  details: Every command is run by the test suite with Nginx 1.24 and small Node.js backends, and its output is compared with this lesson. Default retry rules, max_fails and fail_timeout were checked against the nginx.org documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Behind a load balancer, backends fail in different ways — refusing connections, returning errors, or hanging — and Nginx can **retry** the safe cases on another backend, **skip** a failing backend for a while, and **time out** a hung one, so users see fewer and faster errors.

## Explain it like I'm twelve

At a canteen with two serving counters, if one counter is closed, the queue manager sends you to the other one and stops sending people to the closed counter for a few minutes. If a counter hands you the wrong meal, you get the wrong meal — unless the manager has been told to check. And if a cook stands still for ages, the manager says "sorry, try later" rather than letting you wait forever.

Where the analogy breaks: Nginx makes these decisions in milliseconds, for every request.

## What problem it solves

Backends are restarted, crash and get overloaded. Without failure handling, every request that lands on a dead or stuck backend becomes an error or a long wait for a user. With it, many failures become invisible, and the rest become quick, clear errors — while unsafe retries (paying twice) are avoided.

## How it works

![](media:nginx/upstream-failures.svg)

- `proxy_next_upstream` lists failures that send the request to the next server. The default is `error timeout`: connection failures and timeouts — not HTTP error statuses.
- Non-idempotent requests (`POST`, `LOCK`, `PATCH`) are not passed on once they were sent to a backend, unless `non_idempotent` is added.
- **Passive health checks**: after `max_fails` failures (default 1) within `fail_timeout` (default 10 s), a server is considered unavailable for `fail_timeout`.
- **Timeouts**: `proxy_connect_timeout` limits connecting; `proxy_read_timeout` (default 60 s) limits waiting between reads of the response. When it expires, the client gets `504 Gateway Timeout`.
- A server marked `backup` only receives requests when the others are unavailable.

## Try it yourself

> **Local lab** — needs Nginx, `curl` and Node.js. Nginx runs as your user from a throwaway folder on port 8089; the backends use ports 8093–8095. Every command is run automatically in DevForge's tests.

### 1. A configurable backend, and an upstream with two servers

```bash run
mkdir -p nginx-upstream-lab/tmp && cd nginx-upstream-lab
cat > backend.mjs <<'EOF'
// Usage: node backend.mjs <name> <port> <ok|fail|slow> — answers with its name.
import http from "node:http";
const [name, port, mode] = process.argv.slice(2);
http.createServer((req, res) => {
  const reply = () => { res.writeHead(mode === "fail" ? 500 : 200, { "content-type": "text/plain" }); res.end(`${name}\n`); };
  if (mode === "slow") setTimeout(reply, 3000); else reply();
}).listen(Number(port), "127.0.0.1", () => console.log(`${name} (${mode}) on ${port}`));
EOF
cat > nginx.conf <<'EOF'
pid nginx.pid;
events {}
http {
    access_log off;
    client_body_temp_path tmp/body;
    proxy_temp_path tmp/proxy;
    fastcgi_temp_path tmp/fastcgi;
    uwsgi_temp_path tmp/uwsgi;
    scgi_temp_path tmp/scgi;

    upstream app {
        server 127.0.0.1:8094 max_fails=1 fail_timeout=10s;   # B
        server 127.0.0.1:8093 max_fails=1 fail_timeout=10s;   # A
    }
    upstream slow_app {
        server 127.0.0.1:8095;
    }

    server {
        listen 127.0.0.1:8089;
        proxy_connect_timeout 1s;

        location / {
            proxy_pass http://app;
        }
        location /retry/ {
            proxy_pass http://app/;
            proxy_next_upstream error timeout http_500;
        }
        location /slow/ {
            proxy_pass http://slow_app/;
            proxy_read_timeout 1s;
        }
    }
}
EOF
start() { node backend.mjs "$@" > "$1.log" 2>&1 & echo $! > "$1.pid"; for i in $(seq 1 30); do grep -q ' on ' "$1.log" && break; sleep 0.2; done; cat "$1.log"; }
start A 8093 ok
nginx -p "$PWD" -e error.log -c nginx.conf
```

```text output
A (ok) on 8093
```

Backend B (port 8094) is not running yet — as if it had crashed.

### 2. A dead backend is retried, then skipped

```bash run
for i in 1 2 3 4; do echo "$(curl -s http://127.0.0.1:8089/) $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8089/)"; done | sort | uniq -c
echo "connections refused by B (from Nginx's error log): $(grep -c 'Connection refused' error.log)"
```

```text output
      4 A 200
connections refused by B (from Nginx's error log): 1
```

Every answer came from A with `200`. The very first request was sent to B, refused, and passed to A without the user noticing (`error` is in the default retry list). After that one failure, `max_fails=1` made Nginx skip B for 10 seconds — the error log shows B was tried only once.

### 3. An error *status* is not retried by default

Start B, but broken: it answers `500` to everything. Reloading Nginx gives it fresh workers, so B is tried again:

```bash run
start B 8094 fail
nginx -p "$PWD" -e error.log -c nginx.conf -s reload && sleep 1
for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8089/; done | sort | uniq -c
```

```text output
B (fail) on 8094
      2 200
      2 500
```

Half the users got `500`: a `500` is a valid HTTP response, so with the default `proxy_next_upstream error timeout`, Nginx passed it on.

### 4. Retry on 500 — for requests that are safe to repeat

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s reload && sleep 1
for i in 1 2 3 4; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8089/retry/; done | sort | uniq -c
```

```text output
      4 200
```

In `/retry/`, `http_500` is in the list, so a `500` from B made Nginx try A. These are `GET` requests. A `POST` that already reached B would *not* be retried — B might have done the work (taken a payment) before failing — unless you add `non_idempotent`, which is only safe when the backend can recognise and ignore a repeated request.

### 5. A hung backend becomes a quick 504

```bash run
start slow 8095 slow
SECONDS=0
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8089/slow/)
echo "status $code after about $SECONDS second(s)"
```

```text output
slow (slow) on 8095
status 504 after about 1 second(s)
```

The backend would have taken three seconds; `proxy_read_timeout 1s` gave up after one and answered `504 Gateway Timeout`. Without it, the default is 60 seconds — a minute of a user staring at a spinner, and of Nginx holding a connection.

### 6. Stop everything

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
kill "$(cat A.pid)" "$(cat B.pid)" "$(cat slow.pid)"
```

## Common mistakes

- **Retrying non-idempotent requests.** `non_idempotent` can charge a card twice; make the endpoint idempotent (for example with an idempotency key) first.
- **Retrying everything everywhere.** Retries multiply load on an already struggling system; limit them (`proxy_next_upstream_tries`) and prefer timeouts that fail fast.
- **Timeouts longer than users wait.** A 60-second wait helps nobody; set timeouts from what the endpoint normally needs.
- **Relying on passive checks only.** A backend is only noticed as failing when real requests hit it; orchestrators such as Kubernetes add active health checks (readiness probes).

## Where this fits in a real system

The same ideas run through the stack: **Kubernetes** readiness probes take failing Pods out of a Service, **Prometheus** alerts on rising 5xx and 504 rates, and **OpenTelemetry** traces show which backend made a request slow.
