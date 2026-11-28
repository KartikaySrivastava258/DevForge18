/**
 * The Postman track's live request playground (REMAINING_WORK.md §5.13): real requests from this page to this
 * DevForge server, as the signed-in learner. The allowlist, validation, client-side limit and explanations live
 * in shared/simulations/postman/playground.ts (unit-tested, and checked against the router in
 * server/test/postman-playground.test.ts). Same origin only, so the strict CSP (connect-src 'self') is unchanged.
 */
import { useRef, useState, type FormEvent } from "react";
import { Crumbs } from "../components/Crumbs.tsx";
import { useAuth } from "../lib/auth.tsx";
import { Link } from "../lib/router.tsx";
import { useTitle } from "../lib/useApi.ts";
import {
  ALLOWED,
  ClientRateLimit,
  EXAMPLES,
  explain,
  METHODS,
  prettyBody,
  SHOWN_RESPONSE_HEADERS,
  STATUS_TEXT,
  validateRequest,
  type Explanation,
  type HeaderRow,
  type Method,
  type PlaygroundRequest,
} from "../../../shared/simulations/postman/playground.ts";

const DEFAULT_HEADERS: HeaderRow[] = [
  { name: "X-DevForge-CSRF", value: "1" },
  { name: "Content-Type", value: "application/json" },
];

type Result =
  | { kind: "blocked"; field: "path" | "headers" | "body" | "method"; reason: string }
  | { kind: "limited"; retryAfterSeconds: number }
  | { kind: "network"; message: string }
  | {
      kind: "response";
      request: string;
      status: number;
      ms: number;
      headers: [string, string][];
      body: ReturnType<typeof prettyBody>;
      explanation: Explanation;
    };

function summary(r: Result): string {
  switch (r.kind) {
    case "blocked":
      return `Not sent: ${r.reason}`;
    case "limited":
      return `Not sent: the playground sends at most 20 requests a minute. Try again in ${r.retryAfterSeconds} s.`;
    case "network":
      return `No response: ${r.message}`;
    case "response":
      return `${r.request} → ${r.status}${STATUS_TEXT[r.status] ? ` ${STATUS_TEXT[r.status]}` : ""}`;
  }
}

export function PlaygroundPage() {
  useTitle("Request playground (Postman)");
  const { user } = useAuth();
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/api/health");
  const [headers, setHeaders] = useState<HeaderRow[]>(DEFAULT_HEADERS);
  const [body, setBody] = useState("");
  const [cookie, setCookie] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const limiter = useRef(new ClientRateLimit());
  const [remaining, setRemaining] = useState(limiter.current.limit);
  const nextRowId = useRef(DEFAULT_HEADERS.length);
  const [rowIds, setRowIds] = useState<number[]>(DEFAULT_HEADERS.map((_, i) => i));

  const blockedField = result?.kind === "blocked" ? result.field : null;
  const fieldError = (field: string) => (result?.kind === "blocked" && result.field === field ? result.reason : null);

  const setRows = (rows: HeaderRow[], ids: number[]) => {
    setHeaders(rows);
    setRowIds(ids);
  };
  const addHeader = () => setRows([...headers, { name: "", value: "" }], [...rowIds, nextRowId.current++]);
  const removeHeader = (i: number) => setRows(headers.filter((_, n) => n !== i), rowIds.filter((_, n) => n !== i));
  const editHeader = (i: number, patch: Partial<HeaderRow>) => setHeaders(headers.map((h, n) => (n === i ? { ...h, ...patch } : h)));

  const applyExample = (request: PlaygroundRequest) => {
    setMethod(request.method);
    setPath(request.path);
    const rows = request.headers.length ? request.headers : DEFAULT_HEADERS;
    setRows(
      rows.map((h) => ({ ...h })),
      rows.map(() => nextRowId.current++),
    );
    setBody(request.body);
    setResult(null);
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const request: PlaygroundRequest = { method, path, headers, body: method === "GET" ? "" : body };
    const v = validateRequest(request);
    if (!v.ok) {
      setResult({ kind: "blocked", field: v.field, reason: v.reason });
      return;
    }
    // Defence in depth: the validated path is resolved against this page's origin and must stay on it.
    const url = new URL(path.trim(), window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== v.pathname) {
      setResult({ kind: "blocked", field: "path", reason: "The path must stay on this DevForge server." });
      return;
    }
    const slot = limiter.current.take(Date.now());
    setRemaining(slot.remaining);
    if (!slot.allowed) {
      setResult({ kind: "limited", retryAfterSeconds: slot.retryAfterSeconds });
      return;
    }
    setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch(`${url.pathname}${url.search}`, {
        method,
        headers: v.headers,
        credentials: cookie ? "same-origin" : "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        ...(request.body !== "" ? { body: request.body } : {}),
      });
      const text = await res.text();
      const ms = Math.round(performance.now() - started);
      let code: string | undefined;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: unknown } } | null;
        code = typeof parsed?.error?.code === "string" ? parsed.error.code : undefined;
      } catch {
        code = undefined;
      }
      setResult({
        kind: "response",
        request: `${method} ${url.pathname}${url.search}`,
        status: res.status,
        ms,
        headers: SHOWN_RESPONSE_HEADERS.flatMap((name) => {
          const value = res.headers.get(name);
          return value === null ? [] : [[name, value] as [string, string]];
        }),
        body: prettyBody(text),
        explanation: explain(res.status, code),
      });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setResult({ kind: "network", message: timedOut ? "the server did not answer within 15 seconds." : "the request could not be sent. Check your connection." });
    } finally {
      setBusy(false);
    }
  };

  const describedBy = (field: string, hint?: string) => [hint, fieldError(field) ? `pg-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="page playground">
      <Crumbs items={[{ label: "Tracks", to: "/tracks" }, { label: "Postman", to: "/tracks/postman" }, { label: "Request playground" }]} />
      <header className="sim-page__head">
        <h1>Request playground</h1>
        <p className="lede">Send HTTP requests to DevForge&apos;s own API from your browser and read the status, the headers and the body — with an explanation when something goes wrong.</p>
      </header>

      <div className="notice notice--warn playground__label" role="note">
        <p>
          <strong>Playground — these are real requests to this DevForge server, as you.</strong>{" "}
          {user
            ? `You are signed in as ${user.displayName}. With "Send my session cookie" ticked, requests carry your session, so they read — and can change — your own data.`
            : user === null
              ? "You are not signed in, so personal endpoints (under /api/me/) answer 401. Sign in to try them."
              : "Checking whether you are signed in…"}{" "}
          Unlike the <Link to="/tracks/postman/simulations/postman-request-builder">request builder simulation</Link>, nothing here is modelled.
        </p>
      </div>

      <div className="playground__layout">
        <form className="playground__form" onSubmit={send} noValidate aria-labelledby="pg-request-h">
          <h2 id="pg-request-h">Request</h2>
          <div className="playground__line">
            <div className="field">
              <label htmlFor="pg-method">Method</label>
              <select id="pg-method" className="select" value={method} onChange={(e) => setMethod(e.target.value as Method)} aria-invalid={blockedField === "method" || undefined} aria-describedby={describedBy("method")}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="field playground__path">
              <label htmlFor="pg-path">Path</label>
              <input
                id="pg-path"
                className="input"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={blockedField === "path" || undefined}
                aria-describedby={describedBy("path", "pg-path-hint")}
              />
              <span id="pg-path-hint" className="field__hint">
                Under /api/ on this server, such as /api/tracks/postman or /api/search?q=docker.
              </span>
            </div>
          </div>
          {fieldError("method") ? (
            <p id="pg-method-error" className="field__error">
              {fieldError("method")}
            </p>
          ) : null}
          {fieldError("path") ? (
            <p id="pg-path-error" className="field__error">
              {fieldError("path")}
            </p>
          ) : null}

          <fieldset className="playground__headers" aria-describedby={describedBy("headers", "pg-headers-hint")}>
            <legend>Headers</legend>
            <p id="pg-headers-hint" className="field__hint">
              DevForge refuses writes (POST, PUT, PATCH, DELETE) without <code>X-DevForge-CSRF: 1</code>. It is added for you — remove it to see the 403 that protects you from cross-site request forgery.
            </p>
            {headers.length ? (
              <ul className="playground__rows">
                {headers.map((h, i) => (
                  <li key={rowIds[i]} className="playground__row">
                    <input className="input" aria-label={`Header ${i + 1} name`} value={h.name} placeholder="Name" spellCheck={false} autoComplete="off" onChange={(e) => editHeader(i, { name: e.target.value })} />
                    <input className="input" aria-label={`Header ${i + 1} value`} value={h.value} placeholder="Value" spellCheck={false} autoComplete="off" onChange={(e) => editHeader(i, { value: e.target.value })} />
                    <button type="button" className="btn btn--small btn--ghost" aria-label={`Remove header ${h.name || i + 1}`} onClick={() => removeHeader(i)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No headers.</p>
            )}
            <button type="button" className="btn btn--small" onClick={addHeader}>
              Add header
            </button>
            {fieldError("headers") ? (
              <p id="pg-headers-error" className="field__error">
                {fieldError("headers")}
              </p>
            ) : null}
          </fieldset>

          <div className="field">
            <label htmlFor="pg-body">Body</label>
            <textarea
              id="pg-body"
              className="input textarea playground__body"
              rows={5}
              value={method === "GET" ? "" : body}
              disabled={method === "GET"}
              spellCheck={false}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={blockedField === "body" || undefined}
              aria-describedby={describedBy("body", "pg-body-hint")}
            />
            <span id="pg-body-hint" className="field__hint">
              {method === "GET" ? "GET requests have no body." : "Usually JSON. Invalid JSON is sent as it is, so you can see the server's 400."}
            </span>
            {fieldError("body") ? (
              <p id="pg-body-error" className="field__error">
                {fieldError("body")}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="checkbox">
              <input type="checkbox" checked={cookie} onChange={(e) => setCookie(e.target.checked)} aria-describedby="pg-cookie-hint" /> Send my session cookie
            </label>
            <span id="pg-cookie-hint" className="field__hint">
              Untick it to send the request as an anonymous visitor (credentials: &quot;omit&quot;).
            </span>
          </div>

          <div className="playground__send">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
            <span className="small muted" id="pg-remaining">
              {remaining} of {limiter.current.limit} requests left this minute
            </span>
          </div>

          <h3 className="playground__examples-h">Start from an example</h3>
          <ul className="playground__examples">
            {EXAMPLES.map((ex) => (
              <li key={ex.label}>
                <button type="button" className="btn btn--small" onClick={() => applyExample(ex.request)}>
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </form>

        <section className="playground__result" aria-labelledby="pg-response-h">
          <h2 id="pg-response-h">Response</h2>
          {/* The live region holds only the short summary and the explanation; the headers and body follow it. */}
          <div role="status" className="playground__status">
            {result ? (
              <>
                <p className="playground__summary" data-ok={result.kind === "response" ? String(result.status < 400) : "false"}>
                  <strong>{summary(result)}</strong>
                  {result.kind === "response" ? <span className="small muted"> · {result.ms} ms</span> : null}
                </p>
                {result.kind === "response" && result.status >= 400 ? (
                  <div className="notice notice--danger playground__explain">
                    <p>
                      <strong>What went wrong — {result.explanation.title}.</strong> {result.explanation.text}
                    </p>
                  </div>
                ) : null}
                {result.kind === "response" && result.status < 400 ? <p className="small">{result.explanation.text}</p> : null}
              </>
            ) : (
              <p className="small muted">Build a request and press Send. The answer appears here.</p>
            )}
          </div>
          {result?.kind === "response" ? (
            <>
              <h3>Headers</h3>
              {result.headers.length ? (
                <dl className="playground__resp-headers">
                  {result.headers.map(([name, value]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="small muted">None of the headers shown here were sent.</p>
              )}
              <h3>Body</h3>
              {result.body.length ? (
                <pre className="playground__resp-body" tabIndex={0} role="region" aria-label="Response body">
                  <code>{result.body.text}</code>
                </pre>
              ) : (
                <p className="small muted">(no body)</p>
              )}
              {result.body.truncated ? <p className="small muted">Showing the first 20,000 of {result.body.length.toLocaleString("en")} characters.</p> : null}
            </>
          ) : null}
        </section>
      </div>

      <section className="section" aria-labelledby="pg-limits-h" style={{ maxWidth: "var(--measure)" }}>
        <h2 id="pg-limits-h">How the playground is limited</h2>
        <ul>
          <li>
            <strong>Only DevForge&apos;s own API, on this site.</strong> Requests go to paths under <code>/api/</code> on this server and nowhere else; the page&apos;s security policy would block any other address anyway.
          </li>
          <li>
            <strong>Only the endpoints listed below.</strong> Reading the catalogue and your own data, a lesson self-check and bookmarking — never administration, the content editor, cohorts, account deletion, data export or signing in and out. A disallowed request is refused here, before anything is sent.
          </li>
          <li>
            <strong>At most {limiter.current.limit} requests a minute from this page.</strong> The server also limits every account (600 requests a minute by default) and every network address, across all your tabs; if you reach those limits, the answer is the server&apos;s own <code>429 Too Many Requests</code> with a <code>Retry-After</code> header.
          </li>
        </ul>
        <details className="playground__allowed">
          <summary>What you can send ({ALLOWED.length} endpoints)</summary>
          <ul>
            {ALLOWED.map((e) => (
              <li key={`${e.method} ${e.pattern}`}>
                <code>
                  {e.method} {e.pattern}
                </code>
                {e.kind === "write" ? " — changes your own data" : e.kind === "unrouted" ? " — no such handler: the server answers 405" : e.personal ? " — signed in only" : ""}
              </li>
            ))}
          </ul>
          <p className="small muted">
            <code>:slug</code>, <code>:id</code> and <code>:type</code> stand for one part of the path, such as <code>postman</code> or <code>postman-http-basics</code>.
          </p>
        </details>
        <p>
          New to HTTP? Start with the lesson <Link to="/tracks/postman/lessons/postman-http-basics">HTTP requests and responses</Link>, which sends the same requests with curl and Postman.
        </p>
      </section>
    </div>
  );
}
