import {
  anomalies,
  committedRows,
  isolationTimeline,
  LEVELS,
  nextStatement,
  SCRIPTS,
  txStatus,
  TXS,
  type Entry,
  type IsoAction,
  type IsoState,
  type Level,
  type TxName,
} from "../../../shared/simulations/postgresql/isolation-timeline.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: IsoAction): string {
  switch (a.type) {
    case "setLevel":
      return `isolation level: ${a.level.toUpperCase()}`;
    case "run":
      return `${a.tx}: next statement`;
    case "retry":
      return `${a.tx}: retry from the start`;
  }
}

const show = (v: unknown) => (typeof v === "boolean" ? (v ? "t" : "f") : String(v));

function Cell({ entry }: { entry: Entry }) {
  if (entry.kind === "skip") return <span className="airflow-sim__detail">{entry.out[0]} (UPDATE not sent)</span>;
  return (
    <>
      <code className="iso-sim__sql">{entry.sql}</code>
      <samp className="iso-sim__out" data-kind={entry.kind === "wait" ? "wait" : entry.error ? "error" : "ok"}>
        {entry.kind === "wait" ? "waiting for the other transaction's row lock…" : entry.out.length ? entry.out.join("\n") : "(no rows)"}
      </samp>
      {entry.kind === "resume" ? <span className="airflow-sim__detail">finished after the wait</span> : null}
    </>
  );
}

function IsolationTimelineView({ state, dispatch }: ViewProps<IsoState, IsoAction>) {
  const started = state.timeline.length > 0;
  const found = anomalies(state);
  return (
    <div className="iso-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Isolation level</dt>
          <dd>{state.level.toUpperCase()}</dd>
        </div>
        {TXS.map((tx) => (
          <div key={tx}>
            <dt>{tx}</dt>
            <dd>
              <span className="airflow-sim__state" data-state={txStatus(state, tx) === "committed" ? "success" : txStatus(state, tx) === "failed" ? "failed" : undefined}>
                {txStatus(state, tx)}
              </span>
              {state.tx[tx].attempts > 1 ? ` (attempt ${state.tx[tx].attempts})` : ""}
            </dd>
          </div>
        ))}
      </dl>

      <div className="prom-sim__query">
        <Field label="Isolation level (both transactions)">
          {(id) => (
            <select id={id} value={state.level} disabled={started} onChange={(e) => dispatch({ type: "setLevel", level: e.target.value as Level })}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="iso-sim__next">
        {TXS.map((tx: TxName) => {
          const next = nextStatement(state, tx);
          const status = txStatus(state, tx);
          return (
            <div key={tx} className="iso-sim__tx">
              <p>
                <strong>{tx}</strong> next:{" "}
                {next ? <code className="iso-sim__sql">{next}</code> : <span className="muted">{status === "failed" ? "nothing — it failed and was rolled back" : "nothing — it has committed"}</span>}
              </p>
              <button type="button" className="btn btn--small" disabled={!next || status === "waiting"} onClick={() => dispatch({ type: "run", tx })}>
                Run {tx}
              </button>{" "}
              {status === "failed" ? (
                <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "retry", tx })}>
                  Retry {tx}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <table className="airflow-sim__runs iso-sim__timeline">
        <caption className="small muted">Timeline: one row per statement, in the order it ran. Output is what psql prints.</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">T1</th>
            <th scope="col">T2</th>
          </tr>
        </thead>
        <tbody>
          {state.timeline.length ? (
            state.timeline.map((e, i) => (
              <tr key={i}>
                <th scope="row">{i + 1}</th>
                <td>{e.tx === "T1" ? <Cell entry={e} /> : null}</td>
                <td>{e.tx === "T2" ? <Cell entry={e} /> : null}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="muted">
                Nothing has run yet. Choose the level, then run T1 and T2 in the order you want.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {SCRIPTS[state.script]!.tables.map((t) => (
        <table key={t.name} className="airflow-sim__runs iso-sim__data">
          <caption className="small muted">Committed rows of {t.name} (what a new transaction would see now)</caption>
          <thead>
            <tr>
              {t.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {committedRows(state, t.name).map((row) => (
              <tr key={String(row[t.key])}>
                {t.columns.map((c) => (
                  <td key={c}>{show(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <div className="iso-sim__anomalies">
        <strong>Anomalies</strong>
        {found.length ? (
          <ul>
            {found.map((a) => (
              <li key={a} className={a.startsWith("Serialization failure") ? undefined : "rag-sim__bad"}>
                {a}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">None so far.</p>
        )}
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: isolationTimeline, View: IsolationTimelineView, command: (a) => command(a as IsoAction) };
export default entry;
