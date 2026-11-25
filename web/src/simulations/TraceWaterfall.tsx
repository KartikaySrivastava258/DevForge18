import {
  criticalPath,
  duration,
  LATENCIES,
  latest,
  selfTime,
  traceWaterfall,
  type Latency,
  type Service,
  type Span,
  type Trace,
  type WaterfallAction,
  type WaterfallState,
} from "../../../shared/simulations/opentelemetry/trace-waterfall.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const TUNABLE: Service[] = ["api", "cache", "database", "payment"];

function command(a: WaterfallAction): string {
  switch (a.type) {
    case "send":
      return "curl /checkout";
    case "setCache":
      return a.hit ? "cache: hit" : "cache: miss";
    case "setParallel":
      return a.parallel ? "calls: in parallel" : "calls: one after the other";
    case "setLatency":
      return `${a.service}: +${a.ms} ms`;
    case "select":
      return "select span";
  }
}

const depth = (t: Trace, span: Span): number => {
  const parent = t.spans.find((s) => s.spanId === span.parentId);
  return parent ? 1 + depth(t, parent) : 0;
};

function Waterfall({ trace, selected, onSelect }: { trace: Trace; selected: string | null; onSelect: (id: string) => void }) {
  const total = duration(trace);
  const path = new Set(criticalPath(trace));
  return (
    <ol className="otel-sim__waterfall" aria-label={`Trace ${trace.traceId}, ${total} ms. Select a span to inspect it.`}>
      {trace.spans.map((span) => {
        const onPath = path.has(span.spanId);
        const own = selfTime(trace, span);
        return (
          <li key={span.spanId}>
            <button
              type="button"
              className="otel-sim__row"
              aria-pressed={selected === span.spanId}
              data-critical={onPath ? "true" : "false"}
              onClick={() => onSelect(span.spanId)}
            >
              <span className="otel-sim__label" style={{ paddingLeft: `${depth(trace, span) * 0.9}rem` }}>
                <strong>{span.service}</strong> <span className="tag">{span.kind}</span> {span.name}
              </span>
              <span className="otel-sim__track" aria-hidden="true">
                <span className="otel-sim__bar" style={{ left: `${(span.start / total) * 100}%`, width: `${Math.max(0.6, ((span.end - span.start) / total) * 100)}%` }} />
              </span>
              <span className="otel-sim__time">
                {span.end - span.start} ms
                <span className="otel-sim__own">own {own} ms</span>
                {onPath ? <span className="otel-sim__critical">critical path</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function TraceWaterfallView({ state, dispatch }: ViewProps<WaterfallState, WaterfallAction>) {
  const t = latest(state);
  return (
    <div className="otel-sim">
      <div className="prom-sim__query">
        <button type="button" className="btn btn--primary btn--small" onClick={() => dispatch({ type: "send" })}>
          Send a checkout request
        </button>
        <Field label="Cache">
          {(id) => (
            <select id={id} value={state.cacheHit ? "hit" : "miss"} onChange={(e) => dispatch({ type: "setCache", hit: e.target.value === "hit" })}>
              <option value="miss">miss (query the database)</option>
              <option value="hit">hit (skip the database)</option>
            </select>
          )}
        </Field>
        <Field label="Database and payment calls">
          {(id) => (
            <select id={id} value={state.parallel ? "parallel" : "sequential"} onChange={(e) => dispatch({ type: "setParallel", parallel: e.target.value === "parallel" })}>
              <option value="sequential">one after the other</option>
              <option value="parallel">in parallel</option>
            </select>
          )}
        </Field>
      </div>
      <div className="prom-sim__query">
        {TUNABLE.map((service) => (
          <Field key={service} label={`Extra latency: ${service}`}>
            {(id) => (
              <select id={id} value={state.extra[service]} onChange={(e) => dispatch({ type: "setLatency", service, ms: Number(e.target.value) as Latency })}>
                {LATENCIES.map((ms) => (
                  <option key={ms} value={ms}>
                    +{ms} ms
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>

      {t ? (
        <>
          <p className="otel-sim__summary">
            Latest trace <code>{t.traceId}</code>: <strong>{duration(t)} ms</strong>
            {state.traces.length > 1 ? (
              <span className="muted"> · earlier: {state.traces.slice(0, -1).map((x) => `${duration(x)} ms`).join(", ")}</span>
            ) : null}
          </p>
          <Waterfall trace={t} selected={state.selected} onSelect={(spanId) => dispatch({ type: "select", spanId })} />
        </>
      ) : (
        <p className="muted">No request yet. Send one to see its trace.</p>
      )}
    </div>
  );
}

const entry: SimulationEntry = { model: traceWaterfall, View: TraceWaterfallView, command: (a) => command(a as WaterfallAction) };
export default entry;
