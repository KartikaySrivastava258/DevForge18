import { cacheLoad, DURATION, hitRatio, keyCount, peak, POLICIES, POLICY_NOTES, traffic, type CacheAction, type CacheState, type Policy } from "../../../shared/simulations/redis/cache-load.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: CacheAction): string {
  switch (a.type) {
    case "tick":
      return `(${a.count ?? 1} second${(a.count ?? 1) === 1 ? "" : "s"} of traffic)`;
    case "setCache":
      return a.on ? "use cache-aside (GET, then SET … EX on a miss)" : "read straight from the database";
    case "setTtl":
      return `SET … EX ${a.seconds}`;
    case "setSingleFlight":
      return a.on ? "on a miss: SET lock NX, one request refills, others wait" : "on a miss: every request queries the database";
    case "setPolicy":
      return `CONFIG SET maxmemory-policy ${a.policy}`;
    case "setMaxKeys":
      return a.keys === null ? "CONFIG SET maxmemory 0 (no limit)" : `maxmemory: room for ${a.keys} keys`;
  }
}

const H = 160, W = 600, L = 34, B = 22, T = 10;

function LoadChart({ state }: { state: CacheState }) {
  const max = 400;
  const x = (t: number) => L + (t / DURATION) * (W - L - 6);
  const y = (q: number) => T + (1 - q / max) * (H - T - B);
  const pts = state.dbLoad.map((q, t) => `${x(t)},${y(q)}`).join(" ");
  const req = Array.from({ length: DURATION }, (_, t) => `${x(t)},${y(traffic(t))}`).join(" ");
  return (
    <svg className="mlflow-sim__plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Database queries per second over ${state.t} seconds; peak ${peak(state)}; limit ${state.limit}`}>
      <line className="mlflow-sim__axis" x1={L} y1={H - B} x2={W - 6} y2={H - B} />
      <line className="mlflow-sim__axis" x1={L} y1={T} x2={L} y2={H - B} />
      <polyline className="sprint-sim__ideal" points={req} />
      <line className="mlflow-sim__limit" x1={L} y1={y(state.limit)} x2={W - 6} y2={y(state.limit)} />
      <polyline className="sprint-sim__line" points={pts} />
      {[0, 20, 40, 60].map((t) => (
        <text key={t} className="mlflow-sim__tick" x={x(t)} y={H - B + 14} textAnchor="middle">
          {t}s
        </text>
      ))}
      {[0, 200, 400].map((q) => (
        <text key={q} className="mlflow-sim__tick" x={L - 4} y={y(q) + 4} textAnchor="end">
          {q}
        </text>
      ))}
    </svg>
  );
}

function CacheLoadView({ state, dispatch }: ViewProps<CacheState, CacheAction>) {
  const started = state.t > 0;
  return (
    <div className="cache-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Second</dt>
          <dd>
            {state.t} of {DURATION}
          </dd>
        </div>
        <div>
          <dt>Hit ratio</dt>
          <dd>{(hitRatio(state) * 100).toFixed(1)} %</dd>
        </div>
        <div>
          <dt>Peak database load</dt>
          <dd className={peak(state) > state.limit ? "rag-sim__bad" : "rag-sim__ok"}>
            {peak(state)} / s (limit {state.limit})
          </dd>
        </div>
        {state.maxKeys !== null ? (
          <>
            <div>
              <dt>Keys in memory</dt>
              <dd>
                {keyCount(state)} (room for {state.maxKeys})
              </dd>
            </div>
            <div>
              <dt>Sessions evicted</dt>
              <dd className={state.sessionsLost ? "rag-sim__bad" : "rag-sim__ok"}>{state.sessionsLost}</dd>
            </div>
            <div>
              <dt>Writes refused (OOM)</dt>
              <dd className={state.oom ? "rag-sim__bad" : "rag-sim__ok"}>{state.oom}</dd>
            </div>
          </>
        ) : null}
      </dl>
      <div className="prom-sim__query">
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={state.cacheOn} disabled={started} onChange={(e) => dispatch({ type: "setCache", on: e.target.checked })} /> Cache-aside
        </label>
        <Field label="TTL (seconds)">
          {(id) => (
            <select id={id} value={state.ttl} disabled={started} onChange={(e) => dispatch({ type: "setTtl", seconds: Number(e.target.value) })}>
              {[1, 5, 10, 30, 60, 120].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={state.singleFlight} disabled={started} onChange={(e) => dispatch({ type: "setSingleFlight", on: e.target.checked })} /> Single flight
        </label>
        <Field label="Memory limit">
          {(id) => (
            <select id={id} value={state.maxKeys ?? "none"} disabled={started} onChange={(e) => dispatch({ type: "setMaxKeys", keys: e.target.value === "none" ? null : Number(e.target.value) })}>
              <option value="none">none (maxmemory 0)</option>
              {[20, 30, 40, 50, 60, 80].map((n) => (
                <option key={n} value={n}>
                  room for {n} keys
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="maxmemory-policy">
          {(id) => (
            <select id={id} value={state.policy} disabled={started} onChange={(e) => dispatch({ type: "setPolicy", policy: e.target.value as Policy })}>
              {POLICIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small" disabled={state.t >= DURATION} onClick={() => dispatch({ type: "tick", count: DURATION - state.t })}>
          Run the rest of the minute
        </button>
      </div>
      <figure className="mlflow-sim__figure">
        <LoadChart state={state} />
        <figcaption className="small muted">Solid: database queries per second. Dashed grey: requests per second. Dashed amber: the database's limit.</figcaption>
      </figure>
      {state.maxKeys !== null || state.sessions.length ? (
        <p className="small muted">
          {state.policy}: {POLICY_NOTES[state.policy]} {state.sessions.length} user session{state.sessions.length === 1 ? "" : "s"} (no TTL) stored now.
        </p>
      ) : null}
    </div>
  );
}

const entry: SimulationEntry = { model: cacheLoad, View: CacheLoadView, command: (a) => command(a as CacheAction) };
export default entry;
