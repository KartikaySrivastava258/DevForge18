import { useState } from "react";
import { plan, planDiff, SIZES, summary, SYMBOL, type PlanAction, type PlanState, type Size } from "../../../shared/simulations/terraform/plan-diff.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: PlanAction): string {
  switch (a.type) {
    case "rename":
      return `edit main.tf: resource "server" "${a.from.split(".")[1]}" → "${a.to.split(".")[1]}"`;
    case "setSize":
      return `edit main.tf: ${a.address} size = "${a.size}"`;
    case "setName":
      return `edit main.tf: ${a.address} name = "${a.name}"`;
    case "addMoved":
      return `moved { from = ${a.from}  to = ${a.to} }`;
    case "removeMoved":
      return `delete the moved block from ${a.from}`;
    case "outsideResize":
      return `(someone resizes ${a.address} in the console)`;
    case "outsideDelete":
      return `(someone deletes ${a.address} in the console)`;
    case "apply":
      return "terraform apply";
  }
}

function PlanDiffView({ state, dispatch }: ViewProps<PlanState, PlanAction>) {
  const changes = plan(state);
  const n = summary(changes);
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("server.frontend");
  // The moved block records the last rename (old address → new), which is what Terraform needs.
  const [lastRename, setLastRename] = useState<{ from: string; to: string } | null>(null);
  const pending = lastRename && state.config.some((c) => c.address === lastRename.to) && !state.moved.some((m) => m.from === lastRename.from) ? lastRename : null;
  const from = state.config.some((c) => c.address === renameFrom) ? renameFrom : (state.config[0]?.address ?? "");
  return (
    <div className="tfplan-sim">
      <div className="tfplan-sim__panels">
        <section className="tfplan-sim__panel" aria-label="Configuration">
          <h4>Configuration (main.tf)</h4>
          <ul>
            {state.config.map((c) => (
              <li key={c.address}>
                <code>{c.address}</code>
                <span className="airflow-sim__detail">name "{c.name}"</span>
                <Field label={`Size of ${c.address}`}>
                  {(id) => (
                    <select id={id} value={c.size} onChange={(e) => dispatch({ type: "setSize", address: c.address, size: e.target.value as Size })}>
                      {SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </li>
            ))}
          </ul>
          {state.moved.map((m) => (
            <p key={m.from} className="small">
              <code>
                moved {"{"} {m.from} → {m.to} {"}"}
              </code>{" "}
              <button type="button" className="btn btn--small btn--ghost" aria-label={`Remove the moved block from ${m.from}`} onClick={() => dispatch({ type: "removeMoved", from: m.from })}>
                Remove
              </button>
            </p>
          ))}
        </section>
        <section className="tfplan-sim__panel" aria-label="State">
          <h4>State</h4>
          <ul>
            {state.state.map((x) => (
              <li key={x.address}>
                <code>{x.address}</code>
                <span className="airflow-sim__detail">
                  {x.id} · {x.name} · {x.size}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="tfplan-sim__panel" aria-label="Real world">
          <h4>Real world</h4>
          <ul>
            {state.state.map((x) => {
              const r = state.real[x.id];
              return (
                <li key={x.id}>
                  <code>{x.id}</code>
                  <span className="airflow-sim__detail">{r ? `${r.name} · ${r.size}` : "gone"}</span>
                  {r ? (
                    <span className="layer-sim__buttons">
                      <button type="button" className="btn btn--small btn--ghost" aria-label={`Resize ${x.id} by hand`} onClick={() => dispatch({ type: "outsideResize", address: x.address, size: r.size === "large" ? "small" : "large" })}>
                        Resize by hand
                      </button>
                      <button type="button" className="btn btn--small btn--ghost" aria-label={`Delete ${x.id} by hand`} onClick={() => dispatch({ type: "outsideDelete", address: x.address })}>
                        Delete by hand
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="prom-sim__query">
        <Field label="Rename address">
          {(id) => (
            <select id={id} value={from} onChange={(e) => setRenameFrom(e.target.value)}>
              {state.config.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.address}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="New address">
          {(id) => <input id={id} value={renameTo} onChange={(e) => setRenameTo(e.target.value.trim())} />}
        </Field>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => {
            if (!state.config.some((c) => c.address === renameTo)) setLastRename({ from, to: renameTo });
            dispatch({ type: "rename", from, to: renameTo });
          }}
        >
          Rename
        </button>
        <button type="button" className="btn btn--small btn--ghost" disabled={!pending} onClick={() => pending && dispatch({ type: "addMoved", from: pending.from, to: pending.to })}>
          {pending ? `Add moved block (${pending.from} → ${pending.to})` : "Add moved block (rename first)"}
        </button>
      </div>

      <div className="tfplan-sim__plan">
        <strong>
          terraform plan — Plan: {n.add} to add, {n.change} to change, {n.destroy} to destroy.
        </strong>
        {changes.length ? (
          <ul>
            {changes.map((c, i) => (
              <li key={i} data-action={c.action}>
                <code>{SYMBOL[c.action]}</code> {c.address} <span className="muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No changes. Your infrastructure matches the configuration.</p>
        )}
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "apply" })}>
          terraform apply
        </button>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: planDiff, View: PlanDiffView, command: (a) => command(a as PlanAction) };
export default entry;
