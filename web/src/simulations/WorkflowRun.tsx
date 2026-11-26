import { DURATION, JOBS, workflowRun, type JobId, type WorkflowRunAction, type WorkflowRunState } from "../../../shared/simulations/github-actions/workflow-run.ts";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: WorkflowRunAction): string {
  switch (a.type) {
    case "toggleNeed":
      return `jobs.${a.job}.needs: toggle ${a.on}`;
    case "setUnitMode":
      return a.mode === "matrix" ? "jobs.unit.strategy.matrix.node: [20, 22, 24]" : "jobs.unit: test Node 20, 22 and 24 in one job";
    case "setFailing":
      return `(make ${a.job} ${a.failing ? "fail" : "pass"})`;
    case "run":
      return "(push: the workflow runs)";
  }
}

function WorkflowRunView({ state, dispatch }: ViewProps<WorkflowRunState, WorkflowRunAction>) {
  const r = state.last;
  const scale = Math.max(12, r?.total ?? 12);
  return (
    <div className="ghrun-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Run time</dt>
          <dd className={r ? (r.total <= 12 ? "rag-sim__ok" : "rag-sim__bad") : undefined}>{r ? `${r.total} min` : "not run yet"}</dd>
        </div>
        <div>
          <dt>Unit tests</dt>
          <dd>{state.unitMode === "matrix" ? "matrix: Node 20, 22, 24 side by side" : "one job: Node 20, 22, 24 in turn"}</dd>
        </div>
      </dl>

      <table className="airflow-sim__runs ghrun-sim__needs">
        <caption className="sr-only">Each job, its duration and the jobs it needs</caption>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">needs</th>
            <th scope="col">
              <span className="sr-only">Fail on purpose</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {JOBS.map((j) => (
            <tr key={j}>
              <th scope="row">
                {j}
                <span className="airflow-sim__detail">{j === "unit" ? (state.unitMode === "matrix" ? `${DURATION.unit} min × 3` : `${DURATION.unit * 3} min`) : `${DURATION[j]} min`}</span>
              </th>
              <td>
                <span className="ghrun-sim__chips">
                  {JOBS.filter((o) => o !== j).map((o) => (
                    <label key={o} className="n8n-sim__rule">
                      <input type="checkbox" checked={state.needs[j].includes(o)} onChange={() => dispatch({ type: "toggleNeed", job: j, on: o })} /> {o}
                    </label>
                  ))}
                </span>
              </td>
              <td>
                <label className="n8n-sim__rule">
                  <input type="checkbox" checked={state.failing.includes(j as JobId)} onChange={(e) => dispatch({ type: "setFailing", job: j, failing: e.target.checked })} /> fails
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="prom-sim__query">
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={state.unitMode === "matrix"} onChange={(e) => dispatch({ type: "setUnitMode", mode: e.target.checked ? "matrix" : "sequential" })} /> Run unit as a matrix
        </label>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "run" })}>
          Run the workflow
        </button>
      </div>

      {r ? (
        <ol className="ghrun-sim__timeline" aria-label={`Timeline: ${r.total} minutes`}>
          {r.jobs.map((j) => (
            <li key={j.name} data-result={j.result}>
              <span className="ghrun-sim__name">{j.name}</span>
              <span className="ghrun-sim__track">
                {j.start !== null && j.end !== null ? (
                  <span className="ghrun-sim__bar" style={{ marginLeft: `${(j.start / scale) * 100}%`, width: `${((j.end - j.start) / scale) * 100}%` }}>
                    {j.start}–{j.end}
                  </span>
                ) : (
                  <span className="muted small">skipped</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="small muted">Press “Run the workflow” to see the timeline.</p>
      )}
    </div>
  );
}

const entry: SimulationEntry = { model: workflowRun, View: WorkflowRunView, command: (a) => command(a as WorkflowRunAction) };
export default entry;
