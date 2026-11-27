// The frontend service: GET /products asks the catalogue service and returns its answer.
const http = require("node:http");

const CATALOGUE = process.env.CATALOGUE_URL || "http://catalogue:8081";

function getItems() {
  // node:http (not fetch): the HTTP instrumentation for node:http adds the trace context header.
  return new Promise((resolve, reject) => {
    http
      .get(`${CATALOGUE}/items`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve(JSON.parse(body)));
      })
      .on("error", reject);
  });
}

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/products") {
      try {
        const items = await getItems();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ count: items.length, items }));
      } catch (error) {
        res.writeHead(502).end(String(error));
      }
      return;
    }
    res.writeHead(404).end();
  })
  .listen(8080, () => console.log("frontend listening on 8080"));
