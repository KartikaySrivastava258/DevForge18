/**
 * The live request playground (REMAINING_WORK.md §5.13): the learner sends real requests from the browser to
 * this DevForge server, as themselves. Unlike the request-builder simulation, nothing here is modelled; this
 * file holds the pure parts the page and its tests share: the endpoint allowlist, request validation, the
 * client-side rate limit and the "what went wrong" explanations.
 *
 * Why an allowlist (and why this one). The requests carry the learner's own session cookie, so anything the
 * learner's account may do, the playground could do. It therefore allows only:
 *  - public, read-only catalogue endpoints (tracks, paths, lessons, labs, simulations, quizzes without answers,
 *    projects without solutions, capstones, architectures, graph, integrations, search, health, readiness);
 *  - /api/auth/me and the learner's own read-only /api/me/* lists (progress, bookmarks, labs, quizzes,
 *    assignments, submissions, decisions, certificates, portfolio settings) — data the dashboard already shows;
 *  - two writes, both to the learner's own data, additive and harmless: a lesson self-check
 *    (POST /api/lessons/:id/check; at worst it records an attempt, and the best score never goes down) and
 *    bookmarking (PUT /api/me/bookmarks/:type/:id, idempotent);
 *  - two methods the server has no handler for (POST /api/health, DELETE /api/tracks/:slug), so the learner can
 *    meet a real 405; the server refuses them before any handler or CSRF check runs.
 * It never allows administration, the content editor (CMS), cohorts and reviews, account deletion, data export,
 * sign-in/registration/sign-out (passwords do not belong in a playground; signing out would end the session),
 * quiz grading (attempts count towards certificates), simulation verification, portfolio or submission writes,
 * certificate issuing, staff-only reads such as project solutions, or another person's portfolio or certificate.
 * server/test/postman-playground.test.ts checks every entry against the real router, so a new handler on an
 * allowed path cannot slip in unnoticed.
 */

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export interface AllowedEndpoint {
  method: Method;
  /** Route pattern; ":name" stands for one identifier segment (as the server's router accepts). */
  pattern: string;
  /** read: a GET; write: changes the learner's own data; unrouted: no handler, the server answers 405. */
  kind: "read" | "write" | "unrouted";
  /** Signed-in only (401 when signed out). */
  personal?: boolean;
}

const read = (pattern: string, personal = false): AllowedEndpoint => ({ method: "GET", pattern, kind: "read", ...(personal ? { personal } : {}) });

export const ALLOWED: readonly AllowedEndpoint[] = [
  read("/api/health"),
  read("/api/ready"),
  read("/api/tracks"),
  read("/api/tracks/:slug"),
  read("/api/tracks/:slug/quiz"),
  read("/api/tracks/:slug/projects"),
  read("/api/paths"),
  read("/api/paths/:slug"),
  read("/api/lessons/:id"),
  read("/api/labs/:id"),
  read("/api/simulations/:id"),
  read("/api/projects/:id"),
  read("/api/capstones"),
  read("/api/capstones/:id"),
  read("/api/architectures"),
  read("/api/architectures/:id"),
  read("/api/graph"),
  read("/api/integrations/:id"),
  read("/api/search"),
  read("/api/auth/me"),
  read("/api/me/progress", true),
  read("/api/me/bookmarks", true),
  read("/api/me/labs", true),
  read("/api/me/quizzes", true),
  read("/api/me/assignments", true),
  read("/api/me/submissions", true),
  read("/api/me/decisions", true),
  read("/api/me/certificates", true),
  read("/api/me/portfolio", true),
  { method: "POST", pattern: "/api/lessons/:id/check", kind: "write" },
  { method: "PUT", pattern: "/api/me/bookmarks/:type/:id", kind: "write", personal: true },
  { method: "POST", pattern: "/api/health", kind: "unrouted" },
  { method: "DELETE", pattern: "/api/tracks/:slug", kind: "unrouted" },
];

/** Paths the playground refuses with a specific reason (checked before the allowlist, for a clearer message). */
const DENIED: { test: RegExp; reason: string }[] = [
  { test: /^\/api\/admin(\/|$)/, reason: "Administration endpoints are never available in the playground." },
  { test: /^\/api\/cms(\/|$)/, reason: "The content editor's endpoints are never available in the playground." },
  { test: /^\/api\/me\/delete$/, reason: "Account deletion is never available in the playground." },
  { test: /^\/api\/me\/export$/, reason: "Your data export is a download on the dashboard, not a playground request." },
  { test: /^\/api\/auth\/(login|register|logout)$/, reason: "Signing in, registering and signing out are not available here: never type a password into a playground, and signing out would end your session. The lesson shows these with curl." },
  { test: /^\/api\/(cohorts|reviews|assignable)(\/|$)/, reason: "Cohort and review endpoints act on other people's data, so they are not available in the playground." },
];

export const MAX_PATH_LENGTH = 300;
export const MAX_BODY_BYTES = 100_000; // above the server's 64 KB JSON limit, so its 413 can still be seen
export const MAX_HEADERS = 10;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const HEADER_VALUE = /^[\x20-\x7E]{0,256}$/;
const QUERY = /^[A-Za-z0-9_.~=&%+,:-]{0,200}$/;
/** Headers the browser or a proxy controls; fetch() would drop or refuse most of them anyway. */
const CONTROLLED_HEADERS = /^(cookie|cookie2|host|origin|referer|content-length|connection|keep-alive|transfer-encoding|te|trailer|upgrade|expect|date|via|dnt|forwarded|accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|sec-.*|proxy-.*|x-forwarded-.*|x-real-ip)$/i;

export interface HeaderRow {
  name: string;
  value: string;
}

export interface PlaygroundRequest {
  method: Method;
  /** Path and optional query string, such as /api/search?q=docker. */
  path: string;
  headers: HeaderRow[];
  body: string;
}

export type Validation = { ok: true; endpoint: AllowedEndpoint; pathname: string; headers: [string, string][] } | { ok: false; field: "path" | "headers" | "body" | "method"; reason: string };

function matches(pattern: string, segments: string[]): boolean {
  const parts = pattern.split("/").filter(Boolean);
  return parts.length === segments.length && parts.every((p, i) => (p.startsWith(":") ? SEGMENT.test(segments[i]!) : p === segments[i]));
}

/** Checks a request against the allowlist and the playground's limits. Nothing is sent unless this says ok. */
export function validateRequest(r: PlaygroundRequest): Validation {
  if (!(METHODS as readonly string[]).includes(r.method)) return { ok: false, field: "method", reason: `Choose one of ${METHODS.join(", ")}.` };
  const path = r.path.trim();
  if (!path.startsWith("/api/")) return { ok: false, field: "path", reason: "The playground only sends requests to DevForge's own API: the path must start with /api/." };
  if (path.length > MAX_PATH_LENGTH) return { ok: false, field: "path", reason: `Keep the path under ${MAX_PATH_LENGTH} characters.` };
  if (path.includes("#")) return { ok: false, field: "path", reason: "Remove the #fragment: browsers never send it to the server." };
  const [pathname = "", query] = path.split(/\?(.*)/s, 2);
  const segments = pathname.split("/").slice(1);
  if (segments.some((s) => !SEGMENT.test(s))) {
    return { ok: false, field: "path", reason: "Each part of the path between slashes must be letters, digits, - or _ (no empty parts, dots or % escapes)." };
  }
  if (query !== undefined && !QUERY.test(query)) return { ok: false, field: "path", reason: "Keep the query string short and simple, such as ?q=docker." };
  const denied = DENIED.find((d) => d.test.test(pathname));
  if (denied) return { ok: false, field: "path", reason: denied.reason };
  const onPath = ALLOWED.filter((e) => matches(e.pattern, segments));
  if (onPath.length === 0) return { ok: false, field: "path", reason: `${pathname} is not on the playground's list of allowed endpoints (see "What you can send").` };
  const endpoint = onPath.find((e) => e.method === r.method);
  if (!endpoint) {
    return { ok: false, field: "method", reason: `${r.method} ${pathname} is not allowed in the playground; on this path you can send ${onPath.map((e) => e.method).join(" or ")}.` };
  }

  const rows = r.headers.filter((h) => h.name.trim() !== "" || h.value.trim() !== "");
  if (rows.length > MAX_HEADERS) return { ok: false, field: "headers", reason: `Send at most ${MAX_HEADERS} headers.` };
  const headers: [string, string][] = [];
  for (const h of rows) {
    const name = h.name.trim();
    if (!HEADER_NAME.test(name)) return { ok: false, field: "headers", reason: `"${name || "(empty)"}" is not a valid header name: use letters, digits and -.` };
    if (/^cookie2?$/i.test(name)) return { ok: false, field: "headers", reason: 'The browser sends your session cookie itself; use "Send my session cookie" instead of a Cookie header.' };
    if (CONTROLLED_HEADERS.test(name)) return { ok: false, field: "headers", reason: `${name} is set by the browser (or a proxy), not by the page, so it cannot be changed here.` };
    if (!HEADER_VALUE.test(h.value)) return { ok: false, field: "headers", reason: `The value of ${name} must be plain printable text, at most 256 characters.` };
    if (headers.some(([n]) => n.toLowerCase() === name.toLowerCase())) return { ok: false, field: "headers", reason: `${name} appears twice; send each header once.` };
    headers.push([name, h.value]);
  }

  if (r.method === "GET" && r.body.trim() !== "") return { ok: false, field: "body", reason: "A GET request has no body in the browser's fetch(); clear the body or choose another method." };
  if (new TextEncoder().encode(r.body).length > MAX_BODY_BYTES) return { ok: false, field: "body", reason: `Keep the body under ${MAX_BODY_BYTES / 1000} KB.` };
  return { ok: true, endpoint, pathname, headers };
}

/** A sliding one-minute window, kept in the page: the playground's own limit, on top of the server's. */
export class ClientRateLimit {
  private sent: number[] = [];
  readonly limit: number;
  readonly windowMs: number;

  constructor(limit = 20, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a request if one is allowed now. */
  take(now: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    if (this.sent.length >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((this.sent[0]! + this.windowMs - now) / 1000)) };
    }
    this.sent.push(now);
    return { allowed: true, remaining: this.limit - this.sent.length, retryAfterSeconds: 0 };
  }

  remaining(now: number): number {
    return this.limit - this.sent.filter((t) => now - t < this.windowMs).length;
  }
}

/** Response headers worth showing to a learner (others, such as the long Content-Security-Policy, are left out). */
export const SHOWN_RESPONSE_HEADERS = ["content-type", "content-length", "cache-control", "retry-after", "x-request-id", "x-content-type-options"] as const;

export const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export interface Explanation {
  title: string;
  text: string;
}

/**
 * "What went wrong" for a response: DevForge's error code (body.error.code) when it has a specific meaning,
 * otherwise the status code. 2xx answers get a short confirmation.
 */
export function explain(status: number, code?: string): Explanation {
  const name = `${status}${STATUS_TEXT[status] ? ` ${STATUS_TEXT[status]}` : ""}`;
  const byCode: Record<string, string> = {
    csrf_failed: "DevForge refuses any request that changes something (POST, PUT, PATCH, DELETE) unless it carries the header X-DevForge-CSRF: 1 and comes from this site. Another website cannot make your browser add that header, which is what protects you from cross-site request forgery. Add the header back and send again.",
    invalid_json: "The body is not valid JSON, so the server could not read it. Check the quotes (JSON needs double quotes), commas and braces.",
    validation_failed: "The body is valid JSON, but some fields are missing or wrong. The details list in the response names each field and what to fix.",
    unauthenticated: "This endpoint needs to know who you are, and the request carried no valid session. Sign in, and keep \"Send my session cookie\" ticked.",
    forbidden: "The server knows who you are, but your role may not do this.",
    unsupported_media_type: "The server only accepts JSON bodies. Add the header Content-Type: application/json (without it, fetch() labels a text body as text/plain).",
    payload_too_large: "The body is larger than the server accepts (64 KB for JSON). Send less.",
    method_not_allowed: "The path exists, but not for this method. Read the endpoint's documentation for the methods it supports; GET reads, POST and PUT change things.",
    rate_limited: "Too many requests in a short time. Wait for the number of seconds in the Retry-After header, then try again.",
  };
  if (code && byCode[code]) return { title: `${name}: ${code}`, text: byCode[code]! };
  if (status >= 200 && status < 300) return { title: name, text: status === 204 ? "It worked; the server has nothing to send back." : "It worked." };
  const byStatus: Record<number, string> = {
    400: "Bad Request: something about the request itself is malformed — usually the body. Read the error message and details in the response.",
    401: "Unauthorized: the server does not know who you are. Personal endpoints need a valid session cookie.",
    403: "Forbidden: the server understood the request but will not do it — the request is blocked (as with a missing CSRF header) or your account may not do this.",
    404: "Not Found: nothing exists at this path, or the item it names (a track, a lesson) does not exist. Check the spelling of the path and of the id.",
    405: "Method Not Allowed: the path exists, but not for this method.",
    409: "Conflict: the request clashes with the current state — for example, an e-mail address or portfolio address that is already taken elsewhere in DevForge. The playground's endpoints do not produce it.",
    413: "Content Too Large: the body is bigger than the server accepts (64 KB for JSON in DevForge).",
    415: "Unsupported Media Type: the server does not accept the body's format. DevForge wants Content-Type: application/json.",
    422: "Unprocessable Content: the request is well formed but cannot be carried out as it stands — in DevForge, for example, a content-editor change that changes nothing. The playground's endpoints do not produce it.",
    429: "Too Many Requests: you hit a rate limit. Wait for Retry-After seconds, then try again.",
  };
  if (byStatus[status]) return { title: name, text: byStatus[status]! };
  if (status >= 500) return { title: name, text: "A failure on the server, not in your request. Try again later; if it persists, report it with the X-Request-Id header." };
  if (status >= 400) return { title: name, text: "The server rejected something about the request. Read the error message in the body." };
  return { title: name, text: "An unusual answer for this API." };
}

/** Pretty-prints a JSON body (two-space indent); other text is returned as it is. Long bodies are cut. */
export function prettyBody(text: string, max = 20_000): { text: string; json: boolean; truncated: boolean; length: number } {
  let out = text;
  let json = false;
  if (text.trim() !== "") {
    try {
      out = JSON.stringify(JSON.parse(text), null, 2);
      json = true;
    } catch {
      out = text;
    }
  }
  return { text: out.length > max ? `${out.slice(0, max)}\n…` : out, json, truncated: out.length > max, length: out.length };
}

/** Starting points shown as buttons; each teaches one answer. */
export const EXAMPLES: { label: string; request: PlaygroundRequest; cookie?: boolean }[] = [
  { label: "Health check (200)", request: { method: "GET", path: "/api/health", headers: [], body: "" } },
  { label: "Who am I?", request: { method: "GET", path: "/api/auth/me", headers: [], body: "" } },
  { label: "My bookmarks (401 if signed out)", request: { method: "GET", path: "/api/me/bookmarks", headers: [], body: "" } },
  { label: "A track that does not exist (404)", request: { method: "GET", path: "/api/tracks/no-such-track", headers: [], body: "" } },
  { label: "Wrong method (405)", request: { method: "DELETE", path: "/api/tracks/postman", headers: [{ name: "X-DevForge-CSRF", value: "1" }], body: "" } },
  {
    label: "Self-check with a missing answer (400)",
    request: { method: "POST", path: "/api/lessons/postman-http-basics/check", headers: [{ name: "X-DevForge-CSRF", value: "1" }, { name: "Content-Type", value: "application/json" }], body: '{\n  "answers": { "whose-fault": "b" }\n}' },
  },
  {
    label: "Bookmark the Postman track",
    request: { method: "PUT", path: "/api/me/bookmarks/track/postman", headers: [{ name: "X-DevForge-CSRF", value: "1" }], body: "" },
  },
];
