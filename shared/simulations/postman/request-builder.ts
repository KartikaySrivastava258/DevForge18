/**
 * Simulation: a request builder (REMAINING_WORK.md §5.13).
 *
 * The learner builds HTTP requests — method, path, the CSRF header, the
 * session cookie and a body — against a model of a small part of
 * DevForge's own API, and reads the status code, the body and an
 * explanation of what went wrong for 4xx answers. Signing in sets a
 * session cookie that later requests can send.
 *
 * The status codes follow DevForge's real API and its tests: writes need
 * the X-DevForge-CSRF header (403 csrf_failed without it); a wrong
 * password is 401; malformed JSON is 400; personal endpoints without a
 * session are 401; an unknown track is 404.
 *
 * Deviation from REMAINING_WORK.md §5.13, which suggests a live
 * playground: challenges are verified by replaying actions on the server,
 * which needs a deterministic model, so this is a model of the API rather
 * than real requests. The lessons send the real requests.
 *
 * Simplified (shown to learners): one test account; bodies are chosen
 * from a few examples instead of typed; only the endpoints listed exist.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const ENDPOINTS = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/tracks/kafka" },
  { method: "GET", path: "/api/tracks/no-such-track" },
  { method: "POST", path: "/api/auth/login" },
  { method: "GET", path: "/api/me/bookmarks" },
  { method: "PUT", path: "/api/me/bookmarks/track/kafka" },
  { method: "POST", path: "/api/auth/logout" },
] as const;
export type Endpoint = (typeof ENDPOINTS)[number];
export const BODIES = ["none", "valid login", "wrong password", "not JSON"] as const;
export type Body = (typeof BODIES)[number];

export interface Request {
  endpoint: number;
  csrf: boolean;
  cookie: boolean;
  body: Body;
}
export interface Response {
  status: number;
  body: string;
  explain: string;
}

export interface BuilderState {
  /** Whether the client holds a valid session cookie. */
  session: boolean;
  bookmarks: string[];
  history: { request: Request; response: Response }[];
}

export type BuilderAction = { type: "send"; request: Request };
export interface BuilderScenario {
  signedIn: boolean;
}

const isWrite = (e: Endpoint) => e.method !== "GET";

export function respond(s: BuilderState, r: Request): { state: BuilderState; response: Response } {
  const e = ENDPOINTS[r.endpoint]!;
  const ok = (status: number, body: string, explain: string, next: Partial<BuilderState> = {}) => ({ state: { ...s, ...next }, response: { status, body, explain } });
  if (isWrite(e) && !r.csrf) return ok(403, '{"error":{"code":"csrf_failed"}}', "403 Forbidden: every request that changes something must carry the X-DevForge-CSRF header. Browsers cannot add it to cross-site requests, which is what makes it a defence against cross-site request forgery.");
  if (isWrite(e) && r.body === "not JSON") return ok(400, '{"error":{"code":"invalid_json"}}', "400 Bad Request: the body is not valid JSON, so the server cannot read it.");
  const hasSession = r.cookie && s.session;
  switch (e.path) {
    case "/api/health":
      return ok(200, '{"status":"ok"}', "200 OK.");
    case "/api/tracks/kafka":
      return ok(200, '{"track":{"slug":"kafka",…}}', "200 OK: public content needs no session.");
    case "/api/tracks/no-such-track":
      return ok(404, '{"error":{"code":"not_found"}}', "404 Not Found: the URL names something that does not exist. Check the path.");
    case "/api/auth/login":
      if (r.body === "valid login") return ok(200, '{"user":{…}}  Set-Cookie: session=…', "200 OK: signed in. The response sets a session cookie — send it with later requests.", { session: true });
      if (r.body === "wrong password") return ok(401, '{"error":{"code":"invalid_credentials"}}', "401 Unauthorized: the email or password is wrong. (The API does not say which, so attackers cannot test which emails exist.)");
      return ok(400, '{"error":{"code":"validation_failed"}}', "400 Bad Request: the login needs a JSON body with email and password.");
    case "/api/me/bookmarks":
      if (!hasSession) return ok(401, '{"error":{"code":"unauthenticated"}}', r.cookie ? "401 Unauthorized: the cookie you sent is not a valid session (sign in first)." : "401 Unauthorized: personal data needs a session — send the session cookie from signing in.");
      return ok(200, JSON.stringify({ bookmarks: s.bookmarks }), "200 OK: your bookmarks.");
    case "/api/me/bookmarks/track/kafka":
      if (!hasSession) return ok(401, '{"error":{"code":"unauthenticated"}}', "401 Unauthorized: bookmarking needs a session cookie.");
      return ok(200, '{"saved":true}', "200 OK: bookmarked. Repeating it is safe — PUT is idempotent.", { bookmarks: s.bookmarks.includes("kafka") ? s.bookmarks : [...s.bookmarks, "kafka"] });
    case "/api/auth/logout":
      return ok(204, "(no body)", "204 No Content: signed out; the session is ended on the server, so the old cookie no longer works.", { session: false });
  }
  return ok(404, "", "404");
}

const refuse = (state: BuilderState, error: string): StepResult<BuilderState> => ({ state, events: [], error });

function step(s: BuilderState, a: BuilderAction): StepResult<BuilderState> {
  const e = ENDPOINTS[a.request.endpoint];
  if (!e) return refuse(s, "Choose one of the listed endpoints.");
  const { state, response } = respond(s, a.request);
  const req = `${e.method} ${e.path}${a.request.csrf ? " [X-DevForge-CSRF]" : ""}${a.request.cookie ? " [cookie]" : ""}${a.request.body !== "none" ? ` [body: ${a.request.body}]` : ""}`;
  return { state: { ...state, history: [...s.history.slice(-19), { request: a.request, response }] }, events: [`${req} → ${response.status}. ${response.explain}`] };
}

function init(p: BuilderScenario): StepResult<BuilderState> {
  return { state: { session: p.signedIn, bookmarks: [], history: [] }, events: [p.signedIn ? "You hold a session cookie from an earlier sign-in." : "You are not signed in. The test account is asha@example.edu."] };
}

function describe(s: BuilderState): string[] {
  return [
    `Session: ${s.session ? "signed in (cookie held)" : "none"}. Bookmarks: ${s.bookmarks.join(", ") || "none"}.`,
    ...s.history.map((h) => `${ENDPOINTS[h.request.endpoint]!.method} ${ENDPOINTS[h.request.endpoint]!.path} → ${h.response.status}: ${h.response.explain}`),
  ];
}

export const requestBuilder: SimulationModel<BuilderState, BuilderAction, BuilderScenario> = {
  id: "postman-request-builder",
  track: "postman",
  init,
  step,
  invariants: [{ name: "bookmarks can only change with a session", check: (s) => (s.bookmarks.length && !s.history.some((h) => h.response.status === 200 && ENDPOINTS[h.request.endpoint]!.method === "PUT") ? "bookmark without a successful PUT" : null) }],
  checks: {
    /** The Kafka track is bookmarked, and reading the bookmarks back returned it. */
    "bookmark-saved": (s) => s.bookmarks.includes("kafka") && s.history.some((h) => ENDPOINTS[h.request.endpoint]!.path === "/api/me/bookmarks" && h.response.status === 200 && h.response.body.includes("kafka")),
    /** The learner saw a 401, a 403 and a 404 — and then a 200 for a write. */
    "four-codes": (s) => [401, 403, 404].every((c) => s.history.some((h) => h.response.status === c)) && s.history.some((h) => h.response.status === 200 && ENDPOINTS[h.request.endpoint]!.method !== "GET"),
  },
  describe,
};
