import { useState } from "react";
import { BODIES, ENDPOINTS, requestBuilder, type Body, type BuilderAction, type BuilderState } from "../../../shared/simulations/postman/request-builder.ts";
import { Link } from "../lib/router.tsx";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: BuilderAction): string {
  const e = ENDPOINTS[a.request.endpoint]!;
  return `${e.method} ${e.path}${a.request.csrf ? " -H X-DevForge-CSRF:1" : ""}${a.request.cookie ? " -b cookies.txt" : ""}${a.request.body !== "none" ? ` (body: ${a.request.body})` : ""}`;
}

function RequestBuilderView({ state, dispatch }: ViewProps<BuilderState, BuilderAction>) {
  const [endpoint, setEndpoint] = useState(0);
  const [csrf, setCsrf] = useState(false);
  const [cookie, setCookie] = useState(false);
  const [body, setBody] = useState<Body>("none");
  const last = state.history.at(-1);
  return (
    <div className="req-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Session cookie</dt>
          <dd>{state.session ? "held (signed in)" : "none"}</dd>
        </div>
        <div>
          <dt>Bookmarks</dt>
          <dd>{state.bookmarks.join(", ") || "none"}</dd>
        </div>
      </dl>
      <div className="prom-sim__query">
        <Field label="Request">
          {(id) => (
            <select id={id} value={endpoint} onChange={(e) => setEndpoint(Number(e.target.value))}>
              {ENDPOINTS.map((e, i) => (
                <option key={i} value={i}>
                  {e.method} {e.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Body">
          {(id) => (
            <select id={id} value={body} onChange={(e) => setBody(e.target.value as Body)}>
              {BODIES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={csrf} onChange={(e) => setCsrf(e.target.checked)} /> X-DevForge-CSRF header
        </label>
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={cookie} onChange={(e) => setCookie(e.target.checked)} /> Send the session cookie
        </label>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "send", request: { endpoint, csrf, cookie, body } })}>
          Send
        </button>
      </div>
      {last ? (
        <div className="req-sim__response" data-ok={last.response.status < 400 ? "true" : "false"}>
          <p>
            <strong>
              {ENDPOINTS[last.request.endpoint]!.method} {ENDPOINTS[last.request.endpoint]!.path} → {last.response.status}
            </strong>
          </p>
          <pre>{last.response.body}</pre>
          <p className="small">{last.response.explain}</p>
        </div>
      ) : (
        <p className="small muted">Build a request and press Send.</p>
      )}
      {state.history.length > 1 ? (
        <ol className="ngx-sim__log" aria-label="Earlier requests">
          {state.history.slice(0, -1).slice(-6).map((h, i) => (
            <li key={i}>
              <code>
                {ENDPOINTS[h.request.endpoint]!.method} {ENDPOINTS[h.request.endpoint]!.path}
              </code>{" "}
              → {h.response.status}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="small muted">
        This is a model of the API. To send real requests to this server, as you, open the <Link to="/tracks/postman/playground">request playground</Link>.
      </p>
    </div>
  );
}

const entry: SimulationEntry = { model: requestBuilder, View: RequestBuilderView, command: (a) => command(a as BuilderAction) };
export default entry;
