// Campus Noticeboard API. Notices are kept in Redis (a list called "notices", newest first).
// Configuration comes from the environment: REDIS_HOST (the Redis service's name), REDIS_PORT, PORT.
//
//   GET  /api/health    200 {"status":"ok"} when Redis answers PING, otherwise 503
//   GET  /api/notices   200 [{ id, title, posted_at }, …] — the 50 newest
//   POST /api/notices   {"title": "…"} → 201 with the new notice
const http = require("node:http");
const crypto = require("node:crypto");
const { command } = require("./redis.js");

const PORT = Number(process.env.PORT || 3000);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body) + "\n");
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
    if (req.url === "/api/health" && req.method === "GET") {
      try { await command(["PING"]); return send(res, 200, { status: "ok" }); }
      catch (err) { return send(res, 503, { status: `redis unavailable (${err.code || err.message})` }); }
    }
    if (req.url === "/api/notices" && req.method === "GET") {
      const items = await command(["LRANGE", "notices", 0, 49]);
      return send(res, 200, items.map((s) => JSON.parse(s)));
    }
    if (req.url === "/api/notices" && req.method === "POST") {
      let title;
      try { title = JSON.parse(await readBody(req)).title; } catch { return send(res, 400, { error: "send JSON like {\"title\": \"…\"}" }); }
      if (typeof title !== "string" || !title.trim()) return send(res, 400, { error: "title is required" });
      const notice = { id: crypto.randomUUID(), title: title.trim().slice(0, 200), posted_at: new Date().toISOString() };
      await command(["LPUSH", "notices", JSON.stringify(notice)]);
      return send(res, 201, notice);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 503, { error: `storage unavailable (${err.code || err.message})` });
  }
});

server.listen(PORT, () => console.log(`noticeboard API on ${PORT}, Redis at ${process.env.REDIS_HOST || "localhost"}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
