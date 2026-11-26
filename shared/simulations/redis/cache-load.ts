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
 * Simplified (shown to learners): time moves in whole seconds; every
 * request within a second arrives at once; the database answers within
 * the second; the cache never runs out of memory; traffic is fixed, not
 * random.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const DURATION = 60;
export const OTHER_KEYS = 40;
export const HOT_SHARE = 0.6;
/** Requests per second at time t: 100, with a spike to 400 from second 20 to 39. */
export const traffic = (t: number) => (t >= 20 && t < 40 ? 400 : 100);

export interface CacheState {
  t: number;
  cacheOn: boolean;
  ttl: number;
  singleFlight: boolean;
  /** Second at which each cached key expires (absent = not cached). */
  expires: Record<string, number>;
  /** Database queries per second so far. */
  dbLoad: number[];
  hits: number;
  misses: number;
  limit: number;
}

export type CacheAction =
  | { type: "tick"; count?: number | undefined }
  | { type: "setCache"; on: boolean }
  | { type: "setTtl"; seconds: number }
  | { type: "setSingleFlight"; on: boolean };

export interface CacheScenario {
  cacheOn: boolean;
  ttl: number;
  singleFlight: boolean;
  limit: number;
  /** The hot key starts cached, expiring at this second (to time a stampede). */
  hotExpiresAt: number | null;
}

function second(s: CacheState): { state: CacheState; event: string } {
  const t = s.t;
  const total = traffic(t);
  const hot = Math.round(total * HOT_SHARE);
  const perOther = (total - hot) / OTHER_KEYS;
  const expires = { ...s.expires };
  let db = 0;
  let hits = 0;
  let misses = 0;
  const serve = (key: string, n: number) => {
    if (!s.cacheOn) {
      db += n;
      misses += n;
      return;
    }
    const cached = expires[key] !== undefined && expires[key]! > t;
    if (cached) {
      hits += n;
      return;
    }
    // A miss: every request for the key this second goes to the database — unless single flight lets one go and the rest wait.
    const queries = s.singleFlight ? 1 : n;
    db += queries;
    misses += n;
    expires[key] = t + s.ttl;
  };
  serve("hot", hot);
  for (let k = 0; k < OTHER_KEYS; k++) serve(`key:${k}`, perOther);
  db = Math.round(db);
  const next: CacheState = { ...s, t: t + 1, expires, dbLoad: [...s.dbLoad, db], hits: s.hits + hits, misses: s.misses + Math.round(misses) };
  const hotMissed = s.cacheOn && !(s.expires.hot !== undefined && s.expires.hot > t);
  return { state: next, event: `Second ${t}: ${total} requests, ${db} database queries${db > s.limit ? ` — over the limit of ${s.limit}` : ""}.${hotMissed && !s.singleFlight && s.cacheOn ? ` The hot key was not cached: ${hot} requests for it went to the database at once.` : ""}` };
}

const refuse = (state: CacheState, error: string): StepResult<CacheState> => ({ state, events: [], error });

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
      if (s.t > 0) return refuse(s, "Change settings before the traffic starts (press Reset).");
      return { state: { ...s, cacheOn: a.on }, events: [a.on ? "Cache-aside is on: reads try Redis first." : "Cache is off: every read goes to the database."] };
    case "setTtl":
      if (s.t > 0) return refuse(s, "Change settings before the traffic starts (press Reset).");
      if (a.seconds < 1 || a.seconds > 120) return refuse(s, "TTL must be 1 to 120 seconds.");
      return { state: { ...s, ttl: a.seconds }, events: [`Keys are cached for ${a.seconds} s.`] };
    case "setSingleFlight":
      if (s.t > 0) return refuse(s, "Change settings before the traffic starts (press Reset).");
      return { state: { ...s, singleFlight: a.on }, events: [a.on ? "Single flight is on: on a miss, one request refills the key and the others wait for it." : "Single flight is off: every request that misses queries the database."] };
  }
}

function init(p: CacheScenario): StepResult<CacheState> {
  const expires: Record<string, number> = {};
  if (p.hotExpiresAt !== null) {
    expires.hot = p.hotExpiresAt;
    for (let k = 0; k < OTHER_KEYS; k++) expires[`key:${k}`] = p.hotExpiresAt + 7 + (k % 5);
  }
  const state: CacheState = { t: 0, cacheOn: p.cacheOn, ttl: p.ttl, singleFlight: p.singleFlight, expires, dbLoad: [], hits: 0, misses: 0, limit: p.limit };
  return { state, events: [`A minute of traffic: 100 requests a second, 400 from second 20 to 39; ${Math.round(HOT_SHARE * 100)} % ask for one hot key. The database copes with ${p.limit} queries a second.`] };
}

export const peak = (s: Pick<CacheState, "dbLoad">) => Math.max(0, ...s.dbLoad);
export const hitRatio = (s: Pick<CacheState, "hits" | "misses">) => (s.hits + s.misses ? s.hits / (s.hits + s.misses) : 0);

function describe(s: CacheState): string[] {
  return [
    `Second ${s.t} of ${DURATION}. Cache ${s.cacheOn ? "on" : "off"}, TTL ${s.ttl} s, single flight ${s.singleFlight ? "on" : "off"}. Database limit ${s.limit} queries a second.`,
    `Hit ratio so far: ${(hitRatio(s) * 100).toFixed(1)} %. Peak database load: ${peak(s)} queries a second.`,
    `Database queries per second: ${s.dbLoad.join(", ") || "none yet"}.`,
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
  ],
  checks: {
    /** The whole minute ran and the database never went over its limit. */
    "under-the-limit": (s) => s.t === DURATION && peak(s) <= s.limit,
  },
  describe,
};
