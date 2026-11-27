---
id: nginx-load-balancing-demo
track: nginx
title: Local load-balancing demo
level: intermediate
estimated_hours: 5
prerequisites: [nginx-reverse-proxy-and-load-balancing, nginx-upstream-failures]
related_tracks: [docker]
user_stories:
  - As a student ordering lunch at peak time, I want my order to go through even when one API instance has crashed so that I do not queue at the counter.
  - As a canteen manager, I want an order never to be placed twice so that no student pays twice for one meal.
  - As an operator, I want to put one instance into maintenance without users seeing errors so that I can upgrade instances one at a time.
  - As a student downloading a monthly report, I want quick requests not to wait behind someone else's long report so that the app stays responsive.
acceptance_criteria:
  - nginx -t accepts nginx.conf, and Nginx answers on port 80.
  - Thirty requests to /api/ are spread across app1, app2 and app3 (6 to 14 each), and the fallback service receives none while they are healthy.
  - While one report instance is busy with a long request, new /reports/ requests go to the other instance.
  - A POST that reaches an instance answering 503 is not sent to another instance — six POSTs arrive exactly six times.
  - With app3 answering 503, GET requests are retried on the other instances and all get 200; with app2 refusing connections as well, every GET still gets 200 from app1.
  - With app1, app2 and app3 all down, the fallback service answers.
rubric:
  - { criterion: "Balancing method", excellent: "Round robin for short API calls and least_conn for long reports, each choice justified in a comment, with a shared zone so all workers agree.", good: "Both groups balance as required.", needs_work: "One method everywhere, or a group that only works with a single worker process." }
  - { criterion: "Failure handling", excellent: "Retries are limited to what is safe (connection errors, timeouts, 502/503 for idempotent requests), timeouts are bounded, the backup is explained, and the learner can say what max_fails and fail_timeout do here.", good: "Users see no errors for a crashed or maintenance instance, and the backup takes over when all fail.", needs_work: "Users see 502/503, or the backup takes part in normal rotation." }
  - { criterion: "Safety of retries", excellent: "The README of the learner's copy explains why POST is not retried and what an idempotency key would change.", good: "POST requests are never repeated.", needs_work: "non_idempotent is enabled, so an order can be placed twice." }
hints:
  - Bring up the stand-ins with docker compose up -d, then watch the spread with a loop of curl requests; every answer starts with service=… .
  - Add zone api 64k; inside an upstream block to keep its state (whose turn it is, which servers failed) in memory shared by all worker processes. Without it, each worker balances on its own — with several workers, the spread can be uneven.
  - least_conn; inside an upstream block switches from taking turns to "fewest active connections".
  - proxy_next_upstream decides which failures send a request to the next server. Its default is error timeout; adding http_503 also covers maintenance. Leave non_idempotent out — the upstream-failures lesson explains why.
  - A server marked backup only receives requests when the others are unavailable. Test it by putting all three app instances down with the control port described in services/echo.js.
stretch_goals:
  - Add an X-Served-By response header with $upstream_addr, and log $upstream_addr and $upstream_status in a custom log_format to see retries in the access log.
  - Give app3 weight=2 and predict, then measure, the new spread.
  - Make a slow instance (?delay_ms=…) time out after two seconds with proxy_read_timeout, and decide whether a timed-out GET should be retried.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The canteen's ordering API was one process. At lunchtime it now runs as **three instances** behind Nginx, with
two instances of the report service and a small **fallback** that tells students to order at the counter. The
first draft of `nginx.conf` was written before the scale-up: it knows only two API instances and one report
instance, and it has no plan for instances that crash or go into maintenance.

Your job is to make the load balancing **even**, **fast for long requests** and **invisible when an instance
fails** — without ever placing an order twice. You will break instances on purpose to prove it: the stand-in
services in this project have a control port that puts them into maintenance (`503`) or makes them refuse
connections, exactly the failures from the upstream-failures lesson.

The README in the starter lists the six rules. The check sends real requests while it breaks instances one by
one, and counts which instance received each request.

## Getting started

1. Copy the starter into a new folder. You need Docker with Compose v2 and `curl`.
2. Start everything and look at the spread:

   ```bash
   docker compose up -d
   for i in 1 2 3 4 5 6; do curl -s http://127.0.0.1:8080/api/menu | head -n 1; done
   ```

   Only `app1` and `app2` answer. If port 8080 is taken, use `PROXY_PORT=8081 docker compose up -d`.
3. Work rule by rule. After each change: `docker compose exec proxy nginx -t && docker compose exec proxy nginx -s reload`.
   Break instances with the commands in `services/echo.js`, and reset them with `?mode=ok`.
4. Run the check (it starts its own throwaway services and Nginx 1.24):

   ```bash
   bash check.sh path/to/your/project
   ```

5. Finish with `docker compose down`.
