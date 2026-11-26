---
id: nginx-safe-headers-and-rate-limiting
title: Configure safe headers and rate limiting
track: nginx
level: advanced
mode: local
estimated_minutes: 35
prerequisites: [nginx-serving-static-files, nginx-location-matching]
objectives:
  - Add security headers to every response, including error responses, and hide the Nginx version.
  - Find and fix the add_header inheritance trap that silently drops headers in one location.
  - Limit an API to a request rate with a burst, and answer excess requests with 429.
checkpoints:
  - { id: headers, text: "curl -I showed all four security headers on the home page and on a 404" }
  - { id: inheritance, text: "I saw /downloads/ lose the headers, and fixed it" }
  - { id: rate-limit, text: "A burst of 8 requests gave 4 × 200 and 4 × 429" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Module ngx_http_headers_module (add_header)
    url: https://nginx.org/en/docs/http/ngx_http_headers_module.html
    publisher: nginx.org
    type: documentation
    level: intermediate
    official: true
    why: add_header, the always parameter, and when add_header directives are inherited.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_limit_req_module
    url: https://nginx.org/en/docs/http/ngx_http_limit_req_module.html
    publisher: nginx.org
    type: documentation
    level: advanced
    official: true
    why: limit_req_zone, burst, nodelay and limit_req_status.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Nginx 1.24 (the Ubuntu package used in CI) as an ordinary user, and their output is compared with this page. The behaviour of add_header and limit_req was checked against the nginx.org documentation on 2026-11-26. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Harden a small site served by Nginx: every response carries security headers, the server stops advertising its version, and an API location refuses clients that send too many requests at once. Along the way you meet the most common `add_header` mistake — and prove the final configuration with a check script.

## Before you start

You need Nginx and `curl`, as in *Serving static files*. As in the lessons, Nginx runs as your own user from a throwaway folder, on port 8089 (stop the lesson's Nginx first if it is still running).

## Steps

### 1. A site with security headers

```bash run
mkdir -p safe-site/tmp safe-site/www/downloads && cd safe-site
printf '<h1>Course portal</h1>\n' > www/index.html
printf 'slides\n' > www/downloads/week1.txt
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
    default_type text/plain;
    server_tokens off;

    server {
        listen 127.0.0.1:8089;
        root www;

        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Content-Security-Policy "default-src 'self'" always;

        location /downloads/ {
            add_header Cache-Control "public, max-age=3600";
        }
    }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -t 2>&1 | tail -n 1
nginx -p "$PWD" -e error.log -c nginx.conf
```

```text output
nginx: configuration file …/nginx.conf test is successful
```

- `server_tokens off` removes the version number from the `Server` header and from error pages.
- Each `add_header` adds one response header. `always` adds it to **every** response, including errors such as 404; without it, Nginx adds headers only to a fixed list of success and redirect codes.

### 2. Look at the headers

```bash run
show() { curl -s -o /dev/null -D - "http://127.0.0.1:8089$1" | grep -iE '^(HTTP|server|x-content|x-frame|referrer|content-security|cache-control)' | tr -d '\r'; }
echo "--- /"; show /
echo "--- /missing (404)"; show /missing
```

```text output
--- /
HTTP/1.1 200 OK
Server: nginx
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'
--- /missing (404)
HTTP/1.1 404 Not Found
Server: nginx
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'
```

The 404 carries the headers too, thanks to `always`, and `Server: nginx` no longer gives the version away.

### 3. The inheritance trap

The downloads location only wanted to *add* a cache header. Look at what it sends:

```bash run
echo "--- /downloads/week1.txt"; show /downloads/week1.txt
```

```text output
--- /downloads/week1.txt
HTTP/1.1 200 OK
Server: nginx
Cache-Control: public, max-age=3600
```

All four security headers are gone. The Nginx documentation explains why: `add_header` directives are inherited from the previous level **if and only if** there are no `add_header` directives on the current level. One `add_header` in a location replaces the whole list from the server block.

A common fix is to keep the shared headers in one file and `include` it at the server level **and** in every location that adds its own headers:

```bash run
cat > security-headers.conf <<'EOF'
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'" always;
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
    default_type text/plain;
    server_tokens off;

    server {
        listen 127.0.0.1:8089;
        root www;
        include security-headers.conf;

        location /downloads/ {
            add_header Cache-Control "public, max-age=3600";
            include security-headers.conf;
        }
    }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -s reload && sleep 1
echo "--- /downloads/week1.txt"; show /downloads/week1.txt
```

```text output
--- /downloads/week1.txt
HTTP/1.1 200 OK
Server: nginx
Cache-Control: public, max-age=3600
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'
```

(`include` paths are relative to the configuration folder, so `security-headers.conf` sits next to `nginx.conf`.)

### 4. Rate-limit the API

Add a shared-memory zone (in `http`) that tracks clients by IP address and allows 2 requests per second, and apply it to a new `/api/` location with a burst of 3:

```bash run
mkdir -p www/api && printf '["databases", "networks"]\n' > www/api/courses
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
    default_type text/plain;
    server_tokens off;
    limit_req_zone $binary_remote_addr zone=api:1m rate=2r/s;

    server {
        listen 127.0.0.1:8089;
        root www;
        include security-headers.conf;

        location /api/ {
            limit_req zone=api burst=3 nodelay;
            limit_req_status 429;
        }

        location /downloads/ {
            add_header Cache-Control "public, max-age=3600";
            include security-headers.conf;
        }
    }
}
EOF
nginx -p "$PWD" -e error.log -c nginx.conf -t 2>&1 | tail -n 1
nginx -p "$PWD" -e error.log -c nginx.conf -s reload && sleep 1
for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8089/api/courses; done | sort | uniq -c
```

```text output
nginx: configuration file …/nginx.conf test is successful
      4 200
      4 429
```

Eight requests arrive almost at once. The zone allows one now plus a **burst** of 3 more; `nodelay` serves those 3 straight away instead of spacing them out. The other four are refused. By default Nginx refuses with 503; `limit_req_status 429` sends *429 Too Many Requests*, which tells a client to slow down rather than that the server is broken.

The "API" here is a static file, `www/api/courses`, standing in for a proxied application. Do not test rate limits with `return 200 "…";` in the location: `return` answers the request in Nginx's rewrite phase, *before* the phase in which `limit_req` runs, so every request would get through.

Wait a moment and the allowance refills at 2 per second:

```bash run
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8089/api/courses
```

```text output
200
```

## Check your work

Run this inside `safe-site` while Nginx is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
headers() { curl -s -o /dev/null -D - "http://127.0.0.1:8089$1" | tr -d '\r'; }
check "the configuration is valid" 'nginx -p "$PWD" -e error.log -c nginx.conf -t'
for path in / /missing /downloads/week1.txt; do
  check "$path has all four security headers" 'h=$(headers '"$path"'); for n in X-Content-Type-Options X-Frame-Options Referrer-Policy Content-Security-Policy; do echo "$h" | grep -qi "^$n:" || exit 1; done'
done
check "the Server header hides the version" 'headers / | grep -qx "Server: nginx"'
check "a burst to /api/ is answered with 429" 'sleep 2; for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8089/api/courses; done | grep -qx 429'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the configuration is valid
PASS: / has all four security headers
PASS: /missing has all four security headers
PASS: /downloads/week1.txt has all four security headers
PASS: the Server header hides the version
PASS: a burst to /api/ is answered with 429
All checks passed
```

## Clean up

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
```

## Reset

Stop Nginx (as above), leave the folder and delete it — `cd .. && rm -rf safe-site` — then begin again at step 1.

## What you practised

Security headers belong on every response, so use `always`, and remember that one `add_header` in a location replaces the inherited list — keep shared headers in an included file. Rate limiting with a burst absorbs normal spikes while refusing floods, and 429 tells well-behaved clients to back off.
