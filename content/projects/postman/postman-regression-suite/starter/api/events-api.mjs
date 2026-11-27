// Campus events API — the service your regression suite tests. Do not change this file: the check starts its own
// copy of it.
//
//   node api/events-api.mjs                     the current release on http://127.0.0.1:7403 (PORT=… changes the port)
//   BUG=delete-noop node api/events-api.mjs     a release with a regression (the list is below)
//   HARMLESS=1 node api/events-api.mjs          a release with harmless changes your suite must still accept
//
// Data lives in memory and starts with two events; restart the API to reset it. Every request is logged as
// "METHOD /path -> status [error [fields]]".
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 7403);
const BUG = process.env.BUG ?? "";
// Harmless changes a later release might make: an extra field, another id format, the list in another order.
// A regression suite must not fail on these — clients that follow the contract are not affected.
const HARMLESS = process.env.HARMLESS === "1";
// Regressions the check runs your suite against — each one breaks the contract in the README.
const BUGS = {
  "patch-ignored": "PATCH /events/{id} answers with the changed event but does not save the change",
  "delete-noop": "DELETE /events/{id} answers 204 but the event is still there",
  "list-stale": "GET /events leaves out events created since the API started",
  "capacity-zero": "POST /events accepts a capacity of 0 (the lower limit is off by one)",
  "impossible-date": "POST /events accepts dates that do not exist, such as 2027-02-30",
  "no-details": "validation errors no longer say which fields are invalid (details is missing)",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const events = new Map();
const seedIds = new Set();
const newId = () => (HARMLESS ? crypto.randomUUID() : `evt_${crypto.randomBytes(6).toString("hex")}`);
function store(fields, seed = false) {
  const event = { id: newId(), ...fields, createdAt: new Date().toISOString(), ...(HARMLESS ? { organiser: "Student Council" } : {}) };
  events.set(event.id, event);
  if (seed) seedIds.add(event.id);
  return event;
}
store({ title: "Freshers' orientation", date: "2027-07-20", capacity: 400, venue: "Main Auditorium" }, true);
store({ title: "Robotics club demo day", date: "2027-08-02", capacity: 60, venue: "Lab Block 3" }, true);

// Checks the fields present in `input`; with `partial` false, all four are required. Returns a list of problems.
function validate(input, partial) {
  const problems = [];
  const has = (f) => input[f] !== undefined;
  const check = (field, ok, message) => {
    if (!has(field)) {
      if (!partial) problems.push({ field, message: `${field} is required.` });
    } else if (!ok(input[field])) problems.push({ field, message });
  };
  check("title", (v) => typeof v === "string" && v.trim().length >= 3 && v.length <= 80, "title must be 3 to 80 characters.");
  check("date", (v) => typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && (BUG === "impossible-date" || realDate(v)), "date must be a real date as YYYY-MM-DD.");
  const minCapacity = BUG === "capacity-zero" ? 0 : 1;
  check("capacity", (v) => Number.isInteger(v) && v >= minCapacity && v <= 500, "capacity must be a whole number from 1 to 500.");
  check("venue", (v) => typeof v === "string" && v.trim().length > 0, "venue must not be empty.");
  for (const key of Object.keys(input)) if (!["title", "date", "capacity", "venue"].includes(key)) problems.push({ field: key, message: `${key} is not a field of an event.` });
  return problems;
}
function realDate(text) {
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function send(req, res, status, body, note = "") {
  console.log(`${req.method} ${req.url} -> ${status}${note}`);
  res.writeHead(status, body === undefined ? {} : { "content-type": "application/json; charset=utf-8" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
const fail = (req, res, status, code, message, details) => {
  const error = { code, message, ...(details && BUG !== "no-details" ? { details } : {}) };
  send(req, res, status, { error }, ` ${code}${details ? ` [${details.map((d) => d.field).join(",")}]` : ""}`);
};
function readJson(req, res, then) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return fail(req, res, 415, "unsupported_media_type", "Send the request body as application/json.");
  let text = "";
  req.on("data", (chunk) => (text += chunk));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return fail(req, res, 400, "invalid_json", "The body is not valid JSON.");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(req, res, 400, "invalid_json", "The body must be a JSON object.");
    then(body);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") return send(req, res, 200, { status: "ok" });

    if (parts[0] === "events" && parts.length === 1) {
      if (req.method === "GET") {
        let list = [...events.values()];
        if (BUG === "list-stale") list = list.filter((e) => seedIds.has(e.id));
        list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        if (HARMLESS) list.reverse();
        return send(req, res, 200, { events: list });
      }
      if (req.method === "POST") {
        return readJson(req, res, (body) => {
          const problems = validate(body, false);
          if (problems.length) return fail(req, res, 400, "validation_failed", "Some fields are invalid.", problems);
          const event = store({ title: body.title, date: body.date, capacity: body.capacity, venue: body.venue });
          send(req, res, 201, { event });
        });
      }
      return fail(req, res, 405, "method_not_allowed", `${req.method} is not supported here.`);
    }

    if (parts[0] === "events" && parts.length === 2) {
      const event = events.get(parts[1]);
      if (!["GET", "PATCH", "DELETE"].includes(req.method)) return fail(req, res, 405, "method_not_allowed", `${req.method} is not supported here.`);
      if (!event) return fail(req, res, 404, "not_found", "Event not found.");
      if (req.method === "GET") return send(req, res, 200, { event });
      if (req.method === "DELETE") {
        if (BUG !== "delete-noop") events.delete(event.id);
        return send(req, res, 204);
      }
      return readJson(req, res, (body) => {
        const problems = validate(body, true);
        if (problems.length) return fail(req, res, 400, "validation_failed", "Some fields are invalid.", problems);
        const changed = { ...event, ...body };
        if (BUG !== "patch-ignored") events.set(event.id, changed);
        send(req, res, 200, { event: changed });
      });
    }

    fail(req, res, 404, "not_found", "No such endpoint.");
  })
  .listen(PORT, "127.0.0.1", () => console.log(`events API${BUG ? ` (BUG=${BUG})` : ""}${HARMLESS ? " (HARMLESS=1)" : ""} on http://127.0.0.1:${PORT}`));
