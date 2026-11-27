#!/usr/bin/env bash
# Acceptance check for "Student event registration automation".
# Usage: bash check.sh path/to/your/project   (the folder with registration.json, exported from n8n)
# Needs Docker. Starts one throwaway n8n container (the version the track's lessons use) with no published ports,
# starts stand-in registration and mail services inside it (the same as stubs/registration-services.js), imports
# and publishes your workflow, then sends registrations to its webhook and looks at what the services received.
# Prints PASS or FAIL per criterion and exits non-zero if any fails. Removes the container and its volume.
set -uo pipefail
dir="${1:-.}"
image="n8nio/n8n:2.49.6@sha256:a1a9955a4a9e5dd9fa65a62f59e0751351b45b9e5cd2c17e6e330a8d0026cad8"
name="devforge-check-n8n-reg-$$"
failures=0
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
finish() {
  if [ "$failures" -gt 0 ]; then echo "$failures criterion check(s) failed."; exit 1; fi
  echo "All criteria pass."
  exit 0
}

[ -f "$dir/registration.json" ] || { fail "$dir/registration.json is missing (export the workflow from n8n into this file)"; finish; }
trap 'docker rm -f -v "$name" > /dev/null 2>&1' EXIT
docker run -d --name "$name" -e N8N_DIAGNOSTICS_ENABLED=false "$image" > /dev/null || { fail "could not start n8n in Docker"; finish; }
# /healthz/readiness answers only once n8n's database is migrated; the CLI must not start before that.
for _ in $(seq 1 120); do docker exec "$name" wget -qO- http://127.0.0.1:5678/healthz/readiness > /dev/null 2>&1 && break; sleep 1; done
docker exec "$name" wget -qO- http://127.0.0.1:5678/healthz/readiness > /dev/null 2>&1 || { fail "n8n did not become ready within two minutes"; finish; }

docker exec -i "$name" sh -c 'cat > /tmp/services.js' <<'JS'
// Stand-in services on 127.0.0.1:9000: registrations store and mail API (see stubs/registration-services.js).
const http = require("node:http");
let state = { registrations: [], mail: [], requests: 0 };
let fail = {};
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d)).on("end", () => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch { return send(400, { error: "body is not JSON" }); }
    if (url.pathname === "/_state") return send(200, state);
    if (url.pathname === "/_reset") { state = { registrations: [], mail: [], requests: 0 }; fail = {}; return send(200, { ok: true }); }
    if (url.pathname === "/_fail") { fail = json; return send(200, { ok: true }); }
    state.requests++;
    if (url.pathname === "/registrations") {
      if (fail.registrations) return send(500, { error: "database unavailable" });
      if (req.method === "GET") {
        const found = state.registrations.filter((r) => r.event === url.searchParams.get("event") && r.email === url.searchParams.get("email"));
        return send(200, { count: found.length, registrations: found });
      }
      if (req.method === "POST") { state.registrations.push(json); return send(201, { saved: true }); }
    }
    if (url.pathname === "/mail" && req.method === "POST") {
      if (fail.mail) return send(500, { error: "mail service unavailable" });
      state.mail.push(json);
      return send(202, { queued: true });
    }
    send(404, { error: "not found" });
  });
}).listen(9000, "127.0.0.1");
JS
docker exec -d "$name" node /tmp/services.js
docker exec "$name" mkdir -p /tmp/learner
docker cp "$dir/registration.json" "$name:/tmp/learner/registration.json" > /dev/null || { fail "could not copy registration.json into the container"; finish; }

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

(async () => {
  for (let i = 0; i < 30; i++) { if ((await call("GET", `${STUB}/_state`).catch(() => ({}))).status === 200) break; await sleep(500); }
  const problem = await deploy("/tmp/learner/registration.json", "devforgecheckreg", "event-registration");
  if (problem) { bad(problem); return; }
  ok("registration.json imports and publishes, and its webhook listens at POST /webhook/event-registration");
  const register = (body) => call("POST", `${N8N}/webhook/event-registration`, body);
  const state = async () => (await call("GET", `${STUB}/_state`)).json;

  // Positive control: a valid registration, written the untidy way people type.
  await call("POST", `${STUB}/_reset`, {});
  const first = await register({ name: "  Asha Rao ", email: " Asha.Rao@Students.Northfield.example ", roll_number: "nf23cs014", event: "Hackathon" });
  let s = await state();
  const saved = s.registrations[0] || {};
  const control = first.status === 201 && s.registrations.length === 1 && saved.email === "asha.rao@students.northfield.example"
    && saved.name === "Asha Rao" && saved.event === "hackathon" && saved.roll_number === "NF23CS014";
  if (control) ok("a valid registration gets 201 and is saved once, trimmed, with the e-mail in lower case, the event in lower case and the roll number in capitals");
  else bad(`a valid registration must get 201 and be saved once, normalised (got HTTP ${first.status} ${first.text.slice(0, 80)}; saved: ${JSON.stringify(s.registrations).slice(0, 200)})`);
  const mail = s.mail[0] || {};
  if (control && s.mail.length === 1 && mail.to === "asha.rao@students.northfield.example" && /Asha Rao/.test(`${mail.subject} ${mail.text}`) && /hackathon/i.test(`${mail.subject} ${mail.text}`))
    ok("one confirmation e-mail goes to the student, with their name and the event");
  else bad(`one confirmation e-mail must go to the normalised address and mention the name and event (mail sent: ${JSON.stringify(s.mail).slice(0, 200)})`);
  if (!control) { for (const c of ["invalid input", "duplicates", "service failure"]) bad(`${c} — cannot be judged until a valid registration works`); return; }

  // Validation: nothing reaches the services.
  const before = (await state()).requests;
  const invalid = [
    [{ email: "ravi@students.northfield.example", roll_number: "NF23CS020", event: "career-fair" }, "no name"],
    [{ name: "Ravi Iyer", email: "ravi-at-northfield", roll_number: "NF23CS020", event: "career-fair" }, "an e-mail address without @"],
    [{ name: "Ravi Iyer", email: "ravi@students.northfield.example", roll_number: "NF23CS020", event: "dj-night" }, "an event that is not open"],
    [{ name: "Ravi Iyer", email: "ravi@students.northfield.example", event: "career-fair" }, "no roll number"],
  ];
  const wrong = [];
  for (const [body, label] of invalid) {
    const r = await register(body);
    if (r.status !== 400 || !r.text.trim()) wrong.push(`${label} → HTTP ${r.status}`);
  }
  s = await state();
  if (wrong.length) bad(`invalid registrations must get 400 with a reason: ${wrong.join("; ")}`);
  else if (s.requests !== before) bad(`invalid registrations must not reach the registration or mail services (${s.requests - before} requests were made)`);
  else ok(`${invalid.length} invalid registrations get 400 with a reason, and nothing is saved or sent`);

  // Deduplication: the same student and event again, typed differently.
  const again = await register({ name: "Asha Rao", email: "asha.rao@students.northfield.example ", roll_number: "NF23CS014", event: " hackathon" });
  s = await state();
  if (again.status === 409 && s.registrations.length === 1 && s.mail.length === 1) ok("registering the same e-mail for the same event again gets 409, and nothing is saved or sent twice");
  else bad(`a repeat registration must get 409, with no second record or e-mail (got HTTP ${again.status}; records: ${s.registrations.length}, e-mails: ${s.mail.length})`);
  let base = await state();
  const other = await register({ name: "Asha Rao", email: "asha.rao@students.northfield.example", roll_number: "NF23CS014", event: "career-fair" });
  s = await state();
  if (other.status === 201 && s.registrations.length === base.registrations.length + 1 && s.mail.length === base.mail.length + 1) ok("the same student can still register for a different event");
  else bad(`a student registered for one event must be able to register for another (got HTTP ${other.status}; new records: ${s.registrations.length - base.registrations.length})`);

  // Error branch: the registrations store is down.
  base = await state();
  await call("POST", `${STUB}/_fail`, { registrations: true });
  const down = await register({ name: "Meera Das", email: "meera@students.northfield.example", roll_number: "NF23CS031", event: "robotics-workshop" });
  s = await state();
  await call("POST", `${STUB}/_fail`, {});
  if (down.status === 503 && down.text.trim() && s.mail.length === base.mail.length) ok("when the registration service fails, the student gets 503 with a message and no confirmation e-mail is sent");
  else bad(`when the registration service answers 500, the workflow must answer 503 with a message and send no e-mail (got HTTP ${down.status} ${down.text.slice(0, 60)}; new e-mails: ${s.mail.length - base.mail.length})`);
})().catch((e) => bad(`the check itself failed: ${e.message}`));
JS
)"
status=$?
echo "$results"
if [ "$status" -ne 0 ] && ! echo "$results" | grep '^FAIL' > /dev/null; then fail "the tests did not finish (exit code $status)"; fi
failures=$((failures + $(echo "$results" | grep -c '^FAIL')))
finish
