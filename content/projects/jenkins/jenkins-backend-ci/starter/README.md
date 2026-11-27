# Campus Notes API (Jenkins edition)

The same small REST API as in the GitHub Actions project — course notes on Node.js' `http` module, no
dependencies — now built by the department's Jenkins server.

```bash
npm ci          # install exactly what package-lock.json says
npm run lint    # syntax, no console.log in src/, no test.only
npm test        # node --test
npm run build   # writes dist/ with BUILD_INFO.json (commit and build number from Jenkins' GIT_COMMIT and BUILD_NUMBER)
```

## API

| Method and path | Success | Errors |
|---|---|---|
| `GET /health` | 200 `{"status":"ok"}` | |
| `GET /api/notes` | 200, an array of notes | |
| `POST /api/notes` with `{"title": "...", "body": "..."}` | 201, the note, `Location` header | 400 |
| `GET /api/notes/<id>` | 200, the note | 404 |
| `DELETE /api/notes/<id>` | 204 | 404 |

## Fixed interface (the check relies on it)

- The pipeline is the declarative `Jenkinsfile` at the top of the repository, built from branch `main`.
- The scripts `lint`, `build` and `test:ci` (to add) keep these names. `test:ci` runs the tests and writes a
  JUnit XML report to `reports/`; Node.js has a built-in reporter for that:
  `node --test --test-reporter=junit --test-reporter-destination=reports/junit.xml` (create the folder first).
- The build runs where Node.js 24 and npm are installed (the check's Jenkins provides them).

## Known problems

- The Jenkinsfile is always green, even when a test fails, and Jenkins shows no test results.
- Nothing is kept from a build, so nobody can download what was tested.
- Someone left a `console.log` in `src/app.js`.
