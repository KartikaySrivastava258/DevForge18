---
id: docker-compose-fullstack
track: docker
title: Local full-stack application with Compose
level: intermediate
estimated_hours: 5
prerequisites: [docker-volumes-and-bind-mounts, docker-networks-and-compose, docker-health-logs-and-limits, docker-build-cache-and-supply-chain]
related_tracks: [nginx, redis]
user_stories:
  - As a developer joining the noticeboard team, I want the whole application to start with one command so that I can work on it on my first day.
  - As a student reading the noticeboard, I want notices to survive a restart of the stack so that nothing posted yesterday disappears.
  - As a team lead, I want only the web front door reachable from outside the stack so that nobody can connect to Redis or the API directly.
  - As a developer, I want docker compose up --wait to return only when the application really works so that scripts and tests never start against a half-ready stack.
acceptance_criteria:
  - docker compose config accepts compose.yaml, which defines the services web, api and redis.
  - The web and redis images, and the base image in api/Dockerfile, are pinned by digest.
  - Only web publishes a port, on 127.0.0.1, with the host port taken from WEB_PORT.
  - api waits for redis, and web waits for api, with depends_on condition service_healthy; redis and api report healthy once docker compose up --wait returns.
  - Through the web port, the page loads and a notice can be posted and listed.
  - After docker compose down and docker compose up, the notice is still listed, because Redis keeps /data in a named volume.
rubric:
  - { criterion: "Startup order and health", excellent: "Health checks test what matters (Redis answers, the API can reach Redis), intervals and retries are chosen with a comment, and the learner can explain why depends_on alone does not wait for readiness.", good: "Both health checks and both conditions work; up --wait succeeds.", needs_work: "Plain depends_on lists, so services can start against a dependency that is not ready." }
  - { criterion: "Exposure", excellent: "One published port on 127.0.0.1, configurable, and comments explaining why api and redis publish nothing.", good: "Only web publishes a port.", needs_work: "Redis or the API is published, or web listens on every interface." }
  - { criterion: "Data and reproducibility", excellent: "Named volume with a clear name, pinned images with how to update them, and the down versus down -v difference noted in the README.", good: "Data survives down and up; images are pinned.", needs_work: "Data lives in the container, or images use moving tags such as latest." }
hints:
  - docker compose config prints the file as Compose understands it — run it after every edit. With WEB_PORT=9999 docker compose config you can see the variable being substituted.
  - "Find a digest by pulling the tag and running docker image inspect -f '{{index .RepoDigests 0}}' redis:7.4.12-alpine; write image: redis:7.4.12-alpine@sha256:… with both."
  - The networks-and-compose lesson has a healthcheck for Redis and depends_on with condition service_healthy. For the API, a healthcheck can run wget inside the container against http://127.0.0.1:3000/api/health — wget is part of the Alpine base.
  - A named volume is declared under the top-level volumes key and mounted with - redis-data:/data. Check with docker volume ls after up, and with down followed by up.
  - Removing a ports entry does not make a service unreachable to the others — on the project network, web still reaches api:3000 by name.
stretch_goals:
  - Add a redis-cli service under a Compose profile (profiles [debug]) so a debugging client starts only with docker compose --profile debug run redis-cli.
  - Give api a memory limit and a restart policy, and log rotation for every service, as in the health-logs-and-limits lesson.
  - Turn on Redis's append-only file (appendonly yes) and compare what survives docker kill of the redis container with and without it.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The Campus Noticeboard is a small full-stack application: an Nginx front end, a Node.js API and Redis. Each
part already works on its own — the API even has a finished, pinned `Dockerfile`. What is missing is a
`compose.yaml` the whole team can rely on.

The first draft "works on my machine": it uses moving image tags, publishes Redis and the API on every network
interface "for debugging", starts services in an order that does not wait for anything to be ready, and keeps
Redis's data inside the container, so `docker compose down` throws the notices away.

Your job is to rewrite `compose.yaml` so that one command starts a stack that is **pinned**, **exposed only
where it must be**, **started in a truly ready order**, and **keeps its data**. The starter README lists the
four requirements.

## Getting started

1. Copy the starter into a new folder. You need Docker with Compose v2 and `curl`.
2. Read the first draft and predict what is wrong with it, then check the resolved configuration:

   ```bash
   docker compose config
   ```

   Starting the draft as it is binds ports 8080, 3000 and 6379 on every interface; if any of them is already
   used on your machine, it fails — one of the reasons to change it.
3. Fix one requirement at a time. Use `docker compose up -d --build --wait`, `docker compose ps` and
   `docker compose logs api` as you go, and `docker compose down` (or `down -v` to delete the data).
4. Run the check. It runs your stack under its own project name with `WEB_PORT` set to a free port, and removes
   its containers, network, volumes and built image at the end:

   ```bash
   bash check.sh path/to/your/project
   ```
