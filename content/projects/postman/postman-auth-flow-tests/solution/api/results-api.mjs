// College results API — the service your Postman collection tests. Do not change this file: the check starts its
// own copy of it, with secrets of its own.
//
//   node api/results-api.mjs                     the correct API on http://127.0.0.1:7402 (PORT=… changes the port)
//   BUG=scope-ignored node api/results-api.mjs   a deliberately broken version (the list of bugs is below)
//
// The API key and the client's ID and secret come from the environment variables API_KEY, CLIENT_ID and
// CLIENT_SECRET; the defaults below are demonstration values, the same as in results.postman_environment.json.
// Every request is logged as "METHOD /path -> status [error (reason)]".
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT ?? 7402);
const API_KEY = process.env.API_KEY ?? "demo-key-R4nd0m";
const CLIENT_ID = process.env.CLIENT_ID ?? "results-portal";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "demo-secret-Xq81";
const TOKEN_SECONDS = 60;
const SCOPES = ["grades:read", "timetable:read"];
const BUG = process.env.BUG ?? "";
// The broken versions the check runs your collection against. A suite that still passes against one of these
// would let an authentication hole reach production.
const BUGS = {
  "key-ignored": "GET /status answers 200 without a valid API key",
  "any-secret": "POST /oauth/token issues tokens to a client with the wrong secret",
  "no-signature-check": "GET /grades accepts tokens whose signature does not match",
  "scope-ignored": "GET /grades accepts a valid token without the grades:read scope",
  "status-mixup": "GET /grades answers 403 instead of 401 when there is no token",
};
if (BUG && !BUGS[BUG]) throw new Error(`unknown BUG "${BUG}"; choose one of: ${Object.keys(BUGS).join(", ")}`);

const SIGNING_KEY = crypto.randomBytes(32); // new on every start: tokens from an earlier run stop working
const b64 = (data) => Buffer.from(data).toString("base64url");
const sign = (text) => crypto.createHmac("sha256", SIGNING_KEY).update(text).digest("base64url");
const sameText = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function issueToken(client, scope) {
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify({ sub: client, scope, exp: Math.floor(Date.now() / 1000) + TOKEN_SECONDS }))}`;
  return `${body}.${sign(body)}`;
}
function checkToken(header) {
  const [scheme, token = ""] = (header ?? "").split(" ");
  const [head, payload, signature] = token.split(".");
  if (scheme !== "Bearer" || !signature) return { error: "invalid_token", why: "no bearer token" };
  if (BUG !== "no-signature-check" && !sameText(sign(`${head}.${payload}`), signature)) return { error: "invalid_token", why: "bad signature" };
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return { error: "invalid_token", why: "unreadable payload" };
  }
  if (!(claims.exp >= Date.now() / 1000)) return { error: "invalid_token", why: "expired" };
  return { claims };
}

function send(req, res, status, body, headers = {}) {
  const note = body?.error ? ` ${body.error}${body.reason ? ` (${body.reason})` : ""}` : "";
  console.log(`${req.method} ${req.url} -> ${status}${note}`);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/status") {
      const key = req.headers["x-api-key"] ?? "";
      if (BUG !== "key-ignored" && !sameText(key, API_KEY)) return send(req, res, 401, { error: "invalid_api_key" });
      return send(req, res, 200, { status: "ok" });
    }

    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let form = "";
      req.on("data", (chunk) => (form += chunk));
      req.on("end", () => {
        // The client authenticates with HTTP Basic: base64("id:secret").
        const basic = (req.headers.authorization ?? "").replace(/^Basic /, "");
        const [id = "", secret = ""] = Buffer.from(basic, "base64").toString().split(":");
        const params = new URLSearchParams(form);
        if (id !== CLIENT_ID || (BUG !== "any-secret" && !sameText(secret, CLIENT_SECRET))) {
          return send(req, res, 401, { error: "invalid_client" }, { "www-authenticate": 'Basic realm="token"' });
        }
        if (params.get("grant_type") !== "client_credentials") return send(req, res, 400, { error: "unsupported_grant_type" });
        const scope = params.get("scope") ?? "";
        if (!scope.split(" ").every((s) => SCOPES.includes(s))) return send(req, res, 400, { error: "invalid_scope" });
        send(req, res, 200, { access_token: issueToken(id, scope), token_type: "Bearer", expires_in: TOKEN_SECONDS, scope });
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/grades") {
      const result = checkToken(req.headers.authorization);
      if (result.error) {
        const status = BUG === "status-mixup" && result.why === "no bearer token" ? 403 : 401;
        return send(req, res, status, { error: result.error, reason: result.why }, { "www-authenticate": `Bearer error="${result.error}"` });
      }
      if (BUG !== "scope-ignored" && !result.claims.scope.split(" ").includes("grades:read")) {
        return send(req, res, 403, { error: "insufficient_scope" }, { "www-authenticate": 'Bearer error="insufficient_scope", scope="grades:read"' });
      }
      return send(req, res, 200, { client: result.claims.sub, grades: [{ studentId: "S1024", course: "DB201", grade: "A" }] });
    }

    send(req, res, 404, { error: "not_found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`results API${BUG ? ` (BUG=${BUG})` : ""} on http://127.0.0.1:${PORT}`));
