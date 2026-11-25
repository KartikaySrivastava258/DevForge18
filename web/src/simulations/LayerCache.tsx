import { FILE_NAMES, layerCache, STEPS, type LayerAction, type LayerState } from "../../../shared/simulations/docker/layer-cache.ts";
import type { SimulationEntry, ViewProps } from "./registry.ts";

function command(a: LayerAction): string {
  switch (a.type) {
    case "toggle":
      return `toggle: ${STEPS[a.id].text}`;
    case "moveUp":
    case "moveDown":
      return `move ${a.type === "moveUp" ? "up" : "down"}: ${STEPS[a.id].text}`;
    case "setIgnore":
      return a.on ? "echo secrets.env >> .dockerignore" : "remove secrets.env from .dockerignore";
    case "edit":
      return a.file === "src" ? "edit src/main.py" : "edit requirements.txt";
    case "build":
      return "docker build -t app .";
  }
}

function LayerCacheView({ state, dispatch }: ViewProps<LayerState, LayerAction>) {
  const last = state.last;
  const result = new Map((last?.steps ?? []).map((x) => [x.id, x.cached]));
  return (
    <div className="layer-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Last build</dt>
          <dd className={last ? (last.ok ? "rag-sim__ok" : "rag-sim__bad") : undefined}>{last ? (last.ok ? `${last.seconds} s` : "failed") : "—"}</dd>
        </div>
        <div>
          <dt>Image size</dt>
          <dd>{last?.ok ? `${last.sizeMb} MB` : "—"}</dd>
        </div>
        <div>
          <dt>Files in the image</dt>
          <dd className={last?.files.includes("secrets.env") ? "rag-sim__bad" : undefined}>{last?.ok ? last.files.join(", ") : "—"}</dd>
        </div>
        <div>
          <dt>Edited since last build</dt>
          <dd>{state.pending.length ? state.pending.map((f) => FILE_NAMES[f]).join(", ") : "nothing"}</dd>
        </div>
      </dl>

      <ol className="layer-sim__file" aria-label="Dockerfile">
        {state.lines.map((l, i) => (
          <li key={l.id} className="layer-sim__line" data-on={l.on ? "true" : "false"}>
            <code>{STEPS[l.id].text}</code>
            <span className="layer-sim__result">{l.on && result.has(l.id) ? (result.get(l.id) ? "reused" : "rebuilt") : ""}</span>
            <span className="layer-sim__buttons">
              <button type="button" className="btn btn--small btn--ghost" aria-label={`Move ${STEPS[l.id].text} up`} disabled={i === 0} onClick={() => dispatch({ type: "moveUp", id: l.id })}>
                ↑
              </button>
              <button type="button" className="btn btn--small btn--ghost" aria-label={`Move ${STEPS[l.id].text} down`} disabled={i === state.lines.length - 1} onClick={() => dispatch({ type: "moveDown", id: l.id })}>
                ↓
              </button>
              {l.id === "from" ? null : (
                <button type="button" className="btn btn--small btn--ghost" aria-label={`${l.on ? "Remove" : "Add"} ${STEPS[l.id].text}`} onClick={() => dispatch({ type: "toggle", id: l.id })}>
                  {l.on ? "Remove" : "Add"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      {last && !last.ok ? <p className="rag-sim__bad small">{last.error}</p> : null}

      <div className="prom-sim__query">
        <label className="n8n-sim__rule">
          <input type="checkbox" checked={state.ignoreSecrets} onChange={(e) => dispatch({ type: "setIgnore", on: e.target.checked })} /> .dockerignore lists secrets.env
        </label>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "edit", file: "src" })}>
          Edit the source code
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => dispatch({ type: "edit", file: "deps" })}>
          Edit requirements.txt
        </button>
        <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "build" })}>
          Build
        </button>
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: layerCache, View: LayerCacheView, command: (a) => command(a as LayerAction) };
export default entry;
