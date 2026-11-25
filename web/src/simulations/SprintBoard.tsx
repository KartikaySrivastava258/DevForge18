import { BACKLOG, committedPoints, DEVS, goalDone, SPRINT_DAYS, sprintBoard, story, type Column, type SprintAction, type SprintState } from "../../../shared/simulations/jira/sprint-board.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: SprintAction): string {
  switch (a.type) {
    case "commit":
      return `move ${a.id} from the backlog into the sprint`;
    case "uncommit":
      return `move ${a.id} back to the backlog`;
    case "setWip":
      return `Board settings → Columns → In Progress: max ${a.limit}`;
    case "tick":
      return `(${a.count ?? 1} day${(a.count ?? 1) === 1 ? "" : "s"} pass)`;
  }
}

const COLUMNS: [Column, string][] = [["todo", "To Do"], ["progress", "In Progress"], ["done", "Done"]];
const W = 320, H = 170, L = 34, B = 26, T = 10, R = 10;

function Burndown({ state }: { state: SprintState }) {
  const total = state.burndown[0] ?? 0;
  const max = Math.max(1, total);
  const x = (d: number) => L + (d / SPRINT_DAYS) * (W - L - R);
  const y = (p: number) => T + (1 - p / max) * (H - T - B);
  const points = state.burndown.map((p, d) => `${x(d)},${y(p)}`).join(" ");
  return (
    <svg className="mlflow-sim__plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: ${state.burndown.map((p) => p.toFixed(1)).join(", ")} points left on days 0 to ${state.day}`}>
      <line className="mlflow-sim__axis" x1={L} y1={H - B} x2={W - R} y2={H - B} />
      <line className="mlflow-sim__axis" x1={L} y1={T} x2={L} y2={H - B} />
      <line className="sprint-sim__ideal" x1={x(0)} y1={y(total)} x2={x(SPRINT_DAYS)} y2={y(0)} />
      <polyline className="sprint-sim__line" points={points} />
      {[0, 5, 10].map((d) => (
        <text key={d} className="mlflow-sim__tick" x={x(d)} y={H - B + 14} textAnchor="middle">
          {d}
        </text>
      ))}
      <text className="mlflow-sim__tick" x={L - 4} y={y(total) + 4} textAnchor="end">
        {total}
      </text>
      <text className="mlflow-sim__tick" x={L - 4} y={y(0) + 4} textAnchor="end">
        0
      </text>
      <text className="mlflow-sim__tick" x={(L + W - R) / 2} y={H - 2} textAnchor="middle">
        day → (dashed: ideal)
      </text>
    </svg>
  );
}

function SprintBoardView({ state, dispatch }: ViewProps<SprintState, SprintAction>) {
  const planning = state.day === 0;
  const progress = state.cards.filter((c) => c.column === "progress").length;
  return (
    <div className="sprint-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Day</dt>
          <dd>
            {state.day} of {SPRINT_DAYS}
          </dd>
        </div>
        <div>
          <dt>Committed</dt>
          <dd>
            {committedPoints(state)} points (capacity {DEVS * SPRINT_DAYS} at full focus)
          </dd>
        </div>
        <div>
          <dt>Points left</dt>
          <dd>{(state.burndown.at(-1) ?? 0).toFixed(1)}</dd>
        </div>
        <div>
          <dt>Sprint goal</dt>
          <dd className={goalDone(state) ? "rag-sim__ok" : undefined}>{goalDone(state) ? "met" : state.day === SPRINT_DAYS ? "missed" : "in progress"}</dd>
        </div>
      </dl>

      <div className="prom-sim__query">
        <Field label="In Progress WIP limit">
          {(id) => (
            <select id={id} value={state.wip} onChange={(e) => dispatch({ type: "setWip", limit: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="sprint-sim__board">
        {COLUMNS.map(([col, label]) => {
          const cards = state.cards.filter((c) => c.column === col);
          const over = col === "progress" && progress > state.wip;
          return (
            <section key={col} className="sprint-sim__col" data-over={over ? "true" : "false"} aria-label={`${label}: ${cards.length} stories`}>
              <h4>
                {label} <span className="muted">{cards.length}{col === "progress" ? ` / max ${state.wip}` : ""}</span>
              </h4>
              <ul>
                {cards.map((c) => {
                  const s = story(c.id);
                  const blocked = c.column === "progress" && c.blockedUntil !== null && state.day < c.blockedUntil + 1 && state.day >= c.blockedUntil - (s.blocker?.days ?? 0) + 1;
                  return (
                    <li key={c.id} className="sprint-sim__card" data-goal={s.goal ? "true" : "false"} data-blocked={blocked ? "true" : "false"}>
                      <strong>{c.id}</strong> {s.title}
                      <span className="airflow-sim__detail">
                        {(c.left / 10).toFixed(1)} of {s.points} left{s.goal ? " · goal" : ""}{blocked ? " · blocked" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mlflow-sim__layout">
        <div>
          <strong>Backlog and plan</strong>
          <ul className="sprint-sim__plan">
            {BACKLOG.map((s) => {
              const inSprint = state.committed.includes(s.id);
              return (
                <li key={s.id}>
                  <span>
                    {s.id} {s.title} · {s.points} pts{s.goal ? " · goal" : ""}
                  </span>
                  <button type="button" className="btn btn--small btn--ghost" disabled={!planning} aria-label={`${inSprint ? "Remove" : "Add"} ${s.id} ${inSprint ? "from" : "to"} the sprint`} onClick={() => dispatch({ type: inSprint ? "uncommit" : "commit", id: s.id })}>
                    {inSprint ? "Remove" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
          {planning ? <p className="small muted">Plan before the first day; press Step or Play to run the sprint.</p> : <p className="small muted">Planning is over once the sprint starts.</p>}
        </div>
        <figure className="mlflow-sim__figure">
          <Burndown state={state} />
          <figcaption className="small muted">Burndown: committed points left at the end of each day.</figcaption>
        </figure>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: sprintBoard, View: SprintBoardView, command: (a) => command(a as SprintAction) };
export default entry;
