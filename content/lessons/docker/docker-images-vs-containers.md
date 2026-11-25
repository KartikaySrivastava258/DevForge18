---
id: docker-images-vs-containers
title: Images vs Containers
track: docker
order: 1
level: beginner
estimated_minutes: 20
prerequisites: []
learning_objectives:
  - Explain the difference between an image and a container in your own words.
  - Identify the moment a container is created from an image.
  - Predict what happens to files written inside a container when it is stopped or removed.
  - Explain why rebuilding an image does not change containers that are already running.
resources:
  - title: Docker — Get started
    url: https://docs.docker.com/learn/
    publisher: Docker
    type: tutorial
    level: beginner
    official: true
    why: Official installation links and a guided first look at images and containers.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: shared-writes
    prompt: You start two containers, web1 and web2, from the same nginx:1.27-alpine image, then create a file inside web1. What does web2 see?
    options:
      - { id: a, text: "The new file, because both containers use the same image" }
      - { id: b, text: "No new file — each container writes to its own private writable layer" }
      - { id: c, text: "The new file, but only after web2 is restarted" }
      - { id: d, text: "It depends on whether they publish the same port" }
    answer: b
    explanation: The image layers are read-only and shared. Each container gets its own thin writable layer on top, so a write in web1 is invisible to web2 and never modifies the image.
  - id: stop-vs-remove
    prompt: You write a file inside a container, run docker stop, then docker start on the same container. Is the file still there?
    options:
      - { id: a, text: "Yes — stopping keeps the container's writable layer; only removing the container discards it" }
      - { id: b, text: "No — stopping a container always resets it to the image" }
      - { id: c, text: "Only if the container was started with a volume" }
    answer: a
    explanation: A stopped container still exists, including its writable layer. docker rm deletes the container and that layer. Volumes are how you keep data that must outlive the container itself.
  - id: rebuild-running
    prompt: You fix a bug, rebuild the image with the same tag (myapp:1.0), and the already-running container still shows the bug. Why?
    options:
      - { id: a, text: "Docker's build cache ignored your change" }
      - { id: b, text: "A container keeps using the image it was created from; you must create a new container from the rebuilt image" }
      - { id: c, text: "The Docker daemon must be restarted to load new images" }
    answer: b
    explanation: A container is bound to the specific image ID it was created from. Re-tagging moves the name myapp:1.0 to the new image, but existing containers are unaffected until you replace them.
  - id: latest-tag
    prompt: Which statement about the image tag "latest" is accurate?
    options:
      - { id: a, text: "Docker automatically updates it to the newest release" }
      - { id: b, text: "It is just the default tag name; it points at whatever was last pushed with that tag, so pin explicit versions for reproducibility" }
      - { id: c, text: "It is a guarantee that the image is stable" }
    answer: b
    explanation: '"latest" has no special meaning beyond being the default tag. It can point at different images over time, which makes builds and deployments non-reproducible.'
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine and its output is compared with this lesson. Confirmed in CI (GitHub-hosted Ubuntu 24.04 runner, Docker API 1.48) on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-24
content_version: 2
---

## The idea in one sentence

An **image** is a read-only package containing everything an application needs to run; a **container** is a running (or stopped) instance created from that image, with its own small writable layer on top.

## Explain it like I'm twelve

Imagine your teacher has one **master copy** of a question paper. Nobody writes on the master. Before the exam, the teacher photocopies it — one copy per student. Each student writes answers on their own copy. Two students never see each other's answers, and the master stays clean. If a copy is thrown away, the answers written on it are gone, but the teacher can always make a fresh copy.

- The master copy is the **image**.
- Each student's photocopy is a **container**.
- Writing on your copy is the container's **writable layer**.
- Throwing a copy away is `docker rm`.

The analogy has one limit worth knowing: Docker does not really copy the whole image for each container. All containers share the same read-only image layers, and each gets only a thin layer for its own changes — which is why starting a container is fast and cheap.

## What problem this distinction solves

Before containers, "installing an application" meant changing a machine: adding packages, editing configuration, copying files. Every server drifted a little differently. Separating the **package** (image) from the **running thing** (container) means:

- you build once and run the same image in development, CI and production;
- you can start many identical instances from one image;
- a broken instance can be thrown away and replaced instead of repaired by hand.

## How it works

```diagram steps=docker/image-and-containers
```


Step by step, when you run `docker run nginx:1.27-alpine`:

1. The Docker CLI sends the request to the **Docker daemon** (the background service).
2. If the image is not on your machine, the daemon **pulls** it from a registry such as Docker Hub.
3. The daemon, through its container runtime, **creates a container**: it stacks a new writable layer on top of the image's read-only layers and prepares isolated namespaces for processes and networking.
4. It **starts** the image's default command (for nginx, the web server) as an isolated process.
5. The container keeps running as long as that main process runs.

**Beginner level:** image = template, container = instance.
**Intermediate level:** an image is an ordered set of read-only filesystem layers plus configuration; a container adds a copy-on-write layer — when a container modifies an existing file, that file is first copied up into the container's layer.
**Advanced level:** a container is an ordinary Linux process isolated by kernel namespaces and limited by cgroups. That is why containers share the host's kernel and why a Linux container on macOS or Windows needs Docker Desktop's lightweight Linux VM.

## Try it yourself

> **Local lab** — these commands run on your own machine and require Docker. Install it from the official guide linked in the resources below. On Linux, commands may need `sudo` unless your user has been granted Docker access (see Docker's official post-installation steps — and note that membership of the `docker` group is effectively root access). The image tag is pinned to `nginx:1.27-alpine` on purpose: as you will see below, fixed versions keep results reproducible. Every command here is run automatically in DevForge's CI; see the note at the top for the current verification status. The last step removes everything you create.

**1. Download an image and list it.**

```bash run
docker pull nginx:1.27-alpine
docker image ls nginx:1.27-alpine
```

`pull` downloads the image's layers (you will see progress lines for each layer); `image ls` shows images stored locally — here one row with the repository `nginx`, the tag `1.27-alpine`, an image ID and a size. Nothing is running yet: an image on its own is inert.

**2. Create two containers from the same image.**

```bash run
docker run --name web1 -d -p 8081:80 nginx:1.27-alpine
docker run --name web2 -d -p 8082:80 nginx:1.27-alpine
docker ps
```

- `--name web1` gives the container a readable name instead of a random one.
- `-d` (detached) runs it in the background and prints the new container's long ID.
- `-p 8081:80` publishes the container's port 80 on port 8081 of your machine. Each container needs a different host port.

`docker ps` lists two running containers, both created from `nginx:1.27-alpine`, with ports similar to `0.0.0.0:8081->80/tcp` and `0.0.0.0:8082->80/tcp`.

**3. Write a file inside web1 only.**

```bash run
docker exec web1 sh -c "echo hello from web1 > /usr/share/nginx/html/hello.txt"
curl -s http://localhost:8081/hello.txt
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8082/hello.txt
```

```text output
hello from web1
404
```

`docker exec` runs an extra command inside an existing container. web1 serves the new file; web2 answers **404 Not Found**, because it has its own writable layer and never saw the file.

On Windows PowerShell, type `curl.exe` instead of `curl` (in Windows PowerShell 5.1, `curl` is an alias for a different command), or use Git Bash, or open the URLs in your browser.

**4. Stop versus remove.**

```bash run
docker stop web1
docker start web1
sleep 1
curl -s http://localhost:8081/hello.txt
```

```text output
web1
web1
hello from web1
```

`docker stop` and `docker start` print the container's name. `sleep 1` gives nginx inside the container a moment to start listening again — without it, a very fast `curl` can arrive before the server is ready. After stop and start the file is still there: a stopped container keeps its writable layer. Now remove the container:

```bash run
docker rm -f web1
docker image ls nginx:1.27-alpine --format "{{.Repository}}:{{.Tag}}"
```

```text output
web1
nginx:1.27-alpine
```

`docker rm -f` stops and deletes web1 *and* its writable layer, so the file is gone for good. The image is untouched: it is still listed.

**5. Clean up.**

```bash run
docker rm -f web2
```

```text output
web2
```

Optionally remove the image too with `docker image rm nginx:1.27-alpine`. This is safe: it deletes only the local copy, which you can pull again at any time.

## Common mistakes

- **Expecting changes inside a container to update the image.** They never do. To change an image reproducibly, edit the Dockerfile and rebuild. (`docker commit` can snapshot a container, but the result is hard to reproduce or review, so avoid it for real work.)
- **Keeping important data in the writable layer.** It disappears with `docker rm`. Data that must survive belongs in a **volume** — the subject of a later lesson.
- **Rebuilding an image and expecting running containers to change.** Containers keep the image they were created from. Recreate them to pick up a new image.
- **Treating `latest` as "newest" or "stable".** It is only the default tag name. Pin explicit versions in anything you want to reproduce.
- **Confusing `docker stop` with `docker rm`.** Stopping pauses the process; removing deletes the container and its writable layer.

## Where this fits in a real system

In a CI pipeline (for example GitHub Actions), every commit can produce a new **image** tagged with a version or commit ID and pushed to a registry. Deployment tools such as Docker Compose or Kubernetes then create **containers** from that exact image. Rolling back means creating containers from the previous image — which works precisely because images are immutable and containers are disposable.
