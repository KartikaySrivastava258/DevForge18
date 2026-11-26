---
id: docker-optimise-an-oversized-image
title: Optimise a slow, oversized image
track: docker
level: advanced
mode: local
estimated_minutes: 35
prerequisites: [docker-dockerfile-layers-and-cache]
objectives:
  - Find out why an image is large by reading its layers with docker history.
  - Use a multi-stage build so the compiler stays in the build stage and only the program ships.
  - Run the final image as a non-root user, with no shell inside, and verify both.
checkpoints:
  - { id: history, text: "docker history showed which layer made the first image large" }
  - { id: sizes, text: "The multi-stage image was under 1 MB, against more than 100 MB before" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Multi-stage builds
    url: https://docs.docker.com/build/building/multi-stage/
    publisher: Docker documentation
    type: documentation
    level: intermediate
    official: true
    why: Several FROM stages in one Dockerfile, and copying artefacts between them with COPY --from.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Building best practices
    url: https://docs.docker.com/build/building/best-practices/
    publisher: Docker documentation
    type: documentation
    level: intermediate
    official: true
    why: Choosing a minimal base, multi-stage builds, and running as a non-root user.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Docker, and their output is compared with this page. Image sizes depend on the current Alpine packages, so exact sizes are shown as … and the lab compares them against limits instead. The check script is also run in an empty folder, where it must fail.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

A tiny C program ships in an image of over 200 MB, because the image still contains the compiler that built it. You find the culprit layer, rebuild with a **multi-stage** Dockerfile so that only the program ships, make it run as a non-root user, and prove the result with a check script.

## Before you start

You need Docker, as in *Dockerfiles, layers and the build cache*. The lab pulls `alpine:3.20` and downloads Alpine's compiler packages (about 200 MB) on the first build.

## Steps

### 1. The program and a naive image

```bash run
mkdir image-lab && cd image-lab
cat > timetable.c <<'EOF'
#include <stdio.h>
int main(void) { printf("Timetable service ready\n"); return 0; }
EOF
cat > Dockerfile.naive <<'EOF'
FROM alpine:3.20
RUN apk add --no-cache build-base
WORKDIR /src
COPY . .
RUN gcc -O2 -o /usr/local/bin/timetable timetable.c
CMD ["timetable"]
EOF
build() { docker build -q "$@" > build.log 2>&1 || { cat build.log; return 1; }; }
build -f Dockerfile.naive -t timetable:naive .
docker run --rm timetable:naive
docker image ls timetable:naive --format '{{.Repository}}:{{.Tag}} {{.Size}}'
```

```text output
Timetable service ready
timetable:naive …MB
```

A one-line program in an image of over 200 MB. Every image built `FROM` this one, and every server that runs it, carries all of that.

### 2. Find the culprit

`docker history` lists an image's layers, newest first, with the size each one added. Run it and read the `SIZE` column:

```bash
docker history timetable:naive
```

(How the `CREATED BY` column is written depends on your Docker version and builder.) To compare the two layers that matter:

```bash run
layer() { docker history timetable:naive --format '{{.Size}}|{{.CreatedBy}}' | grep "$1" | cut -d'|' -f1; }
echo "apk add build-base layer: $(layer 'apk add')"
echo "gcc layer (the program):  $(layer 'gcc -O2')"
```

```text output
apk add build-base layer: …MB
gcc layer (the program):  …kB
```

The `apk add … build-base` layer — the C compiler, linker and headers — is nearly the whole image. The program needs none of it at run time. Removing the packages in a *later* layer would not help: earlier layers stay in the image.

### 3. A multi-stage build

```bash run
cat > Dockerfile <<'EOF'
# Stage 1: everything needed to build.
FROM alpine:3.20 AS build
RUN apk add --no-cache build-base
WORKDIR /src
COPY timetable.c .
RUN gcc -O2 -static -o /timetable timetable.c

# Stage 2: only what is needed to run.
FROM scratch
COPY --from=build /timetable /timetable
USER 65534:65534
ENTRYPOINT ["/timetable"]
EOF
build -t timetable:slim .
docker run --rm timetable:slim
docker image ls timetable --format '{{.Repository}}:{{.Tag}} {{.Size}}' | sort
```

```text output
Timetable service ready
timetable:naive …MB
timetable:slim …kB
```

- The first stage still installs the compiler — but it is a **build stage**. Only the last stage becomes the image.
- `COPY --from=build` copies just the compiled program across.
- `scratch` is Docker's empty image: no shell, no package manager, nothing. The program is linked with `-static` so it needs no libraries from the system.
- `COPY timetable.c .` instead of `COPY . .` — the build no longer depends on unrelated files in the folder, so editing a Dockerfile or a README does not invalidate the cache.
- `USER 65534:65534` runs the program as an unprivileged user (often called *nobody*), not as root.

### 4. Verify, do not assume

```bash run
docker image inspect timetable:slim --format 'user: {{.Config.User}}'
size_naive=$(docker image inspect timetable:naive --format '{{.Size}}')
size_slim=$(docker image inspect timetable:slim --format '{{.Size}}')
echo "naive is over 100 MB: $([ "$size_naive" -gt 100000000 ] && echo yes || echo no)"
echo "slim is under 1 MB:   $([ "$size_slim" -lt 1000000 ] && echo yes || echo no)"
docker run --rm --entrypoint /bin/sh timetable:slim -c 'echo a shell' > /dev/null 2>&1 && echo "has a shell" || echo "no shell in the image"
```

```text output
user: 65534:65534
naive is over 100 MB: yes
slim is under 1 MB:   yes
no shell in the image
```

No shell also means an attacker who breaks into the program has very little to work with — and that you cannot `docker exec` a shell into it for debugging. Teams that need debugging tools often use a minimal base such as Alpine or a "distroless" image instead of `scratch`.

## Check your work

Run this inside `image-lab` before you clean up.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "the Dockerfile has a build stage and a final stage" '[ "$(grep -c "^FROM " Dockerfile)" -ge 2 ] && grep -q "COPY --from=" Dockerfile'
check "timetable:slim runs and prints its message" '[ "$(docker run --rm timetable:slim)" = "Timetable service ready" ]'
check "timetable:slim is under 1 MB" '[ "$(docker image inspect timetable:slim --format "{{.Size}}")" -lt 1000000 ]'
check "timetable:slim does not run as root" 'u=$(docker image inspect timetable:slim --format "{{.Config.User}}"); [ -n "$u" ] && [ "${u%%:*}" != 0 ] && [ "${u%%:*}" != root ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the Dockerfile has a build stage and a final stage
PASS: timetable:slim runs and prints its message
PASS: timetable:slim is under 1 MB
PASS: timetable:slim does not run as root
All checks passed
```

## Clean up

```bash run
docker rmi -f timetable:naive timetable:slim > /dev/null
```

## Reset

Remove the images (as above), leave the folder and delete it — `cd .. && rm -rf image-lab` — then begin again at step 1.

## What you practised

An image carries every layer of its history, so tools used only to *build* belong in a build stage. Multi-stage builds, a minimal final base and a non-root user make images smaller, faster to pull and harder to attack — and `docker history` and `docker image inspect` let you check rather than hope.
