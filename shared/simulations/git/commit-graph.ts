/**
 * Simulation: the Git commit graph (REMAINING_WORK.md §5.1).
 *
 * Models commits as a DAG with branch pointers and HEAD, and the commands
 * that move them: commit, branch, switch, merge, rebase, reset and revert.
 * Its graph behaviour is compared with real Git in commit-graph.test.ts.
 *
 * Simplifications (also shown to learners): there are no files, so merges
 * and rebases never conflict; commit IDs are short simulated hashes; HEAD is
 * always on a branch; reset behaves like reset --hard on the graph.
 */
import { z } from "zod/v4";
import type { SimulationModel, StepResult } from "../types.ts";

export interface Commit {
  id: string;
  parents: string[];
  message: string;
  /** Branch HEAD was on when the commit was made; used to draw lanes. */
  lane: string;
  /** For revert commits: the commit whose change this one undoes. */
  revertOf?: string;
}

export interface GitState {
  commits: Record<string, Commit>;
  /** Creation order, oldest first. */
  order: string[];
  branches: Record<string, string>;
  head: string;
  /** origin/main when the scenario says main has been pushed (shared with teammates). */
  remote: Record<string, string>;
}

const branchName = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,29}$/, "Branch names here use lowercase letters, digits and hyphens.");
const message = z.string().trim().min(1, "A commit needs a message.").max(72, "Keep the message under 72 characters.");
const ref = z.string().min(1).max(40);

export const GitActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commit"), message }).strict(),
  z.object({ type: z.literal("branch"), name: branchName }).strict(),
  z.object({ type: z.literal("switch"), branch: branchName }).strict(),
  z.object({ type: z.literal("merge"), branch: branchName, mode: z.enum(["default", "no-ff", "ff-only"]) }).strict(),
  z.object({ type: z.literal("rebase"), onto: branchName }).strict(),
  z.object({ type: z.literal("reset"), to: ref }).strict(),
  z.object({ type: z.literal("revert"), commit: ref }).strict(),
]);
export type GitAction = z.infer<typeof GitActionSchema>;

export const GitScenarioSchema = z
  .object({
    /** Commands that build the starting history, run on a fresh repository with one branch, main. */
    setup: z.array(GitActionSchema).max(40),
    /** Record origin/main at the end of setup: main has been pushed and others may have it. */
    pushed: z.boolean().default(false),
  })
  .strict();
export type GitScenario = z.infer<typeof GitScenarioSchema>;

/** The command a learner would type, shown next to each action in the UI and log. */
export function gitCommand(a: GitAction): string {
  switch (a.type) {
    case "commit":
      return `git commit -m "${a.message}"`;
    case "branch":
      return `git branch ${a.name}`;
    case "switch":
      return `git switch ${a.branch}`;
    case "merge":
      return `git merge${a.mode === "default" ? "" : ` --${a.mode}`} ${a.branch}`;
    case "rebase":
      return `git rebase ${a.onto}`;
    case "reset":
      return `git reset --hard ${a.to}`;
    case "revert":
      return `git revert ${a.commit}`;
  }
}

/** A deterministic 7-hex "hash" so the same actions always give the same IDs. */
function simulatedId(state: GitState, parents: string[], msg: string): string {
  let h = 0x811c9dc5;
  for (const ch of `${state.order.length}|${parents.join(",")}|${msg}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let id = h.toString(16).padStart(8, "0").slice(0, 7);
  while (state.commits[id]) id = ((parseInt(id, 16) + 1) % 0xfffffff).toString(16).padStart(7, "0");
  return id;
}

/** Every commit reachable from `start` (inclusive) by following parents. */
export function ancestors(state: GitState, start: string | undefined): Set<string> {
  const seen = new Set<string>();
  const stack = start ? [start] : [];
  while (stack.length) {
    const id = stack.pop() ?? "";
    if (seen.has(id) || !state.commits[id]) continue;
    seen.add(id);
    stack.push(...(state.commits[id]?.parents ?? []));
  }
  return seen;
}

const short = (id: string | undefined) => id ?? "(none)";
const tip = (state: GitState) => state.branches[state.head];

function addCommit(state: GitState, parents: string[], msg: string, extra: Partial<Commit> = {}): [GitState, string] {
  const id = simulatedId(state, parents, msg);
  const commit: Commit = { id, parents, message: msg, lane: state.head, ...extra };
  return [
    { ...state, commits: { ...state.commits, [id]: commit }, order: [...state.order, id], branches: { ...state.branches, [state.head]: id } },
    id,
  ];
}

/** Resolve a branch name, a commit id, or HEAD~N. */
function resolve(state: GitState, target: string): string | undefined {
  if (state.branches[target]) return state.branches[target];
  if (state.commits[target]) return target;
  const m = /^HEAD(?:~(\d+))?$/.exec(target);
  if (!m) return undefined;
  let id = tip(state);
  for (let i = 0; i < Number(m[1] ?? 0) && id; i++) id = state.commits[id]?.parents[0];
  return id;
}

const refuse = (state: GitState, error: string): StepResult<GitState> => ({ state, events: [], error });

function step(state: GitState, action: GitAction): StepResult<GitState> {
  const head = state.head;
  const current = tip(state);
  switch (action.type) {
    case "commit": {
      const [next, id] = addCommit(state, current ? [current] : [], action.message);
      return { state: next, events: [`New commit ${id} "${action.message}" on ${head}${current ? `, with parent ${current}` : " (the first commit, with no parent)"}; ${head} now points at it.`] };
    }
    case "branch": {
      if (state.branches[action.name]) return refuse(state, `A branch named ${action.name} already exists.`);
      if (!current) return refuse(state, "Make a commit first: a branch is a pointer to a commit.");
      return { state: { ...state, branches: { ...state.branches, [action.name]: current } }, events: [`New branch ${action.name} points at ${current}, the same commit as ${head}. HEAD stays on ${head}.`] };
    }
    case "switch": {
      if (!state.branches[action.branch]) return refuse(state, `There is no branch called ${action.branch}.`);
      if (action.branch === head) return refuse(state, `You are already on ${head}.`);
      return { state: { ...state, head: action.branch }, events: [`HEAD now points at ${action.branch} (commit ${state.branches[action.branch]}). New commits will move ${action.branch}.`] };
    }
    case "merge": {
      const other = state.branches[action.branch];
      if (!other) return refuse(state, `There is no branch called ${action.branch}.`);
      if (action.branch === head) return refuse(state, "A branch cannot be merged into itself.");
      if (!current) return refuse(state, "There is nothing to merge into yet.");
      const mine = ancestors(state, current);
      if (mine.has(other)) return { state, events: [`Already up to date: every commit on ${action.branch} is already in ${head}.`] };
      const fastForward = ancestors(state, other).has(current);
      if (fastForward && action.mode !== "no-ff") {
        return {
          state: { ...state, branches: { ...state.branches, [head]: other } },
          events: [`Fast-forward: ${head} had no commits of its own since ${action.branch} split off, so Git just moved ${head} from ${current} to ${other}. No merge commit was needed.`],
        };
      }
      if (action.mode === "ff-only") return refuse(state, `Not possible to fast-forward: ${head} and ${action.branch} have both moved on since they split. Use git rebase ${head} on ${action.branch} first, or allow a merge commit.`);
      const msg = `Merge branch '${action.branch}'${head === "main" || head === "master" ? "" : ` into ${head}`}`;
      const [next, id] = addCommit(state, [current, other], msg);
      return { state: next, events: [`Merge commit ${id} "${msg}" has two parents: ${current} (${head}) and ${other} (${action.branch}).${fastForward ? " --no-ff made it even though a fast-forward was possible." : ""}`] };
    }
    case "rebase": {
      const onto = state.branches[action.onto];
      if (!onto) return refuse(state, `There is no branch called ${action.onto}.`);
      if (action.onto === head) return refuse(state, "A branch cannot be rebased onto itself.");
      if (!current) return refuse(state, "There is nothing to rebase yet.");
      const base = ancestors(state, onto);
      if (base.has(current)) {
        if (current === onto) return { state, events: [`Current branch ${head} is up to date with ${action.onto}.`] };
        return { state: { ...state, branches: { ...state.branches, [head]: onto } }, events: [`${head} had no commits of its own, so the rebase simply moved it forward to ${onto}.`] };
      }
      if (ancestors(state, current).has(onto)) return { state, events: [`Current branch ${head} is up to date: it already contains ${action.onto}.`] };
      // Replay this branch's own commits (oldest first), skipping merge commits as git rebase does by default.
      const own = state.order.filter((id) => ancestors(state, current).has(id) && !base.has(id) && (state.commits[id]?.parents.length ?? 0) < 2);
      let next: GitState = { ...state, branches: { ...state.branches, [head]: onto } };
      const copies: string[] = [];
      for (const id of own) {
        const original = state.commits[id];
        if (!original) continue;
        let copy: string;
        [next, copy] = addCommit(next, [tip(next) ?? onto], original.message, original.revertOf ? { revertOf: original.revertOf } : {});
        copies.push(`${id} → ${copy}`);
      }
      return {
        state: next,
        events: [`Rebased ${head} onto ${action.onto}: its ${own.length} commit(s) were replayed on top of ${onto} as new commits (${copies.join(", ")}). The old commits are no longer on any branch.`],
      };
    }
    case "reset": {
      const target = resolve(state, action.to);
      if (!target) return refuse(state, `Cannot find ${action.to}. Use a commit ID, a branch name or HEAD~1.`);
      if (!current) return refuse(state, "There is nothing to reset yet.");
      const lost = [...ancestors(state, current)].filter((id) => !ancestors(state, target).has(id));
      const events = [`${head} moved from ${current} to ${target}.${lost.length ? ` ${lost.length} commit(s) are no longer on ${head}.` : ""}`];
      const pushed = state.remote[head];
      if (pushed && !ancestors(state, target).has(pushed)) {
        events.push(`Warning: origin/${head} still has ${pushed}. Pushing now would need --force and would remove commits your teammates may already have.`);
      }
      return { state: { ...state, branches: { ...state.branches, [head]: target } }, events };
    }
    case "revert": {
      const target = resolve(state, action.commit);
      const commit = target ? state.commits[target] : undefined;
      if (!commit || !target) return refuse(state, `Cannot find ${action.commit}.`);
      if (!current || !ancestors(state, current).has(target)) return refuse(state, `${target} is not part of ${head}, so there is nothing to revert here.`);
      if (commit.parents.length > 1) return refuse(state, "Reverting a merge commit needs -m to choose a parent; this simulation does not model that.");
      const msg = `Revert "${commit.message}"`;
      const [next, id] = addCommit(state, [current], msg, { revertOf: target });
      return { state: next, events: [`New commit ${id} "${msg}" undoes the change made by ${target}. History is kept: ${target} is still there, so nobody else's copy is rewritten.`] };
    }
  }
}

function init(params: GitScenario): StepResult<GitState> {
  // A new repository: HEAD is on main, which has no commits yet (an "unborn" branch, absent from branches).
  let state: GitState = { commits: {}, order: [], branches: {}, head: "main", remote: {} };
  for (const action of params.setup) {
    const r = step(state, action);
    if (r.error) return r;
    state = r.state;
  }
  if (params.pushed && state.branches.main) state = { ...state, remote: { main: state.branches.main } };
  return { state, events: [`Scenario ready: ${state.order.length} commit(s); you are on ${state.head}.${params.pushed ? " main has been pushed: origin/main marks what your teammates have." : ""}`] };
}

const describe = (state: GitState): string[] => {
  const lines = [`You are on branch ${state.head}${tip(state) ? `, at commit ${tip(state)}` : " (no commits yet)"}.`];
  for (const [name, id] of Object.entries(state.branches)) lines.push(`Branch ${name} points at ${id}.`);
  for (const [name, id] of Object.entries(state.remote)) lines.push(`origin/${name} (what teammates have) is ${id}.`);
  const live = new Set(Object.values(state.branches).flatMap((id) => [...ancestors(state, id)]));
  for (const id of [...state.order].reverse()) {
    const c = state.commits[id];
    if (!c) continue;
    const parents = c.parents.length === 0 ? "no parent (root)" : c.parents.length === 1 ? `parent ${c.parents[0]}` : `parents ${c.parents.join(" and ")}`;
    lines.push(`Commit ${id} "${c.message}" — ${parents}${live.has(id) ? "" : " — not on any branch any more"}.`);
  }
  return lines;
};

export const commitGraph: SimulationModel<GitState, GitAction, GitScenario> = {
  id: "git-commit-graph",
  track: "git-github",
  scenarioSchema: GitScenarioSchema,
  actionSchema: GitActionSchema,
  init,
  step,
  invariants: [
    {
      name: "every commit's parents exist, and only the root has none",
      check: (s) => {
        const roots = s.order.filter((id) => (s.commits[id]?.parents.length ?? 0) === 0);
        if (s.order.length && roots.length !== 1) return `expected one root commit, found ${roots.length}`;
        const bad = s.order.find((id) => s.commits[id]?.parents.some((p) => !s.commits[p]));
        return bad ? `commit ${bad} has a missing parent` : null;
      },
    },
    {
      name: "parents are older than their children (history is never rewritten in place)",
      check: (s) => {
        const pos = new Map(s.order.map((id, i) => [id, i]));
        const bad = s.order.find((id) => s.commits[id]?.parents.some((p) => (pos.get(p) ?? Infinity) >= (pos.get(id) ?? -1)));
        return bad ? `commit ${bad} has a parent created after it` : null;
      },
    },
    {
      name: "branch names and origin refs point at existing commits",
      check: (s) => {
        const bad = [...Object.entries(s.branches), ...Object.entries(s.remote)].find(([, id]) => !s.commits[id]);
        return bad ? `${bad[0]} points at ${short(bad[1])}, which does not exist` : null;
      },
    },
    {
      name: "HEAD is on an existing branch once there are commits",
      check: (s) => (s.order.length && !s.branches[s.head] ? `HEAD is on ${s.head}, which does not exist` : null),
    },
  ],
  checks: {
    /** feature's work is on main, and main has no merge commits. */
    "feature-on-main-without-merge-commit": (s, initial) => {
      const onMain = ancestors(s, s.branches.main);
      const featureWork = [...ancestors(initial, initial.branches.feature)].filter((id) => !ancestors(initial, initial.branches.main).has(id));
      const messagesOnMain = new Set([...onMain].map((id) => s.commits[id]?.message));
      const hasMerge = [...onMain].some((id) => (s.commits[id]?.parents.length ?? 0) > 1);
      return featureWork.length > 0 && featureWork.every((id) => messagesOnMain.has(initial.commits[id]?.message)) && !hasMerge;
    },
    /** The last pushed commit on main is undone by a revert, without rewriting shared history. */
    "undo-pushed-commit-safely": (s, initial) => {
      const bad = initial.branches.main;
      const onMain = ancestors(s, s.branches.main);
      const pushed = initial.remote.main;
      return Boolean(bad && pushed && onMain.has(pushed) && [...onMain].some((id) => s.commits[id]?.revertOf === bad));
    },
    /** A branch called feature exists with at least one commit that main does not have. */
    "branch-with-own-commit": (s) => {
      const feature = s.branches.feature;
      return Boolean(feature && !ancestors(s, s.branches.main).has(feature));
    },
  },
  describe,
};
