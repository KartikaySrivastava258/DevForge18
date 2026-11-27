// Event intake API. Clubs post events (a room booking, a ticket sale); the API queues them in Redis and the
// worker processes them in the background.
//
//   GET  /health        200 {"status":"ok"} when Redis answers PING, otherwise 503
//   POST /events        {"type": "…", "payload": {…}} with "Authorization: Bearer <API key>" → 202 {id, status}
//   GET  /events/<id>   200 {id, status: "queued" | "processed", processed_by?} or 404
//
// The API key is read once at start from the file named by API_KEY_FILE (default /run/secrets/api_key).
// For a quick run without that file, the API_KEY environment variable is used instead — never in production.
const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { command } = require("./redis.js");

const PORT = Number(process.env.PORT || 3000);
const KEY_FILE = process.env.API_KEY_FILE || "/run/secrets/api_key";
let apiKey = "";
try { apiKey = fs.readFileSync(KEY_FILE, "utf8").trim(); console.log(`API key loaded from ${KEY_FILE}`); }
catch { apiKey = (process.env.API_KEY || "").trim(); console.log(apiKey ? "API key taken from the API_KEY environment variable" : "no API key: POST /events is disabled"); }

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body) + "\n");
}
function authorised(req) {
  const given = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return apiKey !== "" && given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 50_000) reject(new Error("too large")); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      try { await command(["PING"]); return send(res, 200, { status: "ok" }); }
      catch (err) { return send(res, 503, { status: `redis unavailable (${err.code || err.message})` }); }
    }
    if (req.url === "/events" && req.method === "POST") {
      if (!authorised(req)) return send(res, 401, { error: "missing or wrong API key" });
      let event;
      try { event = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "send JSON like {\"type\": \"room-booking\", \"payload\": {}}" }); }
      if (typeof event.type !== "string" || !event.type) return send(res, 400, { error: "type is required" });
      const id = crypto.randomUUID();
      await command(["HSET", `event:${id}`, "status", "queued", "type", event.type]);
      await command(["LPUSH", "events:queue", JSON.stringify({ id, type: event.type, payload: event.payload ?? null })]);
      return send(res, 202, { id, status: "queued" });
    }
    const match = req.url.match(/^\/events\/([0-9a-f-]{36})$/);
    if (match && req.method === "GET") {
      const fields = await command(["HGETALL", `event:${match[1]}`]);
      if (!fields.length) return send(res, 404, { error: "no such event" });
      const record = { id: match[1] };
      for (let i = 0; i < fields.length; i += 2) record[fields[i]] = fields[i + 1];
      return send(res, 200, record);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 503, { error: `storage unavailable (${err.code || err.message})` });
  }
});

server.listen(PORT, () => console.log(`event API on ${PORT}`));
process.on("SIGTERM", () => { console.log("SIGTERM: closing"); server.close(() => process.exit(0)); });
