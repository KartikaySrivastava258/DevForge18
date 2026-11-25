/**
 * Simulation: a workflow executor (REMAINING_WORK.md §5.17).
 *
 * A form workflow — Form → Valid? (If) → Check seats (HTTP Request) → Save —
 * runs a batch of submissions as items. The learner chooses the validation
 * rules, where the If node's false branch goes, and how the HTTP node
 * handles errors (stop the execution, continue with its error output, and
 * Retry On Fail), then runs the batch and sees the items every node
 * received and produced.
 *
 * Follows the n8n documentation: data passes between nodes as items and a
 * node processes each item; an If node has a true and a false output, and
 * items on an output that is not connected go nowhere; a node set to
 * "Continue (using error output)" sends failed items out of a second,
 * error output; Retry On Fail reruns a failing node; without either, a
 * failing node fails the execution and nothing after it runs.
 *
 * Simplified (shown to learners): one execution processes the whole batch;
 * the seat service fails in a fixed, repeatable pattern instead of at
 * random; "Save" and the error workflow are stand-ins that just collect
 * items; an error workflow is modelled as a branch target rather than a
 * separate workflow started by an Error Trigger.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const TRACKS = ["docker", "kafka", "redis"] as const;
export interface Submission {
  id: number;
  name: string;
  email: string;
  track: string;
}

/** The batch of form submissions every run processes. */
export const SUBMISSIONS: readonly Submission[] = [
  { id: 1, name: "Asha", email: "asha@example.edu", track: "docker" },
  { id: 2, name: "", email: "ravi@example.edu", track: "kafka" },
  { id: 3, name: "Meera", email: "meera.example.edu", track: "redis" },
  { id: 4, name: "Nikhil", email: "nikhil@example.edu", track: "cobol" },
  { id: 5, name: "Zoya", email: "zoya@example.edu", track: "kafka" },
];

export type Rule = "nameRequired" | "emailHasAt" | "knownTrack";
export const RULES: readonly Rule[] = ["nameRequired", "emailHasAt", "knownTrack"];
export const RULE_TEXT: Record<Rule, string> = {
  nameRequired: "name is not empty",
  emailHasAt: "email contains @",
  knownTrack: "track is docker, kafka or redis",
};
export const passes = (rule: Rule, s: Submission) =>
  rule === "nameRequired" ? s.name.trim() !== "" : rule === "emailHasAt" ? s.email.includes("@") : (TRACKS as readonly string[]).includes(s.track);
export const isValid = (s: Submission) => RULES.every((r) => passes(r, s));

export type FalseBranch = "none" | "errorWorkflow";
export type OnError = "stop" | "errorOutput";

export interface NodeTrace {
  node: string;
  /** Submission ids per output (output 0 first). */
  outputs: number[][];
  note?: string;
}

export interface RunResult {
  status: "success" | "error";
  trace: NodeTrace[];
  saved: number[];
  toErrorWorkflow: number[];
  dropped: number[];
  /** Items the failing node never finished (the execution stopped there). */
  notRun: number[];
  attempts: number;
}

export interface WorkflowState {
  rules: Rule[];
  falseBranch: FalseBranch;
  onError: OnError;
  retries: number;
  /** Ids of submissions whose seat check fails on the first attempt (a temporary outage). */
  flaky: number[];
  last: RunResult | null;
  runs: number;
}

export type WorkflowAction =
  | { type: "toggleRule"; rule: Rule }
  | { type: "setFalseBranch"; to: FalseBranch }
  | { type: "setOnError"; mode: OnError }
  | { type: "setRetries"; retries: number }
  | { type: "run" };

export interface WorkflowScenario {
  rules: Rule[];
  falseBranch: FalseBranch;
  onError: OnError;
  retries: number;
  flaky: number[];
}

/** Execute the workflow once over the whole batch. */
export function execute(s: WorkflowState): RunResult {
  const ids = SUBMISSIONS.map((x) => x.id);
  const trace: NodeTrace[] = [{ node: "Form", outputs: [ids] }];
  const ok = SUBMISSIONS.filter((x) => s.rules.every((r) => passes(r, x))).map((x) => x.id);
  const bad = ids.filter((id) => !ok.includes(id));
  trace.push({ node: "Valid?", outputs: [ok, bad], note: s.rules.length ? `checks: ${s.rules.map((r) => RULE_TEXT[r]).join("; ")}` : "no checks: every item is true" });
  const toErrorWorkflow = s.falseBranch === "errorWorkflow" ? bad : [];
  const dropped = s.falseBranch === "none" ? [...bad] : [];

  // Check seats: each item is tried 1 + retries times; a flaky item fails only on its first attempt.
  const passed: number[] = [];
  const failed: number[] = [];
  let attempts = 0;
  let stoppedAt: number | null = null;
  for (const id of ok) {
    let success = false;
    for (let t = 0; t <= s.retries && !success; t++) {
      attempts++;
      success = !(s.flaky.includes(id) && t === 0);
    }
    if (success) passed.push(id);
    else if (s.onError === "errorOutput") failed.push(id);
    else {
      stoppedAt = id;
      break;
    }
  }
  if (stoppedAt !== null) {
    trace.push({ node: "Check seats", outputs: [passed], note: `item ${stoppedAt} failed: the execution stopped` });
    const notRun = ok.filter((id) => !passed.includes(id));
    return { status: "error", trace, saved: [], toErrorWorkflow, dropped, notRun, attempts };
  }
  trace.push({ node: "Check seats", outputs: s.onError === "errorOutput" ? [passed, failed] : [passed], note: `${attempts} request(s)${s.retries ? `, retries=${s.retries}` : ""}` });
  trace.push({ node: "Save", outputs: [passed] });
  if (toErrorWorkflow.length || failed.length) trace.push({ node: "Error workflow", outputs: [[...toErrorWorkflow, ...failed]] });
  return { status: "success", trace, saved: passed, toErrorWorkflow: [...toErrorWorkflow, ...failed], dropped, notRun: [], attempts };
}

const refuse = (state: WorkflowState, error: string): StepResult<WorkflowState> => ({ state, events: [], error });
const list = (ids: number[]) => (ids.length ? ids.map((id) => `#${id}`).join(", ") : "none");

function step(s: WorkflowState, a: WorkflowAction): StepResult<WorkflowState> {
  switch (a.type) {
    case "toggleRule": {
      const on = s.rules.includes(a.rule);
      const rules = on ? s.rules.filter((r) => r !== a.rule) : RULES.filter((r) => r === a.rule || s.rules.includes(r));
      return { state: { ...s, rules }, events: [`Valid? ${on ? "no longer checks" : "now checks"} that ${RULE_TEXT[a.rule]}.`] };
    }
    case "setFalseBranch":
      return { state: { ...s, falseBranch: a.to }, events: [a.to === "none" ? "Valid?'s false output is not connected: invalid items go nowhere." : "Valid?'s false output now goes to the error workflow."] };
    case "setOnError":
      return { state: { ...s, onError: a.mode }, events: [a.mode === "stop" ? "Check seats: On Error = Stop Workflow." : "Check seats: On Error = Continue (using error output)."] };
    case "setRetries":
      if (a.retries < 0 || a.retries > 3) return refuse(s, "Retries must be 0 to 3.");
      return { state: { ...s, retries: a.retries }, events: [`Check seats: Retry On Fail ${a.retries ? `on, up to ${a.retries} retr${a.retries === 1 ? "y" : "ies"}` : "off"}.`] };
    case "run": {
      const r = execute(s);
      const lines = [
        `Execution ${s.runs + 1}: ${r.status === "success" ? "succeeded" : "FAILED"}. Saved ${list(r.saved)}; error workflow ${list(r.toErrorWorkflow)}; dropped silently ${list(r.dropped)}${r.notRun.length ? `; never processed ${list(r.notRun)}` : ""}.`,
      ];
      const wrongSaves = r.saved.filter((id) => !isValid(SUBMISSIONS.find((x) => x.id === id)!));
      if (wrongSaves.length) lines.push(`Invalid submissions were saved: ${list(wrongSaves)}.`);
      return { state: { ...s, last: r, runs: s.runs + 1 }, events: lines };
    }
  }
}

function init(p: WorkflowScenario): StepResult<WorkflowState> {
  const state: WorkflowState = { ...p, rules: RULES.filter((r) => p.rules.includes(r)), last: null, runs: 0 };
  return { state, events: [`${SUBMISSIONS.length} submissions are waiting. Valid? checks ${state.rules.length ? state.rules.map((r) => RULE_TEXT[r]).join("; ") : "nothing"}. Press Run to execute the workflow.`] };
}

function describe(s: WorkflowState): string[] {
  const lines = [
    `Submissions: ${SUBMISSIONS.map((x) => `#${x.id} ${x.name || "(no name)"}, ${x.email}, ${x.track}${isValid(x) ? "" : " (invalid)"}`).join("; ")}.`,
    `Valid? checks: ${s.rules.length ? s.rules.map((r) => RULE_TEXT[r]).join("; ") : "nothing"}. False output: ${s.falseBranch === "none" ? "not connected" : "error workflow"}.`,
    `Check seats: On Error ${s.onError === "stop" ? "Stop Workflow" : "Continue (using error output)"}, retries ${s.retries}.`,
  ];
  if (!s.last) return [...lines, "Not run yet."];
  return [
    ...lines,
    `Last execution ${s.last.status === "success" ? "succeeded" : "failed"}.`,
    ...s.last.trace.map((t) => `${t.node}: ${t.outputs.map((o, i) => `${t.outputs.length > 1 ? `output ${i} ` : ""}${list(o)}`).join("; ")}${t.note ? ` (${t.note})` : ""}.`),
  ];
}

const correctRun = (r: RunResult | null) => {
  if (!r || r.status !== "success") return false;
  const valid = SUBMISSIONS.filter(isValid).map((x) => x.id);
  const invalid = SUBMISSIONS.filter((x) => !isValid(x)).map((x) => x.id);
  return valid.every((id) => r.saved.includes(id)) && r.saved.every((id) => valid.includes(id)) && invalid.every((id) => r.toErrorWorkflow.includes(id));
};

export const workflowExecutor: SimulationModel<WorkflowState, WorkflowAction, WorkflowScenario> = {
  id: "n8n-workflow-executor",
  track: "n8n",
  init,
  step,
  invariants: [
    {
      name: "after a successful run, every item ends in exactly one place",
      check: (s) => {
        if (!s.last || s.last.status !== "success") return null;
        const all = [...s.last.saved, ...s.last.toErrorWorkflow, ...s.last.dropped].sort((a, b) => a - b);
        return all.length === SUBMISSIONS.length && all.every((id, i) => id === i + 1) ? null : `items placed: ${all.join(",")}`;
      },
    },
    {
      name: "a failed run saves nothing",
      check: (s) => (s.last && s.last.status === "error" && s.last.saved.length ? "saved items after a failure" : null),
    },
  ],
  checks: {
    /** The last run saved exactly the valid submissions and sent every invalid one to the error workflow. */
    "valid-saved-invalid-reported": (s) => correctRun(s.last),
  },
  describe,
};
