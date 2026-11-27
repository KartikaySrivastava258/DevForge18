---
id: nginx-spa-api-gateway
track: nginx
title: Static frontend + API gateway-style routing
level: advanced
estimated_hours: 7
prerequisites: [nginx-serving-static-files, nginx-location-matching, nginx-caching-and-compression, nginx-access-control]
related_tracks: [docker]
user_stories:
  - As a student shopping on Campus Store, I want a link to /orders/42 to open the right page even after a reload so that I can bookmark and share pages.
  - As a student on a slow mobile connection, I want the app's files cached and compressed so that the store opens quickly on every visit after the first.
  - As a frontend developer, I want a new release to reach every browser on its next visit so that nobody runs yesterday's JavaScript against today's API.
  - As an API owner, I want oversized requests and request floods stopped at the gateway so that one client cannot exhaust the users and orders services.
  - As a security reviewer, I want the same protective headers on every response, errors included, so that no page can be framed or content-sniffed.
acceptance_criteria:
  - nginx -t accepts nginx.conf, and Nginx answers on port 80 with site/ as its document root.
  - "/ and any path that is not a file get index.html with 200 and Cache-Control no-cache; files in /assets/ get max-age of at least 30 days and immutable; a missing asset gets 404, not index.html."
  - JavaScript and CSS are gzip-compressed for clients that send Accept-Encoding gzip, with Vary Accept-Encoding.
  - /api/v1/users/… and /api/v1/orders/… reach the users and orders services without the /api/v1 prefix, with query strings and forwarded headers; any other /api/ path gets a JSON 404 from Nginx.
  - API bodies over 100 KB get 413, except avatar uploads up to 5 MB.
  - Forty rapid API requests give 20 to 34 responses with 200 and the rest 429, while forty rapid requests for / all get 200.
  - Every response checked, errors included, carries X-Content-Type-Options nosniff and X-Frame-Options DENY, and Server nginx without a version.
rubric:
  - { criterion: "Single-page app serving", excellent: "Fallback, cache policy and missing-asset 404 are each justified in a comment, and the learner can explain why index.html must be revalidated while fingerprinted assets can be cached for a year.", good: "Deep links work, assets are cached long and index.html is revalidated.", needs_work: "Deep links give 404, or missing assets come back as index.html with 200." }
  - { criterion: "Gateway routing", excellent: "Prefix removal uses proxy_pass with a URI, exact and prefix locations are chosen deliberately, and unknown API paths get a JSON error that API clients can parse.", good: "Every route reaches the right service with the right path.", needs_work: "The prefix reaches the services, or API errors return the frontend's HTML." }
  - { criterion: "Protection at the edge", excellent: "Body limits are as tight as each endpoint allows, the rate limit answers 429, the static site is not limited, and the README notes what a shared address (campus Wi-Fi) means for a per-address limit.", good: "Limits work as specified.", needs_work: "No limits, or limits that also block the frontend." }
  - { criterion: "Header hygiene", excellent: "Shared headers live in one snippet included wherever a location adds its own header, with always for error responses; the add_header inheritance rule is explained.", good: "Every response carries the security headers.", needs_work: "Headers disappear on assets or on error responses." }
hints:
  - try_files $uri $uri/ /index.html; serves a file if it exists and otherwise hands over index.html. In /assets/, use try_files $uri =404; instead — a missing script must be an error, not a web page.
  - A location with its own add_header (such as Cache-Control) inherits no add_header from the server block. Include snippets/security-headers.conf again in that location — the Nginx lab shows the trap.
  - proxy_pass http://users/users/; inside location /api/v1/users/ replaces the matched prefix — /api/v1/users/42 becomes /users/42. An exact location = /api/v1/users/avatar wins over the prefix and can have its own client_max_body_size.
  - Without nodelay, requests in the burst are queued and slowed down to the rate instead of being served at once. limit_req_status 429 replaces the default 503.
  - "For the JSON 404: default_type application/json; return 404 '{\"error\":\"not found\"}';. return answers before limit_req runs, so it is fine here — but not for testing a rate limit."
stretch_goals:
  - Add a Content-Security-Policy that allows only the app's own scripts and styles, and check in a browser's console that the store still works.
  - Cache GET responses from /api/v1/users/ for a few seconds with proxy_cache, expose X-Cache-Status, and make sure a response with Set-Cookie is never cached.
  - Serve the site over HTTPS with HTTP/2 and HSTS, as in the TLS lesson.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Campus Store is a single-page app with two API services. Today it runs on a developer's laptop: the frontend's
own development server serves the app, and the API services are called directly. For the term launch, **one
Nginx** must do both jobs — serve the built app from `site/` and act as a small **API gateway** for
`/api/v1/` — and it must be fast for students and safe for the services.

Three things make this harder than serving files:

- A single-page app has pages that are not files (`/orders/42`), but its scripts **are** files — and a missing
  script must never come back as an HTML page.
- Caching is a trade-off: fingerprinted assets can be cached for a year, but `index.html` must be revalidated,
  or browsers keep loading last week's release.
- The gateway decides what reaches the services: the path they expect, how large a request may be, how many
  requests per second one client may send, and which headers every response carries — errors included.

The starter README is the specification. The check sends more than twenty kinds of request, including floods
and oversized uploads, and reads every header.

## Getting started

1. Copy the starter into a new folder. You need Docker with Compose v2 and `curl`.
2. Start the stand-in services and Nginx (1.24, the version the lessons use), then try a deep link:

   ```bash
   docker compose up -d
   curl -i http://127.0.0.1:8080/orders/42
   ```

   It gets 404 — the first thing to fix. If port 8080 is taken, use `PROXY_PORT=8081 docker compose up -d`.
   You can also open the store in a browser.
3. Work through the README section by section. After each change:
   `docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.
4. Run the check (it starts its own throwaway services and Nginx):

   ```bash
   bash check.sh path/to/your/project
   ```

5. Finish with `docker compose down`.
