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
