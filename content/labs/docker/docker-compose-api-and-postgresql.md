---
id: docker-compose-api-and-postgresql
title: Connect an API and PostgreSQL with Compose
track: docker
level: intermediate
mode: local
estimated_minutes: 45
prerequisites: [docker-networks-and-compose]
objectives:
  - Describe an API and its PostgreSQL database as two Compose services that reach each other by service name.
  - Make the API wait for a healthy database with a health check and depends_on, instead of a fixed delay.
  - Keep the database's data in a named volume across docker compose down and up, and remove it deliberately.
checkpoints:
  - { id: healthy, text: "docker compose up --wait returned, and both services reported healthy" }
  - { id: survived, text: "After docker compose down and up, the student added through the API was still listed" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Networking in Compose
    url: https://docs.docker.com/compose/how-tos/networking/
    publisher: Docker documentation
    type: documentation
    level: intermediate
    official: true
    why: Compose creates one network per project and every service is reachable at its service name.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Control startup order in Compose
    url: https://docs.docker.com/compose/how-tos/startup-order/
    publisher: Docker documentation
    type: documentation
    level: intermediate
    official: true
    why: depends_on with condition service_healthy waits for a dependency's health check before starting a service.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: docker compose up
    url: https://docs.docker.com/reference/cli/docker/compose/up/
    publisher: Docker documentation
    type: reference
    level: intermediate
    official: true
    why: The --detach and --wait options — return once services are running or healthy.
    verification: { status: verified, checked_on: 2026-11-26 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite with Docker Compose, postgres:16.15-alpine3.23 and node:22.23.5-alpine pinned by digest, and the pg driver 8.23.1 installed from a lockfile with integrity hashes; their output is compared with this page. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

A college's student API keeps its data in PostgreSQL. You describe both in one `compose.yaml`: the API finds the database by its service name, starts only when the database is healthy, and the data lives in a named volume that survives `docker compose down`. Then you prove it with a check script.

## Before you start

You need Docker with the Compose plugin, as in *Networks and Docker Compose*. The lab pulls `postgres:16.15-alpine3.23` and `node:22.23.5-alpine` (about 160 MB together), downloads the `pg` driver from the npm registry, and publishes the API on port 3200 of your machine. The password `devforge-lab` is a practice value for a database that exists only on your machine.

**Warning:** the clean-up step runs `docker compose down -v`, which deletes this project's database volume. It only touches the Compose project `devforge-college` that this lab creates.

## Steps

### 1. The API and its locked dependency

The API uses the `pg` driver. Instead of installing Node.js on your machine, generate the lockfile with the same pinned Node image the API will run on; `--save-exact` pins the version, and the lockfile records a checksum (`integrity`) for every package, which `npm ci` verifies during the build.

```bash run
mkdir -p compose-pg-lab/api compose-pg-lab/initdb && cd compose-pg-lab
NODE_IMAGE=node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
echo '{ "name": "students-api", "version": "1.0.0", "private": true }' > api/package.json
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/api":/app -w /app "$NODE_IMAGE" \
  npm install --save-exact --package-lock-only --no-audit --no-fund pg@8.23.1 > npm.log 2>&1 || { cat npm.log; exit 1; }
grep '"pg":' api/package.json
grep -A3 '"node_modules/pg": {' api/package-lock.json | grep -o '"integrity": "sha512-' | head -n 1
```

```text output
{"name":"students-api","version":"1.0.0","private":true,"dependencies":{"pg":"8.23.1"}}
"integrity": "sha512-
```

```bash run
cat > api/server.js <<'EOF'
const http = require("node:http");
const { Pool } = require("pg");
// The connection string comes from the environment, so no password is written into the code.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      await pool.query("SELECT 1");
      return send(res, 200, { status: "ok", database: "ok" });
    }
    if (req.method === "GET" && req.url === "/students") {
      const { rows } = await pool.query("SELECT id, name FROM students ORDER BY id");
      return send(res, 200, rows);
    }
    if (req.method === "POST" && req.url === "/students") {
      const name = String(JSON.parse((await readBody(req)) || "{}").name ?? "").trim();
      if (!name) return send(res, 400, { error: "name is required" });
      // A parameterised query: the value is sent separately from the SQL, so it cannot change the statement.
      const { rows } = await pool.query("INSERT INTO students (name) VALUES ($1) RETURNING id, name", [name]);
      return send(res, 201, rows[0]);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err.message);
    send(res, 503, { status: "error", database: "unavailable" });
  }
});
server.listen(3000, () => console.log("students API listening on port 3000"));
process.on("SIGTERM", () => server.close(() => pool.end().then(() => process.exit(0))));
EOF
cat > api/Dockerfile <<'EOF'
FROM node:22.23.5-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
USER node
CMD ["node", "server.js"]
EOF
printf 'node_modules\n.env\n' > api/.dockerignore
cat > initdb/01-schema.sql <<'EOF'
CREATE TABLE students (id serial PRIMARY KEY, name text NOT NULL);
INSERT INTO students (name) VALUES ('Asha'), ('Ravi');
EOF
ls api initdb
```

```text output
api:
Dockerfile
package-lock.json
package.json
server.js

initdb:
01-schema.sql
```

The PostgreSQL image runs the files in `/docker-entrypoint-initdb.d` once, the first time it starts with an empty data directory — a convenient way to create the schema for local development. (Real projects usually apply schema changes with a migration tool, as in *Backups, restores and migrations*.)

### 2. The Compose file

```bash run
cat > compose.yaml <<'EOF'
services:
  db:
    image: postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4
    environment:
      POSTGRES_PASSWORD: devforge-lab
      POSTGRES_DB: college
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      # TCP, not the local socket: during first start-up a temporary server listens only on the socket.
      test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "college"]
      interval: 2s
      timeout: 3s
      retries: 30
  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://postgres:devforge-lab@db:5432/college
    ports:
      - "127.0.0.1:3200:3000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 2s
      timeout: 3s
      retries: 30
volumes:
  dbdata:
EOF
docker compose -p devforge-college config --services
```

```text output
db
api
```

- `@db:5432` in `DATABASE_URL`: on the project's network, the database is reachable by its **service name**. No IP addresses, and the database publishes no port on your machine at all.
- `depends_on` with `condition: service_healthy` starts the API only after the database's health check passes. Without it, the API could start first and fail its first queries.
- `dbdata` is a **named volume** for PostgreSQL's data directory; the API's health check makes `--wait` mean "the API can reach the database", not just "the process started".

### 3. Start the stack and use the API

```bash run
docker compose -p devforge-college up -d --build --wait > up.log 2>&1 || { cat up.log; docker compose -p devforge-college logs; exit 1; }
docker compose -p devforge-college ps --format '{{.Service}} {{.Health}}' | sort
curl -s http://127.0.0.1:3200/health; echo
curl -s http://127.0.0.1:3200/students; echo
curl -s -X POST -H 'content-type: application/json' -d '{"name":"Priya"}' http://127.0.0.1:3200/students; echo
curl -s http://127.0.0.1:3200/students; echo
```

```text output
api healthy
db healthy
{"status":"ok","database":"ok"}
[{"id":1,"name":"Asha"},{"id":2,"name":"Ravi"}]
{"id":3,"name":"Priya"}
[{"id":1,"name":"Asha"},{"id":2,"name":"Ravi"},{"id":3,"name":"Priya"}]
```

### 4. Down and up again: the data stays

`docker compose down` stops and removes the containers and the project's network, but keeps named volumes. The database comes back on its existing data — and the init script does not run again, because the data directory is no longer empty.

```bash run
docker compose -p devforge-college down > down.log 2>&1
docker compose -p devforge-college ps -a --format '{{.Service}}' | wc -l
docker volume ls --filter name=devforge-college_dbdata --format '{{.Name}}'
docker compose -p devforge-college up -d --wait > up.log 2>&1 || { cat up.log; exit 1; }
curl -s http://127.0.0.1:3200/students; echo
```

```text output
0
devforge-college_dbdata
[{"id":1,"name":"Asha"},{"id":2,"name":"Ravi"},{"id":3,"name":"Priya"}]
```

Compose prefixes the volume with the project name (`devforge-college_dbdata`), so two projects with a volume called `dbdata` do not share data by accident.

## Check your work

Run this inside `compose-pg-lab` while the stack is running.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
p="docker compose -p devforge-college"
check "compose.yaml makes the API wait for a healthy database" 'grep -A3 "depends_on:" compose.yaml | grep "condition: service_healthy"'
check "the API reaches the database by its service name" 'grep -E "DATABASE_URL: .*@db:5432/" compose.yaml'
check "the database keeps its data in a named volume" '$p config --volumes | grep -x dbdata'
check "server.js reads the connection string from the environment" 'grep "process.env.DATABASE_URL" api/server.js && ! grep "devforge-lab" api/server.js'
check "both services are healthy" '[ "$($p ps --format "{{.Service}} {{.Health}}" | sort | tr "\n" " ")" = "api healthy db healthy " ]'
check "GET /health reports the database ok" 'curl -s http://127.0.0.1:3200/health | grep "\"database\":\"ok\""'
check "Priya, added through the API, is stored" 'curl -s http://127.0.0.1:3200/students | grep "\"name\":\"Priya\""'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: compose.yaml makes the API wait for a healthy database
PASS: the API reaches the database by its service name
PASS: the database keeps its data in a named volume
PASS: server.js reads the connection string from the environment
PASS: both services are healthy
PASS: GET /health reports the database ok
PASS: Priya, added through the API, is stored
All checks passed
```

## Clean up

`-v` also removes the named volume — the practice data. The image Compose built for the API is named after the project and the service, `devforge-college-api`; remove it too.

```bash run
docker compose -p devforge-college down -v > down.log 2>&1
docker image rm devforge-college-api > /dev/null
echo "volumes left: $(docker volume ls --filter name=devforge-college_dbdata -q | wc -l)"
echo "images left:  $(docker image ls -q devforge-college-api | wc -l)"
```

```text output
volumes left: 0
images left:  0
```

## Reset

- **Port 3200 is already in use?** Change `127.0.0.1:3200:3000` in `compose.yaml` and the port in the `curl` commands.
- **Start the whole lab again:** run the clean-up step (it deletes the practice data), leave the folder and delete it — `cd .. && rm -rf compose-pg-lab` — then begin at step 1.

## What you practised

Compose describes a whole application — services, how they find each other, what they wait for and where their data lives — in one file you can commit. Service names replace addresses, health checks replace guessed delays, and named volumes keep the data while containers come and go.
