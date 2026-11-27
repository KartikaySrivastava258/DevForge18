---
id: n8n-self-hosting-securely
title: Self-hosting n8n securely
track: n8n
order: 6
level: advanced
estimated_minutes: 50
prerequisites: [n8n-human-approval-steps]
starts_fresh: true
learning_objectives:
  - Keep n8n's data and encryption key outside the container, and explain what the encryption key protects.
  - Show that credentials are stored encrypted, and what happens when n8n starts with the wrong key.
  - Use n8n's security audit to find unused credentials and risky nodes, and confirm that Execute Command is blocked by default.
  - Plan the rest of a secure deployment — TLS, authentication, the database, backups, updates and task-runner isolation.
resources:
  - title: Set a custom encryption key (n8n documentation)
    url: https://docs.n8n.io/hosting/configuration/configuration-examples/encryption-key/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: n8n creates a random key on first launch, saves it in the ~/.n8n folder and uses it to encrypt credentials before saving them; set N8N_ENCRYPTION_KEY yourself (and on every worker in queue mode).
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Security audit (n8n documentation)
    url: https://docs.n8n.io/hosting/securing/security-audit/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: n8n audit from the CLI, the public API or the n8n node; the risk reports it generates (credentials, database, nodes, filesystem, instance).
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Block access to nodes (n8n documentation)
    url: https://docs.n8n.io/hosting/securing/blocking-nodes/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: NODES_EXCLUDE stops n8n loading a node at all; some nodes, like Execute Command, are blocked by default.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: key
    prompt: You move n8n to a new server, copy the database, but let n8n generate a new encryption key. What breaks?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "Every stored credential — they were encrypted with the old key and cannot be decrypted with the new one; keep the key with the database (and back it up separately)" }
      - { id: c, text: "Only the workflows" }
    answer: b
    explanation: The lab shows n8n refusing to start when the key does not match the one it was set up with.
  - id: execute-command
    prompt: Why is the Execute Command node blocked by default?
    options:
      - { id: a, text: "It is slow" }
      - { id: b, text: "It runs shell commands on the n8n host, so anyone who can edit a workflow could run anything there; enable it only deliberately, for trusted users" }
      - { id: c, text: "It needs a licence" }
    answer: b
    explanation: The audit's "Official risky nodes" section flags it even when it is only present in a workflow.
  - id: export
    prompt: Is export:credentials --decrypted safe to use?
    options:
      - { id: a, text: "Yes, it is just a backup" }
      - { id: b, text: "It writes every secret in plain text; use it only for migrations, on a trusted machine, and delete the output afterwards — normal backups keep credentials encrypted" }
      - { id: c, text: "It only shows names" }
    answer: b
    explanation: The lab shows the API key in clear text with --decrypted, and ciphertext without it.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official n8nio/n8n:2.49.6 image (pinned by digest), starting from nothing, and its output is compared with this lesson. The credential holds a made-up key. The audit's instance report depends on a version check against n8n's servers, so the lab prints only the credentials and nodes reports. Checked against the n8n documentation on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

An n8n instance holds the keys to every system its workflows touch, so a secure self-hosted setup keeps **data and the encryption key** safe and durable, removes **risky capabilities** it does not need, **audits** itself, and sits behind **TLS and proper authentication**.

## Explain it like I'm twelve

The school's automation helper has a key ring for every room. The keys are kept in a locked box (credentials encrypted), and the box's own key (the encryption key) must not be lost — or the box can never be opened again. Some keys are too dangerous to hand out at all (the one to the boiler room: running commands on the server), so they are not even on the ring. And every term someone checks the ring: which keys are never used and should go?

## What problem it solves

Workflow tools collect credentials for email, databases, payment providers and internal APIs. A compromised or careless instance is therefore a skeleton key to the organisation. Most incidents are not exotic: a lost encryption key after a migration, an instance exposed without TLS, a node that runs shell commands, credentials nobody uses any more. Each has a concrete, checkable fix.

## How it works

![](media:n8n/self-hosting.svg)

- **Data folder** (`/home/node/.n8n` in the image): the SQLite database (or use PostgreSQL), and a `config` file holding the encryption key n8n generated — unless you set `N8N_ENCRYPTION_KEY`. Keep it on a volume; back up the key separately from the database.
- **Credentials** are encrypted with that key before they are written to the database.
- **Blocked nodes**: `NODES_EXCLUDE` stops n8n loading nodes at all; Execute Command is blocked by default.
- **Security audit**: `n8n audit` reports unused credentials, risky nodes, SQL built from expressions, file-system access, and instance settings.
- **Around n8n**: HTTPS through a reverse proxy (the **Nginx** track), user management with strong authentication (SSO or two-factor), PostgreSQL with backups, prompt updates, task runners isolated from the main process, and no public API unless needed.

## Try it yourself

> **Local lab** — needs Docker. n8n keeps its data in a named Docker volume, `devforge-n8n-data`, so containers can be replaced without losing it. Every command is run automatically in DevForge's tests.

### 1. n8n with its data on a volume and an explicit encryption key

```bash run
mkdir -p n8n-secure && cd n8n-secure
IMAGE=n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
docker pull -q "$IMAGE" > /dev/null
docker volume create devforge-n8n-data > /dev/null
N8N_KEY=lab-only-key-6f1c0a9e2b   # in production: a long random value from a secret store, never in a script
start() {
  docker run -d --name devforge-n8n -p 127.0.0.1:5678:5678 -v devforge-n8n-data:/home/node/.n8n \
    -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_ENCRYPTION_KEY="$1" "$IMAGE" > /dev/null
}
ready() { for i in $(seq 1 120); do curl -sf http://127.0.0.1:5678/healthz/readiness > /dev/null && return 0; sleep 1; done; return 1; }
n8ncli() { docker exec -i -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n n8n "$@"; }
start "$N8N_KEY"; ready
docker exec devforge-n8n ls /home/node/.n8n | grep -E '^(config|database.sqlite)$'
```

```text output
config
database.sqlite
```

The volume holds the database and the `config` file with the encryption key. Replacing the container (an upgrade) keeps both; deleting the volume loses everything.

### 2. Credentials are stored encrypted

```bash run
docker exec -i devforge-n8n sh -c 'cat > /tmp/credential.json' <<'EOF'
[{ "id": "cred00000000001", "name": "Partner API key", "type": "httpHeaderAuth",
   "data": { "name": "X-API-Key", "value": "sk-lab-123456" } }]
EOF
n8ncli import:credentials --input=/tmp/credential.json 2>&1 | tail -n 1
echo "stored:    $(n8ncli export:credentials --all 2> /dev/null | grep -o '"data":"[^"]\{0,12\}')…"
echo "decrypted: $(n8ncli export:credentials --all --decrypted 2> /dev/null | grep -o '"data":{[^}]*}')"
```

```text output
Successfully imported 1 credential.
stored:    "data":"U2FsdGVkX1…
decrypted: "data":{"name":"X-API-Key","value":"sk-lab-123456"}
```

- In the database the credential is ciphertext (`U2FsdGVkX1…` is Base64 for `Salted__`, the start of an OpenSSL-style encrypted blob). Someone who copies only the database learns nothing about the key.
- `--decrypted` prints every secret in plain text. It exists for migrations; treat its output like a password file and delete it.

### 3. The wrong key, and the right one

```bash run
docker rm -f devforge-n8n > /dev/null                  # e.g. a redeploy with a mistyped secret
start "some-other-key"
for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Status}}' devforge-n8n)" = exited ] && break; sleep 1; done
docker inspect -f 'container {{.State.Status}}, exit code {{.State.ExitCode}}' devforge-n8n
docker logs devforge-n8n 2>&1 | grep -o 'Mismatching encryption keys\. The encryption key in the settings file [^ ]* does not match the N8N_ENCRYPTION_KEY env var\.'
docker rm -f devforge-n8n > /dev/null
start "$N8N_KEY"; ready
echo "with the right key: $(n8ncli export:credentials --all --decrypted 2> /dev/null | grep -o '"value":"[^"]*"')"
```

```text output
container exited, exit code 1
Mismatching encryption keys. The encryption key in the settings file /home/node/.n8n/config does not match the N8N_ENCRYPTION_KEY env var.
with the right key: "value":"sk-lab-123456"
```

n8n refused to start rather than run with a key that cannot decrypt its credentials. If the key itself were lost — not mistyped, but gone — every stored credential would have to be entered again. Store the key in a secret manager and back it up separately from the database: a backup of the database without its key is not a working backup.

### 4. Risky nodes and the security audit

```bash run
docker exec -i devforge-n8n sh -c 'cat > /tmp/shell.json' <<'EOF'
{ "id": "shell0000000001", "name": "Run a command", "nodes": [
  { "id": "s1", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {} },
  { "id": "s2", "name": "Shell", "type": "n8n-nodes-base.executeCommand", "typeVersion": 1, "position": [220, 0], "parameters": { "command": "id" } } ],
  "connections": { "Start": { "main": [[{ "node": "Shell", "type": "main", "index": 0 }]] } }, "settings": {}, "active": false }
EOF
n8ncli import:workflow --input=/tmp/shell.json 2>&1 | tail -n 1
result=$(n8ncli execute --id=shell0000000001 2>&1) || true     # the run is expected to fail
echo "$result" | grep -o 'Unrecognized node type: [a-zA-Z0-9.-]*' | sort -u
n8ncli audit 2> /dev/null | docker exec -i devforge-n8n node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const report = JSON.parse(s.slice(s.indexOf("{")));
    for (const name of ["Credentials Risk Report", "Nodes Risk Report"])
      for (const section of report[name].sections)
        console.log(`${name}: ${section.title} → ${section.location.map((l) => l.name ?? l.nodeName).join(", ")}`);
  });'
```

```text output
Successfully imported 1 workflow.
Unrecognized node type: n8n-nodes-base.executeCommand
Credentials Risk Report: Credentials not used in any workflow → Partner API key
Credentials Risk Report: Credentials not used in any active workflow → Partner API key
Credentials Risk Report: Credentials not used in recently executed workflows → Partner API key
Nodes Risk Report: Official risky nodes → Shell
```

- The workflow imported, but running it failed: **Execute Command is not loaded** in n8n 2.x unless you remove it from the excluded list. Leave it that way unless a trusted team truly needs it.
- The **audit** found the credential nobody uses (delete it: unused secrets are pure risk) and the risky node in a workflow. Its instance report — left out here, because it checks n8n's servers for newer versions — also lists outdated versions and security settings. Run the audit on a schedule (it is also available through the public API and the n8n node) and act on it.

### 5. Clean up

```bash run
docker rm -f devforge-n8n > /dev/null
docker volume rm devforge-n8n-data > /dev/null
echo removed
```

```text output
removed
```

## Beyond the lab: a deployment checklist

- **HTTPS only**, through a reverse proxy that terminates TLS (see *TLS termination* in the Nginx track); set the public URL so webhook links are correct.
- **Authentication**: individual user accounts, SSO or two-factor authentication; no shared logins; least-privilege roles and projects.
- **Database**: PostgreSQL for anything beyond one person, with backups that include the encryption key (stored separately).
- **Updates**: follow n8n's releases and update promptly; the audit's instance report flags outdated versions.
- **Isolation**: run task runners (which execute Code nodes) separately from the main process, as the start-up warnings in these labs recommend; keep `NODES_EXCLUDE` for nodes you do not need.
- **Exposure**: authenticate webhooks that trigger important actions, disable the public API if you do not use it, and keep the editor off the open internet where possible.

## Common mistakes

- **Letting n8n generate the key and never saving it.** The first migration or lost volume then loses every credential.
- **Running the image with its data inside the container.** An upgrade deletes workflows, executions and credentials.
- **Enabling Execute Command "just for one workflow".** Everyone who can edit workflows can now run commands on the server.
- **Keeping credentials "in case".** Unused credentials are only risk; the audit lists them.
- **Exposing n8n directly on port 5678 to the internet.** Put TLS and authentication in front, as for any admin tool.

## Where this fits in a real system

n8n usually runs on **Kubernetes** or a VM with **PostgreSQL** and a reverse proxy such as **Nginx**; its secrets come from a secret store, its database is backed up like any other, and the audit's findings become tickets in **Jira**. The same principles — keys outside the container, least privilege, audits — apply to **Jenkins** and **Airflow**, which you secured in their own tracks.
