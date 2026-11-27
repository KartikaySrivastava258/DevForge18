// Stand-in services for the event-registration workflow, on 127.0.0.1:9000 (inside the n8n container).
//   GET  /registrations?event=&email=   -> {"count": n, "registrations": [...]}   (exact match on both)
//   POST /registrations                 -> 201, stores the JSON body
//   POST /mail                          -> 202, records the e-mail {to, subject, text}
// Test controls (not for the workflow): GET /_state, POST /_reset, POST /_fail {"registrations": true}
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
