/**
 * Simulation: the Kubernetes reconciliation loop (REMAINING_WORK.md §5.3).
 *
 * One Deployment ("web", label app=web), its ReplicaSets and Pods, and a few
 * nodes. Every tick runs, in order: the kubelet (containers start, images are
 * pulled), the Deployment controller (rolling updates within maxSurge and
 * maxUnavailable), the ReplicaSet controller (create or delete Pods to match
 * the desired count) and the scheduler (place Pending Pods on nodes).
 *
 * The rolling-update rules follow the Kubernetes Deployment documentation:
 * maxSurge rounds up, maxUnavailable rounds down, both may not be 0, old Pods
 * are removed only while available Pods stay at or above replicas − maxUnavailable,
 * and unhealthy old Pods are removed first.
 *
 * Simplified (and shown to learners): time moves in ticks; a Pod becomes
 * ready one tick after its container starts (there are no probes); image
 * pulls either work at once or fail forever; the scheduler only looks at how
 * many Pods each node runs; there is one container per Pod.
 */
import { z } from "zod/v4";
import type { SimulationModel, StepResult } from "../types.ts";

export const IMAGES = ["nginx:1.27-alpine", "nginx:1.28-alpine", "nginx:does-not-exist"] as const;
/** Images that exist in the simulated registry. */
const PULLABLE = new Set<string>(["nginx:1.27-alpine", "nginx:1.28-alpine"]);
const STRATEGY_VALUES = ["0", "1", "2", "25%", "50%"] as const;

export type Phase = "Pending" | "ContainerCreating" | "Running" | "ErrImagePull" | "ImagePullBackOff" | "Terminating";

export interface Pod {
  name: string;
  rs: string;
  image: string;
  node: string | null;
  phase: Phase;
  ready: boolean;
  /** Set once the "no node available" event has been logged for this Pod. */
  waitingNoted?: boolean;
}

export interface ReplicaSet {
  name: string;
  revision: number;
  image: string;
  replicas: number;
}

export interface Node {
  name: string;
  schedulable: boolean;
}

export interface K8sState {
  time: number;
  nodes: Node[];
  deployment: { replicas: number; image: string; maxSurge: string; maxUnavailable: string };
  replicaSets: ReplicaSet[];
  pods: Pod[];
  /** Counter for simulated Pod name suffixes. */
  created: number;
  /** Pods the learner deleted, for the self-healing challenge. */
  deletedByYou: number;
  /** The current rollout: lowest number of available Pods seen since it began. */
  rollout: { image: string; minAvailable: number; disrupted: boolean; done: boolean } | null;
}

const strategyValue = z.enum(STRATEGY_VALUES);
export const K8sActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("deletePod"), pod: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal("drainNode"), node: z.string().min(1).max(20) }).strict(),
  z.object({ type: z.literal("uncordonNode"), node: z.string().min(1).max(20) }).strict(),
  z.object({ type: z.literal("scale"), replicas: z.number().int().min(0).max(10) }).strict(),
  z.object({ type: z.literal("setImage"), image: z.enum(IMAGES) }).strict(),
  z.object({ type: z.literal("setStrategy"), maxSurge: strategyValue, maxUnavailable: strategyValue }).strict(),
  z.object({ type: z.literal("undo") }).strict(),
]);
export type K8sAction = z.infer<typeof K8sActionSchema>;

export const K8sScenarioSchema = z
  .object({
    nodes: z.number().int().min(1).max(4),
    replicas: z.number().int().min(1).max(8),
    image: z.enum(IMAGES).default("nginx:1.27-alpine"),
    maxSurge: strategyValue.default("25%"),
    maxUnavailable: strategyValue.default("25%"),
    /** Actions applied after the Deployment has settled (for example, a broken release). */
    setup: z.array(K8sActionSchema).max(20).default([]),
  })
  .strict();
export type K8sScenario = z.infer<typeof K8sScenarioSchema>;

/** The kubectl command for an action, shown next to the controls and in the log. */
export function kubectlCommand(a: K8sAction): string {
  switch (a.type) {
    case "tick":
      return "(time passes)";
    case "deletePod":
      return `kubectl delete pod ${a.pod}`;
    case "drainNode":
      return `kubectl drain ${a.node} --ignore-daemonsets`;
    case "uncordonNode":
      return `kubectl uncordon ${a.node}`;
    case "scale":
      return `kubectl scale deployment/web --replicas=${a.replicas}`;
    case "setImage":
      return `kubectl set image deployment/web nginx=${a.image}`;
    case "setStrategy":
      return `kubectl patch deployment web -p '{"spec":{"strategy":{"rollingUpdate":{"maxSurge":"${a.maxSurge}","maxUnavailable":"${a.maxUnavailable}"}}}}'`;
    case "undo":
      return "kubectl rollout undo deployment/web";
  }
}

/** maxSurge rounds up and maxUnavailable rounds down; if both come to 0, one Pod may be unavailable. */
export function resolveStrategy(d: K8sState["deployment"]): { surge: number; unavailable: number } {
  const amount = (v: string, roundUp: boolean) => {
    if (!v.endsWith("%")) return Number(v);
    const exact = (d.replicas * Number(v.slice(0, -1))) / 100;
    return roundUp ? Math.ceil(exact) : Math.floor(exact);
  };
  const surge = amount(d.maxSurge, true);
  const unavailable = amount(d.maxUnavailable, false);
  return { surge, unavailable: surge === 0 && unavailable === 0 ? 1 : unavailable };
}

function hash(text: string, length: number): string {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const alphabet = "bcdfghjklmnpqrstvwxz2456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length) + Math.imul(i + 7, 2654435761) >>> 0;
  }
  return out;
}

const live = (p: Pod) => p.phase !== "Terminating";
export const available = (s: K8sState) => s.pods.filter((p) => live(p) && p.ready).length;
const podsOf = (s: K8sState, rs: string) => s.pods.filter((p) => p.rs === rs && live(p));
const currentRs = (s: K8sState) => s.replicaSets.find((r) => r.image === s.deployment.image);

/** True when every desired Pod runs the Deployment's image and is ready, and no old Pods remain. */
export function rolloutComplete(s: K8sState): boolean {
  const pods = s.pods.filter(live);
  return pods.length === s.deployment.replicas && pods.every((p) => p.ready && p.image === s.deployment.image) && s.pods.every(live);
}

function tickOnce(input: K8sState): { state: K8sState; events: string[] } {
  const events: string[] = [];
  let s: K8sState = { ...input, time: input.time + 1, pods: input.pods.map((p) => ({ ...p })), replicaSets: input.replicaSets.map((r) => ({ ...r })) };

  // 1. Kubelet: containers start or fail; Pods being deleted disappear.
  const gone = s.pods.filter((p) => !live(p));
  if (gone.length) events.push(`${gone.map((p) => p.name).join(", ")} ${gone.length === 1 ? "has" : "have"} shut down and ${gone.length === 1 ? "is" : "are"} gone.`);
  s.pods = s.pods.filter(live);
  for (const p of s.pods) {
    if (!p.node) continue;
    if (p.phase === "Pending") {
      if (PULLABLE.has(p.image)) p.phase = "ContainerCreating";
      else {
        p.phase = "ErrImagePull";
        events.push(`Kubelet on ${p.node} cannot pull ${p.image} for ${p.name}: ErrImagePull. The Pod will never become ready.`);
      }
    } else if (p.phase === "ContainerCreating") {
      p.phase = "Running";
      p.ready = true;
      events.push(`${p.name} is Running and ready; the Service can send it traffic.`);
    } else if (p.phase === "ErrImagePull") {
      p.phase = "ImagePullBackOff";
    }
  }

  // 2. Deployment controller.
  const d = s.deployment;
  let rs = s.replicaSets.find((r) => r.image === d.image);
  const maxRevision = Math.max(0, ...s.replicaSets.map((r) => r.revision));
  if (!rs) {
    rs = { name: `web-${hash(d.image, 9)}`, revision: maxRevision + 1, image: d.image, replicas: 0 };
    s.replicaSets.push(rs);
    events.push(`Deployment controller: the Pod template changed to ${d.image}, so it created ReplicaSet ${rs.name} (revision ${rs.revision}).`);
  } else if (rs.revision !== maxRevision) {
    rs.revision = maxRevision + 1;
    events.push(`Deployment controller: ${d.image} matches the existing ReplicaSet ${rs.name}, which becomes revision ${rs.revision}.`);
  }
  const newRs = rs;
  const old = s.replicaSets.filter((r) => r !== newRs).sort((a, b) => a.revision - b.revision);
  const { surge, unavailable } = resolveStrategy(d);
  const desiredTotal = () => s.replicaSets.reduce((n, r) => n + r.replicas, 0);
  if (old.every((r) => r.replicas === 0)) {
    if (newRs.replicas !== d.replicas) {
      events.push(`Deployment controller: ReplicaSet ${newRs.name} should have ${d.replicas} Pod(s), not ${newRs.replicas}.`);
      newRs.replicas = d.replicas;
    }
  } else {
    // Scale the new ReplicaSet up, staying within replicas + maxSurge Pods in total.
    const room = Math.min(d.replicas + surge - desiredTotal(), d.replicas - newRs.replicas);
    if (room > 0) {
      newRs.replicas += room;
      events.push(`Deployment controller: rolling update — ${newRs.name} scaled up to ${newRs.replicas} (maxSurge allows ${d.replicas + surge} Pods in total).`);
    }
    // Scale old ReplicaSets down: unhealthy Pods first, then healthy ones while availability allows.
    const minAvailable = d.replicas - unavailable;
    const newUnavailable = newRs.replicas - podsOf(s, newRs.name).filter((p) => p.ready).length;
    let budget = desiredTotal() - minAvailable - newUnavailable;
    for (const r of old) {
      const unhealthy = podsOf(s, r.name).filter((p) => !p.ready).length;
      const cut = Math.min(unhealthy, r.replicas, Math.max(0, budget));
      if (cut > 0) {
        r.replicas -= cut;
        budget -= cut;
        events.push(`Deployment controller: removed ${cut} unready old Pod(s) from ${r.name}.`);
      }
    }
    let excess = available(s) - minAvailable;
    for (const r of old) {
      const cut = Math.min(r.replicas, Math.max(0, excess));
      if (cut > 0) {
        r.replicas -= cut;
        excess -= cut;
        events.push(`Deployment controller: scaled old ReplicaSet ${r.name} down to ${r.replicas}, keeping at least ${minAvailable} Pod(s) available (replicas − maxUnavailable).`);
      }
    }
  }

  // 3. ReplicaSet controller: match each ReplicaSet's Pods to its desired count.
  for (const r of s.replicaSets) {
    const pods = podsOf(s, r.name);
    if (pods.length > r.replicas) {
      const rank = (p: Pod) => (p.node ? 1 : 0) * 4 + (p.ready ? 2 : 0);
      const victims = [...pods].sort((a, b) => rank(a) - rank(b) || s.pods.indexOf(b) - s.pods.indexOf(a)).slice(0, pods.length - r.replicas);
      for (const v of victims) {
        v.phase = "Terminating";
        v.ready = false;
      }
      events.push(`ReplicaSet ${r.name} has ${pods.length} Pod(s) but wants ${r.replicas}: deleting ${victims.map((v) => v.name).join(", ")}.`);
    } else if (pods.length < r.replicas) {
      const names: string[] = [];
      for (let i = pods.length; i < r.replicas; i++) {
        const name = `${r.name}-${hash(`${r.name}#${s.created}`, 5)}`;
        s = { ...s, created: s.created + 1 };
        s.pods.push({ name, rs: r.name, image: r.image, node: null, phase: "Pending", ready: false });
        names.push(name);
      }
      events.push(`ReplicaSet ${r.name} has ${pods.length} Pod(s) but wants ${r.replicas}: created ${names.join(", ")}.`);
    }
  }

  // 4. Scheduler: place each unscheduled Pod on the schedulable node running the fewest Pods.
  for (const p of s.pods) {
    if (p.node || !live(p)) continue;
    const candidates = s.nodes.filter((n) => n.schedulable);
    if (!candidates.length) {
      if (!p.waitingNoted) events.push(`Scheduler: no schedulable node for ${p.name}; it stays Pending.`);
      p.waitingNoted = true;
      continue;
    }
    const load = (n: Node) => s.pods.filter((q) => q.node === n.name && live(q)).length;
    const node = [...candidates].sort((a, b) => load(a) - load(b) || a.name.localeCompare(b.name))[0];
    p.node = node?.name ?? null;
    events.push(`Scheduler: ${p.name} → ${p.node}.`);
  }

  // Track the rollout: the lowest availability seen, and completion.
  if (s.rollout && !s.rollout.done) {
    const done = rolloutComplete(s);
    s = { ...s, rollout: { ...s.rollout, minAvailable: Math.min(s.rollout.minAvailable, available(s)), done } };
    if (done) events.push(`Rollout of ${s.deployment.image} is complete: ${s.deployment.replicas} of ${s.deployment.replicas} Pods updated and ready.`);
  }
  return { state: s, events };
}

const refuse = (state: K8sState, error: string): StepResult<K8sState> => ({ state, events: [], error });

function startRollout(s: K8sState, image: string): K8sState {
  return { ...s, deployment: { ...s.deployment, image }, rollout: { image, minAvailable: available(s), disrupted: false, done: false } };
}
const disrupt = (s: K8sState): K8sState => (s.rollout && !s.rollout.done ? { ...s, rollout: { ...s.rollout, disrupted: true } } : s);

function step(state: K8sState, action: K8sAction): StepResult<K8sState> {
  switch (action.type) {
    case "tick": {
      let s = state;
      const events: string[] = [];
      for (let i = 0; i < (action.count ?? 1); i++) {
        const r = tickOnce(s);
        s = r.state;
        events.push(...r.events);
      }
      return { state: s, events };
    }
    case "deletePod": {
      const pod = state.pods.find((p) => p.name === action.pod && live(p));
      if (!pod) return refuse(state, `There is no running Pod called ${action.pod}.`);
      const s = disrupt({ ...state, deletedByYou: state.deletedByYou + 1, pods: state.pods.map((p) => (p === pod ? { ...p, phase: "Terminating" as const, ready: false } : p)) });
      return { state: { ...s, rollout: s.rollout && !s.rollout.done ? { ...s.rollout, minAvailable: Math.min(s.rollout.minAvailable, available(s)) } : s.rollout }, events: [`You deleted ${pod.name}. It stops serving at once; its ReplicaSet will notice it is a Pod short.`] };
    }
    case "drainNode": {
      const node = state.nodes.find((n) => n.name === action.node);
      if (!node) return refuse(state, `There is no node called ${action.node}.`);
      if (!node.schedulable) return refuse(state, `${node.name} is already cordoned.`);
      const evicted = state.pods.filter((p) => p.node === node.name && live(p));
      const s = disrupt({
        ...state,
        nodes: state.nodes.map((n) => (n === node ? { ...n, schedulable: false } : n)),
        pods: state.pods.map((p) => (evicted.includes(p) ? { ...p, phase: "Terminating" as const, ready: false } : p)),
      });
      return { state: s, events: [`${node.name} is cordoned (no new Pods) and drained: ${evicted.length ? `evicting ${evicted.map((p) => p.name).join(", ")}` : "it had no Pods"}. Their ReplicaSets will recreate them on other nodes.`] };
    }
    case "uncordonNode": {
      const node = state.nodes.find((n) => n.name === action.node);
      if (!node) return refuse(state, `There is no node called ${action.node}.`);
      if (node.schedulable) return refuse(state, `${node.name} is not cordoned.`);
      return { state: { ...state, nodes: state.nodes.map((n) => (n === node ? { ...n, schedulable: true } : n)) }, events: [`${node.name} accepts new Pods again. Existing Pods are not moved back automatically.`] };
    }
    case "scale": {
      if (action.replicas === state.deployment.replicas) return refuse(state, `The Deployment already wants ${action.replicas} replica(s).`);
      const s = disrupt({ ...state, deployment: { ...state.deployment, replicas: action.replicas } });
      return { state: s, events: [`Desired replicas changed from ${state.deployment.replicas} to ${action.replicas}. The controllers will make it so.`] };
    }
    case "setImage": {
      if (action.image === state.deployment.image) return refuse(state, `The Deployment already uses ${action.image}.`);
      return { state: startRollout(state, action.image), events: [`The Pod template now uses ${action.image}. A rolling update begins.`] };
    }
    case "setStrategy": {
      const isZero = (v: string) => v === "0" || v === "0%";
      if (isZero(action.maxSurge) && isZero(action.maxUnavailable)) return refuse(state, "maxSurge and maxUnavailable cannot both be 0: the rollout could never make progress.");
      const s = disrupt({ ...state, deployment: { ...state.deployment, maxSurge: action.maxSurge, maxUnavailable: action.maxUnavailable } });
      const { surge, unavailable } = resolveStrategy(s.deployment);
      return { state: s, events: [`Rolling-update strategy: maxSurge ${action.maxSurge} (= ${surge} extra Pod(s)), maxUnavailable ${action.maxUnavailable} (= ${unavailable} Pod(s) may be unavailable) for ${s.deployment.replicas} replicas.`] };
    }
    case "undo": {
      const current = currentRs(state);
      const previous = state.replicaSets.filter((r) => r !== current && r.revision < (current?.revision ?? Infinity)).sort((a, b) => b.revision - a.revision)[0];
      if (!previous) return refuse(state, "There is no previous revision to roll back to.");
      return { state: startRollout(state, previous.image), events: [`Rolling back to the previous revision: the Pod template returns to ${previous.image} (ReplicaSet ${previous.name}).`] };
    }
  }
}

function init(params: K8sScenario): StepResult<K8sState> {
  let s: K8sState = {
    time: 0,
    nodes: Array.from({ length: params.nodes }, (_, i) => ({ name: `node-${i + 1}`, schedulable: true })),
    deployment: { replicas: params.replicas, image: params.image, maxSurge: params.maxSurge, maxUnavailable: params.maxUnavailable },
    replicaSets: [],
    pods: [],
    created: 0,
    deletedByYou: 0,
    rollout: null,
  };
  // Let the cluster settle so the scenario starts from a steady state.
  for (let i = 0; i < 20 && !(rolloutComplete(s) && s.replicaSets.length); i++) s = tickOnce(s).state;
  for (const action of params.setup) {
    const r = step(s, action);
    if (r.error) return r;
    s = r.state;
  }
  return { state: { ...s, time: 0, deletedByYou: 0 }, events: [`Scenario ready: ${params.nodes} node(s), Deployment web wants ${s.deployment.replicas} replica(s) of ${s.deployment.image}.`] };
}

function describe(s: K8sState): string[] {
  const { surge, unavailable } = resolveStrategy(s.deployment);
  const lines = [
    `Time: tick ${s.time}.`,
    `Deployment web wants ${s.deployment.replicas} replica(s) of ${s.deployment.image}; ${available(s)} Pod(s) are available. Strategy: up to ${surge} extra and ${unavailable} unavailable during an update.`,
  ];
  for (const r of [...s.replicaSets].sort((a, b) => b.revision - a.revision)) {
    lines.push(`ReplicaSet ${r.name} (revision ${r.revision}, ${r.image}) wants ${r.replicas} Pod(s).`);
  }
  for (const n of s.nodes) {
    const pods = s.pods.filter((p) => p.node === n.name);
    lines.push(`Node ${n.name}${n.schedulable ? "" : " (cordoned)"}: ${pods.length ? pods.map((p) => `${p.name} ${p.phase}${p.ready ? ", ready" : ""}`).join("; ") : "no Pods"}.`);
  }
  const pending = s.pods.filter((p) => !p.node);
  if (pending.length) lines.push(`Not yet scheduled: ${pending.map((p) => p.name).join(", ")}.`);
  return lines;
}

export const reconciliation: SimulationModel<K8sState, K8sAction, K8sScenario> = {
  id: "kubernetes-reconciliation",
  track: "kubernetes",
  scenarioSchema: K8sScenarioSchema,
  actionSchema: K8sActionSchema,
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : 1),
  invariants: [
    {
      name: "every Pod belongs to a ReplicaSet and runs on a node that exists",
      check: (s) => {
        const bad = s.pods.find((p) => !s.replicaSets.some((r) => r.name === p.rs) || (p.node !== null && !s.nodes.some((n) => n.name === p.node)));
        return bad ? `${bad.name} has an unknown ReplicaSet or node` : null;
      },
    },
    {
      name: "only Running Pods are ready",
      check: (s) => {
        const bad = s.pods.find((p) => p.ready && p.phase !== "Running");
        return bad ? `${bad.name} is ready in phase ${bad.phase}` : null;
      },
    },
    {
      // Only rolling updates are bound by maxSurge: right after a manual scale-down the
      // ReplicaSets still want the old count until the controller's next pass, as in Kubernetes.
      name: "a rolling update without manual changes never wants more than replicas + maxSurge Pods",
      check: (s) => {
        if (s.replicaSets.some((r) => r.replicas < 0)) return "a ReplicaSet wants a negative number of Pods";
        if (!s.rollout || s.rollout.disrupted || s.rollout.done) return null;
        const total = s.replicaSets.reduce((n, r) => n + r.replicas, 0);
        const limit = s.deployment.replicas + resolveStrategy(s.deployment).surge;
        return total > limit ? `${total} Pods wanted, limit ${limit}` : null;
      },
    },
    {
      name: "a rolling update without manual disruption keeps at least replicas − maxUnavailable Pods available",
      check: (s) => {
        if (!s.rollout || s.rollout.disrupted) return null;
        const min = s.deployment.replicas - resolveStrategy(s.deployment).unavailable;
        return s.rollout.minAvailable < min ? `availability fell to ${s.rollout.minAvailable}, below ${min}` : null;
      },
    },
  ],
  checks: {
    /** Delete a Pod and let the Deployment replace it. */
    "replace-deleted-pod": (s) => s.deletedByYou > 0 && rolloutComplete(s),
    /** Update to nginx:1.28-alpine with at least 4 of 5 Pods available throughout. */
    "update-keeping-four-available": (s) =>
      s.deployment.image === "nginx:1.28-alpine" && s.deployment.replicas === 5 && rolloutComplete(s) && (s.rollout?.minAvailable ?? 0) >= 4,
    /** Back on a working image with every Pod ready. */
    "recover-from-broken-image": (s) => PULLABLE.has(s.deployment.image) && rolloutComplete(s),
  },
  describe,
};
