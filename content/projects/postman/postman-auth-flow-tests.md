---
id: postman-auth-flow-tests
track: postman
title: Authentication flow test collection
level: intermediate
estimated_hours: 6
prerequisites: [postman-collections-environments-newman, postman-authentication-flows]
related_tracks: [nginx]
user_stories:
  - As a security reviewer, I want automated proof that requests without the right credentials are refused so that I can approve opening the API to partner apps.
  - As a partner app developer, I want 401 and 403 used consistently so that my app knows whether to fetch a new token or to ask for more permissions.
  - As a maintainer of the API, I want the authentication tests to fetch their own tokens and read secrets from the environment so that they run unchanged on my laptop and in CI without secrets in the repository.
acceptance_criteria:
  - Run with Newman against the correct API, with an API key and client secret the check generates and passes as --env-var, every assertion passes; every request has a test, no script crashes, and there are at least 15 assertions.
  - The suite calls /status with and without a valid API key (200 and 401), and the token endpoint with the right and a wrong client secret (200 and 401 invalid_client).
  - The suite calls /grades with a grades:read token obtained during the run (200), without a token (401), with a token whose signature does not match (401) and with a token for another scope (403 insufficient_scope).
  - The collection file contains no API key or client secret; they come from the environment.
  - Against each of five deliberately broken versions of the API — API key ignored, any client secret accepted, signature not checked, scope ignored, 403 instead of 401 for a missing token — at least one assertion fails.
rubric:
  - { criterion: "Both sides of every rule", excellent: "Each credential has an accepted case and at least one refused case, and each refusal checks status, error code and (for bearer errors) the WWW-Authenticate header.", good: "Each rule has an accepted and a refused case with the right status.", needs_work: "Mostly happy-path requests; refusals are tested only by status family or not at all." }
  - { criterion: "Token handling", excellent: "Tokens are fetched in the run, kept in collection variables, never logged, and the forged token changes only what a signature check can detect.", good: "Tokens are fetched in the run and chained into later requests.", needs_work: "A token is pasted into the collection, or tests depend on a token from an earlier run." }
  - { criterion: "Secrets", excellent: "All secrets are environment variables, Postman's auth helpers (API Key, Basic, Bearer) read them, and the README explains how CI would supply them.", good: "No secret is in the collection file.", needs_work: "A key or client secret is typed into a request or a script." }
  - { criterion: "Organisation", excellent: "Folders per credential type, names that state the expectation (\"Grades with a token for another scope → 403\"), and requests that can run in order on a fresh API.", good: "Requests are in a sensible order with clear names.", needs_work: "Order-dependent requests with names like \"Request 4\"." }
hints:
  - Use Postman's Authorization tab rather than typing headers — API Key (header X-API-Key), Basic Auth for the token request, Bearer Token for /grades — and put {{apiKey}}, {{clientId}}, {{clientSecret}} and {{gradesToken}} in the fields. Exported, each becomes an "auth" block in the request.
  - In the token request's test script, save the token with pm.collectionVariables.set('gradesToken', pm.response.json().access_token). Later requests use {{gradesToken}}.
  - A forged token must fail only because of its signature. Take the header and payload of one real token and the signature of another, in a pre-request script — the payload stays genuine, so nothing but the signature check can reject it.
  - A test that only says "refused" is too weak. A missing token is an authentication problem (401, try again with a token); a token without the right scope is a permission problem (403, a new token for the same scope will not help).
stretch_goals:
  - Test the 400 answers of the token endpoint (wrong grant_type, unknown scope) and the 401 for an unknown client ID.
  - Test expiry. Tokens last 60 seconds; find a way to test an expired token without making the suite slow, or explain in the README why you would test it elsewhere.
  - Run the suite in a GitHub Actions workflow with the secrets passed from repository secrets via --env-var, as in "Collections in CI".
starter: starter
solution: solution
check_needs: [docker]
owner: content-team
last_reviewed: 2026-11-27
content_version: 1
---

## Brief

The college's results API is about to be opened to two partner apps. The security review asks for evidence that
its authentication works — and keeps working after every change. The API uses the three mechanisms from
*Authentication flows*: an **API key** on `/status`, the **OAuth 2.0 client credentials** flow on
`/oauth/token`, and **bearer tokens** with a **scope** on `/grades`.

You will write a Postman collection that tests every rule from both sides: the right credentials are accepted,
and each kind of wrong credential is refused with the right status code and error. The collection must get its
own tokens during the run and read every secret from the environment, because the check starts the API with
secrets of its own and passes them to Newman on the command line — just as a CI system passes secrets.

The check then runs your collection against five deliberately broken copies of the API. Each one has a real
kind of authentication hole; your suite must fail on every one.

## Getting started

1. Copy the starter files into a new folder and start the API (Node.js 22 or later):

   ```bash
   node api/results-api.mjs
   ```

2. In a second terminal, install Newman into the folder and run the starter collection:

   ```bash
   npm install --no-save --no-audit --no-fund --loglevel=error newman@6.2.3
   npx newman run results-auth.postman_collection.json -e results.postman_environment.json
   ```

3. Explore with curl first, as in *Authentication flows* — for example
   `curl -s -u results-portal:demo-secret-Xq81 -d grant_type=client_credentials -d scope=grades:read http://127.0.0.1:7402/oauth/token`.
   Then build the requests in Postman (import the collection and the environment) and export the collection
   back to `results-auth.postman_collection.json` (format v2.1).
4. Prove that the secrets really come from the environment: start the API with other values
   (`API_KEY=k2 CLIENT_SECRET=s2 node api/results-api.mjs`) and run Newman with
   `--env-var apiKey=k2 --env-var clientSecret=s2`.
5. Try a broken copy, for example `BUG=scope-ignored PORT=7403 node api/results-api.mjs`, with
   `--env-var "baseUrl=http://127.0.0.1:7403"`. The run must fail.
6. Run the check (it needs Docker and network access to install Newman in a throwaway container):

   ```bash
   bash check.sh path/to/your/project
   ```
