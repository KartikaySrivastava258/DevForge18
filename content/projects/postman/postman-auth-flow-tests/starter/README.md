# Results API — authentication tests

The college's results API is about to be opened to two partner apps. Before that happens, the security review
wants evidence that its authentication works: that requests without the right credentials are refused, with the
right status code, every time the API changes. Your job is a Postman collection that tests the authentication
rules automatically.

## The files

| File | What it is |
| --- | --- |
| `api/results-api.mjs` | The API (Node.js, no dependencies). Do not change it — the check runs its own copy. |
| `results-auth.postman_collection.json` | **Your work.** The collection; it has one request so far. Keep the file name. |
| `results.postman_environment.json` | The environment: `baseUrl`, `apiKey`, `clientId`, `clientSecret`. Keep the file name and the variable names. The values are demonstration secrets that match the API's defaults. |

## The API's authentication rules

| Request | Credentials | Answers |
| --- | --- | --- |
| `GET /status` | API key in the `X-API-Key` header | 200 `{"status": "ok"}`; 401 `{"error": "invalid_api_key"}` without the right key |
| `POST /oauth/token` | OAuth 2.0 client credentials: the client ID and secret with HTTP Basic, a form body with `grant_type=client_credentials` and `scope` (`grades:read` or `timetable:read`) | 200 `{"access_token", "token_type": "Bearer", "expires_in": 60, "scope"}`; 401 `invalid_client` for a wrong ID or secret; 400 `unsupported_grant_type` or `invalid_scope` |
| `GET /grades` | `Authorization: Bearer <token>` with the scope `grades:read` | 200 `{"client", "grades": [ … ]}`; 401 `invalid_token` when the token is missing, has been changed (bad signature) or has expired; 403 `insufficient_scope` for a valid token without `grades:read`. Both errors send a `WWW-Authenticate` header. |

Tokens are signed with a key the API picks when it starts, so a token copied from an earlier run never works.

## What the suite must do

Get its own tokens during the run (never paste one into the collection), and test each rule from both sides:
the right credentials are accepted, and each kind of wrong credential is refused with the right status and error.
Keep every secret in the environment — the check runs the API with different secrets and passes them to Newman
with `--env-var`, so a value typed into the collection fails. The check also runs your collection against
deliberately broken copies of the API (the `BUG=…` settings at the top of `api/results-api.mjs`).
