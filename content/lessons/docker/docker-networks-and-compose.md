---
id: docker-networks-and-compose
title: Networks and Docker Compose
track: docker
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [docker-dockerfile-layers-and-cache]
learning_objectives:
  - Show that containers on a user-defined network reach each other by name, and that the default bridge network does not do this.
  - Describe a two-service application — an API and a cache — in a compose.yaml file and start it with one command.
  - Make one service wait for another to be healthy with depends_on and a health check, and see what the API does when the cache stops.
  - Keep data across docker compose down with a named volume, and delete it deliberately with down -v.
resources:
  - title: Bridge network driver
    url: https://docs.docker.com/engine/network/drivers/bridge/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: User-defined bridges give containers automatic DNS resolution by name; the default bridge only lets them reach each other by IP address.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Networking in Compose
    url: https://docs.docker.com/compose/how-tos/networking/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Compose creates one network per project and every service is reachable at its service name.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Control startup order in Compose
    url: https://docs.docker.com/compose/how-tos/startup-order/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: depends_on with condition service_healthy waits for a dependency's health check before starting a service.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker compose up
    url: https://docs.docker.com/reference/cli/docker/compose/up/
    publisher: Docker Inc.
    type: reference
    level: intermediate
    official: true
    why: The --detach and --wait options — return once services are running or healthy.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: default-bridge
    prompt: Two containers are started with plain docker run (no --network). One tries to reach the other by its container name. What happens?
    options:
      - { id: a, text: "It works: Docker always resolves container names" }
      - { id: b, text: "The name does not resolve: on the default bridge network containers can only reach each other by IP address" }
      - { id: c, text: "Docker merges them into one container" }
    answer: b
    explanation: Automatic name resolution is a feature of user-defined networks. Compose creates one for every project, which is why service names work there.
  - id: depends-on
    prompt: The api service has depends_on cache with condition service_healthy. What does Compose wait for before starting api?
    options:
      - { id: a, text: "Only for the cache container to be created" }
      - { id: b, text: "For the cache's health check (here redis-cli ping) to pass" }
      - { id: c, text: "For the cache to have stored some data" }
    answer: b
    explanation: Without a condition, depends_on only orders creation — the API could start before Redis accepts connections. A health check describes what "ready" means.
  - id: cache-stops
    prompt: The cache container stops while the API keeps running. What should a well-built API do?
    options:
      - { id: a, text: "Crash, so that Compose restarts everything" }
      - { id: b, text: "Answer requests with a clear error (here 503) and recover by itself once the cache is back" }
      - { id: c, text: "Wait silently until the cache returns" }
    answer: b
    explanation: depends_on only affects startup; at run time, services fail independently. Each one has to handle its dependencies being unavailable, as the API in this lesson does.
  - id: down-v
    prompt: What is the difference between docker compose down and docker compose down -v?
    options:
      - { id: a, text: "None" }
      - { id: b, text: "Both remove the containers and the network; -v also deletes the project's named volumes, and with them the data" }
      - { id: c, text: "-v prints more output" }
    answer: b
    explanation: Keeping volumes on down is what lets the visit counter survive in the lab. Use -v only when you mean to delete the data.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with Docker Compose v2, after the previous lessons, and its output is compared with this lesson. First run locally with Docker Compose v5.3.1, redis:7.4-alpine and node:22-alpine on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Containers on the same **user-defined network** find each other by name, and **Docker Compose** describes a whole application — its services, network, volumes and startup order — in one `compose.yaml` file that starts and stops with one command.

## Explain it like I'm twelve

A school has many rooms. In the big shared corridor (the default network), nobody has a name badge, so you can only find someone if you know their room number. In a club room (a user-defined network), everyone wears a name badge, so you just call "cache!" and the right person answers.

Compose is the club's written plan: who is in the club, which room they meet in, who has to arrive first, and which cupboard keeps their things.

Where the analogy breaks: "arriving first" is not enough — Compose can wait until a service says it is *ready*, using a health check.

## What problem it solves

Real applications are several programs: an API, a database, a cache, a worker. Starting each with a long `docker run` command, in the right order, on the right network, with the right volumes, is slow and easy to get wrong. A `compose.yaml` file records all of it, can be reviewed in Git like any other code, and gives every developer the same environment with `docker compose up`.

## How it works

![](media:docker/compose.svg)

- `docker network create name` makes a **user-defined bridge network**. Containers started with `--network name` get Docker's built-in DNS, so they can reach each other by container name. The default bridge network, used when you give no `--network`, does not offer that.
- Compose creates one network per **project** (here `devforge-lab_default`) and every service is reachable at its **service name** (`cache`).
- `depends_on` with `condition: service_healthy` makes Compose wait until a dependency's **health check** passes. `docker compose up --wait` returns only once services are running or healthy.
- Named volumes declared under `volumes:` survive `docker compose down`; `down -v` deletes them.
- `-p devforge-lab` sets the project name, which prefixes containers, networks and volumes.

## Try it yourself

> **Local lab** — needs Docker with Compose v2 (`docker compose version`), and `curl`. The API is published on `127.0.0.1:8096`. Every command is run automatically in DevForge's tests, and the last step removes everything you create.

### 1. Names work on a user-defined network

Download the two small images used in this lesson, create a network, and start Redis on it:

```bash run
docker pull -q redis:7.4-alpine
docker pull -q node:22-alpine
docker network create devforge-net > /dev/null
docker run -d --name devforge-cache --network devforge-net redis:7.4-alpine > /dev/null
for i in $(seq 1 30); do docker exec devforge-cache redis-cli ping > /dev/null 2>&1 && break; sleep 0.5; done
docker run --rm --network devforge-net redis:7.4-alpine redis-cli -h devforge-cache ping
```

```text output
docker.io/library/redis:7.4-alpine
docker.io/library/node:22-alpine
PONG
```

A second container on `devforge-net` reached Redis by the name `devforge-cache`. Now try the same from a container on the default network:

```bash run fails
docker run --rm redis:7.4-alpine redis-cli -h devforge-cache ping
```

```text output
Could not connect to Redis at devforge-cache:6379: …
```

The name does not resolve there. Remove the two and move on to Compose, which creates a network like this for you:

```bash run
docker rm -f devforge-cache > /dev/null
docker network rm devforge-net
```

```text output
devforge-net
```

### 2. Describe the application

A tiny API that counts visits in Redis, finding it by the name in `REDIS_HOST`:

```bash run
mkdir -p compose-lab && cd compose-lab
cat > server.js <<'EOF'
// A tiny API: counts visits in Redis, which it reaches by the service name in REDIS_HOST.
const http = require("node:http");
const net = require("node:net");
function incr(key) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(6379, process.env.REDIS_HOST, () => socket.write(`INCR ${key}\r\n`));
    socket.once("data", (d) => { socket.end(); resolve(Number(String(d).slice(1))); });
    socket.once("error", reject);
  });
}
http.createServer(async (req, res) => {
  try { res.end(`visit number ${await incr("visits")}\n`); }
  catch (e) { res.statusCode = 503; res.end(`cache unavailable (${e.code})\n`); }
}).listen(3000);
EOF
cat > compose.yaml <<'EOF'
services:
  cache:
    image: redis:7.4-alpine
    volumes:
      - cache-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 3s
      retries: 30
  api:
    image: node:22-alpine
    command: ["node", "/app/server.js"]
    init: true
    volumes:
      - ./server.js:/app/server.js:ro
    environment:
      REDIS_HOST: cache
    ports:
      - "127.0.0.1:8096:3000"
    depends_on:
      cache:
        condition: service_healthy
volumes:
  cache-data:
EOF
docker compose -p devforge-lab config --services
```

```text output
cache
api
```

- `cache` stores its data in the named volume `cache-data`; its health check is `redis-cli ping`.
- `api` mounts the script read-only (as in the volumes lesson), finds Redis at `cache`, and is published only on `127.0.0.1`. `init: true` runs a small init process in front of Node.js so the container stops promptly when asked.
- `docker compose config` checks the file and prints the merged result; `--services` lists just the service names.

### 3. Start it with one command

```bash run
docker compose -p devforge-lab up -d --wait > up.log 2>&1
docker compose -p devforge-lab ps --format '{{.Service}}: {{.State}} {{.Health}}' | sed 's/ *$//'
docker network ls --filter name=devforge-lab --format '{{.Name}}'
docker volume ls --filter name=devforge-lab --format '{{.Name}}'
```

```text output
api: running
cache: running healthy
devforge-lab_default
devforge-lab_cache-data
```

Compose created a network and a volume, both prefixed with the project name, started `cache`, waited for its health check, and only then started `api`. (`up.log` holds Compose's progress output.)

```bash run
for i in 1 2 3; do curl -s http://127.0.0.1:8096/; done
```

```text output
visit number 1
visit number 2
visit number 3
```

### 4. When a dependency stops

```bash run
docker compose -p devforge-lab stop cache > /dev/null 2>&1
curl -s -w 'HTTP %{http_code}\n' http://127.0.0.1:8096/
```

```text output
cache unavailable (…)
HTTP 503
```

`depends_on` only controls *startup*. Once running, services fail independently: the API is still up, but the name `cache` no longer resolves, so it answers `503 Service Unavailable` instead of crashing. (The exact error code depends on the machine's DNS setup.) Bring the cache back:

```bash run
docker compose -p devforge-lab up -d --wait cache > /dev/null 2>&1
curl -s http://127.0.0.1:8096/
```

```text output
visit number 4
```

The API recovered without a restart, and the count continued: stopping a container does not delete its data.

### 5. down keeps volumes; down -v deletes them

```bash run
docker compose -p devforge-lab down > down.log 2>&1
docker compose -p devforge-lab ps --all --format '{{.Service}}' | wc -l | tr -d ' '
docker compose -p devforge-lab up -d --wait > up.log 2>&1
curl -s http://127.0.0.1:8096/
```

```text output
0
visit number 5
```

`down` removed both containers and the network — but not the named volume, so the new Redis container found the old count. Now remove everything, including the data:

```bash run
docker compose -p devforge-lab down -v > down.log 2>&1
echo "volumes left: $(docker volume ls --filter name=devforge-lab --format '{{.Name}}' | wc -l | tr -d ' ')"
```

```text output
volumes left: 0
```

## Common mistakes

- **Using `localhost` to reach another container.** Inside a container, `localhost` is that container itself; use the service name (`cache`).
- **`depends_on` without a condition.** It only orders container creation; the dependency may not accept connections yet. Add a health check and `condition: service_healthy`.
- **Assuming `depends_on` keeps things working.** It does nothing after startup; every service must handle its dependencies failing, as the API here does with `503`.
- **`down -v` by habit.** It deletes named volumes — for a database, that is the data.
- **Publishing every port on all interfaces.** Services talk over the project network; publish only what you need, and on `127.0.0.1` during development.

## Where this fits in a real system

Compose files are how many teams run an application and its **PostgreSQL** and **Redis** dependencies on a laptop and in CI; DevForge's own `deploy/docker-compose.yml` is one. In production, **Kubernetes** takes over the same ideas — Services give stable names, readiness probes replace health-check conditions, and persistent volume claims replace named volumes — and **GitHub Actions** workflows often use Compose to start test dependencies.
