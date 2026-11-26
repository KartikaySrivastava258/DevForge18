import { useState } from "react";
import { BUILDS, buildQueue, LABELS, maxWait, MINUTES, waitOf, type Label, type QueueAction, type QueueState } from "../../../shared/simulations/jenkins/build-queue.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: QueueAction): string {
  if (a.type === "addAgent") return `add an agent: label "${a.label}", ${a.executors} executor${a.executors === 1 ? "" : "s"}`;
  if (a.type === "removeAgent") return `remove agent ${a.name}`;
  return `(${a.count ?? 1} minute${(a.count ?? 1) === 1 ? "" : "s"} pass)`;
}

function BuildQueueView({ state, dispatch }: ViewProps<QueueState, QueueAction>) {
  const [label, setLabel] = useState<Label>("docker");
  const [executors, setExecutors] = useState(1);
  const started = state.t > 0;
  return (
    <div className="queue-sim">
      <dl className="k8s-sim__summary">
        <div><dt>Minute</dt><dd>{state.t} of {MINUTES}</dd></div>
        <div><dt>Longest wait</dt><dd className={maxWait(state) <= 2 ? "rag-sim__ok" : "rag-sim__bad"}>{maxWait(state)} min</dd></div>
        <div><dt>Finished</dt><dd>{state.runs.filter((r) => r.end !== null && r.end <= state.t).length} of {BUILDS.length}</dd></div>
      </dl>
      <div className="kafka-sim__members">
        <strong>Agents</strong>
        <ul>
          {state.agents.map((a) => (
            <li key={a.name}>
              <span>{a.name}: label <code>{a.label}</code>, {a.executors} executor{a.executors === 1 ? "" : "s"}</span>
              <button type="button" className="btn btn--small btn--ghost" disabled={started} aria-label={`Remove agent ${a.name}`} onClick={() => dispatch({ type: "removeAgent", name: a.name })}>Remove</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="prom-sim__query">
        <Field label="Agent label">
          {(id) => (
            <select id={id} value={label} disabled={started} onChange={(e) => setLabel(e.target.value as Label)}>
              {LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </Field>
        <Field label="Executors">
          {(id) => (
            <select id={id} value={executors} disabled={started} onChange={(e) => setExecutors(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small btn--ghost" disabled={started} onClick={() => dispatch({ type: "addAgent", label, executors })}>Add agent</button>
        <button type="button" className="btn btn--small" disabled={state.t >= MINUTES} onClick={() => dispatch({ type: "tick", count: MINUTES - state.t })}>Run the half hour</button>
      </div>
      <table className="airflow-sim__runs">
        <caption className="sr-only">Builds, their label, when they ran and how long they waited</caption>
        <thead><tr><th scope="col">Build</th><th scope="col">Ran on</th><th scope="col">Waited</th></tr></thead>
        <tbody>
          {BUILDS.map((b) => {
            const r = state.runs.find((x) => x.id === b.id)!;
            const arrived = b.at < state.t;
            return (
              <tr key={b.id}>
                <th scope="row">{b.id}<span className="airflow-sim__detail">{b.label} · arrives {b.at} · {b.minutes} min</span></th>
                <td>{r.agent ? `${r.agent}, ${r.start}–${r.end}` : arrived ? "waiting" : "—"}</td>
                <td className={arrived && waitOf(r, state.t) > 2 ? "airflow-sim__rows--wrong" : undefined}>{arrived || r.start !== null ? `${waitOf(r, state.t)} min` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const entry: SimulationEntry = { model: buildQueue, View: BuildQueueView, command: (a) => command(a as QueueAction) };
export default entry;
