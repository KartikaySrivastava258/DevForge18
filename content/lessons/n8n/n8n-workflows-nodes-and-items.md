---
id: n8n-workflows-nodes-and-items
title: Workflows, nodes and items
track: n8n
order: 1
level: beginner
estimated_minutes: 30
prerequisites: [docker-images-vs-containers]
learning_objectives:
  - Explain what a workflow, a trigger node and a node are in n8n, and how items flow between nodes.
  - Run n8n locally and import a workflow from a JSON file.
  - Execute a workflow and read the items each node produced.
resources:
  - title: n8n — work with nodes
    url: https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: What nodes and trigger nodes are, and node settings such as Retry On Fail and On Error.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n — data structure
    url: https://docs.n8n.io/build/work-with-data/understand-n8ns-data-structure/
    publisher: n8n
    type: documentation
    level: beginner
    official: true
    why: Items — the array of objects with a json key that passes between nodes.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: n8n CLI commands
    url: https://docs.n8n.io/deploy/host-n8n/configure-n8n/use-the-command-line/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: import:workflow, execute and publish:workflow, used in these lessons.
    verification: { status: verified, checked_on: 2026-11-25 }
self_check:
  - id: items
    prompt: A Code node returns three orders and the next node is a Filter. How many times does the Filter evaluate its condition?
    options:
      - { id: a, text: "Once, for the whole list" }
      - { id: b, text: "Three times — once per item" }
      - { id: c, text: "It depends on the workflow name" }
    answer: b
    explanation: Data passes between nodes as a list of items, and n8n's documentation says nodes process each item individually. You see it in the lesson — one order in, one decision out, per item.
  - id: trigger
    prompt: What is special about the first node of a workflow?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "It is a trigger node: it starts the workflow — by hand, on a schedule, or when a request arrives" }
      - { id: c, text: "It must be a Code node" }
    answer: b
    explanation: A trigger node executes the workflow in response to something. In this lesson it is a manual trigger; the next lesson uses a webhook.
  - id: n8n-vs-airflow
    prompt: When would you pick n8n over a code-first orchestrator such as Airflow?
    options:
      - { id: a, text: "For heavy, scheduled data pipelines that engineers maintain in Git" }
      - { id: b, text: "For connecting apps and APIs — forms, chat, email, CRMs — where a visual editor lets more people build and change the flow" }
      - { id: c, text: "Never" }
    answer: b
    explanation: The two overlap, but n8n's strength is integrations and event-driven automations built visually; Airflow's is scheduled, code-reviewed data pipelines.
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official n8nio/n8n:2.49.6 image (pinned by digest); the output shown was recorded from that run. Facts about workflows, nodes, items and the CLI were checked against the n8n documentation on 2026-11-25.
owner: content-team
last_reviewed: 2026-11-25
content_version: 1
---

## The idea in one sentence

**n8n** builds automations as **workflows**: a **trigger node** starts the workflow, and every following **node** receives a list of **items** (records), does one job with each — transform, filter, call an API — and passes its items on.

## Explain it like I'm twelve

Picture a conveyor belt in a toy factory. Something starts the belt (a button, a timer, a delivery at the door). Boxes ride along it, and at each station one worker does one thing to every box: paint it, check it, throw out broken ones. You can see every box at every station.

The belt is a **workflow**, the button is the **trigger**, each station is a **node**, and the boxes are **items**.

Where the analogy breaks: n8n's stations can split the belt in two — good boxes one way, bad boxes another — and some stations talk to other companies' machines (APIs).

## What problem it solves

Teams glue apps together all the time: a form submission should create a CRM record, post to chat and send an email. Writing and hosting a small program for each glue job is slow, and only programmers can change it. n8n provides hundreds of ready-made nodes, a visual editor, and a history of every execution — and it can be self-hosted, so the data stays on your own servers.

## How it works

![](media:n8n/items-flow.svg)

- A workflow is a set of nodes and the connections between them, stored as JSON.
- The **trigger node** starts an execution: by hand, on a schedule, on a webhook call and so on.
- Data passes between nodes as an **array of items**; each item wraps its data in a `json` key. A node processes every item it receives.
- n8n records each **execution**: which nodes ran and the items each one produced.

## Try it yourself

> **Local lab** — needs Docker. n8n runs in its official container, and the workflows are imported from JSON files with n8n's command-line tool, so you can see exactly what each workflow contains. Every command is run automatically in DevForge's tests. Run it where nothing else is called `devforge-n8n`; the last lesson of this series removes it.

### 1. Start n8n

```bash run
mkdir -p n8n-lab && cd n8n-lab
IMAGE=n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
docker pull -q "$IMAGE"
docker run -d --name devforge-n8n -p 127.0.0.1:5678:5678 -e N8N_DIAGNOSTICS_ENABLED=false "$IMAGE" > /dev/null
N8N=http://127.0.0.1:5678
for i in $(seq 1 90); do curl -sf "$N8N/healthz" > /dev/null && break; sleep 1; done
curl -s "$N8N/healthz"; echo
```

```text output
docker.io/n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
{"status":"ok"}
```

- The image is n8n's official one, pinned to version 2.49.6 and its digest. `docker pull -q` downloads it (about 1.3 GB, once).
- `-p 127.0.0.1:5678:5678` publishes n8n's port on your own computer only. `N8N_DIAGNOSTICS_ENABLED=false` turns off sending usage data to n8n.
- `/healthz` answers once the server is up.

### 2. Two helpers for the command line

```bash run
n8ncli() { docker exec -i -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n n8n "$@"; }
importwf() {
  docker exec -i devforge-n8n sh -c "cat > /tmp/$1"
  for i in $(seq 1 30); do out=$(n8ncli import:workflow --input="/tmp/$1" 2>&1) && break; sleep 2; done
  echo "$out" | tail -n 1
}
items() {
  for i in $(seq 1 5); do raw=$(n8ncli execute --id="$1" --rawOutput 2>&1) && echo "$raw" | grep -q '^{' && break; sleep 2; done
  echo "$raw" | docker exec -i devforge-n8n node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const start = s.search(/^\{/m);
      if (start < 0) { console.error(s); process.exit(1); }
      const run = JSON.parse(s.slice(start)).data.resultData.runData;
      for (const [node, [r]] of Object.entries(run)) {
        const out = r.data?.main ?? [];
        out.forEach((list, i) => console.log(`${node}${out.length > 1 ? ` (output ${i})` : ""}: ${JSON.stringify((list ?? []).map((it) => it.json))}`));
      }
    });'
}
```

- `n8ncli …` runs n8n's command-line tool inside the container. (`N8N_RUNNERS_BROKER_PORT` only moves an internal port so the command does not clash with the running server.)
- `importwf name.json` copies the workflow file you pipe into it into the container and imports it, retrying for a minute in case n8n is still finishing its start-up.
- `items ID` executes a workflow (trying again a few times if n8n is not ready) and prints, for every node, the items it produced — read from n8n's own execution record, the JSON that `--rawOutput` prints. If you open a new terminal, define all three again.

### 3. A workflow: three orders, keep the big ones

```bash run
importwf orders.json <<'EOF'
{
  "id": "bigorders01",
  "name": "Big orders",
  "nodes": [
    { "id": "n1", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {} },
    { "id": "n2", "name": "Orders", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0],
      "parameters": { "jsCode": "return [\n  { json: { customer: 'asha', total: 120 } },\n  { json: { customer: 'ravi', total: 40 } },\n  { json: { customer: 'meera', total: 300 } },\n];" } },
    { "id": "n3", "name": "Over 100", "type": "n8n-nodes-base.filter", "typeVersion": 2, "position": [440, 0],
      "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" }, "combinator": "and",
        "conditions": [ { "id": "f1", "leftValue": "={{ $json.total }}", "rightValue": 100, "operator": { "type": "number", "operation": "gt" } } ] }, "options": {} } }
  ],
  "connections": {
    "Start": { "main": [[ { "node": "Orders", "type": "main", "index": 0 } ]] },
    "Orders": { "main": [[ { "node": "Over 100", "type": "main", "index": 0 } ]] }
  },
  "settings": {}
}
EOF
```

```text output
Successfully imported 1 workflow.
```

The file is what the n8n editor stores when you draw this workflow by hand: three **nodes** — a manual trigger, a Code node that returns three orders as items, and a Filter that keeps orders over 100 — and the **connections** between them.

### 4. Execute it and look at every node's items

```bash run
items bigorders01
```

```text output
Start: [{}]
Orders: [{"customer":"asha","total":120},{"customer":"ravi","total":40},{"customer":"meera","total":300}]
Over 100 (output 0): [{"customer":"asha","total":120},{"customer":"meera","total":300}]
Over 100 (output 1): [{"customer":"ravi","total":40}]
```

- **Start** produced one empty item — the trigger just starts the run.
- **Orders** produced three items, each a `json` object.
- **Over 100** checked each item: asha's and meera's orders passed (output 0). n8n's execution record also lists the order it dropped, ravi's, separately (output 1).

Open <http://localhost:5678> in a browser to see the same workflow in the editor (n8n first asks you to create an owner account for this local instance). This step is not part of the automatic tests.

**Keep the container running** for the next lesson.

## Common mistakes

- **Thinking a node runs once.** Nodes process every item they receive; ten items in usually means ten results out.
- **Returning plain objects from a Code node.** Items wrap their data in a `json` key (n8n adds it if missing, but be explicit).
- **Building one giant workflow.** Small workflows that call each other are easier to test and reuse.
- **Exposing n8n to the internet without care.** Use HTTPS and strong authentication, keep it updated, and protect the encryption key n8n uses for stored credentials.

## Where this fits in a real system

n8n sits next to the systems it connects: it receives webhooks from forms or **GitHub**, calls REST APIs (the ones you test in **Postman**), and writes to **PostgreSQL** or posts to chat. It runs in **Docker**, often behind **Nginx** for HTTPS, and heavy or scheduled data pipelines usually stay in **Airflow**.
