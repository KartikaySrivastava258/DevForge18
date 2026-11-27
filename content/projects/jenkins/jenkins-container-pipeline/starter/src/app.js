// Campus Notes API: a small REST API built on Node's http module (no dependencies).
// createApp() returns an http.Server that is not listening yet; server.js starts it, and the tests
// start it on port 0 (a free port) so they never clash with anything else on the machine.
import { createServer } from "node:http";

const MAX_TITLE = 120;
const MAX_BODY_BYTES = 10_000;

function send(res, status, data, headers = {}) {
  const body = data === undefined ? "" : JSON.stringify(data);
  res.writeHead(status, { ...(body ? { "content-type": "application/json" } : {}), ...headers });
  res.end(body);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new Error("body too large");
  }
  return JSON.parse(raw);
}

/** Returns an error message, or null when the note is valid. */
export function validateNote(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "send a JSON object";
  if (typeof input.title !== "string") return "title is required";
  // Fixed bug: the starter checked input.title.length, so a title of only spaces was accepted.
  const title = input.title.trim();
  if (title.length === 0) return "title must not be blank";
  if (title.length > MAX_TITLE) return `title must be at most ${MAX_TITLE} characters`;
  if (input.body !== undefined && typeof input.body !== "string") return "body must be a string";
  return null;
}

export function createApp() {
  const notes = new Map();
  let nextId = 1;

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const match = /^\/api\/notes\/(\d+)$/.exec(url.pathname);

    if (url.pathname === "/health" && req.method === "GET") return send(res, 200, { status: "ok" });

    if (url.pathname === "/api/notes") {
      if (req.method === "GET") return send(res, 200, [...notes.values()]);
      if (req.method === "POST") {
        let input;
        try {
          input = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid JSON" });
        }
        const problem = validateNote(input);
        if (problem) return send(res, 400, { error: problem });
        const note = { id: nextId++, title: input.title.trim(), body: input.body ?? "" };
        notes.set(note.id, note);
        return send(res, 201, note, { location: `/api/notes/${note.id}` });
      }
      return send(res, 405, { error: "method not allowed" }, { allow: "GET, POST" });
    }

    if (match) {
      const id = Number(match[1]);
      if (req.method === "GET") return notes.has(id) ? send(res, 200, notes.get(id)) : send(res, 404, { error: "note not found" });
      if (req.method === "DELETE") return notes.delete(id) ? send(res, 204) : send(res, 404, { error: "note not found" });
      return send(res, 405, { error: "method not allowed" }, { allow: "GET, DELETE" });
    }

    return send(res, 404, { error: "not found" });
  });
}
