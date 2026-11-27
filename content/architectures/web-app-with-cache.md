---
id: web-app-with-cache
title: Web application with a cache behind a reverse proxy
summary: The most common shape of a web service — a reverse proxy in front of stateless application instances, a relational database as the source of truth, and an in-memory cache to keep popular reads fast.
problem: A web application must stay fast and correct as traffic grows, without every read hitting the database and without one slow instance taking the whole service down.
tracks: [nginx, postgresql, redis, docker]
diagram: media:architecture/web-app-with-cache.svg
components:
  - { name: Nginx, track: nginx, role: "The single public entry point: serves static files, terminates TLS, applies rate limits and forwards API requests to healthy instances." }
  - { name: API instances, role: "Stateless application processes; any instance can serve any request, so instances can be added, restarted or replaced freely." }
  - { name: Redis, track: redis, role: "A cache of frequently read data with time-to-live values (cache-aside), plus shared counters for rate limiting." }
  - { name: PostgreSQL, track: postgresql, role: "The source of truth: every rule is a constraint, and every change is a transaction." }
  - { name: Containers, track: docker, role: "Each component runs as a container image, so the same stack starts on a laptop, in CI and on a server." }
flow:
  - A request reaches Nginx, which serves static files itself and forwards API requests to an instance.
  - The instance looks for the data in Redis; on a hit it answers straight away.
  - On a miss it reads PostgreSQL, stores a copy in Redis with a TTL, and answers.
  - A write goes to PostgreSQL in a transaction, then deletes the cached copy so the next read loads fresh data.
trade_offs:
  - { choice: "Cache-aside with TTLs", gain: "Popular reads are served from memory and the database does far less work.", cost: "Readers can see stale data until the key expires or is deleted; every write path must invalidate." }
  - { choice: "Stateless API instances behind a proxy", gain: "Instances can be scaled and replaced without coordination; one failure is absorbed by the others.", cost: "Session and rate-limit state must live elsewhere (Redis), adding a dependency." }
  - { choice: "Constraints in the database, not only in code", gain: "Every writer — any instance, a script, a migration — obeys the same rules.", cost: "Schema changes need migrations and more care than changing code." }
failure_modes:
  - { failure: "Many requests miss the cache for the same key at once (a stampede)", effect: "The database receives a burst of identical queries and slows everyone down.", mitigation: "Let one request rebuild the value under a lock with an expiry, while others wait briefly or serve the stale copy." }
  - { failure: "Redis is unavailable", effect: "Every read goes to the database, which may be overloaded.", mitigation: "Short timeouts to Redis, then fall back to the database or shed load; treat the cache as optional." }
  - { failure: "An API instance hangs or returns errors", effect: "Requests sent to it fail or wait.", mitigation: "Nginx marks it as failed and retries idempotent requests elsewhere; timeouts are set from what the endpoint normally needs." }
alternatives:
  - { instead_of: "Redis cache-aside", consider: "HTTP caching in Nginx", when: "Responses are the same for every user and can be cached by URL for a short time." }
  - { instead_of: "Nginx as the entry point", consider: "A managed load balancer or a Kubernetes Ingress", when: "The service already runs on a cloud platform or a cluster that provides one." }
decision_prompts:
  - Which data is safe to cache, and how stale may it be for your users? Name the TTL and why.
  - What happens to a write that succeeds in PostgreSQL when the cache invalidation fails?
  - How does the service behave if Redis is down for ten minutes during peak traffic?
  - Which requests may Nginx retry on another instance, and which must never be retried?
learn_more:
  - { kind: lesson, id: redis-caching-and-rate-limiting }
  - { kind: lesson, id: redis-cache-stampede-and-failures }
  - { kind: lesson, id: nginx-reverse-proxy-and-load-balancing }
  - { kind: lesson, id: nginx-upstream-failures }
  - { kind: project, id: docker-compose-fullstack }
capstones: [capstone-b, capstone-a]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## When to use it

Use this shape for almost any web application or API with more reads than writes: course portals, shops,
dashboards, internal tools. It scales a long way by adding API instances and cache capacity before anything more
complicated is needed.

It is not enough on its own when work must continue after the request has been answered (sending e-mails, charging
cards, updating other systems). Then add a queue or an event log — see the event-driven architecture.

## How it works

The proxy, the instances and the cache can all be replaced without losing anything, because the only durable state
is in PostgreSQL. That single rule is what makes the rest simple: restart anything else at any time.

Speed comes from not repeating work. Nginx serves static files without touching the application; Redis answers
repeated reads; PostgreSQL indexes keep the remaining queries cheap. Correctness comes from the database: when the
cache and the database disagree, the database wins, and every write invalidates the copies it makes stale.
