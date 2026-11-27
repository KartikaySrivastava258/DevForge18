---
id: docker-image-and-container-security
title: Image and container security
track: docker
order: 6
level: advanced
estimated_minutes: 45
prerequisites: [docker-health-logs-and-limits]
learning_objectives:
  - Show that containers run as root unless told otherwise, and run them as an unprivileged user with USER or --user.
  - Reduce what a compromised container can do with a read-only filesystem, dropped capabilities and no-new-privileges.
  - Recover a "deleted" secret and an ENV password from an image, and explain why secrets must never be built into images.
  - Give a container its secret at run time instead, as a read-only file.
resources:
  - title: Docker Engine security
    url: https://docs.docker.com/engine/security/
    publisher: Docker Inc.
    type: documentation
    level: advanced
    official: true
    why: Namespaces, control groups, Linux capabilities and the recommendation to run processes as non-root users.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker container run (--user, --read-only, --cap-drop, --security-opt)
    url: https://docs.docker.com/reference/cli/docker/container/run/
    publisher: Docker Inc.
    type: reference
    level: intermediate
    official: true
    why: The options used in this lesson to harden a container at run time.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Build secrets
    url: https://docs.docker.com/build/building/secrets/
    publisher: Docker Inc.
    type: documentation
    level: advanced
    official: true
    why: Why build arguments and environment variables are unsafe for secrets, and how RUN --mount=type=secret passes one to a single build step without storing it.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: OWASP Docker Security Cheat Sheet
    url: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
    publisher: OWASP
    type: article
    level: intermediate
    official: false
    why: A checklist of the same rules — non-root users, capabilities, no-new-privileges, read-only filesystems, and keeping secrets out of images.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: deleted-secret
    prompt: "A Dockerfile has COPY . . and then RUN rm -f .env. Is the .env file gone from the image?"
    options:
      - { id: a, text: "Yes, rm deleted it" }
      - { id: b, text: "No: it is still stored in the layer made by COPY; the later layer only hides it. Anyone with the image can extract it" }
      - { id: c, text: "Only if the image is pushed to a registry" }
    answer: b
    explanation: Layers are added, never edited. Keep secrets out of the build context with .dockerignore, and give them to the container at run time.
  - id: root
    prompt: Why run a container's process as a non-root user when it is "isolated" anyway?
    options:
      - { id: a, text: "It is faster" }
      - { id: b, text: "If an attacker takes over the process, root inside the container can change anything in the image's files and is one kernel bug or misconfiguration away from root on the host" }
      - { id: c, text: "Docker refuses root" }
    answer: b
    explanation: Isolation is a layer of defence, not a guarantee. Least privilege limits the damage of every other mistake.
  - id: env-secret
    prompt: A Dockerfile contains ENV DB_PASSWORD=…. Who can read the password?
    options:
      - { id: a, text: "Only the application" }
      - { id: b, text: "Anyone who can pull or inspect the image — docker image inspect shows it — and every process in every container made from it" }
      - { id: c, text: "Nobody: ENV values are encrypted" }
    answer: b
    explanation: ENV is part of the image's configuration. Pass secrets at run time, and prefer files (/run/secrets/…) over environment variables, which leak into logs, crash reports and child processes more easily.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, after the previous lessons, and its output is compared with this lesson. The commands avoid builder-specific output, so they behave the same with the classic builder and BuildKit. The build-secret mount in "Common mistakes" is described from the Docker documentation, not executed. Checked on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 2
---

## The idea in one sentence

A container is only as safe as what it is allowed to do and what its image contains: run it as a **non-root** user with **as few privileges as possible**, and never put **secrets** in an image, because image layers keep everything that was ever copied into them.

## Explain it like I'm twelve

A substitute teacher gets a key to one classroom, not the master key to the whole school — if the key is lost, only one room is at risk. And you never write the safe's combination on the classroom whiteboard and then rub it out: the whiteboard is photographed every time anything changes, and the old photos are kept.

The single key is **least privilege**; the photos are **image layers**.

Where the analogy breaks: anyone who gets a copy of the image gets every "photo" with it.

## What problem it solves

Application bugs happen. When an attacker exploits one inside a container, the container's settings decide how bad it gets: whether they are root, whether they can change files, which kernel features they can use. And images are copied widely — to registries, laptops and CI caches — so a secret built into one is effectively published. These two habits close two of the most common gaps.

## How it works

![](media:docker/security.svg)

- Images run as **root** unless the Dockerfile says `USER` or you pass `--user`. Many official images, such as `node`, include an unprivileged user (`node`, uid 1000) for this purpose.
- `--read-only` makes the container's root filesystem read-only; `--tmpfs /tmp` adds a small writable, in-memory folder where the app needs one.
- Root in a container holds a set of Linux **capabilities** (such as `CHOWN`). `--cap-drop ALL` removes them; `--security-opt no-new-privileges` stops a process from gaining privileges later (for example through a setuid program).
- Every `COPY`, `ADD` and `RUN` adds a **layer**. Deleting a file in a later layer hides it but does not remove it from the earlier one. `ENV` values are stored in the image's configuration.

## Try it yourself

> **Local lab** — needs Docker. The "secrets" here are made up for this lesson. Every command is run automatically in DevForge's tests, and the last step removes everything you create.

### 1. Who are you inside a container?

```bash run
docker run --rm node:22-alpine sh -c 'echo "default: $(id -un), uid $(id -u)"'
docker run --rm --user node node:22-alpine sh -c 'echo "--user node: $(id -un), uid $(id -u)"'
```

```text output
default: root, uid 0
--user node: node, uid 1000
```

```bash run fails
docker run --rm --user node node:22-alpine sh -c 'echo changed > /etc/motd'
```

```text output
sh: can't create /etc/motd: Permission denied
```

As root, the same command would have changed a system file. As `node`, it cannot — and neither could an attacker who took over the process.

### 2. Take away what the process does not need

A read-only root filesystem, with one writable in-memory folder:

```bash run fails
docker run --rm --read-only --tmpfs /tmp alpine:3.20 sh -c 'exec 2>&1; echo note > /tmp/scratch && cat /tmp/scratch; echo changed > /etc/motd'
```

```text output
note
sh: can't create /etc/motd: Read-only file system
```

(`exec 2>&1` sends the shell's errors to the same stream as its output, so they appear in the order they happened.)

Capabilities — here `CHOWN`, which lets root give files to another user:

```bash run
docker run --rm alpine:3.20 sh -c 'touch /tmp/f && chown 1000 /tmp/f && echo "default capabilities: chown worked"'
```

```text output
default capabilities: chown worked
```

```bash run fails
docker run --rm --cap-drop ALL alpine:3.20 sh -c 'touch /tmp/f && chown 1000 /tmp/f && echo "chown worked"'
```

```text output
chown: /tmp/f: Operation not permitted
```

Even as root, the process can no longer use `chown`. Most applications — a web API, a worker — need *no* capabilities at all; drop them all and add back only one you can name a reason for (`--cap-add`).

### 3. A leaky image

A project with a `.env` file, and a Dockerfile that copies everything, "removes" the file, and sets a password:

```bash run
mkdir -p leaky && cd leaky
printf 'API_TOKEN=lesson-only-token-123\n' > .env
echo 'console.log("app")' > app.js
cat > Dockerfile <<'EOF'
FROM alpine:3.20
ENV DB_PASSWORD=lesson-only-password
WORKDIR /app
COPY . .
RUN rm -f .env
CMD ["cat", "app.js"]
EOF
docker build -q -t devforge-leaky:1 . > ../build.log 2>&1 || { cat ../build.log; exit 1; }
docker run --rm devforge-leaky:1 ls -A /app
```

```text output
Dockerfile
app.js
```

`.env` looks gone. Now look at the image the way anyone who pulls it could:

```bash run
docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' devforge-leaky:1 | grep PASSWORD
mkdir -p ../saved && docker save devforge-leaky:1 | tar -x -C ../saved
for layer in $(find ../saved -type f); do tar -tf "$layer" 2>/dev/null | grep -x 'app/.env' > /dev/null && tar -xOf "$layer" app/.env; done
cd ..
```

```text output
DB_PASSWORD=lesson-only-password
API_TOKEN=lesson-only-token-123
```

- The `ENV` password is part of the image's configuration — `docker image inspect` prints it.
- `docker save` writes the image as files, one archive per layer. The `COPY . .` layer still contains `.env`; the `rm` only added a layer that hides it. If this image had been pushed to a registry, both secrets would have to be treated as leaked and **rotated** (replaced).

### 4. The same app, built safely

```bash run
mkdir -p safe/secrets && cd safe
printf 'API_TOKEN=lesson-only-token-123\n' > .env
printf 'lesson-only-password' > secrets/db_password
chmod 644 secrets/db_password
cat > .dockerignore <<'EOF'
.env
secrets/
EOF
cat > app.js <<'EOF'
// Reads its password from a file mounted at run time; never prints it.
const fs = require("node:fs");
const password = fs.readFileSync("/run/secrets/db_password", "utf8");
console.log(`running as uid ${process.getuid()}, password loaded (${password.length} characters)`);
EOF
cat > Dockerfile <<'EOF'
FROM node:22-alpine
WORKDIR /app
COPY app.js .
USER node
CMD ["node", "app.js"]
EOF
docker build -q -t devforge-safe:1 . > ../build.log 2>&1 || { cat ../build.log; exit 1; }
echo "files in /app: $(docker run --rm devforge-safe:1 ls -A /app | tr '\n' ' ')"
echo "secrets in the image's ENV: $(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' devforge-safe:1 | grep -c -iE 'password|token' || true)"
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
  -v "$PWD/secrets/db_password":/run/secrets/db_password:ro devforge-safe:1
cd ..
```

```text output
files in /app: app.js
secrets in the image's ENV: 0
running as uid 1000, password loaded (20 characters)
```

- `.dockerignore` keeps `.env` and `secrets/` out of the build context, so no layer can contain them; the Dockerfile copies only what the app needs.
- `USER node` makes non-root the default, with no flag to forget.
- The password arrives at run time as a read-only file, in a hardened container. The image can now be shared without sharing the password. (`chmod 644` lets uid 1000 read the lesson's file whatever your own user id is; on a real server, restrict the file by ownership instead, or let Compose or Kubernetes secrets manage it.)

### 5. Clean up

```bash run
docker image rm devforge-leaky:1 devforge-safe:1 > /dev/null
rm -rf saved
echo "removed"
```

```text output
removed
```

## Common mistakes

- **`ARG` or `ENV` for secrets during a build.** Both can end up in the image or its history. For a secret that one build step needs (a private package token), BuildKit's `RUN --mount=type=secret,id=…` makes it available to that step only, without storing it — see the Docker build-secrets documentation. (This lab does not run it, so that it works with every builder.)
- **"I deleted it in the next step."** Layers keep it. Remove it from the build context instead, and rotate anything that was ever pushed.
- **`--privileged` to make something work.** It gives the container nearly full access to the host. Find the one capability or device actually needed.
- **Mounting the Docker socket** (`/var/run/docker.sock`) into a container. Whoever controls that container controls Docker — and the host.
- **Old base images.** Rebuild regularly so security fixes in the base image reach you, and scan images for known vulnerabilities (next lesson).

## Where this fits in a real system

**Kubernetes** expresses the same settings in a Pod's `securityContext` (`runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop`, `allowPrivilegeEscalation: false`) and mounts **Secrets** as files. **GitHub Actions** and **Jenkins** pipelines pass secrets to builds through BuildKit secret mounts rather than build arguments, and image scanners in CI catch images built on outdated bases.
