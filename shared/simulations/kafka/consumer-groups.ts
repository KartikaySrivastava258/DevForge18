/**
 * Simulation: partitions and consumer groups (REMAINING_WORK.md §5.10).
 *
 * A topic with N partitions receives keyed events every tick; one consumer
 * group shares the partitions between its members and processes a fixed
 * number of events per member per tick. The learner adds or crashes members,
 * sends bursts, adds partitions and resets offsets, and watches assignment,
 * committed offsets and lag.
 *
 * Follows the Kafka documentation: the same key always goes to the same
 * partition (for a fixed partition count); each partition is consumed by
 * exactly one member of a group at a time; offsets are kept per group and
 * partition; reading does not delete events; offsets can be reset only while
 * the group has no members.
 *
 * Simplified (shown to learners): the key hash is a simple one, not Kafka's
 * murmur2, so keys land in different partitions than on a real broker;
 * partitions are dealt to members round-robin in joining order; rebalances
 * are instant; members process a fixed number of events per tick.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const KEYS = ["asha", "ravi", "meera", "nikhil", "zoya", "arjun"] as const;
export type Key = (typeof KEYS)[number];

export interface KafkaEvent {
  key: Key;
  /** Global sequence number of the event, to show order. */
  seq: number;
}

export interface Member {
  name: string;
}

export interface KafkaState {
  tick: number;
  partitions: KafkaEvent[][];
  /** Committed offset per partition for the group (next event to read). */
  committed: number[];
  members: Member[];
  /** Events each member can process per tick. */
  capacity: number;
  /** Keys produced every tick. */
  incoming: Key[];
  produced: number;
  joined: number;
  crashes: number;
  /** Per key, the partition its last event went to (to show that a partition change moves keys). */
  lastPartition: Partial<Record<Key, number>>;
}

export type KafkaAction =
  | { type: "tick"; count?: number | undefined }
  | { type: "addConsumer" }
  | { type: "crashConsumer"; name: string }
  | { type: "burst"; key: Key; count: number }
  | { type: "addPartitions"; count: number }
  | { type: "resetOffsets" };

export interface KafkaScenario {
  partitions: number;
  consumers: number;
  capacity: number;
  incoming: Key[];
  /** Ticks to run before the learner starts. */
  warmup: number;
}

/** A small deterministic string hash (Kafka itself uses murmur2). */
export function keyHash(key: string): number {
  let h = 0;
  for (const ch of key) h = (Math.imul(h, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}
export const partitionFor = (key: string, partitions: number) => keyHash(key) % partitions;

/** Partitions dealt to members round-robin in joining order: partition p goes to member p mod n. */
export function assignment(s: Pick<KafkaState, "members" | "partitions">): Map<string, number[]> {
  const map = new Map<string, number[]>(s.members.map((m) => [m.name, []]));
  if (!s.members.length) return map;
  s.partitions.forEach((_, p) => map.get(s.members[p % s.members.length]!.name)!.push(p));
  return map;
}

export const lagOf = (s: KafkaState, p: number) => (s.partitions[p]?.length ?? 0) - (s.committed[p] ?? 0);
export const totalLag = (s: KafkaState) => s.partitions.reduce((n, _, p) => n + lagOf(s, p), 0);

function produce(s: KafkaState, keys: Key[]): KafkaState {
  const partitions = s.partitions.map((log) => [...log]);
  const lastPartition = { ...s.lastPartition };
  let produced = s.produced;
  for (const key of keys) {
    const p = partitionFor(key, partitions.length);
    partitions[p]!.push({ key, seq: ++produced });
    lastPartition[key] = p;
  }
  return { ...s, partitions, produced, lastPartition };
}

function tickOnce(s0: KafkaState): { state: KafkaState; events: string[] } {
  let s = produce({ ...s0, tick: s0.tick + 1 }, s0.incoming);
  const committed = [...s.committed];
  const done: string[] = [];
  for (const [name, parts] of assignment(s)) {
    let budget = s.capacity;
    let read = 0;
    // Work through the member's partitions in turn, one event at a time.
    while (budget > 0 && parts.some((p) => (committed[p] ?? 0) < (s.partitions[p]?.length ?? 0))) {
      for (const p of parts) {
        if (budget > 0 && (committed[p] ?? 0) < (s.partitions[p]?.length ?? 0)) {
          committed[p] = (committed[p] ?? 0) + 1;
          budget--;
          read++;
        }
      }
    }
    if (read) done.push(`${name} ${read}`);
  }
  s = { ...s, committed };
  const lag = totalLag(s);
  return { state: s, events: [`Tick ${s.tick}: ${s0.incoming.length} new event(s); processed ${done.join(", ") || "nothing"}; total lag ${lag}.`] };
}

const refuse = (state: KafkaState, error: string): StepResult<KafkaState> => ({ state, events: [], error });
const describeAssignment = (s: KafkaState) =>
  [...assignment(s)].map(([name, parts]) => `${name}: ${parts.length ? parts.map((p) => `P${p}`).join(", ") : "no partitions"}`).join("; ");

function step(s: KafkaState, a: KafkaAction): StepResult<KafkaState> {
  switch (a.type) {
    case "tick": {
      let state = s;
      const events: string[] = [];
      for (let i = 0; i < (a.count ?? 1); i++) {
        const r = tickOnce(state);
        state = r.state;
        events.push(...r.events);
      }
      return { state, events };
    }
    case "addConsumer": {
      if (s.members.length >= 8) return refuse(s, "This simulation allows at most 8 members.");
      const next = { ...s, joined: s.joined + 1, members: [...s.members, { name: `consumer-${s.joined + 1}` }] };
      return { state: next, events: [`consumer-${s.joined + 1} joined; the group rebalanced. ${describeAssignment(next)}.`] };
    }
    case "crashConsumer": {
      if (!s.members.some((m) => m.name === a.name)) return refuse(s, `There is no member called ${a.name}.`);
      const next = { ...s, crashes: s.crashes + 1, members: s.members.filter((m) => m.name !== a.name) };
      return { state: next, events: [`${a.name} crashed; the group rebalanced. ${next.members.length ? describeAssignment(next) : "No members left: nothing is being read."}`] };
    }
    case "burst": {
      const next = produce(s, Array.from({ length: a.count }, () => a.key));
      return { state: next, events: [`${a.count} events with key ${a.key} went to partition ${partitionFor(a.key, s.partitions.length)}.`] };
    }
    case "addPartitions": {
      const partitions = [...s.partitions.map((log) => [...log]), ...Array.from({ length: a.count }, () => [] as KafkaEvent[])];
      if (partitions.length > 8) return refuse(s, "This simulation allows at most 8 partitions.");
      const next = { ...s, partitions, committed: [...s.committed, ...Array.from({ length: a.count }, () => 0)] };
      const moved = KEYS.filter((k) => s.lastPartition[k] !== undefined && partitionFor(k, partitions.length) !== s.lastPartition[k]);
      return {
        state: next,
        events: [`The topic now has ${partitions.length} partitions. ${describeAssignment(next)}.${moved.length ? ` New events for ${moved.join(", ")} will now go to a different partition than before, so their order across the change is no longer guaranteed.` : ""}`],
      };
    }
    case "resetOffsets":
      if (s.members.length) return refuse(s, `Offsets can only be reset while the group has no active members (it has ${s.members.length}).`);
      return { state: { ...s, committed: s.partitions.map(() => 0) }, events: [`Offsets reset to the earliest: the group will read all ${s.produced} events again.`] };
  }
}

function init(p: KafkaScenario): StepResult<KafkaState> {
  let s: KafkaState = {
    tick: 0,
    partitions: Array.from({ length: p.partitions }, () => []),
    committed: Array.from({ length: p.partitions }, () => 0),
    members: Array.from({ length: p.consumers }, (_, i) => ({ name: `consumer-${i + 1}` })),
    capacity: p.capacity,
    incoming: p.incoming,
    produced: 0,
    joined: p.consumers,
    crashes: 0,
    lastPartition: {},
  };
  for (let i = 0; i < p.warmup; i++) s = tickOnce(s).state;
  return { state: s, events: [`Scenario ready: ${p.partitions} partitions, ${p.consumers} member(s), total lag ${totalLag(s)}. ${describeAssignment(s)}.`] };
}

function describe(s: KafkaState): string[] {
  const owner = new Map<number, string>();
  for (const [name, parts] of assignment(s)) for (const p of parts) owner.set(p, name);
  return [
    `Tick ${s.tick}. Each tick the producer sends: ${s.incoming.join(", ") || "nothing"}. Each member processes up to ${s.capacity} events per tick.`,
    ...s.partitions.map((log, p) => `Partition ${p}: ${log.length} events, committed offset ${s.committed[p]}, lag ${lagOf(s, p)}, read by ${owner.get(p) ?? "nobody"}. Last keys: ${log.slice(-5).map((e) => e.key).join(", ") || "none"}.`),
    `Members: ${s.members.length ? describeAssignment(s) : "none"}. Total lag: ${totalLag(s)}.`,
  ];
}

export const consumerGroups: SimulationModel<KafkaState, KafkaAction, KafkaScenario> = {
  id: "kafka-consumer-groups",
  track: "kafka",
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : a.type === "burst" ? Math.ceil(a.count / 10) : 1),
  invariants: [
    {
      name: "each partition is assigned to exactly one member when the group has members",
      check: (s) => {
        if (!s.members.length) return null;
        const owners = new Map<number, number>();
        for (const parts of assignment(s).values()) for (const p of parts) owners.set(p, (owners.get(p) ?? 0) + 1);
        const bad = s.partitions.findIndex((_, p) => owners.get(p) !== 1);
        return bad >= 0 ? `partition ${bad} has ${owners.get(bad) ?? 0} owners` : null;
      },
    },
    {
      name: "committed offsets are between 0 and the end of the log",
      check: (s) => {
        const bad = s.partitions.findIndex((log, p) => (s.committed[p] ?? -1) < 0 || (s.committed[p] ?? 0) > log.length);
        return bad >= 0 ? `partition ${bad} has an impossible offset` : null;
      },
    },
    {
      name: "within a partition, events keep the order in which they were produced",
      check: (s) => {
        const bad = s.partitions.findIndex((log) => log.some((e, i) => i > 0 && e.seq <= (log[i - 1]?.seq ?? 0)));
        return bad >= 0 ? `partition ${bad} is out of order` : null;
      },
    },
  ],
  checks: {
    /** Lag drained to zero after time has passed. */
    "lag-to-zero": (s, initial) => s.tick > initial.tick && totalLag(s) === 0 && totalLag(initial) > 0,
    /** The group has more members than partitions, so at least one member is idle. */
    "idle-member": (s) => [...assignment(s).values()].some((parts) => parts.length === 0),
    /** A member crashed, and the remaining members have caught up. */
    "recover-from-crash": (s, initial) => s.crashes > initial.crashes && s.members.length > 0 && totalLag(s) === 0 && s.tick > initial.tick,
  },
  describe,
};
