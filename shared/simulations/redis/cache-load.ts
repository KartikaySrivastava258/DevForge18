/**
 * Simulation: a cache under load (REMAINING_WORK.md §5.9).
 *
 * Requests arrive every second — a steady load, then a spike. Most ask for
 * one hot key, the rest spread over 40 others. With cache-aside, a hit is
 * served from Redis and a miss goes to the database, which then fills the
 * cache with a TTL. When the hot key expires during the spike, every
 * request for it in that second misses at once and hits the database: a
 * cache stampede. "Single flight" lets one request refill the key while
 * the others wait for it.
 *
 * Follows the cache-aside pattern taught in the Redis track (read from the
 * cache, on a miss read the database and store the result with a TTL).
 *
 * Memory (optional): maxmemory is counted in keys. As Redis does, memory
 * is checked before each command; while more keys are stored than the
 * limit, the eviction policy removes keys (allkeys-lru, volatile-lru,
 * allkeys-lfu). With noeviction — or volatile-lru when no key has a TTL —
 * nothing can be evicted, so writes are refused with an OOM error while
 * reads still work (redis.io "Key eviction"; the same command sequences
 * are compared with a real Redis in cache-load.test.ts). User sessions
 * without a TTL can share the instance with the cache: they are not in
 * the database, so evicting one signs a user out.
 *
 * Simplified (shown to learners): time moves in whole seconds; every
 * request within a second arrives at once (one GET per key, and one SET
 * on a miss); the database answers within the second; traffic is fixed,
 * not random; every key takes the same memory; expired keys free their
 * memory at once; LRU and LFU are exact, where Redis samples a few keys
 * and keeps a probabilistic, decaying LFU counter.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const DURATION = 60;
export const OTHER_KEYS = 40;
export const HOT_SHARE = 0.6;
/** Requests per second at time t: 100, with a spike to 400 from second 20 to 39. */
export const traffic = (t: number) => (t >= 20 && t < 40 ? 400 : 100);

export const POLICIES = ["noeviction", "allkeys-lru", "volatile-lru", "allkeys-lfu"] as const;
export type Policy = (typeof POLICIES)[number];

export interface CacheState {
  t: number;
  cacheOn: boolean;
  ttl: number;
  singleFlight: boolean;
  /** Second at which each cached key expires (absent = not cached). */
  expires: Record<string, number>;
  /** Keys stored without a TTL (user sessions; not in the database). */
  sessions: string[];
  /** Database queries per second so far. */
  dbLoad: number[];
  hits: number;
  misses: number;
  limit: number;
  /** maxmemory, in keys (null: no limit, Redis's default on 64-bit systems). */
  maxKeys: number | null;
  policy: Policy;
  /** A user signs in (a new session key) every this many seconds (null: never). */
  sessionEvery: number | null;
  /** Last access (a logical clock) and number of accesses of each stored key, for LRU and LFU. */
  lastUsed: Record<string, number>;
  uses: Record<string, number>;
  clock: number;
  nextSession: number;
  evicted: number;
  sessionsLost: number;
  oom: number;
}

export type CacheAction =
  | { type: "tick"; count?: number | undefined }
  | { type: "setCache"; on: boolean }
  | { type: "setTtl"; seconds: number }
  | { type: "setSingleFlight"; on: boolean }
  | { type: "setPolicy"; policy: Policy }
  | { type: "setMaxKeys"; keys: number | null };

export interface CacheScenario {
  cacheOn: boolean;
  ttl: number;
  singleFlight: boolean;
  limit: number;
  /** The hot key starts cached, expiring at this second (to time a stampede). */
  hotExpiresAt: number | null;
  maxKeys: number | null;
  policy: Policy;
  /** Session keys (no TTL) stored before the traffic starts. */
  sessions: number;
  sessionEvery: number | null;
}

export const keyCount = (s: Pick<CacheState, "expires" | "sessions">) => Object.keys(s.expires).length + s.sessions.length;
export const isSession = (key: string) => key.startsWith("session:");

/** The key the policy evicts next, or null when it has none it may evict (then writes are refused). */
export function victim(s: Pick<CacheState, "policy" | "sessions" | "expires" | "lastUsed" | "uses">): string | null {
  if (s.policy === "noeviction") return null;
  const candidates = [...(s.policy === "volatile-lru" ? [] : s.sessions), ...Object.keys(s.expires)];
  if (!candidates.length) return null;
  const lru = (a: string, b: string) => (s.lastUsed[a] ?? 0) - (s.lastUsed[b] ?? 0) || (a < b ? -1 : 1);
  const order = s.policy === "allkeys-lfu" ? (a: string, b: string) => (s.uses[a] ?? 0) - (s.uses[b] ?? 0) || lru(a, b) : lru;
  return [...candidates].sort(order)[0]!;
}

function removeKey(s: CacheState, key: string) {
  delete s.expires[key];
  s.sessions = s.sessions.filter((k) => k !== key);
  delete s.lastUsed[key];
  delete s.uses[key];
}

function touch(s: CacheState, key: string, n: number) {
  s.lastUsed[key] = ++s.clock;
  s.uses[key] = (s.uses[key] ?? 0) + n;
}

/** Before every command: while more keys are stored than maxmemory allows, evict. Returns false when a write is refused (OOM). */
function beforeCommand(s: CacheState, write: boolean, evicted: string[]): boolean {
  if (s.maxKeys === null) return true;
  while (keyCount(s) > s.maxKeys) {
    const v = victim(s);
    if (v === null) break;
    removeKey(s, v);
    s.evicted++;
    if (isSession(v)) s.sessionsLost++;
    evicted.push(v);
  }
  if (write && keyCount(s) > s.maxKeys) {
    s.oom++;
    return false;
  }
  return true;
}

export type RedisCommand = { op: "GET"; key: string; requests?: number } | { op: "SET"; key: string; expiresAt: number | null };

/**
 * One Redis command against the model's memory (mutates `s`): first the memory check every command gets,
 * then the command. GET reports whether the key was there; SET stores a key with an expiry second, or
 * none (a key without a TTL), unless it is refused with OOM. Evicted keys are appended to `evicted`.
 */
export function redisCommand(s: CacheState, cmd: RedisCommand, evicted: string[] = []): "hit" | "miss" | "OK" | "OOM" {
  if (cmd.op === "GET") {
    beforeCommand(s, false, evicted);
    const present = s.expires[cmd.key] !== undefined || s.sessions.includes(cmd.key);
    if (present) touch(s, cmd.key, cmd.requests ?? 1);
    return present ? "hit" : "miss";
  }
  if (!beforeCommand(s, true, evicted)) return "OOM";
  const existed = s.expires[cmd.key] !== undefined || s.sessions.includes(cmd.key);
  if (cmd.expiresAt === null) {
    delete s.expires[cmd.key];
    if (!s.sessions.includes(cmd.key)) s.sessions.push(cmd.key);
  } else {
    s.sessions = s.sessions.filter((k) => k !== cmd.key);
    s.expires[cmd.key] = cmd.expiresAt;
  }
  if (!existed) s.uses[cmd.key] = 0;
  touch(s, cmd.key, 0);
  return "OK";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function second(prev: CacheState): { state: CacheState; event: string } {
  const t = prev.t;
  const total = traffic(t);
  const hot = Math.round(total * HOT_SHARE);
  const perOther = (total - hot) / OTHER_KEYS;
  const s: CacheState = { ...prev, expires: { ...prev.expires }, sessions: [...prev.sessions], lastUsed: { ...prev.lastUsed }, uses: { ...prev.uses } };
  const evicted: string[] = [];
  const oomBefore = s.oom;
  let signIn = "";
  // Keys whose TTL has run out are gone, and their memory is free.
  for (const [key, at] of Object.entries(s.expires)) if (at <= t) removeKey(s, key);
  if (s.sessionEvery !== null && t > 0 && t % s.sessionEvery === 0) {
    const key = `session:${s.nextSession++}`;
    if (redisCommand(s, { op: "SET", key, expiresAt: null }, evicted) === "OK") signIn = ` A user signed in: SET ${key} (no TTL).`;
    else signIn = ` A user could not sign in: SET ${key} was refused (OOM).`;
  }
  let db = 0;
  let hits = 0;
  let misses = 0;
  let hotMissed = false;
  const serve = (key: string, n: number) => {
    if (!s.cacheOn) {
      db += n;
      misses += n;
      return;
    }
    if (redisCommand(s, { op: "GET", key, requests: n }, evicted) === "hit") {
      hits += n;
      return;
    }
    // A miss: every request for the key this second goes to the database — unless single flight lets one go and the rest wait.
    if (key === "hot") hotMissed = true;
    db += s.singleFlight ? 1 : n;
    misses += n;
    redisCommand(s, { op: "SET", key, expiresAt: t + s.ttl }, evicted); // SET key value EX ttl (refused with OOM when memory is full)
  };
  serve("hot", hot);
  for (let k = 0; k < OTHER_KEYS; k++) {
    // The hot key's requests are spread over the whole second, so for LRU it is used again between any two other keys.
    if (s.expires.hot !== undefined) s.lastUsed.hot = ++s.clock;
    serve(`key:${k}`, perOther);
  }
  db = Math.round(db);
  const next: CacheState = { ...s, t: t + 1, dbLoad: [...s.dbLoad, db], hits: s.hits + hits, misses: s.misses + Math.round(misses) };
  const lost = evicted.filter(isSession).length;
  const refused = s.oom - oomBefore;
  const memory =
    (evicted.length ? ` Evicted ${plural(evicted.length, "key")} (${s.policy})${lost ? `, including ${plural(lost, "session")}: those users are signed out` : ""}.` : "") +
    (refused ? ` ${plural(refused, "write")} refused: OOM command not allowed when used memory > 'maxmemory'.` : "");
  return {
    state: next,
    event: `Second ${t}: ${total} requests, ${db} database queries${db > s.limit ? ` — over the limit of ${s.limit}` : ""}.${hotMissed && !s.singleFlight ? ` The hot key was not cached: ${hot} requests for it went to the database at once.` : ""}${signIn}${memory}`,
  };
}

const refuse = (state: CacheState, error: string): StepResult<CacheState> => ({ state, events: [], error });
const NOT_STARTED = "Change settings before the traffic starts (press Reset).";

export const POLICY_NOTES: Record<Policy, string> = {
  noeviction: "when memory is full, no key is evicted and writes are refused with an OOM error; reads still work.",
  "allkeys-lru": "when memory is full, evict the least recently used key, with or without a TTL.",
  "volatile-lru": "when memory is full, evict the least recently used key that has a TTL; if no key has one, behave like noeviction.",
  "allkeys-lfu": "when memory is full, evict the least frequently used key, with or without a TTL.",
};

function step(s: CacheState, a: CacheAction): StepResult<CacheState> {
  switch (a.type) {
    case "tick": {
      let state = s;
      const events: string[] = [];
      for (let i = 0; i < (a.count ?? 1); i++) {
        if (state.t >= DURATION) return i === 0 ? refuse(s, "The minute is over.") : { state, events };
        const r = second(state);
        state = r.state;
        events.push(r.event);
      }
      return { state, events };
    }
    case "setCache":
      if (s.t > 0) return refuse(s, NOT_STARTED);
      return { state: { ...s, cacheOn: a.on }, events: [a.on ? "Cache-aside is on: reads try Redis first." : "Cache is off: every read goes to the database."] };
    case "setTtl":
      if (s.t > 0) return refuse(s, NOT_STARTED);
      if (a.seconds < 1 || a.seconds > 120) return refuse(s, "TTL must be 1 to 120 seconds.");
      return { state: { ...s, ttl: a.seconds }, events: [`Keys are cached for ${a.seconds} s.`] };
    case "setSingleFlight":
      if (s.t > 0) return refuse(s, NOT_STARTED);
      return { state: { ...s, singleFlight: a.on }, events: [a.on ? "Single flight is on: on a miss, one request refills the key and the others wait for it." : "Single flight is off: every request that misses queries the database."] };
    case "setPolicy":
      if (s.t > 0) return refuse(s, NOT_STARTED);
      return { state: { ...s, policy: a.policy }, events: [`CONFIG SET maxmemory-policy ${a.policy}: ${POLICY_NOTES[a.policy]}`] };
    case "setMaxKeys":
      if (s.t > 0) return refuse(s, NOT_STARTED);
      if (a.keys !== null && (a.keys < 5 || a.keys > 100)) return refuse(s, "The memory limit must be 5 to 100 keys, or none.");
      return { state: { ...s, maxKeys: a.keys }, events: [a.keys === null ? "No memory limit (maxmemory 0): nothing is ever evicted." : `maxmemory now has room for ${a.keys} keys.`] };
  }
}

function init(p: CacheScenario): StepResult<CacheState> {
  const state: CacheState = {
    t: 0, cacheOn: p.cacheOn, ttl: p.ttl, singleFlight: p.singleFlight, expires: {}, sessions: [], dbLoad: [], hits: 0, misses: 0, limit: p.limit,
    maxKeys: p.maxKeys, policy: p.policy, sessionEvery: p.sessionEvery, lastUsed: {}, uses: {}, clock: 0, nextSession: p.sessions, evicted: 0, sessionsLost: 0, oom: 0,
  };
  for (let i = 0; i < p.sessions; i++) {
    state.sessions.push(`session:${i}`);
    touch(state, `session:${i}`, 0);
  }
  if (p.hotExpiresAt !== null) {
    state.expires.hot = p.hotExpiresAt;
    touch(state, "hot", 0);
    for (let k = 0; k < OTHER_KEYS; k++) {
      state.expires[`key:${k}`] = p.hotExpiresAt + 7 + (k % 5);
      touch(state, `key:${k}`, 0);
    }
  }
  const memory =
    p.maxKeys === null && !p.sessions
      ? ""
      : ` Redis has ${p.maxKeys === null ? "no memory limit" : `room for ${p.maxKeys} keys`} (maxmemory-policy ${p.policy}) and holds ${plural(p.sessions, "user session")} without a TTL${p.sessionEvery ? `; a user signs in every ${p.sessionEvery} seconds` : ""}.`;
  return { state, events: [`A minute of traffic: 100 requests a second, 400 from second 20 to 39; ${Math.round(HOT_SHARE * 100)} % ask for one hot key. The database copes with ${p.limit} queries a second.${memory}`] };
}

export const peak = (s: Pick<CacheState, "dbLoad">) => Math.max(0, ...s.dbLoad);
export const hitRatio = (s: Pick<CacheState, "hits" | "misses">) => (s.hits + s.misses ? s.hits / (s.hits + s.misses) : 0);
const memoryMatters = (s: CacheState) => s.maxKeys !== null || s.sessions.length > 0 || s.sessionEvery !== null || s.sessionsLost > 0;

function describe(s: CacheState): string[] {
  return [
    `Second ${s.t} of ${DURATION}. Cache ${s.cacheOn ? "on" : "off"}, TTL ${s.ttl} s, single flight ${s.singleFlight ? "on" : "off"}. Database limit ${s.limit} queries a second.`,
    `Hit ratio so far: ${(hitRatio(s) * 100).toFixed(1)} %. Peak database load: ${peak(s)} queries a second.`,
    `Database queries per second: ${s.dbLoad.join(", ") || "none yet"}.`,
    ...(memoryMatters(s)
      ? [
          `Memory: ${keyCount(s)} keys stored, ${s.maxKeys === null ? "no limit" : `room for ${s.maxKeys}`}; maxmemory-policy ${s.policy}. Sessions: ${s.sessions.length} stored, ${s.sessionsLost} evicted (users signed out). Keys evicted: ${s.evicted}. Writes refused with OOM: ${s.oom}.`,
        ]
      : []),
  ];
}

export const cacheLoad: SimulationModel<CacheState, CacheAction, CacheScenario> = {
  id: "redis-cache-load",
  track: "redis",
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : 1),
  invariants: [
    { name: "the database never answers more queries than there were requests", check: (s) => (s.dbLoad.every((q, t) => q <= traffic(t)) ? null : "more queries than requests") },
    { name: "with the cache off, every request is a database query", check: (s) => (!s.cacheOn && s.dbLoad.some((q, t) => q !== traffic(t)) ? "a request skipped the database" : null) },
    {
      name: "memory holds at most one key more than maxmemory (the write that crossed it, until the next command)",
      check: (s) => (s.maxKeys !== null && keyCount(s) > s.maxKeys + 1 ? `${keyCount(s)} keys for room for ${s.maxKeys}` : null),
    },
    {
      name: "noeviction never evicts; volatile-lru never evicts a key without a TTL",
      check: (s) => (s.policy === "noeviction" && s.evicted > 0 ? "noeviction evicted a key" : s.policy === "volatile-lru" && s.sessionsLost > 0 ? "volatile-lru evicted a session" : null),
    },
    { name: "without a memory limit nothing is evicted or refused", check: (s) => (s.maxKeys === null && (s.oom > 0 || s.evicted > 0) ? "evicted or refused without a limit" : null) },
  ],
  checks: {
    /** The whole minute ran and the database never went over its limit. */
    "under-the-limit": (s) => s.t === DURATION && peak(s) <= s.limit,
    /** The whole minute ran under the database limit with a memory limit, and no session was evicted and no write refused. */
    "sessions-safe": (s) => s.t === DURATION && s.maxKeys !== null && peak(s) <= s.limit && s.sessionsLost === 0 && s.oom === 0,
  },
  describe,
};
