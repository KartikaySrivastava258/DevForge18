// The report service: GET /report?class=CS-A returns the class's average grade.
// Students complain that the report page takes seconds to load.
const http = require("node:http");

const GRADES = process.env.GRADES_URL || "http://grades:8082";
const CLASSES = { "CS-A": Array.from({ length: 30 }, (_, i) => i + 1), "CS-B": Array.from({ length: 30 }, (_, i) => i + 31) };

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

async function buildReport(className) {
  const students = CLASSES[className] || [];
  const grades = [];
  for (const id of students) {
    const { grade } = await getJson(`${GRADES}/grades/${id}`);
    grades.push(grade);
  }
  const average = grades.length ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null;
  return { class: className, students: students.length, average };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://report");
    if (req.method === "GET" && url.pathname === "/report") {
      try {
        const report = await buildReport(url.searchParams.get("class"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(report));
      } catch (error) {
        res.writeHead(502).end(String(error));
      }
      return;
    }
    res.writeHead(404).end();
  })
  .listen(8080, () => console.log("report listening on 8080"));
