import { championRun, experimentExplorer, KINDS, RUNS, runById, visibleRuns, type ExplorerAction, type ExplorerState, type Kind, type SortKey } from "../../../shared/simulations/mlflow/experiment-explorer.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: ExplorerAction): string {
  switch (a.type) {
    case "sort":
      return `search_runs(order_by=["${a.by === "latencyMs" ? "metrics.latency_ms" : a.by === "rmse" ? "metrics.rmse" : "attributes.run_name"} ${a.dir.toUpperCase()}"])`;
    case "filter": {
      const parts = [a.kind === "all" ? null : `params.kind = '${a.kind}'`, a.maxLatencyMs === null ? null : `metrics.latency_ms <= ${a.maxLatencyMs}`].filter(Boolean);
      return `search_runs(filter_string="${parts.join(" and ")}")`;
    }
    case "register":
      return `mlflow.register_model("runs:/<run ID of ${runById(a.runId)?.name ?? a.runId}>/model", "diabetes-model")`;
    case "setChampion":
      return `client.set_registered_model_alias("diabetes-model", "champion", ${a.version})`;
  }
}

// Scatter plot geometry (viewBox units).
const W = 320, H = 210, L = 44, B = 32, T = 24, R = 12;
const minR = 48, maxR = 56, maxL = 13;
const px = (ms: number) => L + (ms / maxL) * (W - L - R);
const py = (rmse: number) => T + ((maxR - rmse) / (maxR - minR)) * (H - T - B);

function Plot({ state }: { state: ExplorerState }) {
  const shown = new Set(visibleRuns(state).map((r) => r.id));
  const champ = championRun(state);
  return (
    <svg className="mlflow-sim__plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`RMSE against latency for ${RUNS.length} runs${champ ? `; the champion is ${champ.name}` : ""}`}>
      <line className="mlflow-sim__axis" x1={L} y1={H - B} x2={W - R} y2={H - B} />
      <line className="mlflow-sim__axis" x1={L} y1={T} x2={L} y2={H - B} />
      {[0, 4, 8, 12].map((ms) => (
        <text key={ms} className="mlflow-sim__tick" x={px(ms)} y={H - B + 14} textAnchor="middle">
          {ms}
        </text>
      ))}
      {[48, 52, 56].map((r) => (
        <text key={r} className="mlflow-sim__tick" x={L - 6} y={py(r) + 4} textAnchor="end">
          {r}
        </text>
      ))}
      <text className="mlflow-sim__tick" x={(L + W - R) / 2} y={H - 2} textAnchor="middle">
        latency (ms) →
      </text>
      <text className="mlflow-sim__tick" x={4} y={12}>
        RMSE (lower is better)
      </text>
      {state.limitMs !== null ? <line className="mlflow-sim__limit" x1={px(state.limitMs)} y1={T} x2={px(state.limitMs)} y2={H - B} /> : null}
      {RUNS.map((r) => (
        <circle key={r.id} className="mlflow-sim__dot" data-kind={r.kind} data-dim={shown.has(r.id) ? "false" : "true"} cx={px(r.latencyMs)} cy={py(r.rmse)} r={5}>
          <title>{`${r.name}: RMSE ${r.rmse.toFixed(1)}, ${r.latencyMs} ms`}</title>
        </circle>
      ))}
      {champ ? <circle className="mlflow-sim__champ" cx={px(champ.latencyMs)} cy={py(champ.rmse)} r={9} /> : null}
    </svg>
  );
}

function MlflowExplorerView({ state, dispatch }: ViewProps<ExplorerState, ExplorerAction>) {
  const rows = visibleRuns(state);
  const champ = championRun(state);
  return (
    <div className="mlflow-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>@champion</dt>
          <dd>{champ ? `version ${state.champion}: ${champ.name}` : "not set"}</dd>
        </div>
        <div>
          <dt>Latency budget</dt>
          <dd>{state.limitMs === null ? "none" : `${state.limitMs} ms`}</dd>
        </div>
        <div>
          <dt>Registered versions</dt>
          <dd>{state.versions.length}</dd>
        </div>
      </dl>

      <div className="prom-sim__query">
        <Field label="Sort by">
          {(id) => (
            <select id={id} value={`${state.sort.by} ${state.sort.dir}`} onChange={(e) => { const [by, dir] = e.target.value.split(" "); dispatch({ type: "sort", by: by as SortKey, dir: dir as "asc" | "desc" }); }}>
              <option value="name asc">name</option>
              <option value="rmse asc">RMSE, lowest first</option>
              <option value="latencyMs asc">latency, fastest first</option>
            </select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <select id={id} value={state.filter.kind} onChange={(e) => dispatch({ type: "filter", kind: e.target.value as Kind | "all", maxLatencyMs: state.filter.maxLatencyMs })}>
              <option value="all">all kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Max latency">
          {(id) => (
            <select id={id} value={state.filter.maxLatencyMs ?? ""} onChange={(e) => dispatch({ type: "filter", kind: state.filter.kind, maxLatencyMs: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">any</option>
              {[1, 2, 5, 10].map((ms) => (
                <option key={ms} value={ms}>
                  {ms} ms
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="mlflow-sim__layout">
        <table className="airflow-sim__runs mlflow-sim__runs">
          <caption className="sr-only">Runs of the experiment, in the current order and filter</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">RMSE</th>
              <th scope="col">Latency</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-champion={champ?.id === r.id ? "true" : "false"}>
                <th scope="row">
                  {r.name}
                  <span className="airflow-sim__detail">{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(", ")}</span>
                </th>
                <td>{r.rmse.toFixed(1)}</td>
                <td className={state.limitMs !== null && r.latencyMs > state.limitMs ? "airflow-sim__rows--wrong" : undefined}>{r.latencyMs} ms</td>
                <td>
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "register", runId: r.id })}>
                    Register<span className="sr-only"> {r.name}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <figure className="mlflow-sim__figure">
          <Plot state={state} />
          <figcaption className="small muted">
            {KINDS.map((k) => (
              <span key={k} className="mlflow-sim__key" data-kind={k}>
                {k}
              </span>
            ))}
            {state.limitMs !== null ? <span>dashed line: {state.limitMs} ms budget</span> : null} · ring: champion
          </figcaption>
        </figure>
      </div>
      {rows.length === 0 ? <p className="small muted">No run matches the filter.</p> : null}

      <div className="kafka-sim__members">
        <strong>Registered model diabetes-model</strong>
        {state.versions.length ? (
          <ul>
            {state.versions.map((v) => (
              <li key={v.version}>
                <span>
                  version {v.version}: {runById(v.runId)?.name}
                  {state.champion === v.version ? " — @champion" : ""}
                </span>
                {state.champion === v.version ? null : (
                  <button type="button" className="btn btn--small btn--ghost" aria-label={`Make version ${v.version} champion`} onClick={() => dispatch({ type: "setChampion", version: v.version })}>
                    Make champion
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No versions yet: register a run.</p>
        )}
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: experimentExplorer, View: MlflowExplorerView, command: (a) => command(a as ExplorerAction) };
export default entry;
