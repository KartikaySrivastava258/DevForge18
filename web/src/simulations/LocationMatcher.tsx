import { useState } from "react";
import { byId, label, locationMatcher, match, outcome, PALETTE, PATH, type MatcherAction, type MatcherState } from "../../../shared/simulations/nginx/location-matcher.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: MatcherAction): string {
  switch (a.type) {
    case "add":
      return `add: ${label(byId(a.id)!)} { … }`;
    case "remove":
      return `remove: ${label(byId(a.id)!)}`;
    case "moveUp":
      return `move up: ${label(byId(a.id)!)}`;
    case "request":
      return `curl http://localhost${a.path}`;
  }
}

function LocationMatcherView({ state, dispatch }: ViewProps<MatcherState, MatcherAction>) {
  const [path, setPath] = useState("/api/docs/index.html");
  const [pick, setPick] = useState(PALETTE[0]!.id);
  const last = state.requests.at(-1);
  const preview = PATH.test(path) ? match(state.locations, path) : null;
  return (
    <div className="ngx-sim">
      <div className="mlflow-sim__layout">
        <div>
          <strong>server {"{"}</strong>
          <ol className="layer-sim__file" aria-label="Location blocks in file order">
            {state.locations.map((id, i) => {
              const l = byId(id)!;
              return (
                <li key={id} className="layer-sim__line" data-on={last?.location === id ? "true" : "false"} data-winner={last?.location === id ? "true" : "false"}>
                  <code>
                    {label(l)} → {l.target}
                  </code>
                  <span className="layer-sim__result">{last?.location === id ? "answered" : ""}</span>
                  <span className="layer-sim__buttons">
                    <button type="button" className="btn btn--small btn--ghost" aria-label={`Move ${label(l)} up`} disabled={i === 0} onClick={() => dispatch({ type: "moveUp", id })}>
                      ↑
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" aria-label={`Remove ${label(l)}`} onClick={() => dispatch({ type: "remove", id })}>
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <strong>{"}"}</strong>
          <div className="prom-sim__query">
            <Field label="Add a location">
              {(id) => (
                <select id={id} value={pick} onChange={(e) => setPick(e.target.value)}>
                  {PALETTE.filter((l) => !state.locations.includes(l.id)).map((l) => (
                    <option key={l.id} value={l.id}>
                      {label(l)} → {l.target}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "add", id: state.locations.includes(pick) ? (PALETTE.find((l) => !state.locations.includes(l.id))?.id ?? pick) : pick })}>
              Add
            </button>
          </div>
        </div>
        <div>
          <div className="prom-sim__query">
            <Field label="Request path">{(id) => <input id={id} value={path} onChange={(e) => setPath(e.target.value.trim())} />}</Field>
            <button type="button" className="btn btn--small" disabled={!PATH.test(path)} onClick={() => dispatch({ type: "request", path })}>
              Send request
            </button>
          </div>
          {preview ? (
            <ol className="ngx-sim__steps" aria-label="How Nginx chooses">
              {preview.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          ) : (
            <p className="small rag-sim__bad">Use a path such as /api/v1/users.</p>
          )}
          {state.requests.length ? (
            <ul className="ngx-sim__log">
              {state.requests.slice(-6).map((r, i) => (
                <li key={i}>
                  <code>{r.path}</code> → {outcome(r)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: locationMatcher, View: LocationMatcherView, command: (a) => command(a as MatcherAction) };
export default entry;
