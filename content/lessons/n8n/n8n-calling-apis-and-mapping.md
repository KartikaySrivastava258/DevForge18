---
id: n8n-calling-apis-and-mapping
title: Calling APIs and mapping data in depth
track: n8n
order: 4
level: intermediate
estimated_minutes: 45
prerequisites: [n8n-validation-and-errors]
starts_fresh: true
learning_objectives:
  - Call a paginated API with the HTTP Request node and fetch every page with its pagination settings.
  - Turn one response holding a list into one item per record with Split Out.
  - Map nested and missing fields to a flat shape with Edit Fields (Set) and expressions, including defaults and calculations.
  - Survive a rate-limited API with the node's Retry On Fail setting, and prove the retry happened.
resources:
  - title: HTTP Request node (n8n documentation)
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: Pagination options and the variables available to them ($pageCount, $request, $response with body, headers and statusCode); response formats.
    verification: { status: verified, checked_on: 2026-11-27 }
  - title: Split Out node (n8n documentation)
    url: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitout/
    publisher: n8n
    type: documentation
    level: intermediate
    official: true
    why: Separates a list inside one item into individual items, optionally keeping other fields.
    verification: { status: verified, checked_on: 2026-11-27 }
self_check:
  - id: pages
    prompt: The API returns 2 customers per page and a next_page field. How does the workflow get all customers?
    options:
      - { id: a, text: "Increase the timeout" }
      - { id: b, text: "Pagination: update the page parameter each request ($pageCount + 1) until an expression on the response (next_page is null) says it is complete" }
      - { id: c, text: "Call the API once with page=all" }
    answer: b
    explanation: The lab fetches two pages and stops on its own; without pagination it would silently report only the first two customers.
  - id: missing
    prompt: One customer has no address.city. What should the mapping do?
    options:
      - { id: a, text: "Let the expression fail" }
      - { id: b, text: "Decide on purpose — a default such as 'unknown' (as here), or route the item to an error branch if the field is required" }
      - { id: c, text: "Drop the customer silently" }
    answer: b
    explanation: Real APIs omit fields; the mapping is where you decide what that means.
  - id: retry
    prompt: An API answers 429 Too Many Requests now and then. What is the simplest fix inside the workflow?
    options:
      - { id: a, text: "Ignore errors" }
      - { id: b, text: "Turn on Retry On Fail with a wait between tries, so a short rate limit is ridden out — and keep a limit on tries so real failures still surface" }
      - { id: c, text: "Call the API twice every time" }
    answer: b
    explanation: "The lab's API counter shows the retry — one refused request, one successful one."
verification:
  method: executed
  details: Every command is run by the test suite on a disposable Docker engine with the official n8nio/n8n:2.49.6 image (pinned by digest), starting from nothing, and its output is compared with this lesson. The "partner API" is a 25-line Node.js stand-in running inside the n8n container, so the lab needs no internet access and gives the same answers every time. Checked against the n8n documentation and the node definitions in n8n 2.49.6 on 2026-11-27.
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## The idea in one sentence

Most real workflows **fetch** data from an API (all of it, page by page, surviving rate limits), **reshape** it from the API's nested structure into one clean item per record, and only then act on it — and in n8n that is HTTP Request with pagination and retries, Split Out, and Edit Fields with expressions.

## Explain it like I'm twelve

The library sends its book list two books per page, each written its own way: "surname, first name", sometimes with no shelf number. You collect every page, cut the list into one card per book, and copy each onto a standard card — "Name: …, Shelf: … (unknown if missing), Times borrowed: …". If the librarian says "busy, come back in a second", you wait and ask again, instead of going home with nothing.

## What problem it solves

APIs rarely hand over exactly what the next step needs: results come in pages, records are nested, fields are missing, numbers arrive as strings, and busy services answer "429 Too Many Requests". A workflow that reads only the first page, crashes on a missing field or gives up on one 429 is wrong in quiet ways. Doing the fetching and mapping deliberately makes every later step simpler and the results trustworthy.

## How it works

![](media:n8n/api-mapping.svg)

- **HTTP Request** with **Pagination**: "update a parameter in each request" sets `page` to `{{ $pageCount + 1 }}`; "complete when" an expression on `$response.body` is true. Each page becomes one output item.
- **Split Out** turns the `data` list in each page item into one item per customer.
- **Edit Fields (Set)** builds new fields from expressions: `{{ $json.name.first }} {{ $json.name.last }}`, `{{ $json.address.city ?? 'unknown' }}`, and plain JavaScript such as `reduce` to add up order totals (which arrive as strings, so `Number(…)`).
- **Retry On Fail** (a node setting, next to the parameters) retries failed requests a set number of times with a wait in between.

## Try it yourself

> **Local lab** — needs Docker. n8n runs as in *Workflows, nodes and items*, and a tiny stand-in "partner API" runs inside the same container on port 9000 — paginated customers, and a rates endpoint that is rate-limited once. Every command is run automatically in DevForge's tests.

### 1. n8n, the helpers, and a stand-in API

```bash run
mkdir -p n8n-api && cd n8n-api
IMAGE=n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8
docker pull -q "$IMAGE" > /dev/null
docker run -d --name devforge-n8n -p 127.0.0.1:5678:5678 -e N8N_DIAGNOSTICS_ENABLED=false "$IMAGE" > /dev/null
N8N=http://127.0.0.1:5678
for i in $(seq 1 120); do curl -sf "$N8N/healthz/readiness" > /dev/null && break; sleep 1; done
n8ncli() { docker exec -i -e N8N_RUNNERS_BROKER_PORT=5680 devforge-n8n n8n "$@"; }
importwf() {
  docker exec -i devforge-n8n sh -c "cat > /tmp/$1"
  for i in $(seq 1 30); do out=$(n8ncli import:workflow --input="/tmp/$1" 2>&1) && break; sleep 2; done
  echo "$out" | tail -n 1
}
items() {   # run a workflow and print each node's output items
  raw=$(n8ncli execute --id="$1" --rawOutput 2>&1) || true
  echo "$raw" | docker exec -i devforge-n8n node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const start = s.search(/^\{/m), end = s.search(/^Error executing workflow/m);
      const result = JSON.parse(s.slice(start, end < 0 ? undefined : end)).data.resultData;
      if (result.error) { console.log("workflow failed:", result.error.message); return; }
      for (const [node, [r]] of Object.entries(result.runData))
        console.log(`${node}: ${JSON.stringify((r.data?.main?.[0] ?? []).map((it) => it.json))}`);
    });'
}
docker exec -i devforge-n8n sh -c 'cat > /tmp/partner-api.js' <<'EOF'
// Stand-in for a partner API: paginated customers with nested fields, and rates that are rate-limited once.
const http = require("node:http");
const CUSTOMERS = [
  { id: 1, name: { first: "Asha", last: "Rao" }, address: { city: "Pune" }, orders: [{ total: "120.50" }, { total: "80" }] },
  { id: 2, name: { first: "Ravi", last: "Iyer" }, address: { city: "Chennai" }, orders: [] },
  { id: 3, name: { first: "Meera", last: "Das" }, address: {}, orders: [{ total: "300" }] },
];
let refusals = 0, rateRequests = 0;
http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/customers") {
    const page = Number(url.searchParams.get("page") || 1);
    return send(200, { data: CUSTOMERS.slice((page - 1) * 2, page * 2), page, next_page: page * 2 < CUSTOMERS.length ? page + 1 : null });
  }
  if (url.pathname === "/rates") { rateRequests++; return refusals++ < 1 ? send(429, { error: "slow down" }) : send(200, { INR: 1, USD: 0.012 }); }
  if (url.pathname === "/reset") { refusals = 0; rateRequests = 0; return send(200, { ok: true }); }
  if (url.pathname === "/stats") return send(200, { rateRequests });
  send(404, { error: "not found" });
}).listen(9000, "127.0.0.1");
EOF
docker exec -d devforge-n8n node /tmp/partner-api.js
api() { docker exec devforge-n8n node -e "fetch('http://127.0.0.1:9000$1').then((r) => r.text()).then(console.log)"; }
for i in $(seq 1 20); do api /customers?page=2 > /dev/null 2>&1 && break; sleep 0.5; done
api "/customers?page=1"
```

```text output
{"data":[{"id":1,"name":{"first":"Asha","last":"Rao"},"address":{"city":"Pune"},"orders":[{"total":"120.50"},{"total":"80"}]},{"id":2,"name":{"first":"Ravi","last":"Iyer"},"address":{"city":"Chennai"},"orders":[]}],"page":1,"next_page":2}
```

Look at the response before building anything: two customers per page, names split into `first` and `last`, the city nested under `address`, order totals as **strings**, and `next_page` telling you whether more pages exist. (The image has no `curl`, so `api` uses Node's built-in `fetch` inside the container.)

### 2. Fetch every page, one item per customer, mapped

```bash run
importwf customers.json <<'EOF'
{
  "id": "customers001",
  "name": "Customer report",
  "nodes": [
    { "id": "a1", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {} },
    { "id": "a2", "name": "Get customers", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [220, 0],
      "parameters": { "url": "http://127.0.0.1:9000/customers", "options": { "pagination": { "pagination": {
        "paginationMode": "updateAParameterInEachRequest",
        "parameters": { "parameters": [ { "type": "qs", "name": "page", "value": "={{ $pageCount + 1 }}" } ] },
        "paginationCompleteWhen": "other",
        "completeExpression": "={{ $response.body.next_page === null }}" } } } } },
    { "id": "a3", "name": "One item per customer", "type": "n8n-nodes-base.splitOut", "typeVersion": 1, "position": [440, 0],
      "parameters": { "fieldToSplitOut": "data", "options": {} } },
    { "id": "a4", "name": "Map fields", "type": "n8n-nodes-base.set", "typeVersion": 3.4, "position": [660, 0],
      "parameters": { "assignments": { "assignments": [
        { "id": "f1", "name": "customer", "type": "string", "value": "={{ $json.name.first }} {{ $json.name.last }}" },
        { "id": "f2", "name": "city", "type": "string", "value": "={{ $json.address.city ?? 'unknown' }}" },
        { "id": "f3", "name": "orders", "type": "number", "value": "={{ $json.orders.length }}" },
        { "id": "f4", "name": "spent", "type": "number", "value": "={{ $json.orders.reduce((sum, o) => sum + Number(o.total), 0) }}" }
      ] }, "options": {} } }
  ],
  "connections": {
    "Start": { "main": [[{ "node": "Get customers", "type": "main", "index": 0 }]] },
    "Get customers": { "main": [[{ "node": "One item per customer", "type": "main", "index": 0 }]] },
    "One item per customer": { "main": [[{ "node": "Map fields", "type": "main", "index": 0 }]] }
  },
  "settings": {}, "active": false
}
EOF
items customers001 > run.txt
grep '^Map fields' run.txt
echo "pages fetched: $(grep '^Get customers' run.txt | grep -o '"page":' | wc -l), customer items: $(grep '^One item per customer' run.txt | grep -o '"id":' | wc -l)"
```

```text output
Successfully imported 1 workflow.
Map fields: [{"customer":"Asha Rao","city":"Pune","orders":2,"spent":200.5},{"customer":"Ravi Iyer","city":"Chennai","orders":0,"spent":0},{"customer":"Meera Das","city":"unknown","orders":1,"spent":300}]
pages fetched: 2, customer items: 3
```

- **Pagination** asked for page 1, then page 2 (`$pageCount + 1`), and stopped when `next_page` was `null` — two page items. Without it, Meera would simply be missing from the report, with no error.
- **Split Out** turned the two page items into three customer items.
- **Map fields** produced a flat, predictable shape: the name joined, the missing city defaulted to `unknown` instead of breaking, the number of orders counted, and the string totals converted with `Number(…)` before adding (`"120.50" + "80"` would otherwise be text, not 200.5).

### 3. A rate-limited API, with and without retries

```bash run
for mode in once retried; do
  settings=""
  [ "$mode" = retried ] && settings='"retryOnFail": true, "maxTries": 3, "waitBetweenTries": 1000,'
  importwf "rates-$mode.json" <<EOF
{ "id": "rates${mode}01", "name": "Rates ($mode)", "nodes": [
  { "id": "b1", "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0], "parameters": {} },
  { "id": "b2", "name": "Get rates", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [220, 0], $settings
    "parameters": { "url": "http://127.0.0.1:9000/rates", "options": {} } } ],
  "connections": { "Start": { "main": [[{ "node": "Get rates", "type": "main", "index": 0 }]] } }, "settings": {}, "active": false }
EOF
  api /reset > /dev/null
  echo "--- $mode"
  items "rates${mode}01" | grep -v '^Start'
  echo "requests the API received: $(api /stats | grep -o '[0-9]*')"
done
```

```text output
Successfully imported 1 workflow.
--- once
workflow failed: The service is receiving too many requests from you
requests the API received: 1
Successfully imported 1 workflow.
--- retried
Get rates: [{"INR":1,"USD":0.012}]
requests the API received: 2
```

- Without retries, a single `429` failed the whole workflow — n8n reports it as "The service is receiving too many requests from you".
- With **Retry On Fail** (`retryOnFail`, `maxTries`, `waitBetweenTries` — node settings, not parameters), the node waited a second and tried again: the API's counter shows one refused and one successful request.
- Keep `maxTries` small: retries are for short, temporary trouble. A persistent failure should still fail and reach the error handling from *Validating input and handling errors*.

### 4. Clean up

```bash run
docker rm -f devforge-n8n > /dev/null
echo removed
```

```text output
removed
```

## Common mistakes

- **Reading only the first page.** Totals and reports are silently wrong; configure pagination and check the page count once.
- **Mapping without defaults.** Real data has missing fields; decide per field: default, skip, or error.
- **Adding numbers that arrived as strings.** Convert first (`Number(…)`), or `"120.50" + "80"` becomes `"120.5080"`.
- **Unlimited or immediate retries.** They hammer a struggling API; wait between tries and cap the count.
- **Credentials in the URL or the workflow JSON.** Use n8n credentials so secrets are encrypted and not exported with the workflow (see *Self-hosting securely*).

## Where this fits in a real system

The same fetch–split–map pattern feeds **PostgreSQL** tables, **Kafka** topics or **Airflow**-scheduled reports; APIs you build and document in the **Postman** track are what these nodes call; and rate limits like this one are enforced by gateways such as **Nginx** in front of real APIs.
