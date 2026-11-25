import { useState } from "react";
import {
  available,
  IMAGES,
  kubectlCommand,
  reconciliation,
  resolveStrategy,
  rolloutComplete,
  type K8sAction,
  type K8sState,
  type Pod,
} from "../../../shared/simulations/kubernetes/reconciliation.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const STRATEGY = ["0", "1", "2", "25%", "50%"] as const;
type StrategyValue = (typeof STRATEGY)[number];

/** Short, readable phase labels; the phase is always written, never shown by colour alone. */
function PodChip({ pod, current, onDelete }: { pod: Pod; current: boolean; onDelete: () => void }) {
  const short = pod.name.split("-").slice(-1)[0];
  return (
    <li className="k8s-pod" data-phase={pod.phase} data-ready={pod.ready ? "true" : "false"} data-current={current ? "true" : "false"}>
      <span className="k8s-pod__name" title={pod.name}>
        …{short}
      </span>
      <span className="k8s-pod__phase">
        {pod.phase}
        {pod.ready ? ", ready" : ""}
      </span>
      <span className="k8s-pod__image">{pod.image.replace("nginx:", "")}</span>
      {pod.phase === "Terminating" ? null : (
        <button type="button" className="k8s-pod__delete" onClick={onDelete} aria-label={`Delete Pod ${pod.name}`}>
          Delete
        </button>
      )}
    </li>
  );
}

function K8sClusterView({ state, dispatch }: ViewProps<K8sState, K8sAction>) {
  const d = state.deployment;
  const { surge, unavailable } = resolveStrategy(d);
  const [replicas, setReplicas] = useState(d.replicas);
  const [image, setImage] = useState<(typeof IMAGES)[number]>(IMAGES[1]);
  const [maxSurge, setMaxSurge] = useState<StrategyValue>(d.maxSurge as StrategyValue);
  const [maxUnavailable, setMaxUnavailable] = useState<StrategyValue>(d.maxUnavailable as StrategyValue);
  const unscheduled = state.pods.filter((p) => !p.node);
  const status = rolloutComplete(state)
    ? "steady: every Pod is up to date and ready"
    : state.pods.some((p) => p.phase === "ErrImagePull" || p.phase === "ImagePullBackOff")
      ? "stalled: new Pods cannot pull their image"
      : "changing: the controllers are still working";

  const run = (action: K8sAction) => dispatch(action);

  return (
    <div className="k8s-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Deployment web wants</dt>
          <dd>
            {d.replicas} × <code>{d.image}</code>
          </dd>
        </div>
        <div>
          <dt>Available now</dt>
          <dd>
            {available(state)} of {d.replicas}
          </dd>
        </div>
        <div>
          <dt>During updates</dt>
          <dd>
            up to {surge} extra, {unavailable} unavailable
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status}</dd>
        </div>
      </dl>

      <div className="k8s-sim__nodes">
        {state.nodes.map((n) => {
          const pods = state.pods.filter((p) => p.node === n.name);
          return (
            <section key={n.name} className="k8s-node" data-cordoned={n.schedulable ? "false" : "true"} aria-label={`Node ${n.name}`}>
              <header className="k8s-node__head">
                <strong>{n.name}</strong>
                {n.schedulable ? null : <span className="tag">cordoned</span>}
                <button type="button" className="btn btn--small btn--ghost" onClick={() => run(n.schedulable ? { type: "drainNode", node: n.name } : { type: "uncordonNode", node: n.name })}>
                  {n.schedulable ? "Drain" : "Uncordon"}
                </button>
              </header>
              {pods.length ? (
                <ul className="k8s-node__pods">
                  {pods.map((p) => (
                    <PodChip key={p.name} pod={p} current={p.image === d.image} onDelete={() => run({ type: "deletePod", pod: p.name })} />
                  ))}
                </ul>
              ) : (
                <p className="small muted">No Pods</p>
              )}
            </section>
          );
        })}
      </div>
      {unscheduled.length ? (
        <div className="k8s-sim__pending">
          <strong>Pending, not on any node yet:</strong>
          <ul className="k8s-node__pods">
            {unscheduled.map((p) => (
              <PodChip key={p.name} pod={p} current={p.image === d.image} onDelete={() => run({ type: "deletePod", pod: p.name })} />
            ))}
          </ul>
        </div>
      ) : null}

      <details className="k8s-sim__rs">
        <summary>ReplicaSets ({state.replicaSets.length})</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Revision</th>
              <th scope="col">Image</th>
              <th scope="col">Wants</th>
            </tr>
          </thead>
          <tbody>
            {[...state.replicaSets].sort((a, b) => b.revision - a.revision).map((r) => (
              <tr key={r.name}>
                <td>
                  <code>{r.name}</code>
                </td>
                <td>{r.revision}</td>
                <td>
                  <code>{r.image}</code>
                </td>
                <td>{r.replicas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <div className="k8s-sim__controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: "scale", replicas });
          }}
        >
          <Field label="Replicas">
            {(id) => (
              <select id={id} value={replicas} onChange={(e) => setReplicas(Number(e.target.value))}>
                {Array.from({ length: 11 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" className="btn btn--small">
            Scale
          </button>
          <code className="k8s-sim__cmd">{kubectlCommand({ type: "scale", replicas })}</code>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: "setImage", image });
          }}
        >
          <Field label="Image">
            {(id) => (
              <select id={id} value={image} onChange={(e) => setImage(e.target.value as (typeof IMAGES)[number])}>
                {IMAGES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" className="btn btn--small">
            Set image
          </button>
          <code className="k8s-sim__cmd">{kubectlCommand({ type: "setImage", image })}</code>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: "setStrategy", maxSurge, maxUnavailable });
          }}
        >
          <Field label="maxSurge">
            {(id) => (
              <select id={id} value={maxSurge} onChange={(e) => setMaxSurge(e.target.value as StrategyValue)}>
                {STRATEGY.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="maxUnavailable">
            {(id) => (
              <select id={id} value={maxUnavailable} onChange={(e) => setMaxUnavailable(e.target.value as StrategyValue)}>
                {STRATEGY.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" className="btn btn--small">
            Set strategy
          </button>
        </form>
        <div>
          <button type="button" className="btn btn--small" onClick={() => run({ type: "undo" })}>
            Roll back
          </button>
          <code className="k8s-sim__cmd">{kubectlCommand({ type: "undo" })}</code>
        </div>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: reconciliation, View: K8sClusterView, command: (a) => kubectlCommand(a as K8sAction) };
export default entry;
