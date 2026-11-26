/**
 * Simulation: a workflow run visualiser (REMAINING_WORK.md §5.6).
 *
 * A workflow's jobs, with durations and `needs` between them. A run
 * starts every job whose needed jobs have succeeded; jobs without
 * dependencies run in parallel; a failed job's dependants are skipped.
 * The learner adds and removes dependencies, chooses between testing three
 * Node versions one after another or as a matrix, makes a job fail, and
 * sees the timeline and the total run time.
 *
 * Follows GitHub's documentation: "by default, jobs have no dependencies
 * and run in parallel"; needs lists "jobs that must complete successfully
 * before this job will run"; "If a job fails or is skipped, all jobs that
 * need it are skipped"; a matrix runs a job "for each possible combination
 * of the variables".
 *
 * Simplified (shown to learners): durations are fixed whole minutes;
 * runners are always available; there is no queueing or set-up time.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const JOBS = ["lint", "build", "unit", "e2e", "docs", "deploy"] as const;
export type JobId = (typeof JOBS)[number];
export const DURATION: Record<JobId, number> = { lint: 2, build: 4, unit: 5, e2e: 6, docs: 3, deploy: 2 };
/** Dependencies the work really has: tests use the build; deploy ships tested work. */
export const REQUIRED: Record<JobId, JobId[]> = { lint: [], build: [], unit: ["build"], e2e: ["build"], docs: [], deploy: ["unit", "e2e"] };
export const NODE_VERSIONS = [20, 22, 24] as const;

export interface RunJob {
  /** "unit" or, as a matrix, "unit (node 20)" … */
  name: string;
  job: JobId;
  start: number | null;
  end: number | null;
  result: "success" | "failure" | "skipped";
}

export interface WorkflowRunState {
  needs: Record<JobId, JobId[]>;
  unitMode: "sequential" | "matrix";
  failing: JobId[];
  last: { jobs: RunJob[]; total: number } | null;
}

export type WorkflowRunAction =
  | { type: "toggleNeed"; job: JobId; on: JobId }
  | { type: "setUnitMode"; mode: "sequential" | "matrix" }
  | { type: "setFailing"; job: JobId; failing: boolean }
  | { type: "run" };

export interface WorkflowRunScenario {
  needs: Record<JobId, JobId[]>;
  unitMode: "sequential" | "matrix";
  failing: JobId[];
}

/** Does job `a` (transitively) need job `b`? */
export function dependsOn(needs: Record<JobId, JobId[]>, a: JobId, b: JobId, seen = new Set<JobId>()): boolean {
  if (seen.has(a)) return false;
  seen.add(a);
  return needs[a].some((n) => n === b || dependsOn(needs, n, b, seen));
}

export function simulate(s: Pick<WorkflowRunState, "needs" | "unitMode" | "failing">): { jobs: RunJob[]; total: number } {
  const done = new Map<JobId, { end: number; ok: boolean }>();
  const jobs: RunJob[] = [];
  const pending = new Set<JobId>(JOBS);
  while (pending.size) {
    let progressed = false;
    for (const j of JOBS) {
      if (!pending.has(j) || !s.needs[j].every((n) => done.has(n))) continue;
      pending.delete(j);
      progressed = true;
      const deps = s.needs[j].map((n) => done.get(n)!);
      if (deps.some((d) => !d.ok)) {
        done.set(j, { end: Math.max(0, ...deps.map((d) => d.end)), ok: false });
        jobs.push({ name: j, job: j, start: null, end: null, result: "skipped" });
        continue;
      }
      const start = Math.max(0, ...deps.map((d) => d.end));
      const fails = s.failing.includes(j);
      if (j === "unit" && s.unitMode === "matrix") {
        for (const v of NODE_VERSIONS) jobs.push({ name: `unit (node ${v})`, job: j, start, end: start + DURATION.unit, result: fails ? "failure" : "success" });
        done.set(j, { end: start + DURATION.unit, ok: !fails });
      } else {
        const d = j === "unit" ? DURATION.unit * NODE_VERSIONS.length : DURATION[j];
        jobs.push({ name: j === "unit" ? "unit (node 20, 22, 24 in turn)" : j, job: j, start, end: start + d, result: fails ? "failure" : "success" });
        done.set(j, { end: start + d, ok: !fails });
      }
    }
    if (!progressed) break; // a cycle: refused when it is created, so this is only a guard
  }
  const total = Math.max(0, ...jobs.map((x) => x.end ?? 0));
  return { jobs, total };
}

const refuse = (state: WorkflowRunState, error: string): StepResult<WorkflowRunState> => ({ state, events: [], error });

function step(s: WorkflowRunState, a: WorkflowRunAction): StepResult<WorkflowRunState> {
  switch (a.type) {
    case "toggleNeed": {
      if (a.job === a.on) return refuse(s, "A job cannot need itself.");
      const has = s.needs[a.job].includes(a.on);
      if (!has && dependsOn(s.needs, a.on, a.job)) return refuse(s, `${a.on} already needs ${a.job}: that would be a cycle.`);
      const needs = { ...s.needs, [a.job]: has ? s.needs[a.job].filter((n) => n !== a.on) : JOBS.filter((j) => j === a.on || s.needs[a.job].includes(j)) };
      const missing = REQUIRED[a.job].filter((r) => !dependsOn(needs, a.job, r));
      return { state: { ...s, needs, last: null }, events: [`${a.job} ${has ? "no longer needs" : "now needs"} ${a.on}.${missing.length ? ` Careful: ${a.job} uses ${missing.join(" and ")}, which it no longer waits for.` : ""}`] };
    }
    case "setUnitMode":
      return { state: { ...s, unitMode: a.mode, last: null }, events: [a.mode === "matrix" ? "unit now uses a matrix: one job per Node version, side by side." : "unit now tests Node 20, 22 and 24 one after another in a single job."] };
    case "setFailing": {
      const failing = a.failing ? JOBS.filter((j) => j === a.job || s.failing.includes(j)) : s.failing.filter((j) => j !== a.job);
      return { state: { ...s, failing, last: null }, events: [`${a.job} will ${a.failing ? "fail" : "succeed"} on the next run.`] };
    }
    case "run": {
      const r = simulate(s);
      const failed = r.jobs.filter((j) => j.result === "failure").map((j) => j.name);
      const skipped = r.jobs.filter((j) => j.result === "skipped").map((j) => j.name);
      return {
        state: { ...s, last: r },
        events: [`Run finished in ${r.total} min.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}${skipped.length ? ` Skipped (a job they need did not succeed): ${skipped.join(", ")}.` : ""}`],
      };
    }
  }
}

function init(p: WorkflowRunScenario): StepResult<WorkflowRunState> {
  const state: WorkflowRunState = { needs: p.needs, unitMode: p.unitMode, failing: p.failing, last: null };
  return { state, events: [`The workflow has ${JOBS.length} jobs. Press Run to see the timeline.`] };
}

function describe(s: WorkflowRunState): string[] {
  const lines = JOBS.map((j) => `${j} (${j === "unit" ? (s.unitMode === "matrix" ? `${DURATION.unit} min × 3 in parallel` : `${DURATION.unit * 3} min`) : `${DURATION[j]} min`}): needs ${s.needs[j].length ? s.needs[j].join(", ") : "nothing"}${s.failing.includes(j) ? "; will fail" : ""}.`);
  if (!s.last) return [...lines, "Not run yet."];
  return [...lines, ...s.last.jobs.map((j) => `${j.name}: ${j.result === "skipped" ? "skipped" : `minute ${j.start} to ${j.end}, ${j.result}`}.`), `Total: ${s.last.total} min.`];
}

const keepsRequired = (s: WorkflowRunState) => JOBS.every((j) => REQUIRED[j].every((r) => dependsOn(s.needs, j, r)));

export const workflowRun: SimulationModel<WorkflowRunState, WorkflowRunAction, WorkflowRunScenario> = {
  id: "github-actions-workflow-run",
  track: "github-actions",
  init,
  step,
  invariants: [
    { name: "a job never starts before the jobs it needs have finished", check: (s) => { const r = s.last; if (!r) return null; const end = (j: JobId) => Math.max(...r.jobs.filter((x) => x.job === j).map((x) => x.end ?? 0)); const bad = r.jobs.find((x) => x.start !== null && s.needs[x.job].some((n) => end(n) > x.start!)); return bad ? `${bad.name} started early` : null; } },
    { name: "the needs graph has no cycles", check: (s) => (JOBS.some((j) => dependsOn(s.needs, j, j)) ? "cycle" : null) },
  ],
  checks: {
    /** The last run succeeded in 12 minutes or less, and every real dependency is still respected. */
    "fast-and-correct": (s) => !!s.last && s.last.total <= 12 && keepsRequired(s) && s.last.jobs.every((j) => j.result === "success"),
    /** Unit tests ran on all three Node versions, and the whole run took 12 minutes or less. */
    "three-versions-fast": (s) => !!s.last && s.unitMode === "matrix" && s.last.total <= 12 && keepsRequired(s) && s.last.jobs.every((j) => j.result === "success"),
  },
  describe,
};
