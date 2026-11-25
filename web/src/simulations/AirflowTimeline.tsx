import { useState } from "react";
import { dayLabel, expectedRows, schedulerTimeline, type AirflowAction, type AirflowState, type Reprocess, type WriteMode } from "../../../shared/simulations/airflow/scheduler-timeline.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const date = (day: number) => `2026-${String(day < 31 ? 1 : day < 59 ? 2 : 3).padStart(2, "0")}-${String(day < 31 ? day + 1 : day < 59 ? day - 30 : day - 58).padStart(2, "0")}`;

function command(a: AirflowAction): string {
  switch (a.type) {
    case "tick":
      return `(${a.count ?? 1} day${(a.count ?? 1) === 1 ? "" : "s"} pass)`;
    case "setRetries":
      return `@task(retries=${a.retries})`;
    case "setWrite":
      return a.mode === "append" ? "INSERT the day's orders" : "DELETE the day's rows, then INSERT (one transaction)";
    case "clear":
      return `clear the run for ${dayLabel(a.day)}`;
    case "backfill":
      return `airflow backfill create --from-date ${date(a.from)} --to-date ${date(a.to)} --reprocess-behavior ${a.reprocess}`;
  }
}

function AirflowTimelineView({ state, dispatch }: ViewProps<AirflowState, AirflowAction>) {
  // The range follows the scenario (the first week, up to today) until the learner picks dates that exist in it.
  const [picked, setPicked] = useState<{ from?: number; to?: number }>({});
  const inRange = (d: number | undefined): d is number => d !== undefined && d >= state.start && d <= state.now;
  const from = inRange(picked.from) ? picked.from : state.start;
  const to = inRange(picked.to) ? picked.to : Math.min(state.start + 6, state.now);
  const [reprocess, setReprocess] = useState<Reprocess>("none");
  const days = Array.from({ length: state.now - state.start + 1 }, (_, i) => state.start + i);
  const dayOptions = days.map((d) => (
    <option key={d} value={d}>
      {dayLabel(d)}
    </option>
  ));

  return (
    <div className="airflow-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Today</dt>
          <dd>{dayLabel(state.now)}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>
            @daily from {dayLabel(state.start)}, catchup={state.catchup ? "True" : "False"}
          </dd>
        </div>
        <div>
          <dt>Load task</dt>
          <dd>
            {state.write === "append" ? "appends rows" : "replaces the day"}, retries={state.retries}
          </dd>
        </div>
      </dl>

      <table className="airflow-sim__runs">
        <caption className="sr-only">DAG runs by logical date, and rows in the orders table</caption>
        <thead>
          <tr>
            <th scope="col">Logical date</th>
            <th scope="col">Run</th>
            <th scope="col">Rows</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const run = state.runs.find((r) => r.day === d);
            const rows = state.rows[d] ?? 0;
            const wrong = rows !== 0 && rows !== expectedRows(d);
            return (
              <tr key={d}>
                <th scope="row">{dayLabel(d)}</th>
                <td>
                  {run ? (
                    <>
                      <span className="airflow-sim__state" data-state={run.state}>
                        {run.state}
                      </span>{" "}
                      <span className="airflow-sim__detail">
                        {run.kind} · {run.tries} tr{run.tries === 1 ? "y" : "ies"}
                      </span>
                    </>
                  ) : (
                    <span className="muted">no run</span>
                  )}
                </td>
                <td className={wrong ? "airflow-sim__rows airflow-sim__rows--wrong" : "airflow-sim__rows"}>
                  {rows} / {expectedRows(d)}
                  {wrong ? " — wrong" : ""}
                </td>
                <td>
                  {run ? (
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "clear", day: d })}>
                      Clear<span className="sr-only"> the run for {dayLabel(d)}</span>
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">Rows shows what the table holds for that date against the number of orders the source has.</p>

      <div className="prom-sim__query">
        <Field label="Retries">
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
        <Field label="Load task writes by">
          {(id) => (
            <select id={id} value={state.write} onChange={(e) => dispatch({ type: "setWrite", mode: e.target.value as WriteMode })}>
              <option value="append">appending rows</option>
              <option value="replace">replacing the day</option>
            </select>
          )}
        </Field>
      </div>

      <fieldset className="airflow-sim__backfill">
        <legend>Backfill</legend>
        <div className="prom-sim__query">
          <Field label="From">
            {(id) => (
              <select id={id} value={from} onChange={(e) => setPicked({ ...picked, from: Number(e.target.value) })}>
                {dayOptions}
              </select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <select id={id} value={to} onChange={(e) => setPicked({ ...picked, to: Number(e.target.value) })}>
                {dayOptions}
              </select>
            )}
          </Field>
          <Field label="Reprocess">
            {(id) => (
              <select id={id} value={reprocess} onChange={(e) => setReprocess(e.target.value as Reprocess)}>
                <option value="none">missing runs (none)</option>
                <option value="failed">missing and failed (failed)</option>
                <option value="completed">all runs (completed)</option>
              </select>
            )}
          </Field>
          <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "backfill", from, to, reprocess })}>
            Create backfill
          </button>
        </div>
      </fieldset>
    </div>
  );
}

const entry: SimulationEntry = { model: schedulerTimeline, View: AirflowTimelineView, command: (a) => command(a as AirflowAction) };
export default entry;
