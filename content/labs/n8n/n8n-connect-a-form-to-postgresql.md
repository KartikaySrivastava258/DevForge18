---
id: n8n-connect-a-form-to-postgresql
title: Connect a form to PostgreSQL
track: n8n
level: intermediate
mode: local
estimated_minutes: 45
prerequisites: [n8n-validation-and-errors]
objectives:
  - Store a PostgreSQL connection as an encrypted n8n credential instead of writing it into a workflow.
  - Build a workflow that receives a form submission on a webhook, validates it and inserts it into PostgreSQL with a parameterised query.
  - Answer each outcome with the right HTTP status — 201 stored, 400 invalid, 409 duplicate — and confirm the rows in the database.
checkpoints:
  - { id: stored, text: "A valid registration returned 201 with the new row's id, and psql listed it" }
  - { id: duplicate, text: "Registering the same email twice returned 409, and the table still held one row for it" }
  - { id: check-passed, text: "The check script printed All checks passed" }
resources:
  - title: Webhook node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Webhook URLs, HTTP methods, and responding from a Respond to Webhook node.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Respond to Webhook node
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Choosing the response body and status code from inside the workflow.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Postgres node
    url: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: The node's operations, including Execute Query with query parameters.
    verification: { status: verified, checked_on: 2026-11-28 }
verification:
  method: executed
  details: Every step and the check script are run by DevForge's test suite on a disposable Docker engine with n8nio/n8n 2.49.6 and postgres:16.15-alpine3.23, both pinned by digest, and their output is compared with this page. The check script is also run in an empty folder, where it must fail.
starts_fresh: true
owner: content-team
last_reviewed: 2026-11-28
content_version: 1
---

## Goal

A course-registration form posts JSON to n8n. Today the submissions only exist in n8n's execution log; the department wants them in its PostgreSQL database. You connect n8n to PostgreSQL through a stored credential, insert each valid submission with a **parameterised** query, answer the form with a status code that says what happened, and check the rows in the database.

## Before you start

You need Docker, as in *Validating input and handling errors*. The lab starts its own n8n (`devforge-n8n-form`, on port 5679 so it does not clash with the lessons' n8n on 5678) and its own PostgreSQL, on a Docker network so n8n can reach the database by name. It pulls `n8nio/n8n:2.49.6` (about 1.3 GB, once) and `postgres:16.15-alpine3.23`. The password `devforge-lab` is a practice value for databases that exist only on your machine.

## Steps

### 1. PostgreSQL with a registrations table

```bash run
mkdir -p form-pg-lab/initdb && cd form-pg-lab
cat > initdb/01-registrations.sql <<'EOF'
CREATE TABLE registrations (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  track text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
EOF
docker network create devforge-form-net > /dev/null
docker run -d --name devforge-form-db --network devforge-form-net \
  -e POSTGRES_PASSWORD=devforge-lab -e POSTGRES_DB=college \
  -v "$PWD/initdb":/docker-entrypoint-initdb.d:ro \
  postgres:16.15-alpine3.23@sha256:8dc5ce2495b2aeafbf033e4be590764f611248e9eb8495b5202170a6afcb64a4 > /dev/null
for i in $(seq 1 60); do docker exec devforge-form-db pg_isready -q -h 127.0.0.1 -U postgres -d college && break; sleep 0.5; done
sql() { docker exec devforge-form-db psql -X -q -U postgres -d college -c "$1"; }
sql "\d registrations" | grep -E "^ (id|name|email|track) "
```

```text output
 id         | integer                  |           | not null | nextval('registrations_id_seq'::regclass)
 name       | text                     |           | not null |
 email      | text                     |           | not null |
 track      | text                     |           | not null |
```

`email` is `UNIQUE`: the database itself refuses a second registration with the same address, whatever the workflow does. The `UNIQUE` constraint is the guarantee; checks in the workflow only make the answer friendlier.

### 2. n8n on the same network

```bash run
IMAGE=n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
docker run -d --name devforge-n8n-form --network devforge-form-net -p 127.0.0.1:5679:5678 \
  -e N8N_DIAGNOSTICS_ENABLED=false -e WEBHOOK_URL=http://127.0.0.1:5679/ "$IMAGE" > /dev/null
N8N=http://127.0.0.1:5679
for i in $(seq 1 120); do curl -sf "$N8N/healthz/readiness" > /dev/null && break; sleep 1; done
n8ncli() { docker exec -i -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n-form n8n "$@"; }
importfile() {
  docker exec -i devforge-n8n-form sh -c "cat > /tmp/$2"
  for i in $(seq 1 30); do out=$(n8ncli "import:$1" --input="/tmp/$2" 2>&1) && break; sleep 2; done
  echo "$out" | tail -n 1
}
curl -s "$N8N/healthz/readiness"; echo
```

```text output
{"status":"ok"}
```

`n8ncli` runs n8n's command-line tool inside the container, and `importfile workflow|credentials NAME` imports what you pipe into it, retrying while n8n finishes starting — as in the n8n lessons. If you open a new terminal, define both again.

### 3. The database connection, as a credential

The workflow will refer to this credential by its id; the host, user and password live only in n8n's credential store, encrypted with n8n's key (*Self-hosting n8n securely*). `devforge-form-db` is the database container's name, which Docker's network resolves for n8n.

```bash run
importfile credentials pg-credential.json <<'EOF'
[{ "id": "pgcollege000001", "name": "College database", "type": "postgres",
   "data": { "host": "devforge-form-db", "port": 5432, "database": "college", "user": "postgres", "password": "devforge-lab", "ssl": "disable" } }]
EOF
```

```text output
Successfully imported 1 credential.
```

In production, give n8n its own database role that may only `INSERT` into this table and `SELECT` from it, not the `postgres` superuser (*Roles, privileges and SQL injection prevention*).

### 4. The workflow

```bash run
importfile workflow registration.json <<'EOF'
{
  "id": "formtopg000001",
  "name": "Course registration to PostgreSQL",
  "nodes": [
    { "id": "f1", "name": "Form", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": "7c1d6c4e-3333-4b8e-9a51-2f6d1a0b7c03",
      "parameters": { "httpMethod": "POST", "path": "course-registration", "responseMode": "responseNode", "options": {} } },
    { "id": "f2", "name": "Valid?", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [220, 0],
      "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" }, "combinator": "and", "conditions": [
        { "id": "c1", "leftValue": "={{ ($json.body.name || '').trim() }}", "rightValue": "", "operator": { "type": "string", "operation": "notEmpty", "singleValue": true } },
        { "id": "c2", "leftValue": "={{ /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(($json.body.email || '').trim()) }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true", "singleValue": true } },
        { "id": "c3", "leftValue": "={{ ['docker', 'kafka', 'redis'].includes(($json.body.track || '').toLowerCase()) }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true", "singleValue": true } }
      ] }, "options": {} } },
    { "id": "f3", "name": "Insert registration", "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [440, -100], "onError": "continueErrorOutput",
      "credentials": { "postgres": { "id": "pgcollege000001", "name": "College database" } },
      "parameters": { "operation": "executeQuery",
        "query": "INSERT INTO registrations (name, email, track) VALUES ($1, lower($2), lower($3)) RETURNING id",
        "options": { "queryReplacement": "={{ [$json.body.name.trim(), $json.body.email.trim(), $json.body.track] }}" } } },
    { "id": "f4", "name": "Stored", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [660, -160],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ status: 'registered', id: $json.id }) }}", "options": { "responseCode": 201 } } },
    { "id": "f5", "name": "Already registered", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [660, -40],
      "parameters": { "respondWith": "json", "responseBody": "={\"error\": \"this email is already registered\"}", "options": { "responseCode": 409 } } },
    { "id": "f6", "name": "Rejected", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [440, 120],
      "parameters": { "respondWith": "json", "responseBody": "={\"error\": \"name, a valid email and a track (docker, kafka or redis) are required\"}", "options": { "responseCode": 400 } } }
  ],
  "connections": {
    "Form": { "main": [[ { "node": "Valid?", "type": "main", "index": 0 } ]] },
    "Valid?": { "main": [[ { "node": "Insert registration", "type": "main", "index": 0 } ], [ { "node": "Rejected", "type": "main", "index": 0 } ]] },
    "Insert registration": { "main": [[ { "node": "Stored", "type": "main", "index": 0 } ], [ { "node": "Already registered", "type": "main", "index": 0 } ]] }
  },
  "settings": {}
}
EOF
n8ncli publish:workflow --id=formtopg000001 2>&1 | tail -n 1
U="$N8N/webhook/course-registration"
for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U" -H 'Content-Type: application/json' -d '{}')" != 404 ] && break; sleep 1; done
```

```text output
Successfully imported 1 workflow.
A running n8n applies this change shortly. If n8n is stopped, it applies the change when it starts.
```

- **Valid?** checks the form before anything touches the database: a name, an email that looks like one, and a known track.
- **Insert registration** runs one SQL statement with **placeholders** `$1`, `$2`, `$3`. The values travel separately from the SQL text, so a name such as `x'); DROP TABLE registrations; --` is stored as a strange name, never run as SQL. Building the statement by pasting `{{ $json.body.name }}` into the query text would be SQL injection.
- `onError: continueErrorOutput` gives the Postgres node a second output for failures; here the only expected failure is the `UNIQUE` constraint, answered with `409`. (A real workflow would also check the error's code, so a database outage is not reported as a duplicate.)

### 5. Submit the form

```bash run
post() { curl -s -w "  -> %{http_code}\n" -X POST "$U" -H 'Content-Type: application/json' -d "$1"; }
post '{"name": "Asha Rao", "email": "Asha@College.example", "track": "Docker"}'
post '{"name": "Ravi", "email": "ravi@college.example", "track": "kafka"}'
post '{"name": "Asha again", "email": "asha@college.example", "track": "redis"}'
post '{"name": "", "email": "nobody", "track": "cobol"}'
post '{"name": "x'"'"'); DROP TABLE registrations; --", "email": "mallory@college.example", "track": "redis"}'
```

```text output
{"status":"registered","id":1}  -> 201
{"status":"registered","id":2}  -> 201
{"error":"this email is already registered"}  -> 409
{"error":"name, a valid email and a track (docker, kafka or redis) are required"}  -> 400
{"status":"registered","id":4}  -> 201
```

### 6. Look in the database

```bash run
sql "SELECT id, name, email, track FROM registrations ORDER BY id;"
```

```text output
 id |               name                |          email          | track
----+-----------------------------------+-------------------------+--------
  1 | Asha Rao                          | asha@college.example    | docker
  2 | Ravi                              | ravi@college.example    | kafka
  4 | x'); DROP TABLE registrations; -- | mallory@college.example | redis
(3 rows)
```

The duplicate (Asha's address in different capitals — the workflow lower-cases emails before storing) and the invalid submission left no rows, and the "injection" attempt is just an odd name in a table that still exists. Ids are not always consecutive: a failed `INSERT` still uses up a value of the sequence.

## Check your work

Run this inside `form-pg-lab` while both containers are running. It posts one more registration of its own.

```bash run check
bash <<'CHECK'
fail=0
check() { if eval "$2" > /dev/null 2>&1; then echo "PASS: $1"; else echo "FAIL: $1"; fail=1; fi; }
U=http://127.0.0.1:5679/webhook/course-registration
q() { docker exec devforge-form-db psql -X -tA -U postgres -d college -c "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$U" -H 'Content-Type: application/json' -d "$1"; }
check "the registrations table keeps emails unique" 'q "SELECT indexdef FROM pg_indexes WHERE tablename = '\''registrations'\''" | grep "UNIQUE INDEX .*(email)"'
check "the workflow inserts with placeholders, not pasted values" 'docker exec -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n-form n8n export:workflow --id=formtopg000001 | grep "VALUES (\$1" && ! docker exec -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n-form n8n export:workflow --id=formtopg000001 | grep "\"query\": *\"[^\"]*{{"'
check "the database password is not written in the workflow" '! docker exec -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n-form n8n export:workflow --id=formtopg000001 | grep "devforge-lab"'
check "a valid registration is stored and answered with 201" '[ "$(code "{\"name\": \"Check Script\", \"email\": \"check-$$@college.example\", \"track\": \"redis\"}")" = 201 ] && [ "$(q "SELECT count(*) FROM registrations WHERE email = '\''check-$$@college.example'\''")" = 1 ]'
check "the same email again is answered with 409" '[ "$(code "{\"name\": \"Check Script\", \"email\": \"check-$$@college.example\", \"track\": \"redis\"}")" = 409 ]'
check "an invalid submission is answered with 400" '[ "$(code "{\"name\": \"\", \"email\": \"x\", \"track\": \"cobol\"}")" = 400 ]'
check "Asha and Ravi are registered" '[ "$(q "SELECT count(*) FROM registrations WHERE email IN ('\''asha@college.example'\'', '\''ravi@college.example'\'')")" = 2 ]'
if [ "$fail" -eq 0 ]; then echo "All checks passed"; else echo "Some checks failed"; exit 1; fi
CHECK
```

```text output
PASS: the registrations table keeps emails unique
PASS: the workflow inserts with placeholders, not pasted values
PASS: the database password is not written in the workflow
PASS: a valid registration is stored and answered with 201
PASS: the same email again is answered with 409
PASS: an invalid submission is answered with 400
PASS: Asha and Ravi are registered
All checks passed
```

## Clean up

```bash run
docker rm -f devforge-n8n-form devforge-form-db > /dev/null
docker network rm devforge-form-net > /dev/null
echo "removed"
```

```text output
removed
```

## Reset

- **A name is already in use?** Remove the leftovers of an earlier attempt: `docker rm -f devforge-n8n-form devforge-form-db; docker network rm devforge-form-net`.
- **Start again:** run the clean-up step, delete the `form-pg-lab` folder — `cd .. && rm -rf form-pg-lab` — and begin at step 1.

## What you practised

Connecting a form to a database is three decisions: where the connection secret lives (an encrypted credential, not the workflow), how values reach SQL (placeholders, never pasted text), and which rules the database itself enforces (here, `UNIQUE`), so the workflow's answers — 201, 400, 409 — always match what was stored.
