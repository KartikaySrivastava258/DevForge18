---
id: nginx-serving-static-files
title: Nginx configuration and static files
track: nginx
order: 1
level: beginner
estimated_minutes: 35
prerequisites: []
learning_objectives:
  - Explain what a web server does and where Nginx sits in front of applications.
  - Read the structure of an Nginx configuration (contexts, directives, server and location blocks).
  - Test, start and stop Nginx safely without administrator rights.
  - Serve a folder of static files and read the response headers and access log.
resources:
  - title: Nginx beginner's guide
    url: https://nginx.org/en/docs/beginners_guide.html
    publisher: nginx.org
    type: tutorial
    level: beginner
    official: true
    why: The official introduction to configuration structure, serving static content and setting up a simple proxy.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Nginx documentation
    url: https://nginx.org/en/docs/
    publisher: nginx.org
    type: reference
    level: all
    official: true
    why: The reference for every directive used here, such as root, try_files, types and server_tokens.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: test-first
    prompt: Why run nginx -t before starting or reloading Nginx?
    options:
      - { id: a, text: "It makes Nginx start faster" }
      - { id: b, text: "It checks the configuration for errors without changing what is running, so a typo does not take the site down" }
      - { id: c, text: "It runs the site's automated tests" }
    answer: b
    explanation: nginx -t parses and validates the configuration and reports the exact file and line of any error. Testing before a reload is a basic production habit — a broken configuration never reaches the running server.
  - id: location-match
    prompt: A request for /missing.html returns 404. Which line in the lab's configuration decides that?
    options:
      - { id: a, text: "try_files $uri $uri/ =404, which returns 404 when neither the file nor a matching folder exists under the root" }
      - { id: b, text: "listen 127.0.0.1:8088" }
      - { id: c, text: "server_tokens off" }
    answer: a
    explanation: try_files checks each option in order — the exact file, then a directory — and falls back to the last argument, here the status code 404.
  - id: server-tokens
    prompt: What does server_tokens off change, and why is it commonly used?
    options:
      - { id: a, text: "It disables HTTPS" }
      - { id: b, text: "It stops Nginx from announcing its exact version in the Server header and error pages, giving attackers less information" }
      - { id: c, text: "It turns off the access log" }
    answer: b
    explanation: 'With server_tokens off the header reads "Server: nginx" instead of including the version number. Hiding the version is not real protection on its own — you must still patch — but there is no reason to advertise it.'
verification:
  method: executed
  details: Every command is run by the test suite with Nginx as an unprivileged process in a throwaway folder, and its output is compared with this lesson. First confirmed against a real Nginx installation on Ubuntu on 2026-11-25; it also runs in CI.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**Nginx** is a web server and reverse proxy: it accepts HTTP connections and, following its configuration, serves files from disk, forwards requests to applications, or rejects them.

## Explain it like I'm twelve

Nginx is the reception desk of a large school. Visitors never wander the corridors. They come to the desk, and the receptionist follows a rulebook: leaflets are handed out directly from the rack (*static files*); questions about marks go to the exam office (*forwarding to an application*); anyone asking for the staff room is turned away (*rejecting requests*). One calm receptionist can handle a queue of hundreds because they never stop to do the slow work themselves.

Where the analogy breaks: Nginx's rulebook is a text file that is checked before use, and it can be reloaded without closing the desk.

## What problem it solves

Application servers are good at business logic but poorly suited to everything else on the edge of the internet: serving static files efficiently, handling thousands of slow connections, terminating TLS, compressing responses, routing different paths to different services, and spreading load across several copies of an app. Nginx does those jobs in front of applications with modest memory, so the applications can focus on their own work.

## How it works

![](media:nginx/config-contexts.svg)


- A **directive** is a name, its values and a semicolon: `listen 127.0.0.1:8088;`.
- A **block** (or *context*) groups directives in braces; inner blocks inherit settings from outer ones.
- `server` blocks are chosen by address, port and host name; `location` blocks by the request's path.
- One **master** process reads the configuration and manages **worker** processes, which handle connections without blocking each other.

## Try it yourself

> **Local lab** — runs Nginx as your own user, inside one folder, on port 8088. It does not use or change any system-wide Nginx configuration and needs no administrator rights after installation. Every command below is run automatically in DevForge's CI; see the note at the top for the current verification status.

### 1. Install Nginx

- **Ubuntu or Debian:** `sudo apt install nginx`. The package may also start a system Nginx on port 80; this lab does not use or change it.
- **macOS with Homebrew:** `brew install nginx`.
- **Windows:** use WSL (Windows Subsystem for Linux) and follow the Ubuntu instructions inside it.

### 2. Create a lab folder, a page and a configuration

```bash run
mkdir -p nginx-lab/site nginx-lab/temp
cd nginx-lab
cat > site/index.html <<'EOF'
<h1>Hello from Nginx</h1>
EOF
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

  server {
    listen 127.0.0.1:8088;
    root   site;

    location / {
      try_files $uri $uri/ =404;
    }
  }
}
EOF
```

Read the configuration from the top: the main context sets where Nginx keeps its process ID and error log; `types` maps file extensions to the `Content-Type` sent to browsers; `server_tokens off` hides the version number; the temp paths keep scratch files inside your folder. The `server` block listens only on your own computer, port 8088, and serves files from `site`. `try_files` returns the requested file if it exists and `404` if not.

### 3. Test, then start

Always test a configuration before using it. `-p "$PWD"` makes this folder Nginx's working directory, so every relative path above is inside it, and `-e error.log` keeps early errors there too:

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -t
```

```text output
nginx: the configuration file …/nginx-lab/nginx.conf syntax is ok
nginx: configuration file …/nginx-lab/nginx.conf test is successful
```

Start it. Nginx runs in the background and prints nothing when it starts successfully:

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf
```

### 4. Request the page

```bash run
curl -si http://127.0.0.1:8088/
```

```text output
HTTP/1.1 200 OK
Server: nginx
Date: …
Content-Type: text/html
Content-Length: 26
Last-Modified: …
Connection: keep-alive
ETag: "…"
Accept-Ranges: bytes

<h1>Hello from Nginx</h1>
```

`Server: nginx` has no version because of `server_tokens off`. `Last-Modified` and `ETag` let browsers ask "has this file changed?" instead of downloading it again. You can also open `http://127.0.0.1:8088/` in a browser.

### 5. Content types and missing files

Add a stylesheet, then ask for it and for a file that does not exist:

```bash run
echo "h1 { color: steelblue; }" > site/style.css
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8088/style.css
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8088/missing.html
```

```text output
200 text/css
404 text/html
```

New files are served immediately; only configuration changes need a reload. The `types` block made `.css` arrive as `text/css` — without the right type, browsers refuse to apply stylesheets.

### 6. Read the access log

Every request is recorded:

```bash run
tail -n 1 access.log
```

```text output
127.0.0.1 - - […] "GET /missing.html HTTP/1.1" 404 … "-" "curl/…"
```

The fields are the client address, the user (none), the time, the request line, the status, the response size, the referring page and the client software. When users report "the page is broken", this log tells you what they actually requested and what they received.

### 7. Stop Nginx

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

`-s` sends a signal to the running master process: `stop` (immediately), `quit` (after finishing current requests) or `reload` (re-read the configuration without dropping connections). Keep the `nginx-lab` folder for the next lesson.

## Common mistakes

- **Reloading without `nginx -t` first.** If the new configuration is invalid, the reload is refused and Nginx keeps running the old one; testing first tells you why.
- **Forgetting semicolons or braces.** `nginx -t` reports the file and line.
- **Wrong or missing content types,** so browsers ignore CSS or download HTML instead of showing it.
- **Serving a folder that contains secrets** such as `.env` or `.git`. Only point `root` at a folder meant to be public.
- **Editing the system configuration while learning.** Practise with a separate prefix, as here, and leave `/etc/nginx` alone.

## Where this fits in a real system

In production, Nginx usually serves the built frontend (exactly what DevForge's `build/web` folder contains) and forwards `/api/` requests to the application — the subject of the next lesson. It typically also terminates HTTPS. Its access logs feed monitoring systems, and request counts and error rates appear in **Prometheus and Grafana** dashboards.
