---
id: postman-authentication-flows
title: Authentication flows — API keys, bearer tokens and OAuth
track: postman
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [postman-http-basics]
learning_objectives:
  - Call an API with an API key and with a bearer token, and say what each proves.
  - Get an access token with the OAuth 2.0 client credentials flow, and read its scope and expiry.
  - Tell 401 (not authenticated, or token invalid) from 403 (authenticated, but not allowed), and see why a token's signature matters.
resources:
  - title: RFC 6750 — OAuth 2.0 Bearer Token Usage
    url: https://www.rfc-editor.org/rfc/rfc6750
    publisher: IETF
    type: reference
    level: advanced
    official: true
    why: The Authorization Bearer header, invalid_token (401) and insufficient_scope (403), and why bearer tokens must be protected.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: RFC 6749 — The OAuth 2.0 Authorization Framework
    url: https://www.rfc-editor.org/rfc/rfc6749
    publisher: IETF
    type: reference
    level: advanced
    official: true
    why: The client credentials grant (section 4.4) and the other OAuth flows.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Postman Docs — Authorization types
    url: https://learning.postman.com/docs/use/send-requests/authorization/authorization-types/
    publisher: Postman
    type: documentation
    level: beginner
    official: true
    why: Setting API keys, bearer tokens and OAuth 2.0 in the Authorization tab.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: bearer
    prompt: Why must a bearer token be kept as secret as a password?
    options:
      - { id: a, text: "Because it is encrypted" }
      - { id: b, text: "Anyone who has it can use it — the API does not check who is presenting it" }
      - { id: c, text: "It is not secret; it is only an ID" }
    answer: b
    explanation: RFC 6750 says any party in possession of a bearer token can use it. That is why tokens are short-lived, sent only over HTTPS, and never logged.
  - id: 401-403
    prompt: Your token is valid, but GET /grades answers 403 with error="insufficient_scope". What is wrong?
    options:
      - { id: a, text: "The token has expired" }
      - { id: b, text: "The API knows who you are, but your token was not granted the permission (scope) this endpoint needs" }
      - { id: c, text: "The server is down" }
    answer: b
    explanation: 401 means "authenticate (again)" — no token, a bad one or an expired one. 403 means "you are authenticated, but not allowed". Request a token with the right scope.
  - id: jwt-readable
    prompt: You decoded the middle part of a JWT access token and read its scope and expiry. What does that tell you?
    options:
      - { id: a, text: "The token is broken" }
      - { id: b, text: "A JWT's payload is only encoded, not encrypted — anyone can read it; the signature stops it being changed, so never put secrets in it" }
      - { id: c, text: "You can now change the scope and reuse it" }
    answer: b
    explanation: The signature covers header and payload; changing a single character makes verification fail, as the tampered token in this lesson shows.
verification:
  method: executed
  details: Every command is run by the test suite against a small demonstration API written in this lesson (Node.js, built-in modules only), and its output is compared with this lesson. The OAuth and bearer token rules it follows were checked against RFC 6749 and RFC 6750 on 2026-11-26. Postman's Authorization tab was checked against Postman's documentation, not executed.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

An **API key** identifies the calling program with a long-lived secret, while an **OAuth access token** — usually sent as `Authorization: Bearer …` — is short-lived, limited to certain **scopes**, and obtained through a defined **flow**; reading 401 versus 403 tells you which part failed.

## Explain it like I'm twelve

An API key is like a membership card: show it and you are in, until the club cancels it. An access token is like a wristband from the front desk: you show your membership once, get a wristband that only opens the swimming pool, and it stops working at 5 o'clock.

The front desk is the **token endpoint**, "only the pool" is the **scope**, and 5 o'clock is the **expiry**.

Where the analogy breaks: a wristband can be copied by anyone who sees it — which is why tokens travel only over HTTPS and expire quickly.

## What problem it solves

Earlier lessons signed in with a password and a session cookie — right for people using a website. Programs calling APIs need something else: a credential that can be limited to certain actions, expire on its own, and be revoked without changing a password. Most public APIs use API keys or OAuth tokens, and Postman's Authorization tab has a setting for each.

## How it works

![](media:postman/auth-flows.svg)

- **API key**: a long random string, sent in a header (here `X-API-Key`). Simple, but it usually grants everything and lasts until revoked.
- **OAuth 2.0 client credentials** (RFC 6749, section 4.4): a program sends its client ID and secret to a **token endpoint** and asks for a **scope**; it receives an **access token** that expires.
- **Bearer token** (RFC 6750): the token is sent as `Authorization: Bearer <token>`. Invalid or expired → **401** with `error="invalid_token"`; valid but lacking the scope → **403** with `error="insufficient_scope"`.
- Tokens are often **JWTs**: three base64url parts — header, payload (claims such as `scope` and `exp`), and a signature that makes any change detectable.

## Try it yourself

> **Local lab** — you need Node.js (DevForge itself runs on it) and `curl`. The demonstration API below is written for this lesson and uses only Node's built-in modules; real APIs follow the same rules. Every command is run automatically in DevForge's tests.

### 1. A small API with two kinds of protection

```bash run
mkdir -p auth-lab && cd auth-lab
cat > auth-api.mjs <<'EOF'
// Demonstration API: /status needs an API key; /grades needs a bearer token with scope grades:read.
import http from "node:http";
import crypto from "node:crypto";

const API_KEY = "demo-key-7Hq2";
const CLIENTS = { "reports-app": "demo-secret-Lp9" };
const SIGNING_KEY = crypto.randomBytes(32); // new on every start: old tokens stop working
const b64 = (data) => Buffer.from(data).toString("base64url");
const sign = (text) => crypto.createHmac("sha256", SIGNING_KEY).update(text).digest("base64url");

function issueToken(client, scope) {
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ sub: client, scope, exp: Math.floor(Date.now() / 1000) + 5 }))}`;
  return `${body}.${sign(body)}`;
}
function checkToken(header) {
  const [scheme, token = ""] = (header ?? "").split(" ");
  const [head, payload, signature] = token.split(".");
  if (scheme !== "Bearer" || !signature) return { error: "invalid_token", why: "no bearer token" };
  const expected = Buffer.from(sign(`${head}.${payload}`));
  if (expected.length !== Buffer.from(signature).length || !crypto.timingSafeEqual(expected, Buffer.from(signature))) return { error: "invalid_token", why: "bad signature" };
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp < Date.now() / 1000) return { error: "invalid_token", why: "expired" };
  return { claims };
}
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/status") {
    if (req.headers["x-api-key"] !== API_KEY) return send(res, 401, { error: "missing or invalid API key" });
    return send(res, 200, { status: "ok" });
  }
  if (req.method === "POST" && url.pathname === "/oauth/token") {
    let form = "";
    req.on("data", (c) => (form += c)).on("end", () => {
      const [id, secret] = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":");
      const params = new URLSearchParams(form);
      if (CLIENTS[id] !== secret) return send(res, 401, { error: "invalid_client" });
      if (params.get("grant_type") !== "client_credentials") return send(res, 400, { error: "unsupported_grant_type" });
      const scope = params.get("scope") ?? "";
      send(res, 200, { access_token: issueToken(id, scope), token_type: "Bearer", expires_in: 5, scope });
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/grades") {
    const result = checkToken(req.headers.authorization);
    if (result.error) return send(res, 401, { error: result.error, reason: result.why }, { "www-authenticate": `Bearer error="${result.error}"` });
    if (!result.claims.scope.split(" ").includes("grades:read")) return send(res, 403, { error: "insufficient_scope" }, { "www-authenticate": 'Bearer error="insufficient_scope", scope="grades:read"' });
    return send(res, 200, { client: result.claims.sub, grades: [{ course: "DB201", grade: "A" }] });
  }
  send(res, 404, { error: "not found" });
}).listen(7300, "127.0.0.1", () => console.log("auth API on http://127.0.0.1:7300"));
EOF
node auth-api.mjs > api.log 2>&1 &
echo $! > api.pid
for i in $(seq 1 30); do grep -q 'on http' api.log && break; sleep 0.2; done
cat api.log
A=http://127.0.0.1:7300
```

```text output
auth API on http://127.0.0.1:7300
```

The secrets are hard-coded only because this is a demonstration; a real service reads them from a secret store.

### 2. An API key

```bash run
curl -s -w ' %{http_code}\n' "$A/status"
curl -s -w ' %{http_code}\n' -H 'X-API-Key: demo-key-7Hq2' "$A/status"
```

```text output
{"error":"missing or invalid API key"} 401
{"status":"ok"} 200
```

The key goes in a header. (Some APIs accept keys in the URL, as `?api_key=…`; avoid that where you can — URLs end up in logs and browser history.)

### 3. Get an access token: the client credentials flow

The program authenticates *itself* to the token endpoint with its client ID and secret (sent here with HTTP Basic, `-u`), and asks for a scope:

```bash run
answer=$(curl -s -u reports-app:demo-secret-Lp9 -d grant_type=client_credentials -d scope=grades:read "$A/oauth/token")
echo "$answer" | sed 's/"access_token":"[^"]*"/"access_token":"…"/'
TOKEN=$(echo "$answer" | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
echo "the token's payload: $(node -e 'console.log(Buffer.from(process.argv[1], "base64url").toString())' "$(echo "$TOKEN" | cut -d. -f2)" | sed 's/"exp":[0-9]*/"exp":…/')"
```

```text output
{"access_token":"…","token_type":"Bearer","expires_in":5,"scope":"grades:read"}
the token's payload: {"sub":"reports-app","scope":"grades:read","exp":…}
```

The token is a JWT, and its middle part is just base64url-encoded JSON — anyone holding the token can read it. It expires five seconds after it was issued (deliberately short for this lesson; real tokens often last minutes to an hour).

### 4. Use the token

```bash run
curl -s -w ' %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$A/grades"
curl -s -w ' %{http_code}\n' "$A/grades"
```

```text output
{"client":"reports-app","grades":[{"course":"DB201","grade":"A"}]} 200
{"error":"invalid_token","reason":"no bearer token"} 401
```

### 5. Change the token, use the wrong scope, wait too long

```bash run
payload=$(node -e 'console.log(Buffer.from(process.argv[1]).toString("base64url"))' '{"sub":"reports-app","scope":"grades:read admin","exp":9999999999}')
forged="$(echo "$TOKEN" | cut -d. -f1).$payload.$(echo "$TOKEN" | cut -d. -f3)"
echo "forged payload:  $(curl -s -w ' %{http_code}' -H "Authorization: Bearer $forged" "$A/grades")"
other=$(curl -s -u reports-app:demo-secret-Lp9 -d grant_type=client_credentials -d scope=status:read "$A/oauth/token" | sed 's/.*"access_token":"\([^"]*\)".*/\1/')
echo "wrong scope:     $(curl -s -w ' %{http_code}' -H "Authorization: Bearer $other" "$A/grades")"
curl -s -D - -o /dev/null -H "Authorization: Bearer $other" "$A/grades" | grep -i '^www-authenticate' | tr -d '\r'
sleep 6
echo "after 6 seconds: $(curl -s -w ' %{http_code}' -H "Authorization: Bearer $TOKEN" "$A/grades")"
```

```text output
forged payload:  {"error":"invalid_token","reason":"bad signature"} 401
wrong scope:     {"error":"insufficient_scope"} 403
www-authenticate: Bearer error="insufficient_scope", scope="grades:read"
after 6 seconds: {"error":"invalid_token","reason":"expired"} 401
```

- **Forged**: changing the payload — giving yourself `admin` and a far-away expiry — breaks the signature, so the API refuses it.
- **Wrong scope**: a valid token for `status:read` is not enough for `/grades` (403 `insufficient_scope`) — the API knows *who* you are, but not that you may read grades. The `WWW-Authenticate` header says which scope is needed, as RFC 6750 describes.
- **Expired**: after its lifetime, the same token is refused (401 `invalid_token`). The client simply asks the token endpoint for a new one.

### 6. Stop the API

```bash run
kill "$(cat api.pid)"
```

### 7. The same in Postman

On a request's **Authorization** tab: choose **API Key** (key `X-API-Key`, add to *Header*), **Bearer Token** (paste a token, or better `{{accessToken}}` from an environment), or **OAuth 2.0**, where Postman runs the flow for you — fill in the token URL, client ID, client secret and scope, choose the *Client Credentials* grant, and select **Get New Access Token**. Set authorization once on the collection and let requests inherit it. Keep client secrets in environment variables marked as secret, never in the collection you share.

Other OAuth flows — such as the **authorization code** flow, where a person signs in and approves an app — add a redirect through the browser, but end the same way: an access token sent as a bearer token.

## Common mistakes

- **Secrets in shared collections.** Exported collections are often committed or published; keep keys and secrets in environments marked secret, or a vault.
- **Logging tokens.** A token in a log is a token anyone with the log can use.
- **Treating JWT contents as private.** Anyone can decode them; never put secrets in the payload.
- **Mixing up 401 and 403.** 401: (re)authenticate. 403: get the right permission — a new token will not help unless it has the right scope.

## Where this fits in a real system

**Newman** in **GitHub Actions** or **Jenkins** gets a token with the client credentials flow at the start of a run (using secrets from the CI system), then calls the API with it; an API gateway or **Nginx** often checks tokens before requests reach the service.
