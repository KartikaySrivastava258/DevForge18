// The report service: GET /report?class=CS-A returns the class's average grade.
const http = require("node:http");
const { trace } = require("@opentelemetry/api");

const tracer = trace.getTracer("report");
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
  return tracer.startActiveSpan("build report", async (span) => {
    try {
      const students = CLASSES[className] || [];
      span.setAttribute("report.class", className ?? "");
      span.setAttribute("report.students", students.length);
      // One batch request instead of one request per student (the N+1 pattern the trace showed:
      // 30 sequential GET /grades/<id> spans of about 20 ms each).
      const rows = students.length ? await getJson(`${GRADES}/grades?ids=${students.join(",")}`) : [];
      const grades = rows.map((r) => r.grade);
      const average = grades.length ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10 : null;
      return { class: className, students: students.length, average };
    } finally {
      span.end();
    }
  });
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
