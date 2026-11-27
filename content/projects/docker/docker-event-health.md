---
id: docker-event-health
track: docker
title: Multi-service event application with health checks
level: advanced
estimated_hours: 7
prerequisites: [docker-networks-and-compose, docker-health-logs-and-limits, docker-image-and-container-security, docker-build-cache-and-supply-chain]
related_tracks: [redis]
user_stories:
  - As a club secretary, I want an event I post to be processed even if the worker was restarting at that moment so that no booking is lost.
  - As an operator, I want each service's health to say whether it can really do its job so that docker compose ps tells me where a problem is.
  - As a security reviewer, I want the API key kept out of images and environment variables so that docker inspect or a pushed image never reveals it.
  - As an operator, I want the API and worker to run with least privilege, limited memory and rotated logs so that one bug cannot take over or fill the machine.
acceptance_criteria:
  - docker compose config accepts compose.yaml with the services api, worker and redis; the redis image and the Dockerfile's base image are pinned by digest.
  - Only api publishes a port, on 127.0.0.1, taken from API_PORT; api and worker wait for redis with condition service_healthy.
  - docker compose up --wait succeeds and api, worker and redis all report healthy.
  - api and worker run as a non-root user with a read-only root filesystem, all capabilities dropped, no-new-privileges, a memory limit and json-file logs with max-size.
  - POST /events answers 202 with the key from secrets/api_key.txt and 401 without it; the key is in no container's environment and no file of the image, and .dockerignore keeps secrets/ out of the build context.
  - A posted event is processed; one posted while the worker is stopped stays queued and is processed when it returns; stopping the worker takes under 5 seconds with exit code 0.
  - With redis stopped, api becomes unhealthy; when redis is back, healthy again.
rubric:
  - { criterion: "Meaningful health", excellent: "Each health check tests the service's real job (API reaches Redis, worker's heartbeat is fresh), timings are justified, and the learner can show an unhealthy state on purpose and explain what Docker does and does not do about it.", good: "Every service has a working health check and startup waits for health.", needs_work: "Health checks only test that a port is open, or are missing." }
  - { criterion: "Secrets", excellent: "Compose secret from a file that is git-ignored and docker-ignored, with an .example file and a note on file permissions; the learner can explain why an environment variable is weaker.", good: "The key reaches the API only as a secret file.", needs_work: "The key is set with environment or ENV, or copied into the image." }
  - { criterion: "Least privilege and limits", excellent: "Shared hardening in one YAML anchor, only the writable paths that are needed (tmpfs /tmp for the worker), and limits chosen with a reason.", good: "All hardening and limits are in place for both services.", needs_work: "Root user, writable filesystem, or no limits." }
  - { criterion: "Reliability", excellent: "Queued events survive worker restarts and Redis restarts (append-only file), the worker stops between events, and the README explains at-least-once processing.", good: "Events wait while the worker is down; the worker stops cleanly.", needs_work: "Events are lost, or stopping the worker takes the full grace period." }
hints:
  - Start with the configuration only, using docker compose config, then bring the stack up with docker compose up -d --build --wait and watch docker compose ps.
  - The health-logs-and-limits lesson uses docker run options (--health-cmd, --memory, --log-opt max-size); in compose.yaml they become healthcheck, mem_limit and logging. depends_on with condition service_healthy is in the networks-and-compose lesson. For the worker, the health check command is node healthcheck.js.
  - "A Compose secret is declared at the top level (secrets: api_key: file: ./secrets/api_key.txt) and given to a service with secrets: [api_key]; it appears at /run/secrets/api_key. The file must be readable by the container's user (uid 1000)."
  - read_only true makes the whole root filesystem read-only. The worker writes its heartbeat to /tmp, so give it tmpfs [/tmp] — and nothing else.
  - "A YAML anchor (x-app with &app, merged with <<: *app) keeps the shared hardening for api and worker in one place."
stretch_goals:
  - Run two workers with docker compose up --scale worker=2 and confirm from processed_by that both take events.
  - Add a dead-letter list for events that fail three times, and a health check that turns unhealthy when it grows.
  - Generate an SBOM for the image and scan it, as in the supply-chain lesson, and pin the result in CI.
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

Student clubs post events — room bookings, ticket sales — to an **API**. The API queues each event in
**Redis**, and a **worker** processes the queue in the background. The application code is finished; what is
not finished is how it runs. The first `Dockerfile` and `compose.yaml` start everything, but:

- the API key is a plain environment variable in `compose.yaml`, and `COPY . .` would ship any local secret
  file into the image;
- nothing has a health check, so "running" says nothing about "working", and services start in an order that
  does not wait for Redis;
- the API, the worker and Redis run as root with a writable filesystem, no memory limit and logs that grow
  forever, and Redis is published on every interface.

Your job is to write the `Dockerfile`, `.dockerignore` and `compose.yaml` that make the stack **healthy in a
meaningful way**, **keep the key secret**, run **with least privilege**, and **lose no events** when the worker
restarts. The starter README lists six requirements.

## Getting started

1. Copy the starter into a new folder. You need Docker with Compose v2 and `curl`.
2. Read `app/api.js`, `app/worker.js` and `app/healthcheck.js` — they tell you where the key is read from and
   where the worker writes its heartbeat. Then check the draft's resolved configuration:

   ```bash
   docker compose config
   ```

3. Create `secrets/api_key.txt` from the `.example` file, and work through the requirements one at a time with
   `docker compose up -d --build --wait`, `docker compose ps`, `docker compose logs worker` and
   `docker inspect`. Stop Redis or the worker on purpose and watch what happens.
4. Run the check. It works on a copy of your folder with its own random key, runs your stack under its own
   project name with `API_PORT` set to a free port, and removes everything it created:

   ```bash
   bash check.sh path/to/your/project
   ```
