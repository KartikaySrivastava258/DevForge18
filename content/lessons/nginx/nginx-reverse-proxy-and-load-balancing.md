---
id: nginx-reverse-proxy-and-load-balancing
title: Reverse proxy, 502 errors and load balancing
track: nginx
order: 2
level: beginner
estimated_minutes: 35
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Configure Nginx as a reverse proxy in front of an application.
  - Explain which headers a proxy should pass to the application and why.
  - Diagnose a 502 Bad Gateway using the error log.
  - Spread requests across several application instances with an upstream group.
resources:
  - title: Nginx beginner's guide
    url: https://nginx.org/en/docs/beginners_guide.html
    publisher: nginx.org
    type: tutorial
    level: beginner
    official: true
    why: The official introduction to configuration structure, serving static content and setting up a simple proxy.
    verification: { status: unverified }
  - title: Nginx documentation
    url: https://nginx.org/en/docs/
    publisher: nginx.org
    type: reference
    level: all
    official: true
    why: Reference for proxy_pass, proxy_set_header and the upstream module used in this lesson.
    verification: { status: unverified }
self_check:
  - id: bad-gateway
    prompt: Users see "502 Bad Gateway" from Nginx. Where is the problem most likely to be?
    options:
      - { id: a, text: "In the user's browser" }
      - { id: b, text: "Between Nginx and the application: Nginx could not get a valid response from the upstream (for example, it is not running or not listening on the configured address)" }
      - { id: c, text: "In the user's request body" }
    answer: b
    explanation: 502 means the gateway (Nginx) failed to get a response from the upstream. The error log says why — here, "Connection refused" because nothing was listening on that port.
  - id: forwarded-for
    prompt: Why set X-Forwarded-For when proxying to an application?
    options:
      - { id: a, text: "Without it, every request appears to come from Nginx's own address, so the application cannot log or rate-limit real clients" }
      - { id: b, text: "It encrypts the request" }
      - { id: c, text: "It is required for HTTP/1.1" }
    answer: a
    explanation: The application's TCP connection comes from Nginx. X-Forwarded-For carries the client's address, and the application should trust it only when it really sits behind your proxy — which is why DevForge reads it only with TRUST_PROXY=true.
  - id: round-robin
    prompt: An upstream group lists two servers and the responses alternate A, B, A, B. Why is that useful in production?
    options:
      - { id: a, text: "It spreads load across instances and lets you take one down for maintenance while the others keep serving" }
      - { id: b, text: "It makes each request twice as fast" }
      - { id: c, text: "It stores data on both servers" }
    answer: a
    explanation: 'Load balancing increases capacity and availability. It does not share state: anything kept in one instance''s memory (such as DevForge''s rate-limit counters) is not visible to the others, which is why shared state belongs in a database or Redis.'
verification:
  method: executed
  details: Every command is run by the test suite with Nginx as an unprivileged process in front of a real DevForge server, and its output is compared with this lesson. Confirmed in CI with Nginx 1.24.0 (Ubuntu 24.04) on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

As a **reverse proxy**, Nginx receives every request and forwards selected paths to application servers, returns their responses, and can spread requests across several copies of an application.

## Explain it like I'm twelve

Back at the reception desk: when someone asks about marks, the receptionist phones the exam office, writes down the answer and passes it on. The visitor never needs to know where the exam office is. If the exam office does not pick up, the receptionist says "sorry, the office isn't answering" — that is a **502**. And if there are two exam offices, the receptionist alternates between them so neither gets swamped.

Where the analogy breaks: Nginx also passes along notes such as "this visitor came from address X" so the application still knows who is really asking.

## What problem it solves

Without a proxy, every application must face the internet directly: serve its own static files, manage TLS, and expose its port. With a proxy, one public address can route `/` to static files and `/api/` to the API, add security limits at the edge, and send traffic to several application instances — so one instance can be restarted or upgraded while the others keep serving.

## How it works

```text
                       ┌───────────── Nginx :8088 ─────────────┐
 client ── GET /api/ ─▶│ location /api/ → upstream devforge    │──▶ DevForge :8080
                       │ location /     → files in site/       │
                       │ location /balanced/ → demo_backends   │──▶ backend A :8091
                       └───────────────────────────────────────┘──▶ backend B :8092
```

- `proxy_pass` forwards the request to an upstream address or **upstream group**.
- `proxy_set_header` adds or replaces headers on the forwarded request.
- An `upstream` block lists servers; by default Nginx sends requests to them in turn (**round robin**).
- If the upstream cannot be reached, Nginx answers **502 Bad Gateway**; if it is too slow, **504 Gateway Timeout**.

## Try it yourself

> **Local lab** — continue in the `nginx-lab` folder from the previous lesson. Start DevForge in another terminal (`npm start` in your DevForge folder) so something is listening on port 8080. Every command below is run automatically in DevForge's CI against a real DevForge server; see the note at the top for the current verification status.

### 1. Write the proxy configuration

This replaces `nginx.conf`. Besides the proxy to DevForge, it defines two tiny demo "backends" (A and B) that only announce themselves, so you can watch load balancing happen, and a deliberately broken route:

```bash run
cat > nginx.conf <<'EOF'
pid       nginx.pid;
error_log error.log;

events {}

http {
  types {
    text/html html;
    text/css  css;
  }
  default_type application/octet-stream;
  access_log   access.log;
  server_tokens off;

  # Keep Nginx's temporary files inside this folder (no root needed).
  client_body_temp_path temp/body;
  proxy_temp_path       temp/proxy;
  fastcgi_temp_path     temp/fastcgi;
  uwsgi_temp_path       temp/uwsgi;
  scgi_temp_path        temp/scgi;

  upstream devforge {
    server 127.0.0.1:8080;
  }

  upstream demo_backends {
    server 127.0.0.1:8091;
    server 127.0.0.1:8092;
  }

  server {
    listen 127.0.0.1:8091;
    default_type text/plain;
    return 200 "served by backend A\n";
  }

  server {
    listen 127.0.0.1:8092;
    default_type text/plain;
    return 200 "served by backend B\n";
  }

  server {
    listen 127.0.0.1:8088;
    root   site;

    location / {
      try_files $uri $uri/ =404;
    }

    location /api/ {
      proxy_pass http://devforge;
      proxy_set_header Host              $host;
      proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /broken/ {
      proxy_pass http://127.0.0.1:9;
    }

    location /balanced/ {
      proxy_pass http://demo_backends;
    }
  }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -t
```

```text output
nginx: the configuration file …/nginx-lab/nginx.conf syntax is ok
nginx: configuration file …/nginx-lab/nginx.conf test is successful
```

The three `proxy_set_header` lines tell DevForge the original host name, the client's real address, and whether the client used HTTP or HTTPS. Start Nginx:

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf
```

### 2. Reach DevForge through the proxy

```bash run
curl -s http://127.0.0.1:8088/api/health
```

```text output
{"status":"ok"}
```

The request went to Nginx on port 8088, which forwarded it to DevForge on 8080. Look at where the response headers came from:

```bash run
curl -si http://127.0.0.1:8088/api/health | grep -E "^(HTTP/|Server:|X-Content-Type-Options:)"
```

```text output
HTTP/1.1 200 OK
Server: nginx
X-Content-Type-Options: nosniff
```

`Server: nginx` was added by the proxy; `X-Content-Type-Options` was set by DevForge and passed through unchanged. Static files are still served by Nginx itself:

```bash run
curl -s http://127.0.0.1:8088/
```

```text output
<h1>Hello from Nginx</h1>
```

### 3. Diagnose a 502

The `/broken/` route points at port 9, where nothing is listening:

```bash run
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8088/broken/
grep -c "Connection refused" error.log
```

```text output
502
1
```

The client only learns "502 Bad Gateway"; the reason is in Nginx's error log (`grep -c` counts matching lines). Open `error.log` to see the full entry, including the upstream address it tried. Whenever an application behind a proxy "goes down", check whether it is running and listening on the address in `proxy_pass`.

### 4. Watch load balancing

```bash run
for i in 1 2 3 4; do curl -s http://127.0.0.1:8088/balanced/; done
```

```text output
served by backend A
served by backend B
served by backend A
served by backend B
```

Nginx sent the requests to the two servers in turn. In production these would be several copies of the same application, and one could be restarted while the other kept serving.

### 5. Stop Nginx

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

## Common mistakes

- **Blaming Nginx for a 502.** It is reporting that the upstream failed; check that the application is running and the address in `proxy_pass` is right, then read `error.log`.
- **Not forwarding client details.** Without `X-Forwarded-For`, the application sees every request as coming from the proxy, so logs and rate limits are wrong.
- **Trusting forwarding headers from anyone.** A client can send its own `X-Forwarded-For`. Only trust it when the application is reachable exclusively through your proxy — DevForge enables this with `TRUST_PROXY=true`.
- **Opening the app through the proxy with the wrong origin.** If you browse to DevForge at `http://localhost:8088`, set `PUBLIC_ORIGIN=http://localhost:8088` when starting DevForge; otherwise its cross-site request protection rejects sign-ins, because the browser's `Origin` no longer matches.
- **Keeping per-instance state behind a load balancer.** Sessions or counters stored in one instance's memory are invisible to the others; keep shared state in PostgreSQL or Redis.

## Where this fits in a real system

DevForge's own `deploy/nginx/nginx.conf` uses exactly these ideas: Nginx is the only public entry point, forwards requests to the app with `X-Forwarded-For`, hides `/metrics` from the internet and applies edge rate limits. With several instances behind an upstream group, shared state moves to **PostgreSQL** and **Redis**; in **Kubernetes**, an Ingress or Gateway controller plays this role, and **Prometheus** watches the 502 and 504 rates so a failing upstream is noticed before users report it.
