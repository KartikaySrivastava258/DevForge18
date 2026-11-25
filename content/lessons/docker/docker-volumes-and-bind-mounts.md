---
id: docker-volumes-and-bind-mounts
title: Keeping data with volumes and bind mounts
track: docker
order: 2
level: beginner
estimated_minutes: 30
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Show that data written inside a container disappears when the container is removed.
  - Keep data across containers with a named volume.
  - Share a folder from your computer with a container using a bind mount, read-only where possible.
  - Choose between a volume and a bind mount for a given situation.
resources:
  - title: Docker documentation
    url: https://docs.docker.com/
    publisher: Docker
    type: documentation
    level: all
    official: true
    why: The storage section explains volumes, bind mounts and tmpfs mounts, and when to use each.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: database-container
    prompt: You run PostgreSQL in a container without any volume, then docker rm the container. What happens to the database?
    options:
      - { id: a, text: "It is saved automatically in the image" }
      - { id: b, text: "It is lost: it lived in the container's writable layer, which is deleted with the container" }
      - { id: c, text: "Docker moves it into a volume when the container is removed" }
    answer: b
    explanation: Without a volume, every file a container writes lives in its writable layer, which docker rm deletes. Databases in containers should always store their data directory in a volume.
  - id: volume-vs-bind
    prompt: You are editing a website's HTML in your code editor and want a container to serve each change immediately. What fits best?
    options:
      - { id: a, text: "A bind mount of your project folder, read-only if the container only needs to read it" }
      - { id: b, text: "A named volume" }
      - { id: c, text: "Rebuilding the image after every change" }
    answer: a
    explanation: A bind mount shows a folder from your computer inside the container, so edits appear instantly. Named volumes are managed by Docker and suit data the application owns, such as a database's files.
  - id: read-only
    prompt: Why mount the site folder with :ro?
    options:
      - { id: a, text: "Read-only mounts are faster to create" }
      - { id: b, text: "If the container is compromised or buggy, it cannot change or delete the files on your computer" }
      - { id: c, text: "Nginx refuses writable folders" }
    answer: b
    explanation: Least privilege applies to storage too. A container that only serves files should not be able to modify them; :ro makes the mount read-only inside the container, as the failed write in the lab shows.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine, after the previous lesson, and its output is compared with this lesson. Confirmed in CI (GitHub-hosted Ubuntu 24.04 runner, Docker API 1.48) on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 2
---

## The idea in one sentence

A container's own files disappear when the container is removed, so data that must last goes in a **volume** (storage managed by Docker) or a **bind mount** (a folder from your computer).

## Explain it like I'm twelve

Remember the photocopied exam papers from the previous lesson: anything written on a copy is lost when the copy is thrown away. A **volume** is like a notebook kept in the exam hall's cupboard: any student can borrow it, write in it, and return it, and the notes are still there tomorrow. A **bind mount** is like bringing your own notebook from home: what is written is in *your* notebook, and you can read it at home too.

Where the analogy breaks: several containers can use the same volume at the same time, so the application must handle that safely — a database, for example, should be the only writer to its own data folder.

## What problem it solves

Containers are meant to be disposable: you replace them to upgrade, scale or recover. That only works if the data they need is **not** inside them. Volumes keep databases, uploads and other application state across container replacements; bind mounts let you develop with files from your own computer without rebuilding the image after every change.

## How it works

![](media:docker/mounts.svg)


- `-v notes-data:/data` mounts the named volume `notes-data` at `/data`. Docker creates it if it does not exist.
- `-v "$PWD/site":/usr/share/nginx/html:ro` mounts a folder from your computer, read-only (`:ro`).
- A mount **hides** whatever the image had at that path while it is mounted.

## Try it yourself

> **Local lab** — requires Docker; continue from the previous lesson. Every command here is run automatically in DevForge's CI; see the note at the top for the current verification status. The last step removes everything you create.

Download the small Alpine Linux image used below:

```bash run
docker pull alpine:3.20
```

### 1. See data disappear

Write a file inside a container, remove the container, then look for the file from a new one:

```bash run
docker run --name scratch alpine:3.20 sh -c 'echo "note 1" > /notes.txt; cat /notes.txt'
docker rm scratch
```

```text output
note 1
scratch
```

```bash run fails
docker run --rm alpine:3.20 cat /notes.txt
```

```text output
cat: can't open '/notes.txt': No such file or directory
```

The new container starts from the clean image; the file died with `scratch`. `--rm` removes a container automatically when it exits — handy for one-off commands.

### 2. Keep data in a named volume

```bash run
docker volume create notes-data
docker run --rm -v notes-data:/data alpine:3.20 sh -c 'echo "note 1" >> /data/notes.txt'
docker run --rm -v notes-data:/data alpine:3.20 sh -c 'echo "note 2" >> /data/notes.txt'
docker run --rm -v notes-data:/data alpine:3.20 cat /data/notes.txt
```

```text output
notes-data
note 1
note 2
```

Three different containers, each removed straight after use, all shared one volume. Ask Docker about it:

```bash run
docker volume ls --filter name=notes-data --format "{{.Name}} {{.Driver}}"
docker volume inspect notes-data --format "{{.Mountpoint}}"
```

```text output
notes-data local
/var/lib/docker/volumes/notes-data/_data
```

The `local` driver keeps the volume's files on the Docker host. On macOS and Windows that path is inside Docker Desktop's Linux virtual machine, not directly in your own folders.

### 3. Serve your own files with a bind mount

Create a page on your computer and serve it with nginx, read-only:

```bash run
mkdir -p site
echo "<h1>Edited on my laptop</h1>" > site/index.html
docker run -d --name devsite -p 8083:80 -v "$PWD/site":/usr/share/nginx/html:ro nginx:1.27-alpine
sleep 1
```

`docker run -d` prints the new container's ID; `sleep 1` gives nginx a moment to start. On Windows, use Git Bash for `$PWD`, or `${PWD}` in PowerShell.

```bash run
curl -s http://localhost:8083/
```

```text output
<h1>Edited on my laptop</h1>
```

Change the file on your computer and request it again — no restart, no rebuild:

```bash run
echo "<h1>Changed without rebuilding</h1>" > site/index.html
curl -s http://localhost:8083/
```

```text output
<h1>Changed without rebuilding</h1>
```

Because the mount is read-only, the container itself cannot change your files:

```bash run fails
docker exec devsite sh -c 'echo hacked > /usr/share/nginx/html/index.html'
```

```text output
sh: can't create /usr/share/nginx/html/index.html: Read-only file system
```

### 4. Clean up

```bash run
docker rm -f devsite
docker volume rm notes-data
```

```text output
devsite
notes-data
```

Removing a container never removes its named volumes: you must delete them deliberately, as here. That protects data from an accidental `docker rm`.

## Common mistakes

- **Running a database container without a volume.** Removing or recreating the container deletes the data. For the `postgres:16` image, mount a volume at `/var/lib/postgresql/data` (check the image's documentation for other versions).
- **Expecting `docker rm` to delete volumes.** Unused volumes accumulate; list them with `docker volume ls` and remove what you no longer need.
- **Writable bind mounts by default.** If a container only reads files, add `:ro`.
- **Mounting over a path the image needs.** A mount hides the image's files at that path, which can make an application fail to start.
- **Relative paths in bind mounts.** Use an absolute path such as `"$PWD/site"`; a bare name like `site` is treated as a *volume* name.

## Where this fits in a real system

In **Docker Compose** files and **Kubernetes** manifests the same idea appears as declared volumes and persistent volume claims: application containers stay disposable while **PostgreSQL**, **Redis** (when persistence is enabled) and file uploads keep their data in managed storage. DevForge's own Compose setup does exactly this — the app container is read-only, and the database lives in the `devforge-data` volume.
