---
id: docker-health-logs-and-limits
title: Health checks, logs, limits and stopping cleanly
track: docker
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [docker-networks-and-compose]
learning_objectives:
  - Add a health check to a container, watch it go from starting to healthy to unhealthy, and explain what Docker does (and does not do) about an unhealthy container.
  - Read a container's logs, and cap their size with log rotation.
  - Set a memory limit, recognise an out-of-memory kill (OOMKilled, exit code 137), and use a restart policy for programs that crash.
  - Make a container stop promptly and cleanly by handling SIGTERM, or with --init.
resources:
  - title: Dockerfile reference — HEALTHCHECK
    url: https://docs.docker.com/reference/dockerfile/
    publisher: Docker Inc.
    type: reference
    level: intermediate
    official: true
    why: Health status starts as starting, becomes healthy when a check passes, and unhealthy after retries consecutive failures.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker container run
    url: https://docs.docker.com/reference/cli/docker/container/run/
    publisher: Docker Inc.
    type: reference
    level: intermediate
    official: true
    why: The --health-*, --memory, --restart and --init options (--init runs an init process that forwards signals and reaps processes).
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Resource constraints
    url: https://docs.docker.com/engine/containers/resource_constraints/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Memory and CPU limits, and what happens when a container runs out of memory.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Start containers automatically (restart policies)
    url: https://docs.docker.com/engine/containers/start-containers-automatically/
    publisher: Docker Inc.
    type: documentation
    level: beginner
    official: true
    why: no, on-failure[:max-retries], always and unless-stopped; on-failure restarts only after a non-zero exit code.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: JSON File logging driver
    url: https://docs.docker.com/engine/logging/drivers/json-file/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: The max-size and max-file options that rotate container logs.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker container stop
    url: https://docs.docker.com/reference/cli/docker/container/stop/
    publisher: Docker Inc.
    type: reference
    level: beginner
    official: true
    why: The main process receives SIGTERM and, after a grace period, SIGKILL.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: unhealthy
    prompt: A container started with plain docker run becomes unhealthy. What does Docker do about it?
    options:
      - { id: a, text: "Restarts it immediately" }
      - { id: b, text: "Reports it — in docker ps and docker inspect — but keeps it running; acting on it is up to an orchestrator or a person" }
      - { id: c, text: "Deletes it" }
    answer: b
    explanation: In the lab the container stays "Up … (unhealthy)". Orchestrators use health to act — Compose's service_healthy condition, or Kubernetes probes, which do restart containers.
  - id: oom
    prompt: A container exits with code 137 and docker inspect shows OOMKilled=true. What happened?
    options:
      - { id: a, text: "The program called exit(137)" }
      - { id: b, text: "It used more memory than its --memory limit, and the kernel killed it with SIGKILL (128 + 9 = 137)" }
      - { id: c, text: "The image was too large" }
    answer: b
    explanation: Exit codes above 128 mean "killed by signal (code − 128)". OOMKilled tells you the signal came from the memory limit. Fix the memory use or raise the limit deliberately.
  - id: sigterm
    prompt: docker stop takes the whole grace period and the exit code is 137. What does that tell you?
    options:
      - { id: a, text: "The stop worked normally" }
      - { id: b, text: "The main process ignored SIGTERM, so Docker had to kill it with SIGKILL — it had no chance to finish requests or clean up" }
      - { id: c, text: "The container ran out of memory" }
    answer: b
    explanation: 'A program running as PID 1 in a container does not get the default "terminate on SIGTERM" behaviour. Handle SIGTERM in the program, or run it with --init (init: true in Compose).'
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, after the previous lessons, and its output is compared with this lesson. First run locally with node:22-alpine and alpine:3.20 on 2026-11-26. Health status, restart policies, log rotation options and docker stop's SIGTERM-then-SIGKILL sequence were checked against the Docker documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-27
content_version: 2
---

## The idea in one sentence

A running container needs more than `docker run`: a **health check** says whether it actually works, **logs** say what it did, **limits** stop it from taking the whole machine, a **restart policy** brings it back after a crash, and **handling SIGTERM** lets it stop without dropping work.

## Explain it like I'm twelve

A school bus company checks each bus every morning (health check), keeps a logbook of every trip but throws out old pages (logs with rotation), never lets a bus carry more than its seats (limits), sends a bus back out if it stalls (restart policy) — and when the day ends, tells drivers "finish your route, then park", instead of pulling the keys out mid-journey (SIGTERM, then SIGKILL).

Where the analogy breaks: Docker *notices* an unhealthy container but, on its own, does not fix it.

## What problem it solves

"The container is running" does not mean the application works: a web server can be stuck while its process is still alive. Without limits, one leaking container can make the whole host run out of memory; without log rotation, logs can fill the disk; and a program that ignores the stop signal is killed mid-request at every deployment. These settings turn a container from "it started" into something you can operate.

## How it works

![](media:docker/operations.svg)

- `--health-cmd` (or `HEALTHCHECK` in a Dockerfile) runs a command inside the container every `--health-interval`. Status starts as `starting`, becomes `healthy` when a check passes, and `unhealthy` after `--health-retries` failures in a row.
- `docker logs` shows what the main process wrote to stdout and stderr. With the `json-file` driver, `max-size` and `max-file` rotate the log files.
- `--memory 64m` caps memory. If the container goes over, the kernel kills a process in it; `docker inspect` then shows `OOMKilled=true`, and exit code `137` (128 + signal 9).
- `--restart on-failure:3` restarts a container that exits with a non-zero code, at most three times.
- `docker stop` sends `SIGTERM`, waits for a grace period, then sends `SIGKILL`. A program that is PID 1 in its container must handle `SIGTERM` itself, or run behind a small init process (`--init`).

## Try it yourself

> **Local lab** — needs Docker and `curl`. The web app is published on `127.0.0.1:8097`. Every command is run automatically in DevForge's tests, and the last step removes everything you create.

### 1. A web app with a health endpoint

```bash run
mkdir -p ops-lab && cd ops-lab
cat > app.js <<'EOF'
// A small web app: /health answers 200 until /break is called, then 500.
const http = require("node:http");
let healthy = true;
const server = http.createServer((req, res) => {
  if (req.url === "/break") { healthy = false; console.log("health check will now fail"); return res.end("broken\n"); }
  if (req.url === "/health") { res.statusCode = healthy ? 200 : 500; return res.end(healthy ? "ok\n" : "not ok\n"); }
  console.log(`request ${req.url}`);
  res.end("hello\n");
});
server.listen(8080, () => console.log("listening on 8080"));
// docker stop sends SIGTERM: stop accepting connections, finish open ones, then exit.
process.on("SIGTERM", () => { console.log("SIGTERM received: closing"); server.close(() => process.exit(0)); });
EOF
docker run -d --name devforge-web -p 127.0.0.1:8097:8080 -v "$PWD/app.js":/app.js:ro \
  --memory 64m --log-driver json-file --log-opt max-size=1m --log-opt max-file=3 \
  --health-cmd 'wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1' \
  --health-interval 1s --health-timeout 2s --health-retries 2 \
  node:22-alpine node /app.js > /dev/null
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' devforge-web)" = healthy ] && break; sleep 0.5; done
docker inspect -f '{{.State.Health.Status}}' devforge-web
curl -s http://127.0.0.1:8097/timetable
```

```text output
healthy
hello
```

- The health check runs `wget` *inside* the container every second; exit code `0` means healthy. (The status was `starting` until the first check passed.)
- The same container also has a 64 MB memory limit and rotating logs — more on both below.

### 2. Running, but not healthy

```bash run
curl -s http://127.0.0.1:8097/break
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' devforge-web)" = unhealthy ] && break; sleep 0.5; done
docker inspect -f 'health: {{.State.Health.Status}}, state: {{.State.Status}}' devforge-web
docker ps --filter name=devforge-web --format '{{.Names}} {{.Status}}'
```

```text output
broken
health: unhealthy, state: running
devforge-web Up … (unhealthy)
```

After two failed checks in a row the container is **unhealthy** — and still running. Plain Docker only *reports* health. Compose uses it to order startup (previous lesson), and Kubernetes probes go further and restart containers or stop sending them traffic.

### 3. Logs, rotation and memory use

```bash run
docker logs devforge-web
docker inspect -f '{{.HostConfig.LogConfig.Type}} {{.HostConfig.LogConfig.Config}}' devforge-web
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' devforge-web
```

```text output
listening on 8080
request /timetable
health check will now fail
json-file map[max-file:3 max-size:1m]
devforge-web … / 64MiB
```

- `docker logs` shows everything the app printed. Add `--tail 20` or `--since 10m` to narrow it, `-f` to follow.
- At most three files of 1 MB each are kept, so this container's logs can never fill the disk.
- `docker stats` shows memory use against the 64 MiB limit.

### 4. Stopping cleanly

```bash run
timed_stop() { local t0 ms; t0=$(date +%s%N); docker stop "$@" > /dev/null; ms=$(( ($(date +%s%N) - t0) / 1000000 )); [ "$ms" -lt 2000 ] && echo "in under 2 s" || echo "after about $(( (ms + 500) / 1000 )) s"; }
echo "app with a SIGTERM handler: stopped $(timed_stop devforge-web), exit code $(docker inspect -f '{{.State.ExitCode}}' devforge-web)"
docker logs --tail 1 devforge-web
```

```text output
app with a SIGTERM handler: stopped in under 2 s, exit code 0
SIGTERM received: closing
```

Now two programs with **no** SIGTERM handler — one plain, one with `--init` — and a 3-second grace period:

```bash run
docker run -d --name devforge-stubborn node:22-alpine node -e 'setInterval(() => {}, 1000)' > /dev/null
docker run -d --name devforge-tidy --init node:22-alpine node -e 'setInterval(() => {}, 1000)' > /dev/null
echo "no handler:          stopped $(timed_stop -t 3 devforge-stubborn), exit code $(docker inspect -f '{{.State.ExitCode}}' devforge-stubborn)"
echo "no handler + --init: stopped $(timed_stop -t 3 devforge-tidy), exit code $(docker inspect -f '{{.State.ExitCode}}' devforge-tidy)"
```

```text output
no handler:          stopped after about 3 s, exit code 137
no handler + --init: stopped in under 2 s, exit code 143
```

- The plain program was PID 1 in its container. Linux does not apply the default "terminate" action to PID 1, so `SIGTERM` did nothing; Docker waited the full grace period and sent `SIGKILL` (137 = 128 + 9). In a real service, every open request would be cut off.
- With `--init`, a small init process is PID 1 and passes `SIGTERM` on; Node.js then exits as the signal's default action says (143 = 128 + 15).
- Best: handle `SIGTERM` yourself, as `app.js` does, so the app finishes its work and exits with `0`.

### 5. Out of memory

```bash run fails
docker run --name devforge-hog --memory 64m --memory-swap 64m node:22-alpine node -e 'const a = []; for (;;) a.push(Buffer.alloc(1 << 20, 1));'
```

```bash run
for i in $(seq 1 20); do [ "$(docker inspect -f '{{.State.OOMKilled}}' devforge-hog)" = true ] && break; sleep 0.5; done
docker inspect -f 'OOMKilled={{.State.OOMKilled}}, exit code {{.State.ExitCode}}' devforge-hog
```

```text output
OOMKilled=…, exit code 137
```

On most runs this prints `OOMKilled=true, exit code 137`. The program kept allocating 1 MB buffers. At 64 MB (`--memory-swap 64m` also rules out swap) the kernel killed it. Without the limit, it would have kept growing until the whole machine ran short. Exit code 137 means the process was ended by `SIGKILL` (128 + 9); `OOMKilled=true` says the kernel's out-of-memory killer sent it. Treat that flag as a helpful hint, not proof either way: Docker sets it only when it receives a separate out-of-memory event (the Docker Engine source sets `OOMKilled` in its handler for that event, and nowhere on exit), and that event can arrive late or not at all. In DevForge's own test runs the flag occasionally stayed `false` even after the loop above waited ten seconds, while the exit code was 137 every time. So when a container with a memory limit dies with 137 and no one ran `docker kill`, assume memory first, and confirm with its memory use (`docker stats`, or your monitoring) before it died.

### 6. Restarting after a crash

```bash run
docker run -d --name devforge-flaky --restart on-failure:3 alpine:3.20 sh -c 'echo "starting"; exit 1' > /dev/null
for i in $(seq 1 40); do [ "$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' devforge-flaky)" = "exited 3" ] && break; sleep 0.5; done
docker inspect -f '{{.State.Status}}, restarted {{.RestartCount}} times, exit code {{.State.ExitCode}}' devforge-flaky
docker logs devforge-flaky | sort | uniq -c
```

```text output
exited, restarted 3 times, exit code 1
      4 starting
```

The first run and three restarts — then Docker gave up, as `on-failure:3` says. A restart policy helps with occasional crashes; it cannot fix a program that always fails, which is why the limit matters.

### 7. Clean up

```bash run
docker rm -f devforge-web devforge-stubborn devforge-tidy devforge-hog devforge-flaky
```

```text output
devforge-web
devforge-stubborn
devforge-tidy
devforge-hog
devforge-flaky
```

## Common mistakes

- **Treating "Up" as "working".** Add a health check that exercises the app (an HTTP request), not just "is the process alive".
- **Expecting Docker to fix unhealthy containers.** It does not by itself; use an orchestrator, or alert on it.
- **Unbounded logs.** The default `json-file` driver keeps everything unless `max-size` is set — per container or in the daemon's configuration.
- **No memory limit, or one copied from somewhere.** Measure normal use (`docker stats`), then set a limit with headroom.
- **Shell-form `CMD`.** `CMD node app.js` runs under `/bin/sh -c`, which does not pass signals on; use the exec form `CMD ["node", "app.js"]`, and handle `SIGTERM`.
- **`--restart always` hiding a crash loop.** Watch the restart count; repeated restarts are an alert, not a fix.

## Where this fits in a real system

**Kubernetes** turns each of these into Pod settings — liveness and readiness probes, resource requests and limits (with the same `OOMKilled` reason), restart policies and a termination grace period. **Prometheus** alerts on restart counts and memory near the limit, and centralised logging collects what `docker logs` shows from every container.
