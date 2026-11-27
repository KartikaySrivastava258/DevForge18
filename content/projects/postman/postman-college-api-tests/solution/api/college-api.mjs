// College course catalogue API — the service your Postman collection tests. Do not change this file:
// the check starts its own copy of it.
//
//   node api/college-api.mjs                 the correct API on http://127.0.0.1:7401 (PORT=… changes the port)
//   BUG=missing-404 node api/college-api.mjs a deliberately broken version (the list of bugs is below)
//
// Data lives in memory: restart the API to get the original seats back. Every request is logged as
// "METHOD /path?query -> status".
import http from "node:http";

const PORT = Number(process.env.PORT ?? 7401);
const BUG = process.env.BUG ?? "";
// The broken versions the check runs your collection against. A test suite that still passes against one of
// these would let that bug reach students.
const BUGS = {
  "missing-404": "GET /courses/<unknown code> answers 200 with course: null instead of 404",
  "wrong-course": "GET /courses/<code> answers with the next course in the list, not the one asked for",
  "filter-ignored": "GET /courses?dept=… ignores dept and lists every course",
  "no-validation": "POST …/enrolments accepts a missing or malformed studentId",
  "full-course": "POST …/enrolments enrols students in a course with no seats left",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const courses = [
  { code: "CS101", title: "Programming Fundamentals", dept: "CS", credits: 4, seats: 40 },
  { code: "CS205", title: "Data Structures", dept: "CS", credits: 4, seats: 0 },
  { code: "MA102", title: "Linear Algebra", dept: "MA", credits: 3, seats: 60 },
  { code: "PH110", title: "Engineering Physics", dept: "PH", credits: 3, seats: 12 },
];
const enrolments = [];

function send(req, res, status, body) {
  console.log(`${req.method} ${req.url} -> ${status}`);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const error = (code, message, details) => ({ error: { code, message, ...(details ? { details } : {}) } });

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") return send(req, res, 200, { status: "ok" });

    if (parts[0] === "courses" && parts.length === 1) {
      if (req.method !== "GET") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      const dept = url.searchParams.get("dept");
      const list = dept && BUG !== "filter-ignored" ? courses.filter((c) => c.dept === dept) : courses;
      return send(req, res, 200, { courses: list });
    }

    if (parts[0] === "courses" && parts.length === 2) {
      if (req.method !== "GET") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      const index = courses.findIndex((c) => c.code === parts[1]);
      if (index === -1) {
        if (BUG === "missing-404") return send(req, res, 200, { course: null });
        return send(req, res, 404, error("not_found", "Course not found."));
      }
      const course = BUG === "wrong-course" ? courses[(index + 1) % courses.length] : courses[index];
      return send(req, res, 200, { course });
    }

    if (parts[0] === "courses" && parts[2] === "enrolments" && parts.length === 3) {
      if (req.method !== "POST") return send(req, res, 405, error("method_not_allowed", `${req.method} is not supported here.`));
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return send(req, res, 415, error("unsupported_media_type", "Send the request body as application/json."));
      }
      let text = "";
      req.on("data", (chunk) => (text += chunk));
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(text || "{}");
        } catch {
          return send(req, res, 400, error("invalid_json", "The body is not valid JSON."));
        }
        const course = courses.find((c) => c.code === parts[1]);
        if (!course) return send(req, res, 404, error("not_found", "Course not found."));
        const studentId = body?.studentId;
        if (BUG !== "no-validation" && (typeof studentId !== "string" || !/^S[0-9]{4}$/.test(studentId))) {
          return send(req, res, 400, error("validation_failed", "Some fields are invalid.", [
            { field: "studentId", message: "studentId must be S followed by four digits, for example S1024." },
          ]));
        }
        if (course.seats === 0 && BUG !== "full-course") return send(req, res, 409, error("course_full", "This course has no seats left."));
        course.seats = Math.max(0, course.seats - 1);
        enrolments.push({ courseCode: course.code, studentId });
        return send(req, res, 201, { enrolment: { courseCode: course.code, studentId }, seatsLeft: course.seats });
      });
      return;
    }

    send(req, res, 404, error("not_found", "No such endpoint."));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`college API${BUG ? ` (BUG=${BUG})` : ""} on http://127.0.0.1:${PORT}`));
