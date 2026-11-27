# College course API — test suite

The academic office's course API is used by the student portal and the mobile app. Every release so far has
been checked by someone clicking through a few requests, and two bugs reached students last term: an unknown
course code showed an empty page instead of "not found", and a full course kept accepting enrolments. Your job is
a Postman collection that checks the API's contract automatically, so that Newman can run it on every change.

## The files

| File | What it is |
| --- | --- |
| `api/college-api.mjs` | The API (Node.js, no dependencies). Do not change it — the check runs its own copy. |
| `college-api.postman_collection.json` | **Your work.** The collection; it has one request so far. Keep the file name. |
| `college.postman_environment.json` | The environment: `baseUrl` = `http://127.0.0.1:7401`. Keep the file name and the variable name. |

## The API's contract

All bodies are JSON. Every error has the same shape: `{"error": {"code": "…", "message": "…"}}`, sometimes with
`details`: a list of `{"field": "…", "message": "…"}`.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /health` | 200 `{"status": "ok"}` | — |
| `GET /courses` | 200 `{"courses": [ … ]}` — every course has `code` (like `CS101`), `title`, `dept`, `credits` and `seats` (seats left) | — |
| `GET /courses?dept=CS` | 200 — only the courses of that department | — |
| `GET /courses/{code}` | 200 `{"course": { … }}` — the course with that code | 404 `not_found` |
| `POST /courses/{code}/enrolments` with `{"studentId": "S1024"}` | 201 `{"enrolment": {"courseCode", "studentId"}, "seatsLeft": n}` — one seat fewer than before | 400 `validation_failed` (details name `studentId`) when the ID is missing or not `S` and four digits; 404 `not_found` for an unknown course; 409 `course_full` when no seats are left; 415 when the body is not JSON |

The sample data has four courses; `CS205` (Data Structures) is full. Data lives in memory: restart the API to get
the original seats back.

## What the suite must do

Cover every row of the table, including the errors, and check what a client relies on — the status code **and**
the fields in the body — not just "it answered". The check also runs your collection against deliberately
broken copies of the API (the `BUG=…` settings listed at the top of `api/college-api.mjs`); a suite that still
passes against a broken API would let that bug through.
