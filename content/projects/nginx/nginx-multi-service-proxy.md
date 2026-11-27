---
id: nginx-multi-service-proxy
track: nginx
title: Reverse proxy for a multi-service application
level: beginner
estimated_hours: 4
prerequisites: [nginx-serving-static-files, nginx-reverse-proxy-and-load-balancing, nginx-location-matching]
related_tracks: [docker]
user_stories:
  - As a student using Campus Hub, I want one address for the portal and its API so that I never need to know which internal service answers.
  - As a developer of the courses service, I want every request to arrive with its original Host, client address and protocol so that my logs and links are correct.
  - As an on-call engineer, I want requests for unknown host names and unknown API paths stopped at Nginx so that stray traffic never reaches the applications.
acceptance_criteria:
  - nginx -t accepts nginx.conf, and Nginx answers on port 80.
  - For campus.example, /api/courses/… goes to courses, /api/notices/… to notices and everything outside /api/ to web, with path and query unchanged; any other /api/ path gets 404 from Nginx.
  - Every path on admin.campus.example goes to the admin service.
  - A request for any other host name, or with an empty Host header, is refused by Nginx and reaches no service.
  - Every service receives the original Host header, X-Forwarded-For with the client's address appended to any earlier value, and X-Forwarded-Proto.
  - Responses carry Server nginx without the version number.
rubric:
  - { criterion: "Routing", excellent: "Every route works, the catch-all /api/ location and the default server are explained in comments, and the learner can say why the order of prefix locations does not matter.", good: "Every route in the table works.", needs_work: "Unknown API paths or unknown hosts still reach the frontend, or paths arrive changed." }
  - { criterion: "Forwarded headers", excellent: "Headers are set once at http or server level, the inheritance rule is noted, and the README explains when the application may trust X-Forwarded-For.", good: "All three headers reach every service.", needs_work: "A service sees the internal name as Host, or no client address." }
  - { criterion: "Safe defaults", excellent: "An explicit default_server refuses unknown hosts, server_tokens is off, and every change was tested with nginx -t before reloading.", good: "Unknown hosts are refused and the version is hidden.", needs_work: "The first server block silently answers every host name." }
hints:
  - Start with nginx -t after every edit — inside Compose that is docker compose exec proxy nginx -t, then nginx -s reload.
  - Two server blocks can listen on the same port; Nginx picks one by the request's Host header (server_name). Without a match it uses the default server for that port — the first one, unless one is marked default_server.
  - Locations /api/courses/, /api/notices/ and /api/ can live side by side. The longest matching prefix wins, whatever their order in the file — exactly as in the location-matching lesson.
  - proxy_pass http://courses; (no path after the name) passes the URI on unchanged. proxy_set_header lines at server or http level are inherited by every location — unless a location sets a proxy_set_header of its own, which replaces the whole inherited list.
  - $proxy_add_x_forwarded_for is the incoming X-Forwarded-For with the client's address appended (or just the address if there was none).
stretch_goals:
  - Stop one service (docker compose stop notices), request /api/notices/ and find the reason for the 502 in docker compose logs proxy.
  - Add a location = /health that Nginx answers itself, for a load balancer in front of it.
  - Add HTTPS for campus.example with a development certificate, as in the TLS lesson, and redirect plain HTTP to it; X-Forwarded-Proto should then say https.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Campus Hub is a student portal built from four services: a frontend (`web`), a courses API, a notices API and
an admin tool. Today each would need its own public port. Your job is to put **one Nginx** in front of all of
them — the only public entry point — and route every request by **host name and path** to the right service.

The first draft of `nginx.conf` sends everything to the frontend, for every host name. That "works" in a browser,
which is exactly why it is dangerous: API mistakes come back as frontend pages, a request for any host name
reaches the application, and the services cannot tell who their clients are because every request seems to come
from Nginx.

The README in the starter is the specification: a routing table, the headers every service must receive, and
what Nginx itself must answer. The services in this project are stand-ins that reply with what they received,
so every `curl` shows you which service answered and which headers arrived.

## Getting started

1. Copy the starter into a new folder. You need Docker with Compose v2 and `curl`.
2. Start the stand-in services and Nginx (Nginx 1.24, the version the lessons use):

   ```bash
   docker compose up -d
   curl -H "Host: campus.example" http://127.0.0.1:8080/api/courses/42
   ```

   The reply says `service=web` — the first thing to fix. If port 8080 is taken on your machine, start with
   `PROXY_PORT=8081 docker compose up -d` and use that port.
3. Edit `nginx.conf`, then test and reload: `docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.
   Work through the routing table one row at a time, then the headers, then the refusals.
4. Run the check. It starts its own throwaway copies of the services and of Nginx, so the Compose setup does not
   need to be running:

   ```bash
   bash check.sh path/to/your/project
   ```

5. Finish with `docker compose down`.
