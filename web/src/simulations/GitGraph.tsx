import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ancestors, commitGraph, gitCommand, validateGitAction, type GitAction, type GitState } from "../../../shared/simulations/git/commit-graph.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const COL = 72;
const ROW = 64;
/** Left gutter for the lane (row) names, then the first commit. */
const GUTTER = 96;
const PAD_X = GUTTER + 24;
const PAD_Y = 52;

type Kind = GitAction["type"];
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "commit", label: "commit" },
  { kind: "branch", label: "branch" },
  { kind: "switch", label: "switch" },
  { kind: "merge", label: "merge" },
  { kind: "rebase", label: "rebase" },
  { kind: "reset", label: "reset --hard" },
  { kind: "revert", label: "revert" },
];

/** Draws the commit graph and offers the commands the model understands. */
function GitGraphView({ state, dispatch }: ViewProps<GitState, GitAction>) {
  const scroller = useRef<HTMLDivElement>(null);
  const live = useMemo(() => new Set(Object.values(state.branches).flatMap((id) => [...ancestors(state, id)])), [state]);
  const lanes = useMemo(() => {
    const order = ["main", ...state.order.map((id) => state.commits[id]?.lane ?? "main")];
    return [...new Set(order)];
  }, [state]);
  const pos = (id: string) => {
    const i = state.order.indexOf(id);
    const lane = lanes.indexOf(state.commits[id]?.lane ?? "main");
    return { x: PAD_X + i * COL, y: PAD_Y + lane * ROW };
  };
  const width = PAD_X + 48 + Math.max(0, state.order.length - 1) * COL;
  const height = PAD_Y + Math.max(1, lanes.length) * ROW;
  const labels = new Map<string, { text: string; head: boolean; remote: boolean }[]>();
  for (const [name, id] of Object.entries(state.branches)) labels.set(id, [...(labels.get(id) ?? []), { text: name, head: name === state.head, remote: false }]);
  for (const [name, id] of Object.entries(state.remote)) labels.set(id, [...(labels.get(id) ?? []), { text: `origin/${name}`, head: false, remote: true }]);

  // Keep the newest commit in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [state.order.length]);

  return (
    <div className="git-sim">
      <p className="small muted">
        You are on <strong>{state.head}</strong>
        {state.branches[state.head] ? ` (commit ${state.branches[state.head]})` : ", which has no commits yet"}. Commits are drawn left to right in the order they were made; each branch's commits share a row.
      </p>
      <div className="git-sim__scroll" ref={scroller} tabIndex={0} role="group" aria-label="Commit graph; the commit list below has the same information as text">
        {state.order.length ? (
          <svg className="git-sim__svg" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
            {lanes.map((lane, i) => (
              <text key={lane} className="git-sim__lane" x={GUTTER - 8} y={PAD_Y + i * ROW + 4} textAnchor="end">
                {lane} row
              </text>
            ))}
            {state.order.flatMap((id) =>
              (state.commits[id]?.parents ?? []).map((p) => {
                const a = pos(p);
                const b = pos(id);
                const d = a.y === b.y ? `M${a.x} ${a.y} L${b.x} ${b.y}` : `M${a.x} ${a.y} C${a.x + COL / 2} ${a.y} ${b.x - COL / 2} ${b.y} ${b.x} ${b.y}`;
                return <path key={`${p}-${id}`} className="git-sim__edge" data-live={live.has(id) ? "true" : "false"} d={d} />;
              }),
            )}
            {state.order.map((id) => {
              const { x, y } = pos(id);
              const commit = state.commits[id];
              return (
                <g key={id} className="git-sim__commit" data-live={live.has(id) ? "true" : "false"} data-merge={(commit?.parents.length ?? 0) > 1 ? "true" : undefined}>
                  <circle cx={x} cy={y} r={11} />
                  <text x={x} y={y + 28} textAnchor="middle" className="git-sim__id">
                    {id}
                  </text>
                  {(labels.get(id) ?? []).map((l, i) => (
                    <g key={l.text} className="git-sim__label" data-head={l.head ? "true" : undefined} data-remote={l.remote ? "true" : undefined}>
                      <text x={x} y={y - 18 - i * 16} textAnchor="middle">
                        {l.head ? `HEAD → ${l.text}` : l.text}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        ) : (
          <p className="git-sim__empty">No commits yet. Make the first one below.</p>
        )}
      </div>

      <CommandForm state={state} dispatch={dispatch} />

      <details className="git-sim__list" open>
        <summary>Commits, newest first</summary>
        <ol>
          {[...state.order].reverse().map((id) => {
            const c = state.commits[id];
            const refs = (labels.get(id) ?? []).map((l) => (l.head ? `HEAD → ${l.text}` : l.text));
            return (
              <li key={id} data-live={live.has(id) ? "true" : "false"}>
                <code>{id}</code> {c?.message}
                {refs.length ? <span className="git-sim__refs"> ({refs.join(", ")})</span> : null}
                {(c?.parents.length ?? 0) > 1 ? <span className="tag">merge commit</span> : null}
                {live.has(id) ? null : <span className="tag">not on any branch</span>}
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}

function CommandForm({ state, dispatch }: ViewProps<GitState, GitAction>) {
  const [kind, setKind] = useState<Kind>("commit");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("feature");
  const branches = Object.keys(state.branches);
  const others = branches.filter((b) => b !== state.head);
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"default" | "no-ff" | "ff-only">("default");
  const onBranch = [...ancestors(state, state.branches[state.head])];
  const commitsOnBranch = state.order.filter((id) => onBranch.includes(id)).reverse();

  const action = ((): GitAction | null => {
    switch (kind) {
      case "commit":
        return { type: "commit", message: message.trim() || `Change ${state.order.length + 1}` };
      case "branch":
        return { type: "branch", name: name.trim() };
      case "switch":
        return { type: "switch", branch: target || branches.find((b) => b !== state.head) || state.head };
      case "merge":
        return { type: "merge", branch: target || others[0] || "", mode };
      case "rebase":
        return { type: "rebase", onto: target || others[0] || "" };
      case "reset":
        return { type: "reset", to: target || "HEAD~1" };
      case "revert":
        return { type: "revert", commit: target || "HEAD" };
    }
  })();
  const needsOtherBranch = kind === "merge" || kind === "rebase" || kind === "switch";
  const problem = needsOtherBranch && others.length === 0 ? "There is no other branch yet. Create one with git branch first." : action ? validateGitAction(action) : "Choose a command.";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!action || problem) return;
    dispatch(action);
    if (kind === "commit") setMessage("");
  };

  const targetSelect = (label: string, options: { value: string; text: string }[]) => (
    <Field label={label}>
      {(id) => (
        <select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.text}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  return (
    <form className="git-sim__form" onSubmit={submit}>
      <Field label="Command">
        {(id) => (
          <select id={id}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setTarget("");
            }}
          >
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                git {k.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind === "commit" ? (
        <Field label="Message" grow>
          {(id) => (
            <input id={id} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`Change ${state.order.length + 1}`} maxLength={72} />
          )}
        </Field>
      ) : null}
      {kind === "branch" ? (
        <Field label="New branch name">
          {(id) => (
            <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
          )}
        </Field>
      ) : null}
      {kind === "switch" ? targetSelect("Branch", branches.filter((b) => b !== state.head).map((b) => ({ value: b, text: b }))) : null}
      {kind === "merge" || kind === "rebase" ? targetSelect(kind === "merge" ? "Branch to merge" : "Onto", others.map((b) => ({ value: b, text: b }))) : null}
      {kind === "merge" ? (
        <Field label="Mode">
          {(id) => (
            <select id={id} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="default">default (fast-forward if possible)</option>
              <option value="no-ff">--no-ff (always a merge commit)</option>
              <option value="ff-only">--ff-only (fast-forward or refuse)</option>
            </select>
          )}
        </Field>
      ) : null}
      {kind === "reset"
        ? targetSelect("Move this branch to", [{ value: "HEAD~1", text: "HEAD~1 (one commit back)" }, ...others.map((b) => ({ value: b, text: `branch ${b}` })), ...commitsOnBranch.slice(1).map((id) => ({ value: id, text: `${id} ${state.commits[id]?.message ?? ""}` }))])
        : null}
      {kind === "revert"
        ? targetSelect("Commit to undo", commitsOnBranch.filter((id) => (state.commits[id]?.parents.length ?? 0) < 2).map((id, i) => ({ value: i === 0 ? "HEAD" : id, text: `${i === 0 ? "HEAD" : id} ${state.commits[id]?.message ?? ""}` })))
        : null}
      <div className="git-sim__run">
        <code className="git-sim__preview">{action ? gitCommand(action) : ""}</code>
        <button type="submit" className="btn btn--primary btn--small" disabled={problem !== null}>
          Run
        </button>
      </div>
      {problem ? <p className="small sim__problem">{problem}</p> : null}
    </form>
  );
}

const entry: SimulationEntry = { model: commitGraph, View: GitGraphView, command: (a) => gitCommand(a as GitAction) };
export default entry;
