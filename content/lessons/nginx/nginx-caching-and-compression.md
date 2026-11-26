---
id: nginx-caching-and-compression
title: Caching and compression
track: nginx
order: 4
level: intermediate
estimated_minutes: 35
prerequisites: [nginx-serving-static-files]
learning_objectives:
  - Put a proxy cache in front of a backend and read MISS and HIT in the response headers.
  - Explain how the backend's own headers (Cache-Control, Set-Cookie) decide what may be cached.
  - Turn on gzip compression for JSON and measure the saving.
resources:
  - title: Module ngx_http_proxy_module (proxy_cache, proxy_cache_valid, proxy_ignore_headers)
    url: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
    publisher: nginx.org
    type: documentation
    level: intermediate
    official: true
    why: Defining a cache, how long responses are kept, and which upstream headers change caching.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_gzip_module
    url: https://nginx.org/en/docs/http/ngx_http_gzip_module.html
    publisher: nginx.org
    type: documentation
    level: beginner
    official: true
    why: gzip, gzip_types, gzip_min_length and gzip_vary.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Module ngx_http_upstream_module ($upstream_cache_status)
    url: https://nginx.org/en/docs/http/ngx_http_upstream_module.html
    publisher: nginx.org
    type: documentation
    level: intermediate
    official: true
    why: The values of $upstream_cache_status, such as MISS, HIT and EXPIRED.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: hit
    prompt: Three identical requests go through the cache within 30 seconds. The backend counted one. Why?
    options:
      - { id: a, text: "The other two failed" }
      - { id: b, text: "The first was a MISS and Nginx stored the response; the next two were HITs answered from the cache without contacting the backend" }
      - { id: c, text: "The browser cached them" }
    answer: b
    explanation: That is the point of a proxy cache — repeated requests cost the backend nothing until the cached copy expires.
  - id: private
    prompt: A response carries Cache-Control private, no-store (or a Set-Cookie header). What does Nginx do with it by default?
    options:
      - { id: a, text: "Caches it for proxy_cache_valid seconds" }
      - { id: b, text: "Does not cache it — the backend's headers take part in deciding caching, and a response with Set-Cookie is never cached" }
      - { id: c, text: "Rejects it with 502" }
    answer: b
    explanation: The nginx documentation lists Expires, Cache-Control, Set-Cookie and Vary as headers that set caching parameters unless ignored with proxy_ignore_headers — and ignoring them for personal data would serve one user's page to another.
  - id: gzip
    prompt: Why is gzip_types needed to compress JSON?
    options:
      - { id: a, text: "JSON cannot be compressed" }
      - { id: b, text: "By default gzip only compresses text/html; other types, such as application/json, must be listed" }
      - { id: c, text: "It makes JSON valid" }
    answer: b
    explanation: The gzip module's documentation says responses with the text/html type are always compressed; gzip_types adds others.
verification:
  method: executed
  details: Every command is run by the test suite with Nginx 1.24 and a small Node.js backend, after the earlier lessons, and its output is compared with this lesson. Cache and gzip behaviour was checked against the nginx.org documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Nginx can **cache** a backend's responses — answering repeats itself (`HIT`) until they expire — and **compress** responses with gzip, while respecting the backend's headers about what must never be cached.

## Explain it like I'm twelve

The school office gets asked "when is lunch?" a hundred times a day. Instead of phoning the kitchen each time, the receptionist writes the answer on a sticky note and reads it out — until it is out of date. Personal questions ("what is my grade?") are never put on the sticky note.

The sticky note is the **cache**; the personal questions are responses marked **private**. Writing in shorthand so the answer fits on the note is **compression**.

## What problem it solves

Many requests ask for the same data, and the backend (and its database) does the same work again for each one. A cache in front absorbs the repeats, and compression cuts transfer sizes — especially for JSON and HTML, which compress very well. Both make pages faster and backends cheaper, if they are set up so private data is never shared.

## How it works

![](media:nginx/cache-gzip.svg)

- `proxy_cache_path` defines where cached responses are stored and a shared-memory zone for their keys; `proxy_cache zone` uses it in a location; `proxy_cache_valid 200 30s` keeps successful responses for 30 seconds.
- `$upstream_cache_status` says what happened: `MISS` (fetched from the backend), `HIT` (served from the cache), `EXPIRED`, and others. Exposing it as a header makes caching visible.
- The backend's `Cache-Control` and `Expires` headers can set or prevent caching, and a response with `Set-Cookie` is not cached — unless `proxy_ignore_headers` says otherwise.
- `gzip on` compresses responses for clients that send `Accept-Encoding: gzip`; `gzip_types` lists which content types (besides `text/html`); `gzip_vary on` adds `Vary: Accept-Encoding` so other caches keep both versions apart.

## Try it yourself

> **Local lab** — needs Nginx (as in *Serving static files*), `curl` and Node.js. Nginx runs as your user from a throwaway folder on port 8089; the backend listens on port 8092. Every command is run automatically in DevForge's tests.

### 1. A backend that counts its requests

```bash run
mkdir -p nginx-cache-lab/tmp && cd nginx-cache-lab
cat > backend.mjs <<'EOF'
// A small API: /timetable is the same for everyone; /private is personal. /hits reports how many requests it served.
import http from "node:http";
let served = 0;
http.createServer((req, res) => {
  if (req.url === "/hits") return res.end(`${served}\n`);
  served++;
  if (req.url === "/private") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
    return res.end(JSON.stringify({ user: "asha", grade: "A" }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ week: 1, sessions: Array.from({ length: 50 }, (_, i) => ({ day: i % 5, room: `Room ${200 + i}`, title: "Databases lecture" })) }));
}).listen(8092, "127.0.0.1", () => console.log("backend on http://127.0.0.1:8092"));
EOF
node backend.mjs > backend.log 2>&1 &
echo $! > backend.pid
for i in $(seq 1 30); do grep -q 'on http' backend.log && break; sleep 0.2; done
cat backend.log
```

```text output
backend on http://127.0.0.1:8092
```

### 2. Nginx with a cache and gzip

```bash run
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

    proxy_cache_path tmp/cache levels=1:2 keys_zone=pages:1m max_size=10m inactive=10m use_temp_path=off;

    gzip on;
    gzip_types application/json;
    gzip_min_length 256;
    gzip_vary on;

    server {
        listen 127.0.0.1:8089;
        location / {
            proxy_pass http://127.0.0.1:8092;
            proxy_cache pages;
            proxy_cache_valid 200 30s;
            add_header X-Cache-Status $upstream_cache_status always;
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

- `keys_zone=pages:1m` — a 1 MB shared-memory zone for cache keys (the documentation says about 8 thousand keys); `max_size=10m` caps the files on disk; `inactive=10m` removes entries nobody asked for in 10 minutes.
- `gzip_min_length 256` skips tiny responses, where compression saves nothing.

### 3. MISS, then HIT

```bash run
status() { curl -s -o /dev/null -D - "http://127.0.0.1:8089$1" | grep -i '^x-cache-status' | tr -d '\r'; }
for i in 1 2 3; do status /timetable; done
echo "backend requests: $(curl -s http://127.0.0.1:8092/hits)"
```

```text output
X-Cache-Status: MISS
X-Cache-Status: HIT
X-Cache-Status: HIT
backend requests: 1
```

The first request was fetched from the backend and stored; the next two came from Nginx's cache. Three requests cost the backend one.

### 4. Private responses stay private

```bash run
for i in 1 2; do status /private; done
echo "backend requests: $(curl -s http://127.0.0.1:8092/hits)"
```

```text output
X-Cache-Status: MISS
X-Cache-Status: MISS
backend requests: 3
```

The backend marked `/private` as `private, no-store`, so Nginx did not store it — each request went to the backend. Caching it would have shown Asha's grade to the next visitor. Responses that set cookies are not cached either, for the same reason.

### 5. Compression

```bash run
echo "without gzip: $(curl -s http://127.0.0.1:8089/timetable | wc -c | tr -d ' ') bytes"
echo "with gzip:    $(curl -s -H 'Accept-Encoding: gzip' http://127.0.0.1:8089/timetable | wc -c | tr -d ' ') bytes"
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' http://127.0.0.1:8089/timetable | grep -iE '^(content-encoding|vary)' | tr -d '\r'
```

```text output
without gzip: 2823 bytes
with gzip:    260 bytes
Vary: Accept-Encoding
Content-Encoding: gzip
```

The JSON shrank to under a tenth of its size — repetitive text compresses very well. `Vary: Accept-Encoding` tells browsers and other caches that the response depends on that request header.

### 6. Stop everything

```bash run
nginx -p "$PWD" -e error.log -c nginx.conf -s stop
kill "$(cat backend.pid)"
```

## Common mistakes

- **Caching personal pages.** Ignoring `Cache-Control` or `Set-Cookie` with `proxy_ignore_headers` to "improve the hit rate" can serve one user's data to another.
- **Caching errors.** Without status codes in `proxy_cache_valid`, only some successful responses are cached; be deliberate about whether 404s are cached, and for how long.
- **Compressing already-compressed files.** Images, video and zip files do not shrink; list only text types in `gzip_types`.
- **No way to see what happened.** Without an `X-Cache-Status`-style header or log field, debugging a cache is guesswork.

## Where this fits in a real system

Nginx (or a CDN) caches public API responses and pages in front of the application; **Redis** caches data *inside* the application; and **Prometheus** dashboards track cache hit ratios so a change that breaks caching is noticed before the database is.
