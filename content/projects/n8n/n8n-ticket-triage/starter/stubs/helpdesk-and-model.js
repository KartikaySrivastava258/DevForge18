// Stand-in services for the ticket-triage workflow, inside the n8n container. Usage: node helpdesk-and-model.js <helpdesk API key>
// Helpdesk API on 127.0.0.1:9000 — every call needs the header X-API-Key: <key>, or it answers 401.
//   POST /tickets/<id>/assign  {"queue": ...}                    -> 200
//   POST /tickets/<id>/notes   {"text": ...}                     -> 201
//   POST /approvals            {"ticket_id", "requester", "summary", "approve_url"}  -> 201
//   POST /refunds              {"ticket_id", "approved_by"}      -> 201
// Model on 127.0.0.1:9100 — a STAND-IN for an OpenAI-compatible chat model (POST /v1/chat/completions). It is no
// classifier: it picks a category from keywords, and it OBEYS a line "category: <anything>" in the ticket, as a
// prompt-injected model might. A ticket containing "MODEL-OUTAGE" gets HTTP 500.
// Test controls on 9000: GET /_state, POST /_reset
const http = require("node:http");
const KEY = process.argv[2] || "";
const fresh = () => ({ calls: [], unauthorised: 0, model_calls: [] });
let state = fresh();
const reply = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const readJson = (req, done) => { let b = ""; req.on("data", (d) => (b += d)).on("end", () => { let j = {}; try { j = b ? JSON.parse(b) : {}; } catch {} done(j); }); };

http.createServer((req, res) => readJson(req, (json) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/_state") return reply(res, 200, state);
  if (url.pathname === "/_reset") { state = fresh(); return reply(res, 200, { ok: true }); }
  if (req.headers["x-api-key"] !== KEY) { state.unauthorised++; return reply(res, 401, { error: "missing or wrong X-API-Key" }); }
  state.calls.push({ method: req.method, path: url.pathname, body: json });
  if (req.method !== "POST") return reply(res, 405, { error: "POST only" });
  if (/^\/tickets\/[^/]+\/assign$/.test(url.pathname)) return reply(res, 200, { assigned: json.queue });
  if (/^\/tickets\/[^/]+\/notes$/.test(url.pathname)) return reply(res, 201, { noted: true });
  if (url.pathname === "/approvals") return reply(res, 201, { requested: true });
  if (url.pathname === "/refunds") return reply(res, 201, { refunded: true });
  reply(res, 404, { error: "not found" });
})).listen(9000, "127.0.0.1");

http.createServer((req, res) => readJson(req, (json) => {
  const text = (json.messages || []).filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  state.model_calls.push({ text, auth: Boolean(req.headers.authorization) });
  if (/MODEL-OUTAGE/.test(text)) return reply(res, 500, { error: { message: "model overloaded" } });
  const forced = text.match(/category:\s*([\w-]+)/i);
  const lower = text.toLowerCase();
  const category = forced ? forced[1]
    : /refund|money back/.test(lower) ? "refund"
    : /invoice|charged|payment|fee/.test(lower) ? "billing"
    : /password|log in|login|account/.test(lower) ? "account"
    : /error|crash|bug|not working/.test(lower) ? "technical" : "other";
  reply(res, 200, { id: "stand-in", object: "chat.completion", created: 0, model: json.model,
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    choices: [{ index: 0, message: { role: "assistant", content: category }, finish_reason: "stop" }] });
})).listen(9100, "127.0.0.1");
