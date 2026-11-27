# Campus Notes API

A small REST API for course notes, built on Node.js' `http` module with no dependencies.

```bash
npm ci          # install exactly what package-lock.json says (nothing yet, but the habit matters)
npm run lint    # syntax, no console.log in src/, no test.only
npm test        # node --test
npm run build   # writes dist/ (the deployable folder) with BUILD_INFO.json
npm start       # http://localhost:3000
```

## API

| Method and path | Success | Errors |
|---|---|---|
| `GET /health` | 200 `{"status":"ok"}` | |
| `GET /api/notes` | 200, an array of notes | |
| `POST /api/notes` with `{"title": "...", "body": "..."}` | 201, the note, and a `Location: /api/notes/<id>` header | 400 `{"error": "..."}` |
| `GET /api/notes/<id>` | 200, the note | 404 |
| `DELETE /api/notes/<id>` | 204, no body | 404 |

Rules for a new note:

- `title` is required, must be a string, and is stored without leading or trailing spaces.
- A title must contain at least one non-space character and at most 120 characters (after trimming).
- `body` is optional and must be a string; invalid JSON is answered with 400.

## Fixed interface (the check relies on it)

- `src/app.js` exports `createApp()`, which returns an `http.Server` that is not listening yet.
- Tests live in `test/` and run with `npm test`; they use the API through `createApp()` (or over HTTP).
- The scripts `lint`, `test` and `build` in `package.json` keep their names; `build` writes `dist/`.
- The workflow is `.github/workflows/ci.yml`.

## Known problems

- The CI workflow is always green, even when a test fails.
- Only two endpoints have tests.
- A user reported that a note titled with just spaces was accepted.
