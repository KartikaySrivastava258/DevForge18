/**
 * Simulation: the experiment explorer (REMAINING_WORK.md §5.18).
 *
 * An experiment holds a fixed set of runs — three kinds of model, each with
 * a few settings — with a test error (RMSE) and a prediction latency. The
 * learner sorts and filters the runs, registers runs as versions of a
 * registered model, and moves the champion alias between versions, as in
 * MLflow's Model Registry: versions are numbered in order and never change;
 * an alias is a movable name for exactly one version.
 *
 * Simplified (shown to learners): the runs and their numbers are invented
 * to show a trade-off — they were not measured; there is one registered
 * model and one alias; latency is a single number per run.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const KINDS = ["linear", "forest", "boosting"] as const;
export type Kind = (typeof KINDS)[number];
export type SortKey = "rmse" | "latencyMs" | "name";

export interface ExpRun {
  id: string;
  name: string;
  kind: Kind;
  params: Record<string, string>;
  rmse: number;
  latencyMs: number;
}

/** The experiment's runs (invented numbers: more capacity → lower error, higher latency). */
export const RUNS: readonly ExpRun[] = [
  { id: "r01", name: "linear-a1.0", kind: "linear", params: { alpha: "1.0" }, rmse: 55.7, latencyMs: 0.2 },
  { id: "r02", name: "linear-a0.1", kind: "linear", params: { alpha: "0.1" }, rmse: 53.0, latencyMs: 0.2 },
  { id: "r03", name: "forest-50x4", kind: "forest", params: { trees: "50", depth: "4" }, rmse: 51.6, latencyMs: 0.8 },
  { id: "r04", name: "forest-50x8", kind: "forest", params: { trees: "50", depth: "8" }, rmse: 50.0, latencyMs: 1.6 },
  { id: "r05", name: "forest-200x4", kind: "forest", params: { trees: "200", depth: "4" }, rmse: 50.5, latencyMs: 3.2 },
  { id: "r06", name: "forest-200x8", kind: "forest", params: { trees: "200", depth: "8" }, rmse: 48.9, latencyMs: 6.4 },
  { id: "r07", name: "boost-100", kind: "boosting", params: { rounds: "100" }, rmse: 50.3, latencyMs: 1.2 },
  { id: "r08", name: "boost-300", kind: "boosting", params: { rounds: "300" }, rmse: 49.6, latencyMs: 3.6 },
  { id: "r09", name: "boost-500", kind: "boosting", params: { rounds: "500" }, rmse: 49.4, latencyMs: 6.0 },
  { id: "r10", name: "boost-1000", kind: "boosting", params: { rounds: "1000" }, rmse: 48.5, latencyMs: 12.0 },
];
export const runById = (id: string) => RUNS.find((r) => r.id === id);

export interface ModelVersion {
  version: number;
  runId: string;
}

export interface ExplorerState {
  sort: { by: SortKey; dir: "asc" | "desc" };
  filter: { kind: Kind | "all"; maxLatencyMs: number | null };
  versions: ModelVersion[];
  /** The version the champion alias points to, if any. */
  champion: number | null;
  /** The latency budget of the service that will load @champion (null = none). */
  limitMs: number | null;
}

export type ExplorerAction =
  | { type: "sort"; by: SortKey; dir: "asc" | "desc" }
  | { type: "filter"; kind: Kind | "all"; maxLatencyMs: number | null }
  | { type: "register"; runId: string }
  | { type: "setChampion"; version: number };

export interface ExplorerScenario {
  limitMs: number | null;
  /** Runs registered before the learner starts, in version order. */
  registered: string[];
  champion: number | null;
}

/** The runs as the current sort and filter show them. */
export function visibleRuns(s: Pick<ExplorerState, "sort" | "filter">): ExpRun[] {
  const { kind, maxLatencyMs } = s.filter;
  const rows = RUNS.filter((r) => (kind === "all" || r.kind === kind) && (maxLatencyMs === null || r.latencyMs <= maxLatencyMs));
  const sign = s.sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const d = s.sort.by === "name" ? a.name.localeCompare(b.name) : a[s.sort.by] - b[s.sort.by];
    return sign * d || a.id.localeCompare(b.id);
  });
}

const best = (rows: readonly ExpRun[]) => [...rows].sort((a, b) => a.rmse - b.rmse)[0];
export const bestOverall = () => best(RUNS)!;
export const bestWithin = (limitMs: number) => best(RUNS.filter((r) => r.latencyMs <= limitMs));
export const championRun = (s: ExplorerState) => {
  const v = s.versions.find((x) => x.version === s.champion);
  return v ? runById(v.runId) : undefined;
};

const refuse = (state: ExplorerState, error: string): StepResult<ExplorerState> => ({ state, events: [], error });
const fmt = (r: ExpRun) => `${r.name} (RMSE ${r.rmse.toFixed(1)}, ${r.latencyMs} ms)`;

function step(s: ExplorerState, a: ExplorerAction): StepResult<ExplorerState> {
  switch (a.type) {
    case "sort": {
      const next = { ...s, sort: { by: a.by, dir: a.dir } };
      const top = visibleRuns(next)[0];
      return { state: next, events: [`Sorted by ${a.by} ${a.dir === "asc" ? "ascending" : "descending"}${top ? `; first is ${fmt(top)}` : ""}.`] };
    }
    case "filter": {
      const next = { ...s, filter: { kind: a.kind, maxLatencyMs: a.maxLatencyMs } };
      const parts = [a.kind === "all" ? null : `params.kind = '${a.kind}'`, a.maxLatencyMs === null ? null : `metrics.latency_ms <= ${a.maxLatencyMs}`].filter(Boolean);
      return { state: next, events: [`Filter ${parts.length ? parts.join(" and ") : "cleared"}: ${visibleRuns(next).length} of ${RUNS.length} runs shown.`] };
    }
    case "register": {
      const run = runById(a.runId);
      if (!run) return refuse(s, `There is no run ${a.runId}.`);
      if (s.versions.length >= 12) return refuse(s, "This simulation allows at most 12 versions.");
      const version = s.versions.length + 1;
      return { state: { ...s, versions: [...s.versions, { version, runId: run.id }] }, events: [`Registered ${fmt(run)} as version ${version} of diabetes-model.`] };
    }
    case "setChampion": {
      const v = s.versions.find((x) => x.version === a.version);
      if (!v) return refuse(s, `There is no version ${a.version}.`);
      const run = runById(v.runId)!;
      const before = championRun(s);
      const notes: string[] = [`@champion now points to version ${a.version}: ${fmt(run)}.`];
      if (before && before.id !== run.id) {
        const dr = run.rmse - before.rmse;
        const dl = run.latencyMs - before.latencyMs;
        notes.push(`Compared with ${before.name}: RMSE ${dr <= 0 ? "down" : "up"} ${Math.abs(dr).toFixed(1)}, latency ${dl <= 0 ? "down" : "up"} ${Math.abs(dl).toFixed(1)} ms.`);
      }
      if (s.limitMs !== null && run.latencyMs > s.limitMs) notes.push(`Warning: ${run.latencyMs} ms is over the service's ${s.limitMs} ms budget.`);
      return { state: { ...s, champion: a.version }, events: [notes.join(" ")] };
    }
  }
}

function init(p: ExplorerScenario): StepResult<ExplorerState> {
  const versions = p.registered.map((runId, i) => ({ version: i + 1, runId }));
  if (versions.some((v) => !runById(v.runId))) return { state: undefined as never, events: [], error: "unknown run in registered" };
  if (p.champion !== null && !versions.some((v) => v.version === p.champion)) return { state: undefined as never, events: [], error: "champion must be a registered version" };
  const state: ExplorerState = { sort: { by: "name", dir: "asc" }, filter: { kind: "all", maxLatencyMs: null }, versions, champion: p.champion, limitMs: p.limitMs };
  const champ = championRun(state);
  return {
    state,
    events: [
      `Scenario ready: ${RUNS.length} runs in the experiment, ${versions.length} registered version(s)${champ ? `, @champion → ${fmt(champ)}` : ", no champion yet"}.${p.limitMs !== null ? ` The service that loads @champion must answer within ${p.limitMs} ms.` : ""}`,
    ],
  };
}

function describe(s: ExplorerState): string[] {
  const champ = championRun(s);
  return [
    `Runs sorted by ${s.sort.by} ${s.sort.dir === "asc" ? "ascending" : "descending"}${s.filter.kind !== "all" ? `, only ${s.filter.kind}` : ""}${s.filter.maxLatencyMs !== null ? `, latency at most ${s.filter.maxLatencyMs} ms` : ""}:`,
    ...visibleRuns(s).map((r) => `${r.name}: ${r.kind}, ${Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(", ")}; RMSE ${r.rmse.toFixed(1)}; latency ${r.latencyMs} ms.`),
    `Registered versions: ${s.versions.length ? s.versions.map((v) => `${v.version} = ${runById(v.runId)!.name}`).join("; ") : "none"}.`,
    `@champion: ${champ ? `version ${s.champion}, ${fmt(champ)}` : "not set"}.${s.limitMs !== null ? ` Latency budget: ${s.limitMs} ms.` : ""}`,
  ];
}

export const experimentExplorer: SimulationModel<ExplorerState, ExplorerAction, ExplorerScenario> = {
  id: "mlflow-experiment-explorer",
  track: "mlflow",
  init,
  step,
  invariants: [
    {
      name: "versions are numbered 1, 2, 3… in order and each refers to a run",
      check: (s) => (s.versions.every((v, i) => v.version === i + 1 && runById(v.runId)) ? null : "bad version list"),
    },
    {
      name: "the alias points to an existing version",
      check: (s) => (s.champion === null || s.versions.some((v) => v.version === s.champion) ? null : `champion → missing version ${s.champion}`),
    },
  ],
  checks: {
    /** @champion is the run with the lowest error of all. */
    "champion-lowest-error": (s) => championRun(s)?.id === bestOverall().id,
    /** @champion is the most accurate run that fits the latency budget. */
    "champion-best-within-limit": (s) => s.limitMs !== null && championRun(s)?.id === bestWithin(s.limitMs)?.id,
  },
  describe,
};
