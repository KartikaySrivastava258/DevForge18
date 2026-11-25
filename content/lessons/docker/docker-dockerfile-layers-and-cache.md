---
id: docker-dockerfile-layers-and-cache
title: Writing a Dockerfile — layers, cache and .dockerignore
track: docker
order: 3
level: beginner
estimated_minutes: 35
prerequisites: [docker-volumes-and-bind-mounts]
learning_objectives:
  - Write a Dockerfile and explain which instructions create image layers.
  - Predict which layers Docker rebuilds after a change, and order instructions so a code change does not redo slow steps.
  - Keep files out of the build with .dockerignore.
resources:
  - title: Docker build cache
    url: https://docs.docker.com/build/cache/
    publisher: Docker Inc.
    type: documentation
    level: beginner
    official: true
    why: How layers are cached, what invalidates the cache, and how to order a Dockerfile for it.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: Dockerfile reference
    url: https://docs.docker.com/reference/dockerfile/
    publisher: Docker Inc.
    type: documentation
    level: intermediate
    official: true
    why: Every instruction (FROM, COPY, RUN, CMD …) and the .dockerignore file.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: invalidate
    prompt: A Dockerfile copies the whole project, then installs dependencies. You change one line of source code. What does the next build do?
    options:
      - { id: a, text: "Reuses every layer" }
      - { id: b, text: "Rebuilds from the COPY of the project onwards — including the slow dependency install" }
      - { id: c, text: "Rebuilds only the base image" }
    answer: b
    explanation: When a layer changes, every layer after it is rebuilt. Copy the dependency list and install first, and copy the source last, so code changes only rebuild the final layers.
  - id: dockerignore
    prompt: What does a .dockerignore file do?
    options:
      - { id: a, text: "Hides files inside the running container" }
      - { id: b, text: "Keeps matching files out of the build context, so they are never sent to the builder or copied into the image" }
      - { id: c, text: "Deletes files from your project" }
    answer: b
    explanation: You see it in the lesson — the secrets file stays on your computer and never reaches the image.
  - id: cmd-layer
    prompt: The lesson's image has five instructions but only four file layers. Why?
    options:
      - { id: a, text: "Docker skipped one instruction" }
      - { id: b, text: "CMD only sets what runs at start; it changes no files, so it adds no file layer" }
      - { id: c, text: "Docker was broken" }
    answer: b
    explanation: The image's file layers come from the base image, COPY and RUN. CMD sets what the container runs at start — you counted 4 file layers with or without it.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine (with alpine:3.20); the output shown was recorded from that run. Layers are compared by their digests rather than by the builder's progress messages, which differ between Docker versions and builders. Facts about the build cache and .dockerignore were checked against Docker's documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

A **Dockerfile** is a recipe for an image: each instruction is a build step, the ones that change files — such as `COPY` and `RUN` — add a **layer** of files, Docker **caches** them and reuses them until something they depend on changes, and from that point on **everything after it is rebuilt** — so the order of instructions decides how fast your builds are.

## Explain it like I'm twelve

Picture a layer cake built in a strict order: sponge, jam, cream, decorations. If you only want new decorations, you keep the sponge, jam and cream and redo the top. But if you change the jam, everything above it — cream and decorations — must be redone too.

Each part is a **layer**, keeping the unchanged ones is the **cache**, and putting the thing you change most often at the top is **ordering the Dockerfile well**.

Where the analogy breaks: Docker decides "changed" exactly — by the instruction and the files it copies — not by taste.

## What problem it solves

Builds run many times a day, on laptops and in CI. A Dockerfile that reinstalls every dependency whenever one line of code changes wastes minutes per build. Ordering for the cache — and keeping secrets and clutter out of the build with `.dockerignore` — makes builds fast, small and safer.

## How it works

```diagram steps=docker/layer-cache
```

- Docker's documentation describes each instruction as a layer of the build. Those that change files — `FROM`'s base image, `COPY`, `RUN` — appear in the image's list of file layers; `CMD` only sets what runs at start, and you will count that it adds no file layer.
- On a rebuild, Docker checks each instruction in order and reuses the cached result while nothing it depends on has changed. For `COPY`, it compares a checksum of the files being copied (a file's modification time alone does not count).
- In the documentation's words: "Once a layer changes, then all downstream layers need to be rebuilt as well."
- So, as the documentation advises, order instructions from less frequently changed to more frequently changed: the base image, the dependency list and their installation first, your source code last.

## Try it yourself

> **Local lab** — needs Docker. Every command is run automatically in DevForge's tests. A `RUN` step with `sleep 2` stands in for a slow dependency installation, so nothing is downloaded except the small `alpine` image.

### 1. A small project and a well-ordered Dockerfile

```bash run
mkdir -p dockerfile-lab/src && cd dockerfile-lab
printf 'flask==3.1.2\nrequests==2.32.5\n' > requirements.txt
echo 'hello from version 1' > src/app.txt
echo 'API_KEY=do-not-ship-me' > secrets.env
cat > Dockerfile <<'EOF'
FROM alpine:3.20
COPY requirements.txt /app/
RUN sleep 2 && sort /app/requirements.txt > /app/installed.txt
COPY src/ /app/src/
CMD ["cat", "/app/src/app.txt"]
EOF
build() { docker build -q -t "$1" . > build.log 2>&1 || { cat build.log; return 1; }; }
layers() { docker image inspect -f '{{range .RootFS.Layers}}{{println .}}{{end}}' "$1" | grep .; }
build cake:v1
layers cake:v1 | wc -l
docker run --rm cake:v1
```

```text output
4
hello from version 1
```

- Four instructions add files — `FROM` (the base image's one layer), `COPY requirements.txt`, `RUN` and `COPY src/` — and the image lists 4 file layers. `CMD` adds none.
- `build` keeps the builder's progress messages in `build.log` and shows them only if the build fails; `layers` lists the image's layer digests, one per line. Define both again in a new terminal.

### 2. Change the code: only the last layer is rebuilt

```bash run
echo 'hello from version 2' > src/app.txt
build cake:v2
paste <(layers cake:v1) <(layers cake:v2) | awk '{ print "layer " NR ": " ($1 == $2 ? "reused" : "rebuilt") }'
docker run --rm cake:v2
```

```text output
layer 1: reused
layer 2: reused
layer 3: reused
layer 4: rebuilt
hello from version 2
```

The source code is copied last, so only layer 4 changed. Layers 1–3 — including the slow `RUN` — came straight from the cache.

### 3. The same project, badly ordered

```bash run
cat > Dockerfile.slow <<'EOF'
FROM alpine:3.20
COPY . /app/
RUN sleep 2 && sort /app/requirements.txt > /app/installed.txt
CMD ["cat", "/app/src/app.txt"]
EOF
docker build -q -f Dockerfile.slow -t slow:v1 . > build.log 2>&1
echo 'hello from version 3' > src/app.txt
docker build -q -f Dockerfile.slow -t slow:v2 . > build.log 2>&1
paste <(layers slow:v1) <(layers slow:v2) | awk '{ print "layer " NR ": " ($1 == $2 ? "reused" : "rebuilt") }'
docker run --rm slow:v2 cat /app/secrets.env
```

```text output
layer 1: reused
layer 2: rebuilt
layer 3: rebuilt
API_KEY=do-not-ship-me
```

- `COPY . /app/` copies everything, so a one-line code change changes layer 2 — and layer 3, the slow install, must run again.
- Worse: `COPY .` also copied `secrets.env` into the image. Anyone who gets the image can read it.

### 4. Keep files out with .dockerignore

```bash run
printf 'secrets.env\nbuild.log\nDockerfile*\n' > .dockerignore
docker build -q -f Dockerfile.slow -t slow:v3 . > build.log 2>&1
docker run --rm slow:v3 ls /app
docker rmi -f cake:v1 cake:v2 slow:v1 slow:v2 slow:v3 > /dev/null
```

```text output
installed.txt
requirements.txt
src
```

- `.dockerignore` lists files the builder never receives. `secrets.env` is gone from the image — and so are `build.log` and the Dockerfiles, which the app does not need.
- The last line removes the lab's images.

## Try it in the simulation

Reorder a Dockerfile, switch steps on and off, edit the code or the dependency list, and rebuild — every step shows whether it was reused or rebuilt. It is a labelled teaching model with invented times and sizes, not Docker itself.

```simulation docker-layer-cache scenario=bad-order
```

## Common mistakes

- **`COPY . .` before installing dependencies.** Every code change reinstalls everything. Copy the dependency list first, install, then copy the code.
- **No `.dockerignore`.** Secrets, `.git`, `node_modules` and logs end up in the build context — slower builds and leaked files.
- **Moving tags such as `latest` for the base image.** Pin a version (and, for production, a digest) so builds are reproducible.

## Where this fits in a real system

**GitHub Actions** and **Jenkins** build images on every change; good layer order and a shared build cache keep those builds fast. The image then runs on **Kubernetes** or with Compose, and a small image with no secrets is faster to pull and safer to run.
