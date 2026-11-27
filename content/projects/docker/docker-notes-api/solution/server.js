// Notes API — a small JSON API with no dependencies outside Node.js itself.
// Notes are kept in DATA_DIR/notes.json (DATA_DIR defaults to /data). The admin token for DELETE /notes comes
// from the NOTES_ADMIN_TOKEN environment variable at run time.
//
//   GET    /health   200 {"status":"ok"} when the data folder is writable, otherwise 503
//   GET    /notes    200 [{ id, text, created_at }, …]
//   POST   /notes    {"text": "…"} → 201 with the new note
//   DELETE /notes    with "Authorization: Bearer <NOTES_ADMIN_TOKEN>" → 204, deletes every note
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const FILE = path.join(DATA_DIR, "notes.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (err) { if (err.code === "ENOENT") return []; throw err; }
}
function save(notes) {
  // Write to a temporary file, then rename: a crash mid-write never leaves half a file behind.
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
  fs.renameSync(tmp, FILE);
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body) + "\n");
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 10_000) reject(new Error("too large")); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      try { fs.accessSync(DATA_DIR, fs.constants.W_OK); return send(res, 200, { status: "ok" }); }
      catch (err) { return send(res, 503, { status: `data folder ${DATA_DIR} is not writable (${err.code})` }); }
    }
    if (req.url === "/notes" && req.method === "GET") return send(res, 200, load());
    if (req.url === "/notes" && req.method === "POST") {
      let text;
      try { text = JSON.parse(await readBody(req)).text; } catch { return send(res, 400, { error: "send JSON like {\"text\": \"…\"}" }); }
      if (typeof text !== "string" || !text.trim()) return send(res, 400, { error: "text is required" });
      const note = { id: crypto.randomUUID(), text: text.trim(), created_at: new Date().toISOString() };
      const notes = load();
      notes.push(note);
      save(notes);
      return send(res, 201, note);
    }
    if (req.url === "/notes" && req.method === "DELETE") {
      const token = process.env.NOTES_ADMIN_TOKEN;
      if (!token) return send(res, 503, { error: "NOTES_ADMIN_TOKEN is not set" });
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "wrong or missing token" });
      save([]);
      return send(res, 204);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: `${err.code || err.message}` });
  }
});

server.listen(PORT, () => console.log(`notes API listening on ${PORT}, data in ${DATA_DIR}`));

// docker stop sends SIGTERM: stop accepting connections, finish open requests, then exit cleanly.
process.on("SIGTERM", () => {
  console.log("SIGTERM received: closing");
  server.close(() => process.exit(0));
});
