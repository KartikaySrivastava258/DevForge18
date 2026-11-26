import { useState } from "react";
import { COLUMNS, QUERIES, queryPlanner, ROWS, type Column, type PlannerAction, type PlannerState } from "../../../shared/simulations/postgresql/query-planner.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: PlannerAction): string {
  switch (a.type) {
    case "createIndex":
      return `CREATE INDEX ON orders (${a.columns.join(", ")});`;
    case "dropIndex":
      return `DROP INDEX ${a.name};`;
    case "explain":
      return "EXPLAIN ANALYZE …";
  }
}

function QueryPlannerView({ state, dispatch }: ViewProps<PlannerState, PlannerAction>) {
  const [first, setFirst] = useState<Column>("customer_id");
  const [second, setSecond] = useState<Column | "">("");
  const p = state.last;
  const share = p ? p.touched / ROWS : 0;
  return (
    <div className="planner-sim">
      <p className="planner-sim__sql">
        <code>{QUERIES[state.query]?.sql}</code>
      </p>
      <dl className="k8s-sim__summary">
        <div>
          <dt>Plan</dt>
          <dd>{p ? (p.kind === "seq" ? "Seq Scan" : `Index Scan using ${p.index}`) : "not explained yet"}</dd>
        </div>
        <div>
          <dt>Rows touched</dt>
          <dd className={p ? (p.touched < ROWS / 100 ? "rag-sim__ok" : "rag-sim__bad") : undefined}>{p ? `${p.touched.toLocaleString("en")} (${(share * 100).toFixed(share < 0.01 ? 2 : 0)} %)` : "—"}</dd>
        </div>
        <div>
          <dt>Rows returned</dt>
          <dd>{p ? p.returned.toLocaleString("en") : "—"}</dd>
        </div>
      </dl>
      {p ? (
        <div className="planner-sim__bar" role="img" aria-label={`Touched ${p.touched} of ${ROWS} rows`}>
          <span style={{ width: `${Math.max(0.5, share * 100)}%` }} />
        </div>
      ) : null}

      <div className="prom-sim__query">
        <Field label="Index column 1">
          {(id) => (
            <select id={id} value={first} onChange={(e) => setFirst(e.target.value as Column)}>
              {COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Index column 2">
          {(id) => (
            <select id={id} value={second} onChange={(e) => setSecond(e.target.value as Column | "")}>
              <option value="">(none)</option>
              {COLUMNS.filter((c) => c !== first).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "createIndex", columns: second && second !== first ? [first, second] : [first] })}>
          Create index
        </button>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "explain" })}>
          Run EXPLAIN
        </button>
      </div>

      <div className="kafka-sim__members">
        <strong>Indexes on orders</strong>
        {state.indexes.length ? (
          <ul>
            {state.indexes.map((i) => (
              <li key={i.name}>
                <span>
                  <code>{i.name}</code> ({i.columns.join(", ")})
                </span>
                <button type="button" className="btn btn--small btn--ghost" aria-label={`Drop ${i.name}`} onClick={() => dispatch({ type: "dropIndex", name: i.name })}>
                  Drop
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">Only the primary key on id.</p>
        )}
      </div>

      {p ? (
        <table className="airflow-sim__runs">
          <caption className="sr-only">Plans the planner compared</caption>
          <thead>
            <tr>
              <th scope="col">Plan considered</th>
              <th scope="col">Rows touched</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {p.considered.map((c) => (
              <tr key={c.label}>
                <th scope="row">{c.label}</th>
                <td>{c.touched.toLocaleString("en")}</td>
                <td className={c.cost === p.cost ? "rag-sim__ok" : undefined}>
                  {c.cost.toFixed(0)}
                  {c.cost === p.cost ? " — chosen" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

const entry: SimulationEntry = { model: queryPlanner, View: QueryPlannerView, command: (a) => command(a as PlannerAction) };
export default entry;
