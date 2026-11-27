// The grades service (owned by another team — do not change it).
//   GET /grades/<id>          one student's grade           (about 20 ms: a database round trip)
//   GET /grades?ids=1,2,3     several students in one call  (about 25 ms, whatever the number of ids)
const http = require("node:http");

const grade = (id) => 40 + ((id * 37) % 61); // deterministic sample data: 40..100
const later = (ms, fn) => setTimeout(fn, ms);

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://grades");
    const one = /^\/grades\/(\d+)$/.exec(url.pathname);
    const reply = (body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && one) return later(20, () => reply({ id: Number(one[1]), grade: grade(Number(one[1])) }));
    if (req.method === "GET" && url.pathname === "/grades" && url.searchParams.has("ids")) {
      const ids = url.searchParams.get("ids").split(",").filter(Boolean).map(Number);
      return later(25, () => reply(ids.map((id) => ({ id, grade: grade(id) }))));
    }
    res.writeHead(404).end();
  })
  .listen(8082, () => console.log("grades listening on 8082"));
