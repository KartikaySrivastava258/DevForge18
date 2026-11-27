# Campus events API — regression suite

The student council's events API has shipped three releases this term, and two of them broke something that had
worked before: once an edit to an event answered "saved" without saving, once deleted events kept appearing in
the app. Each time, students found the bug first. The council wants an automated **regression suite** that runs
on every pull request and blocks a release that breaks the contract below.

## The files

| File | What it is |
| --- | --- |
| `api/events-api.mjs` | The API (Node.js, no dependencies). Do not change it — the check runs its own copy. |
| `tests/` | **Your work.** Collections, data files. The starter has a collection with two requests. |
| `run-api-tests.sh` | **Your work.** The one command CI calls: `sh run-api-tests.sh <base URL>`. Keep the name. |
| `.github/workflows/` | **Your work.** The workflow that runs the suite on pull requests (create the folder). |

## The API's contract

All bodies are JSON. Errors look like `{"error": {"code": "…", "message": "…", "details": [{"field", "message"}]}}`;
`details` is present on `validation_failed` and lists every invalid field.

An event has `id` (a string chosen by the API), `title` (3–80 characters), `date` (a real date, `YYYY-MM-DD`),
`capacity` (a whole number from 1 to 500), `venue` (not empty) and `createdAt`. Clients must ignore fields they
do not know, and must not rely on the format of `id` or the order of the list.

| Request | Success | Errors |
| --- | --- | --- |
| `GET /health` | 200 `{"status": "ok"}` | — |
| `GET /events` | 200 `{"events": [ … ]}` — every event, including new ones | — |
| `POST /events` with all four fields | 201 `{"event": { … }}` | 400 `validation_failed`; 415 for a body that is not JSON |
| `GET /events/{id}` | 200 `{"event": { … }}` | 404 `not_found` |
| `PATCH /events/{id}` with some of the four fields | 200 `{"event": { … }}` — the change is saved | 400 `validation_failed`; 404 `not_found` |
| `DELETE /events/{id}` | 204, no body — the event is gone | 404 `not_found` |

The API starts with two events and keeps everything in memory; restart it to reset.

## What the suite must do

- Follow one event through its whole life — create, read, list, update, read again, delete, read again — and
  check after every change that the change really happened.
- Test every validation rule, including the boundaries, from a **data file**: one row per invalid event.
- Clean up after itself and pass every time, on a fresh API or one it has already run against.
- Not fail on harmless changes the contract allows (`HARMLESS=1` starts such a release).

## What the runner must do

`run-api-tests.sh` takes the API's base URL as its first argument, runs every collection with a pinned Newman,
writes JUnit reports into `results/`, and exits non-zero if any test failed — even when an earlier collection
already failed, both reports must be written. The check runs it with `sh`, so keep it a POSIX shell script.
