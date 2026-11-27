#!/usr/bin/env bash
# Acceptance check for "Assignment reminder workflow".
# Usage: bash check.sh path/to/your/project   (the folder with reminders.json, exported from n8n)
# Needs Docker. Starts one throwaway n8n container (the version the track's lessons use) with no published ports,
# starts the stand-in assignment, reminder-log, mail and alert services inside it (the same as
# stubs/assignment-services.js), imports and publishes your workflow, and runs it through its webhook with pinned
# "now" times — 1 and 2 December 2026, 08:00 at the college — so the result does not depend on today's date. The
# daily schedule itself is read from the file. Prints PASS or FAIL per criterion and exits non-zero if any fails.
# Removes the container and its volume.
set -uo pipefail
dir="${1:-.}"
image="n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8"
name="devforge-check-n8n-rem-$$"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}

[ -f "$dir/reminders.json" ] || { fail "$dir/reminders.json is missing (export the workflow from n8n into this file)"; finish; }
trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" -e N8N_DIAGNOSTICS_ENABLED=false "$image" > /dev/null || { fail "could not start n8n in Docker"; finish; }
# /healthz/readiness answers only once n8n's database is migrated; the CLI must not start before that.
for _ in $(seq 1 120); do docker exec "$name" wget -qO- http://127.0.0.1:5678/healthz/readiness > /dev/null 2>&1 && break; sleep 1; done
docker exec "$name" wget -qO- http://127.0.0.1:5678/healthz/readiness > /dev/null 2>&1 || { fail "n8n did not become ready within two minutes"; finish; }

docker exec -i "$name" sh -c 'cat > /tmp/services.js' <<'JS'
// Stand-in services for the assignment-reminder workflow, on 127.0.0.1:9000 (inside the n8n container).
//   GET  /assignments      -> {"assignments": [{id, course, title, due, students: [{name, email, submitted}]}]}
//   GET  /reminders-sent   -> {"sent": [{assignment_id, email}]}      (the reminder log)
//   POST /reminders-sent   -> 201, body {"entries": [{assignment_id, email}, ...]} is added to the log
//   POST /mail             -> 202, records {to, subject, text}; answers 500 for bounce@students.northfield.example
//   POST /alerts           -> 201, records the body (for the course coordinator)
// Test controls: GET /_state, POST /_reset
const http = require("node:http");
const ASSIGNMENTS = [
  { id: "dbms-lab-4", course: "Database systems", title: "DBMS lab 4", due: "2026-12-02T23:59:00+05:30", students: [
    { name: "Asha Rao", email: "asha@students.northfield.example", submitted: false },
    { name: "Ravi Iyer", email: "ravi@students.northfield.example", submitted: true },
    { name: "Meera Das", email: "meera@students.northfield.example", submitted: false } ] },
  { id: "os-quiz-2", course: "Operating systems", title: "OS quiz 2", due: "2026-12-03T08:00:00+05:30", students: [
    { name: "Kiran Shah", email: "kiran@students.northfield.example", submitted: false } ] },
  { id: "networks-report", course: "Computer networks", title: "Networks report", due: "2026-12-03T08:01:00+05:30", students: [
    { name: "Asha Rao", email: "asha@students.northfield.example", submitted: false } ] },
  { id: "maths-sheet-6", course: "Discrete mathematics", title: "Maths sheet 6", due: "2026-11-30T23:59:00+05:30", students: [
    { name: "Ravi Iyer", email: "ravi@students.northfield.example", submitted: false } ] },
  { id: "compilers-project", course: "Compilers", title: "Compilers project", due: "2026-12-02T02:30:00Z", students: [
    { name: "Bounce Test", email: "bounce@students.northfield.example", submitted: false },
    { name: "Neha Joshi", email: "neha@students.northfield.example", submitted: false } ] },
];
const fresh = () => ({ sent: [], mail: [], alerts: [], requests: 0 });
let state = fresh();
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch { return send(400, { error: "body is not JSON" }); }
    if (url.pathname === "/_state") return send(200, state);
    if (url.pathname === "/_reset") { state = fresh(); return send(200, { ok: true }); }
    state.requests++;
    if (url.pathname === "/assignments" && req.method === "GET") return send(200, { assignments: ASSIGNMENTS });
    if (url.pathname === "/reminders-sent" && req.method === "GET") return send(200, { sent: state.sent });
    if (url.pathname === "/reminders-sent" && req.method === "POST") {
      if (!Array.isArray(json.entries)) return send(400, { error: "expected {\"entries\": [...]}" });
      state.sent.push(...json.entries.map((e) => ({ assignment_id: e.assignment_id, email: e.email })));
      return send(201, { logged: json.entries.length });
    }
    if (url.pathname === "/mail" && req.method === "POST") {
      if (json.to === "bounce@students.northfield.example") return send(500, { error: "mailbox unavailable" });
      state.mail.push(json);
      return send(202, { queued: true });
    }
    if (url.pathname === "/alerts" && req.method === "POST") { state.alerts.push(json); return send(201, { ok: true }); }
    send(404, { error: "not found" });
  });
}).listen(9000, "127.0.0.1");
JS
docker exec -d "$name" node /tmp/services.js
docker exec "$name" mkdir -p /tmp/learner
docker cp "$dir/reminders.json" "$name:/tmp/learner/reminders.json" > /dev/null || { fail "could not copy reminders.json into the container"; finish; }

# The tests: Node.js inside the n8n container (it has no curl), using n8n's own CLI to import and publish.
results="$(timeout 240 docker exec -i "$name" node - 2>&1 <<'JS'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const ok = (m) => console.log(`PASS: ${m}`);
const bad = (m) => console.log(`FAIL: ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N8N = "http://127.0.0.1:5678", STUB = "http://127.0.0.1:9000";
const cli = (...args) => execFileSync("n8n", args, { env: { ...process.env, N8N_RUNNERS_BROKER_PORT: "5680" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
/** Import the workflow under a fixed id, publish it, and wait until its POST webhook is registered. */
async function deploy(file, id, path) {
  let wf;
  try { wf = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return `${file.split("/").pop()} is not valid JSON (${e.message})`; }
  if (Array.isArray(wf) && wf.length === 1) wf = wf[0];   // "n8n export:workflow --id=…" writes a list of one
  if (!Array.isArray(wf.nodes) || typeof wf.connections !== "object") return `${file.split("/").pop()} is not an n8n workflow export (no nodes or connections)`;
  Object.assign(wf, { id, active: false });
  fs.writeFileSync(`/tmp/${id}.json`, JSON.stringify(wf));
  let last = "";
  for (let i = 0; i < 20; i++) {
    try { cli("import:workflow", `--input=/tmp/${id}.json`); last = ""; break; } catch (e) { last = String(e.stderr || e.message).trim().split("\n").pop(); await sleep(2000); }
  }
  if (last) return `n8n could not import the workflow: ${last}`;
  try { cli("publish:workflow", `--id=${id}`); } catch (e) { return `n8n could not publish the workflow: ${String(e.stderr || e.message).trim().split("\n").pop()}`; }
  for (let i = 0; i < 60; i++) {
    const r = await call("GET", `${N8N}/webhook/${path}`).catch(() => ({ text: "" }));
    if (/POST/.test(r.text)) return null;   // a GET on a registered POST-only webhook says it expects POST
    await sleep(1000);
  }
  return `no POST webhook at /webhook/${path} after publishing — check the Webhook node's path and method`;
}
// The schedule cannot be waited for in a check, so its settings are read from the file: daily at 08:00, in the
// college's time zone, and connected to the same logic the webhook runs (the path that sends e-mail).
function scheduleProblem(wf) {
  const triggers = wf.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  if (triggers.length !== 1) return `expected one Schedule Trigger node (found ${triggers.length})`;
  const rules = triggers[0].parameters?.rule?.interval ?? [{}];
  const daily8 = (r) => {
    if (r.field === "cronExpression") {
      const f = String(r.expression ?? "").trim().split(/\s+/);
      const [min, hour, ...rest] = f.length === 6 ? f.slice(1) : f;
      return (f.length === 5 || (f.length === 6 && f[0] === "0")) && Number(min) === 0 && Number(hour) === 8 && rest.every((x) => x === "*");
    }
    return (r.field ?? "days") === "days" && (r.daysInterval ?? 1) === 1 && r.triggerAtHour === 8 && (r.triggerAtMinute ?? 0) === 0;
  };
  if (rules.length !== 1 || !daily8(rules[0])) return `the Schedule Trigger must run once a day at 08:00 (rule: ${JSON.stringify(rules)})`;
  if (wf.settings?.timezone !== "Asia/Kolkata") return `the workflow's time zone (Workflow settings) must be Asia/Kolkata, so 08:00 means 08:00 at the college (it is ${JSON.stringify(wf.settings?.timezone ?? "the instance default")})`;
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const seen = new Set(), queue = [triggers[0].name];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const outputs of Object.values(wf.connections[name] ?? {})) for (const list of outputs ?? []) for (const c of list ?? []) queue.push(c.node);
  }
  if (![...seen].some((n) => JSON.stringify(byName[n]?.parameters ?? {}).includes("/mail"))) return "the Schedule Trigger must lead to the node that sends the reminder e-mails";
  return null;
}

(async () => {
  for (let i = 0; i < 30; i++) { if ((await call("GET", `${STUB}/_state`).catch(() => ({}))).status === 200) break; await sleep(500); }
  let wf = null;
  try { wf = JSON.parse(fs.readFileSync("/tmp/learner/reminders.json", "utf8")); } catch {}
  if (Array.isArray(wf) && wf.length === 1) wf = wf[0];
  const problem = await deploy("/tmp/learner/reminders.json", "devforgecheckrem", "assignment-reminders");
  if (problem) { bad(problem); return; }
  ok("reminders.json imports and publishes, and its webhook listens at POST /webhook/assignment-reminders");
  const sched = scheduleProblem(wf);
  sched ? bad(`schedule: ${sched}`) : ok("a Schedule Trigger runs the same reminder logic every day at 08:00 Asia/Kolkata");

  const run = (now) => call("POST", `${N8N}/webhook/assignment-reminders`, { now });
  const state = async () => (await call("GET", `${STUB}/_state`)).json;
  const key = (m) => `${m.to}|${(String(m.subject) + " " + String(m.text)).match(/DBMS lab 4|OS quiz 2|Networks report|Maths sheet 6|Compilers project/)?.[0] ?? "?"}`;

  // Positive control: Tuesday 1 December 2026, 08:00 at the college.
  await call("POST", `${STUB}/_reset`, {});
  const first = await run("2026-12-01T08:00:00+05:30");
  let s = await state();
  const got = new Set(s.mail.map(key));
  const want = ["asha@students.northfield.example|DBMS lab 4", "meera@students.northfield.example|DBMS lab 4",
                "kiran@students.northfield.example|OS quiz 2", "neha@students.northfield.example|Compilers project"];
  const control = first.status === 200 && want.every((w) => got.has(w)) && s.mail.length === 4;
  if (control) ok("at 08:00 on 1 December, exactly the 4 due reminders are sent, each naming its assignment");
  else {
    const why = [];
    if (first.status !== 200) why.push("the webhook must answer 200 with a summary, even when an e-mail fails");
    if (got.size === 0) why.push("no reminder was sent");
    else if (got.has("ravi@students.northfield.example|DBMS lab 4")) why.push("Ravi already submitted DBMS lab 4");
    if (got.has("asha@students.northfield.example|Networks report")) why.push("Networks report is due 48 hours and 1 minute later — outside the window");
    if (got.has("ravi@students.northfield.example|Maths sheet 6")) why.push("Maths sheet 6 was due yesterday");
    if (got.size && !got.has("kiran@students.northfield.example|OS quiz 2")) why.push("OS quiz 2 is due exactly 48 hours later — inside the window");
    if (got.size && !got.has("neha@students.northfield.example|Compilers project")) why.push("Compilers project is due 2026-12-02T02:30:00Z, which is 08:00 at the college the next day");
    if ([...got].some((k) => k.endsWith("|?"))) why.push("every e-mail must name the assignment's title");
    bad(`expected reminders to ${want.join(", ")} (HTTP ${first.status}; sent ${s.mail.length}: ${[...got].join(", ") || "none"})${why.length ? " — " + why.join("; ") : ""}`);
  }
  if (!control) { for (const c of ["failed e-mails", "no repeats", "the next day", "a bad time"]) bad(`${c} — cannot be judged until the first run sends the right reminders`); return; }

  const alert = JSON.stringify(s.alerts);
  if (first.json?.sent === 4 && first.json?.failed === 1 && s.alerts.length === 1 && alert.includes("bounce@students.northfield.example"))
    ok("the e-mail that fails does not stop the others: the reply says sent 4, failed 1, and one alert names the failed address");
  else bad(`a failing address must not stop the run: reply {"sent": 4, "failed": 1, …} and one alert naming bounce@students.northfield.example (reply: ${first.text.slice(0, 80)}; alerts: ${alert.slice(0, 120)})`);

  const repeat = await run("2026-12-01T08:00:00+05:30");
  s = await state();
  if (repeat.status === 200 && s.mail.length === 4 && repeat.json?.sent === 0) ok("running again for the same time sends no reminder twice");
  else bad(`a second run at the same time must send nothing new and reply "sent": 0 (HTTP ${repeat.status} ${repeat.text.slice(0, 80)}; e-mails now ${s.mail.length})`);

  const next = await run("2026-12-02T08:00:00+05:30");
  s = await state();
  const added = s.mail.slice(4).map(key);
  if (next.status === 200 && added.length === 1 && added[0] === "asha@students.northfield.example|Networks report") ok("the next morning only the newly due reminder is sent (Networks report to Asha)");
  else bad(`at 08:00 on 2 December only Asha's Networks report reminder is new (HTTP ${next.status}; new: ${added.join(", ") || "none"})`);

  const before = s.mail.length;
  const badTime = await run("tomorrow morning");
  s = await state();
  if (badTime.status === 400 && badTime.text.trim() && s.mail.length === before) ok("a \"now\" that is not an ISO 8601 date and time gets 400, and nothing is sent");
  else bad(`{"now": "tomorrow morning"} must get 400 with a reason and send nothing (HTTP ${badTime.status}; new e-mails: ${s.mail.length - before})`);
})().catch((e) => bad(`the check itself failed: ${e.message}`));
JS
)"
status=$?
echo "$results"
if [ "$status" -ne 0 ] && ! echo "$results" | grep '^FAIL' > /dev/null; then fail "the tests did not finish (exit code $status)"; fi
failures=$((failures + $(echo "$results" | grep -c '^FAIL')))
finish
