/**
 * Simulation: controller, queue and executors (REMAINING_WORK.md §5.11).
 *
 * Builds arrive over 30 minutes; each needs an agent with a label (linux
 * or docker) and takes a few minutes. Agents have labels and a number of
 * executors — "a slot for the execution of tasks" (Jenkins documentation).
 * Every minute, waiting builds start, oldest first, on a free executor of
 * an agent with their label. The learner adds or removes agents before
 * the builds start and watches queue times.
 *
 * Simplified (shown to learners): fixed arrivals and durations; builds
 * start at whole minutes; one label per build and per agent; no
 * controller executors; the queue rules are this model's, not a copy of
 * Jenkins' scheduler.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const LABELS = ["linux", "docker"] as const;
export type Label = (typeof LABELS)[number];
export const MINUTES = 30;
/** Builds: arrival minute, label, duration (minutes). */
export const BUILDS: readonly { id: string; at: number; label: Label; minutes: number }[] = Array.from({ length: 12 }, (_, i) => ({
  id: `#${i + 1}`,
  at: i * 2,
  label: i % 3 === 2 ? "linux" : "docker",
  minutes: i % 3 === 2 ? 2 : 5,
}));

export interface Agent {
  name: string;
  label: Label;
  executors: number;
}
export interface BuildRun {
  id: string;
  start: number | null;
  end: number | null;
  agent: string | null;
}
export interface QueueState {
  t: number;
  agents: Agent[];
  runs: BuildRun[];
}
export type QueueAction = { type: "addAgent"; label: Label; executors: number } | { type: "removeAgent"; name: string } | { type: "tick"; count?: number | undefined };
export interface QueueScenario {
  agents: Agent[];
}

export const waitOf = (r: BuildRun, t: number) => {
  const b = BUILDS.find((x) => x.id === r.id)!;
  return (r.start ?? Math.max(t, b.at)) - b.at;
};
export const maxWait = (s: QueueState) => Math.max(0, ...s.runs.filter((r) => BUILDS.find((b) => b.id === r.id)!.at < s.t).map((r) => waitOf(r, s.t)));

function minute(s: QueueState): { state: QueueState; event: string } {
  const t = s.t;
  const runs = s.runs.map((r) => ({ ...r }));
  const busy = (name: string) => runs.filter((r) => r.agent === name && r.start !== null && (r.end ?? Infinity) > t).length;
  const started: string[] = [];
  for (const b of BUILDS.filter((x) => x.at <= t)) {
    const r = runs.find((x) => x.id === b.id)!;
    if (r.start !== null) continue;
    const agent = s.agents.find((a) => a.label === b.label && busy(a.name) < a.executors);
    if (!agent) continue;
    r.start = t;
    r.end = t + b.minutes;
    r.agent = agent.name;
    started.push(`${b.id} on ${agent.name}`);
  }
  const waiting = BUILDS.filter((b) => b.at <= t && runs.find((r) => r.id === b.id)!.start === null).map((b) => `${b.id} (${b.label})`);
  return { state: { ...s, t: t + 1, runs }, event: `Minute ${t}: ${started.length ? `started ${started.join(", ")}` : "nothing started"}${waiting.length ? `; waiting: ${waiting.join(", ")}` : ""}.` };
}

const refuse = (state: QueueState, error: string): StepResult<QueueState> => ({ state, events: [], error });

function step(s: QueueState, a: QueueAction): StepResult<QueueState> {
  switch (a.type) {
    case "addAgent": {
      if (s.t > 0) return refuse(s, "Change the agents before the builds start (press Reset).");
      if (s.agents.length >= 5) return refuse(s, "This simulation allows at most 5 agents.");
      if (a.executors < 1 || a.executors > 4) return refuse(s, "An agent here has 1 to 4 executors.");
      const name = `${a.label}-${s.agents.filter((x) => x.label === a.label).length + 1}`;
      return { state: { ...s, agents: [...s.agents, { name, label: a.label, executors: a.executors }] }, events: [`Added agent ${name} (label ${a.label}, ${a.executors} executor${a.executors === 1 ? "" : "s"}).`] };
    }
    case "removeAgent":
      if (s.t > 0) return refuse(s, "Change the agents before the builds start (press Reset).");
      if (!s.agents.some((x) => x.name === a.name)) return refuse(s, `There is no agent ${a.name}.`);
      return { state: { ...s, agents: s.agents.filter((x) => x.name !== a.name) }, events: [`Removed agent ${a.name}.`] };
    case "tick": {
      let state = s;
      const events: string[] = [];
      for (let i = 0; i < (a.count ?? 1); i++) {
        if (state.t >= MINUTES) return i === 0 ? refuse(s, "The half hour is over.") : { state, events };
        const r = minute(state);
        state = r.state;
        events.push(r.event);
      }
      return { state, events };
    }
  }
}

function init(p: QueueScenario): StepResult<QueueState> {
  return { state: { t: 0, agents: p.agents, runs: BUILDS.map((b) => ({ id: b.id, start: null, end: null, agent: null })) }, events: [`${BUILDS.length} builds will arrive over ${MINUTES} minutes: ${BUILDS.filter((b) => b.label === "docker").length} need a docker agent (5 min), ${BUILDS.filter((b) => b.label === "linux").length} a linux agent (2 min).`] };
}

function describe(s: QueueState): string[] {
  return [
    `Minute ${s.t} of ${MINUTES}. Agents: ${s.agents.map((a) => `${a.name} (${a.label}, ${a.executors} executor${a.executors === 1 ? "" : "s"})`).join("; ") || "none"}.`,
    ...BUILDS.map((b) => { const r = s.runs.find((x) => x.id === b.id)!; return `${b.id} (${b.label}, arrives ${b.at}): ${r.start !== null ? `ran on ${r.agent} from ${r.start} to ${r.end}, waited ${r.start - b.at} min` : b.at < s.t ? `waiting ${s.t - b.at} min` : "not arrived"}.`; }),
    `Longest wait so far: ${maxWait(s)} min.`,
  ];
}

export const buildQueue: SimulationModel<QueueState, QueueAction, QueueScenario> = {
  id: "jenkins-build-queue",
  track: "jenkins",
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : 1),
  invariants: [
    { name: "an agent never runs more builds at once than it has executors", check: (s) => { for (const a of s.agents) for (let t = 0; t < s.t; t++) if (s.runs.filter((r) => r.agent === a.name && r.start! <= t && r.end! > t).length > a.executors) return `${a.name} overloaded at ${t}`; return null; } },
    { name: "a build only runs on an agent with its label", check: (s) => (s.runs.every((r) => !r.agent || s.agents.find((a) => a.name === r.agent)?.label === BUILDS.find((b) => b.id === r.id)!.label) ? null : "label mismatch") },
  ],
  checks: {
    /** Every build has finished by minute 30 and none waited more than 2 minutes. */
    "short-queue": (s) => s.t === MINUTES && s.runs.every((r) => r.end !== null && r.end <= MINUTES) && maxWait(s) <= 2,
  },
  describe,
};
