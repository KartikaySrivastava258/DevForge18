// A stand-in for the users and orders services: it answers every request on port 8000 with what it received,
// one "name=value" per line — which service, the path it saw, the forwarded headers and the body size.
// The service name comes from the NAME environment variable (set in compose.yaml). Do not change this file:
// the check starts its own copy.
const http = require("node:http");
const name = process.env.NAME;
http.createServer((req, res) => {
  let bytes = 0;
  req.on("data", (c) => { bytes += c.length; });
  req.on("end", () => {
    const h = req.headers;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end([`service=${name}`, `method=${req.method}`, `uri=${req.url}`, `host=${h.host || ""}`,
      `x-forwarded-for=${h["x-forwarded-for"] || ""}`, `x-forwarded-proto=${h["x-forwarded-proto"] || ""}`,
      `body-bytes=${bytes}`].join("\n") + "\n");
  });
}).listen(8000, () => console.log(`${name} listening on 8000`));
process.on("SIGTERM", () => process.exit(0));
