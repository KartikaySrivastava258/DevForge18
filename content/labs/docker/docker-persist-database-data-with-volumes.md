---
id: docker-persist-database-data-with-volumes
title: Persist database data using volumes
track: docker
level: beginner
mode: local
estimated_minutes: 30
prerequisites: [docker-volumes-and-bind-mounts]
objectives:
  - Show that a database container without a named volume loses its data when the container is removed.
  - Store PostgreSQL's data directory in a named volume, so the data outlives the container.
  - Replace the database container and confirm the data is still there, then remove the volume deliberately.
checkpoints:
  - { id: lost, text: "Without a named volume, the new container reported that the table students does not exist" }
  - { id: kept, text: "With the named volume devforge-pgdata, a brand-new container still found the three students" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Docker documentation — storage
    url: https://docs.docker.com/
    publisher: Docker documentation
    type: documentation
    level: beginner
    official: true
    why: The storage section explains volumes, bind mounts and tmpfs mounts, and when to use each.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: docker container run
    url: https://docs.docker.com/reference/cli/docker/container/run/
    publisher: Docker documentation
    type: reference
    level: intermediate
    official: true
    why: The options used in this lab, including -v to mount a volume and -e to set environment variables.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Docker and the postgres:16.15-alpine3.23 image pinned by digest, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

Containers are meant to be thrown away and replaced — but a database's data must not be. You see a database lose its data with its container, then keep PostgreSQL's data in a **named volume** so that a brand-new container picks up exactly where the old one stopped.

## Before you start

You need Docker, as in *Keeping data with volumes and bind mounts*. The lab pulls `postgres:16.15-alpine3.23` (about 110 MB) and publishes no ports: every command reaches PostgreSQL with `docker exec`. The password `devforge-lab` is a practice value for a database that only exists on your machine; never reuse it.

**Warning:** the clean-up step deletes the volume `devforge-pgdata` and everything in it. The lab creates that volume itself; check `docker volume ls` first if you already use a volume with that name.

## Steps

### 1. Two helpers

`start NAME [docker run options]` starts PostgreSQL and waits until it accepts connections over TCP (during its first start, the image runs a temporary server that only listens on a local socket, so waiting for TCP avoids talking to that one). `sql NAME "statement"` runs SQL inside the container.

```bash run
mkdir volume-lab && cd volume-lab
cat > helpers.sh <<'EOF'
PG_IMAGE=postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
start() {
  local name=$1; shift
  docker run -d --name "$name" -e POSTGRES_PASSWORD=devforge-lab "$@" "$PG_IMAGE" > /dev/null
  for i in $(seq 1 60); do docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres && return 0; sleep 0.5; done
  echo "PostgreSQL did not start"; docker logs "$name"; return 1
}
sql() { docker exec "$1" psql -X -q -U postgres -c "$2"; }
EOF
. ./helpers.sh
echo "helpers ready"
```

```text output
helpers ready
```

### 2. Without a named volume, the data goes with the container

```bash run
start devforge-pg-temp
sql devforge-pg-temp "CREATE TABLE students (id int PRIMARY KEY, name text NOT NULL); INSERT INTO students VALUES (1, 'Asha'), (2, 'Ravi'), (3, 'Meera');"
sql devforge-pg-temp "SELECT count(*) AS students FROM students;"
docker rm -f -v devforge-pg-temp > /dev/null
start devforge-pg-temp
sql devforge-pg-temp "SELECT count(*) AS students FROM students;" 2>&1 || true
docker rm -f -v devforge-pg-temp > /dev/null
```

```text output
 students
----------
        3
(1 row)

ERROR:  relation "students" does not exist
LINE 1: SELECT count(*) AS students FROM students;
                                         ^
```

The second container started from the same image with an empty data directory: the table never existed there. (The PostgreSQL image declares its data directory as a volume, so Docker gave the first container an *anonymous* volume; `docker rm -v` removed it with the container, and a new container gets a new, empty one.)

### 3. A named volume for the data directory

`-v devforge-pgdata:/var/lib/postgresql/data` mounts a volume called `devforge-pgdata` at the directory where PostgreSQL 16 keeps its data. Docker creates the volume if it does not exist.

```bash run
. ./helpers.sh
start devforge-pg -v devforge-pgdata:/var/lib/postgresql/data
sql devforge-pg "CREATE TABLE students (id int PRIMARY KEY, name text NOT NULL); INSERT INTO students VALUES (1, 'Asha'), (2, 'Ravi'), (3, 'Meera');"
docker volume ls --filter name=devforge-pgdata --format '{{.Name}} ({{.Driver}})'
docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{end}}' devforge-pg
```

```text output
devforge-pgdata (local)
volume devforge-pgdata -> /var/lib/postgresql/data
```

### 4. Replace the container, keep the data

Remove the container completely — as you would to upgrade it or change its settings — and start a new one on the same volume.

```bash run
. ./helpers.sh
docker rm -f devforge-pg > /dev/null
docker ps -a --filter name=^devforge-pg$ --format '{{.Names}}' | wc -l
start devforge-pg -v devforge-pgdata:/var/lib/postgresql/data
sql devforge-pg "SELECT id, name FROM students ORDER BY id;"
```

```text output
0
 id | name
----+-------
  1 | Asha
  2 | Ravi
  3 | Meera
(3 rows)
```

No container existed for a moment, yet the rows survived: they live in the volume, not in the container. The new container found an existing data directory, so the image skipped its first-start initialisation and simply started PostgreSQL on it. (Plain `docker rm -f` without `-v` never removes a *named* volume.)

## Check your work

Run this inside `volume-lab` while `devforge-pg` is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
check "the volume devforge-pgdata exists" 'docker volume inspect devforge-pgdata'
check "the container devforge-pg is running" '[ "$(docker inspect -f "{{.State.Running}}" devforge-pg)" = true ]'
check "devforge-pg keeps its data directory in devforge-pgdata" 'docker inspect -f "{{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}" devforge-pg | grep "devforge-pgdata:/var/lib/postgresql/data"'
check "the students table holds the three students" '[ "$(docker exec devforge-pg psql -X -tA -U postgres -c "SELECT count(*) FROM students")" = 3 ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the volume devforge-pgdata exists
PASS: the container devforge-pg is running
PASS: devforge-pg keeps its data directory in devforge-pgdata
PASS: the students table holds the three students
All checks passed
```

## Clean up

Removing the container keeps the volume; deleting the data is a separate, deliberate step.

```bash run
docker rm -f devforge-pg > /dev/null
docker volume ls --filter name=devforge-pgdata --format '{{.Name}} still exists'
docker volume rm devforge-pgdata > /dev/null
docker volume ls --filter name=devforge-pgdata --format '{{.Name}}' | wc -l
```

```text output
devforge-pgdata still exists
0
```

## Reset

- **A name is already in use?** Remove the leftovers of an earlier attempt: `docker rm -f devforge-pg devforge-pg-temp`.
- **Start the whole lab again:** run the clean-up step (it deletes the practice data), leave the folder and delete it — `cd .. && rm -rf volume-lab` — then begin at step 1.

## What you practised

A container's own filesystem lives and dies with the container. Data that must survive — a database's data directory above all — belongs in a named volume, which you create, attach, keep across container replacements and remove only on purpose. Back up a volume like any other important data: a volume protects against replacing containers, not against deleting the volume or losing the disk.
