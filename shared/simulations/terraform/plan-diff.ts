/**
 * Simulation: the plan diff (REMAINING_WORK.md §5.5).
 *
 * Three panels: the configuration (what you want), the state (what
 * Terraform recorded) and the real world (what exists). Planning first
 * refreshes the state from the real world — noticing drift — then compares
 * the configuration with it: + create, - destroy, ~ update in place,
 * -/+ destroy and then create a replacement. A moved block turns a changed
 * address into a move. Applying makes the real world and the state match
 * the configuration.
 *
 * Follows Terraform's documentation: plan "proposes a set of change
 * actions that should, if applied, make the remote objects match the
 * configuration"; by default a changed address is destroy-and-create, and
 * a moved block relocates the object instead; changes made outside
 * Terraform are drift, and a normal plan would revert them.
 *
 * Simplified (shown to learners): one invented resource type, "server",
 * with two arguments — changing name forces a replacement, changing size
 * is an in-place update; object IDs are simple counters.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const SIZES = ["small", "medium", "large"] as const;
export type Size = (typeof SIZES)[number];
export interface ServerArgs {
  name: string;
  size: Size;
}
export interface ConfigItem extends ServerArgs {
  address: string;
}
export interface StateItem extends ServerArgs {
  address: string;
  id: string;
}
export interface Moved {
  from: string;
  to: string;
}

export interface Change {
  action: "create" | "destroy" | "update" | "replace" | "move" | "drift";
  address: string;
  detail: string;
}

export interface PlanState {
  config: ConfigItem[];
  moved: Moved[];
  state: StateItem[];
  /** Real objects by ID. */
  real: Record<string, ServerArgs>;
  nextId: number;
  /** Objects destroyed by applies so far. */
  destroyed: number;
  applies: number;
}

export type PlanAction =
  | { type: "rename"; from: string; to: string }
  | { type: "setSize"; address: string; size: Size }
  | { type: "setName"; address: string; name: string }
  | { type: "addMoved"; from: string; to: string }
  | { type: "removeMoved"; from: string }
  | { type: "outsideResize"; address: string; size: Size }
  | { type: "outsideDelete"; address: string }
  | { type: "apply" };

export interface PlanScenario {
  servers: ConfigItem[];
  /** Changes made outside Terraform after the last apply. */
  drift: { address: string; size: Size }[];
}

/** Refresh the state from the real world (in memory), then diff the configuration against it. */
export function plan(s: PlanState): Change[] {
  const changes: Change[] = [];
  const refreshed: StateItem[] = [];
  for (const item of s.state) {
    const real = s.real[item.id];
    if (!real) {
      changes.push({ action: "drift", address: item.address, detail: "deleted outside Terraform" });
      continue;
    }
    if (real.size !== item.size || real.name !== item.name) changes.push({ action: "drift", address: item.address, detail: `size changed outside Terraform: ${item.size} → ${real.size}` });
    refreshed.push({ ...item, ...real });
  }
  // Apply moved blocks to the refreshed state's addresses.
  const byAddr = new Map(refreshed.map((x) => [x.address, x]));
  for (const m of s.moved) {
    const obj = byAddr.get(m.from);
    if (obj && !byAddr.has(m.to) && s.config.some((c) => c.address === m.to)) {
      byAddr.delete(m.from);
      byAddr.set(m.to, { ...obj, address: m.to });
      changes.push({ action: "move", address: m.from, detail: `has moved to ${m.to}` });
    }
  }
  for (const c of s.config) {
    const cur = byAddr.get(c.address);
    if (!cur) changes.push({ action: "create", address: c.address, detail: `name = "${c.name}", size = "${c.size}"` });
    else if (cur.name !== c.name) changes.push({ action: "replace", address: c.address, detail: `name: "${cur.name}" → "${c.name}" forces replacement` });
    else if (cur.size !== c.size) changes.push({ action: "update", address: c.address, detail: `size: "${cur.size}" → "${c.size}"` });
  }
  for (const [addr] of byAddr) if (!s.config.some((c) => c.address === addr)) changes.push({ action: "destroy", address: addr, detail: "not in the configuration" });
  return changes;
}

export function summary(changes: Change[]): { add: number; change: number; destroy: number } {
  return {
    add: changes.filter((c) => c.action === "create" || c.action === "replace").length,
    change: changes.filter((c) => c.action === "update").length,
    destroy: changes.filter((c) => c.action === "destroy" || c.action === "replace").length,
  };
}
export const SYMBOL: Record<Change["action"], string> = { create: "+", destroy: "-", update: "~", replace: "-/+", move: "→", drift: "!" };

function apply(s: PlanState): PlanState {
  const changes = plan(s);
  const real = { ...s.real };
  let nextId = s.nextId;
  let destroyed = s.destroyed;
  // Refresh, then move.
  let state: StateItem[] = s.state.filter((x) => real[x.id]).map((x) => ({ ...x, ...real[x.id]! }));
  for (const ch of changes.filter((c) => c.action === "move")) {
    const to = s.moved.find((m) => m.from === ch.address)!.to;
    state = state.map((x) => (x.address === ch.address ? { ...x, address: to } : x));
  }
  for (const ch of changes) {
    const cfg = s.config.find((c) => c.address === ch.address);
    const cur = state.find((x) => x.address === ch.address);
    if (ch.action === "create" && cfg) {
      const id = `srv-${++nextId}`;
      real[id] = { name: cfg.name, size: cfg.size };
      state.push({ address: cfg.address, id, name: cfg.name, size: cfg.size });
    } else if (ch.action === "update" && cfg && cur) {
      real[cur.id] = { name: cfg.name, size: cfg.size };
      state = state.map((x) => (x.address === ch.address ? { ...x, size: cfg.size } : x));
    } else if (ch.action === "replace" && cfg && cur) {
      delete real[cur.id];
      destroyed++;
      const id = `srv-${++nextId}`;
      real[id] = { name: cfg.name, size: cfg.size };
      state = state.map((x) => (x.address === ch.address ? { address: cfg.address, id, name: cfg.name, size: cfg.size } : x));
    } else if (ch.action === "destroy" && cur) {
      delete real[cur.id];
      destroyed++;
      state = state.filter((x) => x.address !== ch.address);
    }
  }
  return { ...s, real, state, nextId, destroyed, applies: s.applies + 1 };
}

const refuse = (state: PlanState, error: string): StepResult<PlanState> => ({ state, events: [], error });
const ADDRESS = /^server\.[a-z][a-z0-9_]{0,19}$/;
const describePlan = (changes: Change[]) => {
  const s = summary(changes);
  return `Plan: ${s.add} to add, ${s.change} to change, ${s.destroy} to destroy.${changes.length ? " " + changes.map((c) => `${SYMBOL[c.action]} ${c.address} ${c.detail}`).join("; ") + "." : " No changes."}`;
};

function step(s: PlanState, a: PlanAction): StepResult<PlanState> {
  switch (a.type) {
    case "rename": {
      if (!ADDRESS.test(a.to)) return refuse(s, "Addresses look like server.web (lower case letters, digits, _).");
      if (!s.config.some((c) => c.address === a.from)) return refuse(s, `${a.from} is not in the configuration.`);
      if (s.config.some((c) => c.address === a.to)) return refuse(s, `${a.to} already exists.`);
      const next = { ...s, config: s.config.map((c) => (c.address === a.from ? { ...c, address: a.to } : c)) };
      return { state: next, events: [`Renamed ${a.from} to ${a.to} in the configuration. ${describePlan(plan(next))}`] };
    }
    case "setSize":
    case "setName": {
      if (!s.config.some((c) => c.address === a.address)) return refuse(s, `${a.address} is not in the configuration.`);
      if (a.type === "setName" && !/^[a-z][a-z0-9-]{0,19}$/.test(a.name)) return refuse(s, "Names use lower case letters, digits and hyphens.");
      const next = { ...s, config: s.config.map((c) => (c.address === a.address ? (a.type === "setSize" ? { ...c, size: a.size } : { ...c, name: a.name }) : c)) };
      return { state: next, events: [`${a.address}: ${a.type === "setSize" ? `size = "${a.size}"` : `name = "${a.name}"`} in the configuration. ${describePlan(plan(next))}`] };
    }
    case "addMoved": {
      if (s.moved.some((m) => m.from === a.from)) return refuse(s, `There is already a moved block from ${a.from}.`);
      if (!ADDRESS.test(a.from) || !ADDRESS.test(a.to) || a.from === a.to) return refuse(s, "A moved block needs two different addresses like server.web.");
      const next = { ...s, moved: [...s.moved, { from: a.from, to: a.to }] };
      return { state: next, events: [`Added moved { from = ${a.from}, to = ${a.to} }. ${describePlan(plan(next))}`] };
    }
    case "removeMoved": {
      if (!s.moved.some((m) => m.from === a.from)) return refuse(s, `There is no moved block from ${a.from}.`);
      const next = { ...s, moved: s.moved.filter((m) => m.from !== a.from) };
      return { state: next, events: [`Removed the moved block from ${a.from}. ${describePlan(plan(next))}`] };
    }
    case "outsideResize":
    case "outsideDelete": {
      const item = s.state.find((x) => x.address === a.address);
      if (!item || !s.real[item.id]) return refuse(s, `There is no real object for ${a.address}.`);
      const real = { ...s.real };
      if (a.type === "outsideDelete") delete real[item.id];
      else real[item.id] = { ...real[item.id]!, size: a.size };
      const next = { ...s, real };
      return { state: next, events: [`Someone ${a.type === "outsideDelete" ? `deleted ${item.id}` : `resized ${item.id} to ${a.size}`} by hand, outside Terraform. ${describePlan(plan(next))}`] };
    }
    case "apply": {
      const changes = plan(s);
      const next = apply(s);
      return { state: next, events: [`terraform apply: ${describePlan(changes).replace(/^Plan:/, "applied")} ${next.destroyed > s.destroyed ? `${next.destroyed - s.destroyed} real object(s) destroyed.` : "Nothing destroyed."}`] };
    }
  }
}

function init(p: PlanScenario): StepResult<PlanState> {
  const config = p.servers.map((x) => ({ ...x }));
  const state = p.servers.map((x, i) => ({ ...x, id: `srv-${i + 1}` }));
  const real: Record<string, ServerArgs> = Object.fromEntries(state.map((x) => [x.id, { name: x.name, size: x.size }]));
  for (const d of p.drift) {
    const item = state.find((x) => x.address === d.address);
    if (item) real[item.id] = { ...real[item.id]!, size: d.size };
  }
  const s: PlanState = { config, moved: [], state, real, nextId: state.length, destroyed: 0, applies: 0 };
  return { state: s, events: [`${config.length} server(s) applied earlier. ${describePlan(plan(s))}`] };
}

function describe(s: PlanState): string[] {
  return [
    `Configuration: ${s.config.map((c) => `${c.address} (name "${c.name}", size "${c.size}")`).join("; ") || "empty"}${s.moved.length ? `; moved blocks: ${s.moved.map((m) => `${m.from} → ${m.to}`).join(", ")}` : ""}.`,
    `State: ${s.state.map((x) => `${x.address} = ${x.id} (${x.name}, ${x.size})`).join("; ") || "empty"}.`,
    `Real world: ${Object.entries(s.real).map(([id, r]) => `${id} (${r.name}, ${r.size})`).join("; ") || "nothing"}.`,
    describePlan(plan(s)),
  ];
}

export const planDiff: SimulationModel<PlanState, PlanAction, PlanScenario> = {
  id: "terraform-plan-diff",
  track: "terraform",
  init,
  step,
  invariants: [
    { name: "every address appears at most once in the state", check: (s) => (new Set(s.state.map((x) => x.address)).size === s.state.length ? null : "duplicate address") },
    { name: "a plan's counts match its changes", check: (s) => { const c = plan(s); const n = summary(c); return n.add >= 0 && n.destroy >= 0 && c.length >= n.change ? null : "bad counts"; } },
  ],
  checks: {
    /** server.web was renamed to server.frontend and applied, with no real object ever destroyed. */
    "rename-no-destroy": (s, initial) => {
      const original = initial.state.find((x) => x.address === "server.web")?.id;
      return s.applies > 0 && s.destroyed === 0 && s.config.some((c) => c.address === "server.frontend") && s.state.find((x) => x.address === "server.frontend")?.id === original && plan(s).length === 0;
    },
    /** After drift, the real world matches the configuration again and the plan is empty. */
    "drift-fixed": (s) => s.applies > 0 && plan(s).length === 0 && s.destroyed === 0,
  },
  describe,
};
