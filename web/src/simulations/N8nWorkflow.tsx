import { isValid, RULE_TEXT, RULES, SUBMISSIONS, workflowExecutor, type OnError, type WorkflowAction, type WorkflowState } from "../../../shared/simulations/n8n/workflow-executor.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: WorkflowAction): string {
  switch (a.type) {
    case "toggleRule":
      return `Valid?: toggle "${RULE_TEXT[a.rule]}"`;
    case "setFalseBranch":
      return a.to === "none" ? "disconnect Valid? (false)" : "connect Valid? (false) → Error workflow";
    case "setOnError":
      return `Check seats → Settings → On Error: ${a.mode === "stop" ? "Stop Workflow" : "Continue (using error output)"}`;
    case "setRetries":
      return `Check seats → Settings → Retry On Fail: ${a.retries ? `${a.retries} tries more` : "off"}`;
    case "run":
      return "Execute workflow";
  }
}

const ids = (list: number[]) => (list.length ? list.map((id) => `#${id}`).join(" ") : "—");

function N8nWorkflowView({ state, dispatch }: ViewProps<WorkflowState, WorkflowAction>) {
  const r = state.last;
  const outcome = (id: number) =>
    !r ? "not run" : r.status === "error" ? (r.notRun.includes(id) ? "never processed (execution failed)" : r.dropped.includes(id) ? "dropped silently" : r.toErrorWorkflow.includes(id) ? "error workflow" : "not saved (execution failed)") : r.saved.includes(id) ? "saved" : r.toErrorWorkflow.includes(id) ? "error workflow" : "dropped silently";
  return (
    <div className="n8n-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Last execution</dt>
          <dd className={r ? (r.status === "success" ? "rag-sim__ok" : "rag-sim__bad") : undefined}>{r ? (r.status === "success" ? "succeeded" : "failed") : "not run yet"}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{r ? ids(r.saved) : "—"}</dd>
        </div>
        <div>
          <dt>Error workflow</dt>
          <dd>{r ? ids(r.toErrorWorkflow) : "—"}</dd>
        </div>
        <div>
          <dt>Dropped silently</dt>
          <dd>{r ? ids(r.dropped) : "—"}</dd>
        </div>
      </dl>

      <fieldset className="airflow-sim__backfill">
        <legend>Valid? (If node) checks</legend>
        <div className="n8n-sim__rules">
          {RULES.map((rule) => (
            <label key={rule} className="n8n-sim__rule">
              <input type="checkbox" checked={state.rules.includes(rule)} onChange={() => dispatch({ type: "toggleRule", rule })} /> {RULE_TEXT[rule]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="prom-sim__query">
        <Field label="Valid? false output">
          {(id) => (
            <select id={id} value={state.falseBranch} onChange={(e) => dispatch({ type: "setFalseBranch", to: e.target.value as WorkflowState["falseBranch"] })}>
              <option value="none">not connected</option>
              <option value="errorWorkflow">→ error workflow</option>
            </select>
          )}
        </Field>
        <Field label="Check seats: On Error">
          {(id) => (
            <select id={id} value={state.onError} onChange={(e) => dispatch({ type: "setOnError", mode: e.target.value as OnError })}>
              <option value="stop">Stop Workflow</option>
              <option value="errorOutput">Continue (using error output)</option>
            </select>
          )}
        </Field>
        <Field label="Check seats: retries">
          {(id) => (
            <select id={id} value={state.retries} onChange={(e) => dispatch({ type: "setRetries", retries: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "run" })}>
          Run the workflow
        </button>
      </div>

      <table className="airflow-sim__runs">
        <caption className="sr-only">Form submissions and where each one ended up in the last execution</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Submission</th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {SUBMISSIONS.map((s) => {
            const out = outcome(s.id);
            const wrong = r !== null && ((isValid(s) && out !== "saved") || (!isValid(s) && out !== "error workflow"));
            return (
              <tr key={s.id}>
                <th scope="row">{s.id}</th>
                <td>
                  {s.name || <em>(no name)</em>}
                  <span className="airflow-sim__detail">
                    {s.email} · {s.track}
                    {isValid(s) ? "" : " · invalid"}
                  </span>
                </td>
                <td className={wrong ? "airflow-sim__rows--wrong" : undefined}>{out}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {r ? (
        <ol className="n8n-sim__trace" aria-label="Items each node produced in the last execution">
          {r.trace.map((t) => (
            <li key={t.node}>
              <strong>{t.node}</strong>
              {t.outputs.map((o, i) => (
                <span key={i} className="n8n-sim__out">
                  {t.outputs.length > 1 ? (t.node === "Valid?" ? (i === 0 ? "true: " : "false: ") : i === 0 ? "ok: " : "error: ") : ""}
                  {ids(o)}
                </span>
              ))}
              {t.note ? <span className="airflow-sim__detail">{t.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="small muted">Run the workflow to see the items each node produced.</p>
      )}
    </div>
  );
}

const entry: SimulationEntry = { model: workflowExecutor, View: N8nWorkflowView, command: (a) => command(a as WorkflowAction) };
export default entry;
