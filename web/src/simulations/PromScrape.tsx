import {
  evaluate,
  INTERVALS,
  promql,
  scrapeAndRate,
  WINDOWS,
  type Interval,
  type P95By,
  type PromAction,
  type PromState,
  type QueryKind,
  type Window,
} from "../../../shared/simulations/prometheus/scrape-and-rate.ts";
import { Field } from "./Field.tsx";
import type { SimulationEntry, ViewProps } from "./registry.ts";

const SHOWN = 300; // seconds of history drawn
const W = 600;
const H = 200;
const PAD = { left: 56, right: 12, top: 12, bottom: 28 };
const TRAFFIC = [0, 5, 10, 20, 30] as const;

const QUERY_LABEL: Record<QueryKind, string> = {
  raw: "raw counter",
  rate: "rate() per instance",
  "sum-rate": "sum(rate()) — total",
  "rate-sum": "rate(sum()) — wrong order",
  p95: "95th percentile latency",
};
const P95_LABEL: Record<P95By, string> = { le: "sum by (le)", "instance-le": "sum by (instance, le)", none: "sum() — drops le" };

function command(a: PromAction): string {
  switch (a.type) {
    case "tick":
      return `(${a.count ?? 1} s pass)`;
    case "setTraffic":
      return `traffic to devforge-${a.instance + 1}: ${a.rps}/s`;
    case "restart":
      return `restart devforge-${a.instance + 1}`;
    case "setInterval":
      return `scrape_interval: ${a.seconds}s`;
    case "setWindow":
      return `range [${a.seconds === 300 ? "5m" : a.seconds === 60 ? "1m" : "30s"}]`;
    case "setQuery":
      return "query changed";
  }
}

function Chart({ state }: { state: PromState }) {
  const from = state.t - SHOWN;
  const points = state.instances.map((i) => i.samples.filter((p) => p.t > from));
  const max = Math.max(1, ...points.flat().map((p) => p.total));
  const x = (t: number) => PAD.left + ((t - from) / SHOWN) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const windowStart = x(Math.max(from, state.t - state.window));
  return (
    <svg className="prom-sim__chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Scraped counter samples for both instances over the last five minutes; the shaded area is the query's range. The text below and text mode list the same samples.">
      <rect className="prom-sim__range" x={windowStart} y={PAD.top} width={x(state.t) - windowStart} height={H - PAD.top - PAD.bottom} />
      <line className="prom-sim__axis" x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} />
      <line className="prom-sim__axis" x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} />
      <text className="prom-sim__tick" x={PAD.left - 6} y={PAD.top + 10} textAnchor="end">
        {max}
      </text>
      <text className="prom-sim__tick" x={PAD.left - 6} y={H - PAD.bottom} textAnchor="end">
        0
      </text>
      <text className="prom-sim__tick" x={PAD.left} y={H - 8}>
        5 min ago
      </text>
      <text className="prom-sim__tick" x={W - PAD.right} y={H - 8} textAnchor="end">
        now ({state.t}s)
      </text>
      {points.map((pts, k) => (
        <g key={k} className={`prom-sim__series prom-sim__series--${k + 1}`}>
          <polyline points={pts.map((p) => `${x(p.t)},${y(p.total)}`).join(" ")} />
          {pts.map((p) =>
            k === 0 ? <circle key={p.t} cx={x(p.t)} cy={y(p.total)} r={3} /> : <rect key={p.t} x={x(p.t) - 3} y={y(p.total) - 3} width={6} height={6} />,
          )}
        </g>
      ))}
    </svg>
  );
}

function PromScrapeView({ state, dispatch }: ViewProps<PromState, PromAction>) {
  const result = evaluate(state);
  const truth = state.instances.reduce((n, i) => n + i.rps, 0);
  return (
    <div className="prom-sim">
      <dl className="k8s-sim__summary">
        <div>
          <dt>Time</dt>
          <dd>{state.t} s</dd>
        </div>
        <div>
          <dt>True total traffic</dt>
          <dd>{truth} requests/s</dd>
        </div>
        <div>
          <dt>Scrape interval</dt>
          <dd>every {state.interval} s</dd>
        </div>
      </dl>

      <div className="git-sim__scroll prom-sim__chart-frame" tabIndex={0} role="group" aria-label="Chart of scraped samples; scroll sideways if it is cut off">
        <Chart state={state} />
      </div>
      <ul className="prom-sim__legend">
        {state.instances.map((inst, k) => (
          <li key={inst.name} className={`prom-sim__legend-item prom-sim__legend-item--${k + 1}`}>
            <span aria-hidden="true">{k === 0 ? "●" : "■"}</span> {inst.name}: counter {inst.total}
            {inst.restarts ? `, restarted ${inst.restarts}×` : ""}
          </li>
        ))}
      </ul>

      <div className="prom-sim__instances">
        {state.instances.map((inst, k) => (
          <div key={inst.name} className="prom-sim__instance">
            <strong>{inst.name}</strong>
            <Field label="Traffic (requests/s)">
              {(id) => (
                <select id={id} value={inst.rps} onChange={(e) => dispatch({ type: "setTraffic", instance: k, rps: Number(e.target.value) })}>
                  {TRAFFIC.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button type="button" className="btn btn--small" onClick={() => dispatch({ type: "restart", instance: k })}>
              Restart {inst.name}
            </button>
          </div>
        ))}
        <Field label="Scrape interval">
          {(id) => (
            <select id={id} value={state.interval} onChange={(e) => dispatch({ type: "setInterval", seconds: Number(e.target.value) as Interval })}>
              {INTERVALS.map((n) => (
                <option key={n} value={n}>
                  {n} s
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="prom-sim__query">
        <Field label="Query">
          {(id) => (
            <select id={id} value={state.query} onChange={(e) => dispatch({ type: "setQuery", query: e.target.value as QueryKind })}>
              {(Object.keys(QUERY_LABEL) as QueryKind[]).map((q) => (
                <option key={q} value={q}>
                  {QUERY_LABEL[q]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {state.query === "p95" ? (
          <Field label="Aggregation">
            {(id) => (
              <select id={id} value={state.p95By} onChange={(e) => dispatch({ type: "setQuery", query: "p95", p95By: e.target.value as P95By })}>
                {(Object.keys(P95_LABEL) as P95By[]).map((b) => (
                  <option key={b} value={b}>
                    {P95_LABEL[b]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label="Range">
          {(id) => (
            <select id={id} value={state.window} onChange={(e) => dispatch({ type: "setWindow", seconds: Number(e.target.value) as Window })}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w === 300 ? "5m" : w === 60 ? "1m" : "30s"}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <code className="git-sim__preview prom-sim__promql">{promql(state)}</code>
      <div className="prom-sim__result" aria-live="polite">
        <strong>Result</strong>
        {result.kind === "series" ? (
          <ul>
            {result.series.map((s) => (
              <li key={s.labels}>
                <code>{s.labels}</code> {s.value}
                {state.query === "p95" ? " seconds" : state.query === "raw" ? "" : " per second"}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No data. {result.kind === "empty" ? result.reason : result.message}
          </p>
        )}
      </div>
    </div>
  );
}

const entry: SimulationEntry = { model: scrapeAndRate, View: PromScrapeView, command: (a) => command(a as PromAction) };
export default entry;
