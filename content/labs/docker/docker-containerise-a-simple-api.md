---
id: docker-containerise-a-simple-api
title: Containerise a simple API
track: docker
level: beginner
mode: local
estimated_minutes: 30
prerequisites: [docker-dockerfile-layers-and-cache]
objectives:
  - Write a Dockerfile for a small Node.js API, with a pinned base image, a .dockerignore and a non-root user.
  - Build the image, run it with a published port, and call the API from your machine.
  - Read the container's logs and stop it cleanly, so it exits with code 0.
checkpoints:
  - { id: built, text: "docker build produced the image courses-api:1, and docker image inspect showed port 3000 and the user node" }
  - { id: called, text: "curl reached the API in the container at 127.0.0.1:3100 and got the list of courses" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Dockerfile reference
    url: https://docs.docker.com/reference/dockerfile/
    publisher: Docker documentation
    type: reference
    level: beginner
    official: true
    why: Every instruction (FROM, COPY, RUN, CMD …) and the .dockerignore file.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Building best practices
    url: https://docs.docker.com/build/building/best-practices/
    publisher: Docker documentation
    type: documentation
    level: intermediate
    official: true
    why: Tags are mutable, pinning to a digest guarantees the same image, and processes should run as a non-root user.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker container stop
    url: https://docs.docker.com/reference/cli/docker/container/stop/
    publisher: Docker documentation
    type: reference
    level: intermediate
    official: true
    why: The main process receives SIGTERM and, after a grace period, SIGKILL.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Docker and the node:22.23.5-alpine image pinned by digest, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

You have a small API that runs on your laptop with `node server.js`. Package it as an image that runs the same way on any machine with Docker: write the Dockerfile, build the image, run it, call it, read its logs and stop it cleanly — then prove it with a check script.

## Before you start

You need Docker, as in *Writing a Dockerfile*. The lab pulls `node:22.23.5-alpine` (about 50 MB) on the first build and publishes the API on port 3100 of your machine; if something else uses that port, pick another and change it everywhere below. It works the same on Linux, macOS and Windows (in a WSL or Git Bash terminal).

## Steps

### 1. The API

The API uses only Node.js's standard library, so there are no packages to install. It reads its port from the `PORT` environment variable and stops cleanly when it receives `SIGTERM`, the signal `docker stop` sends.

```bash run
mkdir api-lab && cd api-lab
cat > server.js <<'EOF'
const http = require("node:http");
const courses = [
  { code: "CS101", title: "Programming basics" },
  { code: "DB201", title: "Databases" },
];
const server = http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { status: "ok" });
  if (req.method === "GET" && req.url === "/courses") return send(200, courses);
  send(404, { error: "not found" });
});
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`courses API listening on port ${port}`));
process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing");
  server.close(() => process.exit(0));
});
EOF
cat > package.json <<'EOF'
{ "name": "courses-api", "version": "1.0.0", "private": true, "scripts": { "start": "node server.js" } }
EOF
ls
```

```text output
package.json
server.js
```

### 2. The Dockerfile and .dockerignore

```bash run
cat > Dockerfile <<'EOF'
# The tag says which version; the digest guarantees the exact image, even if the tag is moved.
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY package.json server.js ./
ENV PORT=3000
EXPOSE 3000
# The official Node images include an unprivileged user called node.
USER node
CMD ["node", "server.js"]
EOF
cat > .dockerignore <<'EOF'
node_modules
.git
.env
*.log
EOF
echo "Dockerfile: $(grep -c . Dockerfile) lines"
```

```text output
Dockerfile: 9 lines
```

- `FROM … @sha256:…` pins the base image. A tag like `node:22-alpine` moves when a new version is published; a digest never does.
- `COPY package.json server.js ./` copies only what the API needs, and `.dockerignore` keeps secrets (`.env`), Git history and logs out of the build even if someone later writes `COPY . .`.
- `EXPOSE 3000` documents the port; it does not publish it. Publishing happens with `-p` when you run the container.
- `USER node` runs the API as an unprivileged user, not as root.
- `CMD ["node", "server.js"]` (the *exec form*) makes `node` the container's main process, so it receives `SIGTERM` directly. Starting it through `npm start` would put npm in between.

### 3. Build and inspect the image

```bash run
docker build -q -t courses-api:1 . > build.log 2>&1 || { cat build.log; exit 1; }
docker image inspect courses-api:1 --format 'user: {{.Config.User}}, ports: {{range $p, $_ := .Config.ExposedPorts}}{{$p}} {{end}}'
docker image inspect courses-api:1 --format 'command: {{json .Config.Cmd}}'
```

```text output
user: node, ports: 3000/tcp
command: ["node","server.js"]
```

### 4. Run it and call it

`-p 127.0.0.1:3100:3000` publishes the container's port 3000 on port 3100 of your machine, reachable only from your machine. The loop waits until the API answers instead of guessing how long it takes to start.

```bash run
docker run -d --name devforge-courses-api -p 127.0.0.1:3100:3000 courses-api:1 > /dev/null
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3100/health > /dev/null && break; sleep 0.5; done
curl -s http://127.0.0.1:3100/health; echo
curl -s http://127.0.0.1:3100/courses; echo
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/nothing-here
docker logs devforge-courses-api
```

```text output
{"status":"ok"}
[{"code":"CS101","title":"Programming basics"},{"code":"DB201","title":"Databases"}]
404
courses API listening on port 3000
```

The API inside the container still listens on port 3000 — it does not know about 3100. `docker logs` shows what the main process wrote to its standard output.

## Check your work

Run this inside `api-lab` while the container is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "the Dockerfile pins its base image by digest" 'grep -Eq "^FROM [^ ]+@sha256:[0-9a-f]{64}" Dockerfile'
check ".dockerignore keeps .env out of the build" 'grep -qx "\.env" .dockerignore'
check "the image courses-api:1 runs as a non-root user" 'u=$(docker image inspect courses-api:1 --format "{{.Config.User}}"); [ -n "$u" ] && [ "${u%%:*}" != root ] && [ "${u%%:*}" != 0 ]'
check "the container devforge-courses-api runs courses-api:1" '[ "$(docker inspect -f "{{.Config.Image}} {{.State.Running}}" devforge-courses-api)" = "courses-api:1 true" ]'
check "GET http://127.0.0.1:3100/health answers ok" '[ "$(curl -s http://127.0.0.1:3100/health)" = "{\"status\":\"ok\"}" ]'
check "GET /courses lists CS101" 'curl -s http://127.0.0.1:3100/courses | grep "CS101"'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the Dockerfile pins its base image by digest
PASS: .dockerignore keeps .env out of the build
PASS: the image courses-api:1 runs as a non-root user
PASS: the container devforge-courses-api runs courses-api:1
PASS: GET http://127.0.0.1:3100/health answers ok
PASS: GET /courses lists CS101
All checks passed
```

## Stop it cleanly and clean up

`docker stop` sends `SIGTERM`, waits (10 seconds by default) and then sends `SIGKILL`. Because the API handles `SIGTERM`, it closes at once and exits with code 0 — a killed process would exit with 137.

```bash run
docker stop devforge-courses-api > /dev/null
docker inspect -f 'exit code: {{.State.ExitCode}}' devforge-courses-api
docker logs devforge-courses-api
```

```text output
exit code: 0
courses API listening on port 3000
SIGTERM received, closing
```

Then remove the container and the image:

```bash run
docker rm devforge-courses-api > /dev/null
docker rmi courses-api:1 > /dev/null
echo "removed"
```

```text output
removed
```

## Reset

- **The name is already in use?** A container from an earlier attempt still exists: `docker rm -f devforge-courses-api`.
- **Start the whole lab again:** remove the container and the image (as above), leave the folder and delete it — `cd .. && rm -rf api-lab` — then begin at step 1.

## What you practised

Containerising an API means writing down everything it needs to run: a pinned base image, only the files it needs, the port it listens on, an unprivileged user and a command that receives signals. Then the same image runs the same way on every machine — and `inspect`, `logs` and the exit code let you check it instead of assuming.
