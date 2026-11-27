# Why is the class report slow?

`GET /report?class=CS-A` (the `report` service) returns a class's average grade and takes well over half a
second; teachers open it for every class every morning. The services are already traced with OpenTelemetry.
Find the cause **from the traces**, fix it, and write it up.

- `report.js` is yours to change. `grades.js` belongs to another team: use it, do not change it (its
  endpoints are documented at the top of the file).
- The answer must stay the same: `{"class": "CS-A", "students": 30, "average": …}`.
- Target: 95% of report requests in under 200 ms.
- Add a span named `build report` around the work for one report, with the attribute `report.students`
  (the number of students), so the next investigation starts from a better trace.
- Fill in `FINDINGS.md`: symptom, evidence from the trace, cause and fix, with numbers.

Run the lab: `npm install`, then `docker compose up`. Request http://localhost:8080/report?class=CS-A and look
at the trace in Jaeger (http://localhost:16686, service `report`).
