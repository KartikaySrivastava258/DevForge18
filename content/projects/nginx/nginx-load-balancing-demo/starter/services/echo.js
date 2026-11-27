// A stand-in for each API and report instance. It answers on port 8000 with its name and what it received;
// add ?delay_ms=3000 to a request to make it answer three seconds later (a long report).
// A control port, 9000, reachable only from inside the container, lets you break it on purpose:
//   docker compose exec app3 wget -qO- "http://127.0.0.1:9000/?mode=503"    maintenance: answers 503
//   docker compose exec app2 wget -qO- "http://127.0.0.1:9000/?mode=down"   crashed: refuses connections
//   docker compose exec app2 wget -qO- "http://127.0.0.1:9000/?mode=ok"     healthy again
//   docker compose exec app1 wget -qO- "http://127.0.0.1:9000/"             mode and GET/POST counts
// The instance name comes from the NAME environment variable (set in compose.yaml). Do not change this file:
// the check starts its own copy.
const http = require("node:http");
const name = process.env.NAME;
let mode = "ok";
const stats = { GET: 0, POST: 0, OTHER: 0 };
const app = http.createServer((req, res) => {
  let bytes = 0;
  req.on("data", (c) => { bytes += c.length; });
  req.on("end", () => {
    stats[req.method in stats ? req.method : "OTHER"]++;
    const delay = Math.min(Number(new URL(req.url, "http://x").searchParams.get("delay_ms")) || 0, 30000);
    setTimeout(() => {
      if (mode === "503") { res.writeHead(503, { "content-type": "text/plain" }); return res.end(`service=${name}\nstatus=maintenance\n`); }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`service=${name}\nmethod=${req.method}\nuri=${req.url}\nbody-bytes=${bytes}\n`);
    }, delay);
  });
});
app.listen(8000, () => console.log(`${name} listening on 8000`));
http.createServer((req, res) => {
  const m = new URL(req.url, "http://x").searchParams.get("mode");
  if (m === "down" && mode !== "down") app.close();
  if (m && m !== "down" && mode === "down") app.listen(8000);
  if (m) mode = m;
  res.end(`mode=${mode} GET=${stats.GET} POST=${stats.POST}\n`);
}).listen(9000, "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));
