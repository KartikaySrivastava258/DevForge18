/**
 * The cache-load model: stampedes and single flight; the memory limit and eviction policies, with their
 * invariants; and the eviction rules compared with a real Redis for small deterministic command sequences.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { dockerTestingEnabled, hasCommand } from "../../../scripts/lib/lesson-runner.ts";
import { RedisClient } from "../../../server/src/redis/client.ts";
import { replay, violations } from "../types.ts";
import { cacheLoad as model, hitRatio, keyCount, peak, redisCommand, traffic, type CacheAction, type CacheScenario, type CacheState, type Policy, type RedisCommand } from "./cache-load.ts";
import { CacheActionSchema, CacheScenarioSchema } from "./schema.ts";

const SC: CacheScenario = { cacheOn: true, ttl: 10, singleFlight: false, limit: 60, hotExpiresAt: 25, maxKeys: null, policy: "noeviction", sessions: 0, sessionEvery: null };
const MINUTE: CacheAction = { type: "tick", count: 60 };
const run = (over: Partial<CacheScenario>, actions: CacheAction[] = []) => replay(model, { ...SC, ...over }, [...actions, MINUTE]);

describe("cache under load", () => {
  it("without a cache, the database gets every request", () => {
    const s = run({ cacheOn: false }).state;
    assert.deepEqual([peak(s), hitRatio(s)], [400, 0]);
    assert.equal(traffic(25), 400);
  });
  it("when the hot key expires in the spike, its requests stampede the database", () => {
    const s = run({}).state;
    assert.equal(s.dbLoad[25], 240);
    assert.ok(hitRatio(s) > 0.9, "a high hit ratio can still hide a stampede");
  });
  it("a longer TTL does not stop a stampede that happens anyway", () => {
    assert.equal(run({ ttl: 60 }).state.dbLoad[25], 240);
  });
  it("single flight sends one query per expired key", () => {
    const s = run({ singleFlight: true }).state;
    assert.equal(s.dbLoad[25], 1);
    assert.ok(peak(s) <= 60);
  });
  it("a cold cache also stampedes, unless single flight is on", () => {
    assert.equal(run({ hotExpiresAt: null }).state.dbLoad[0], 100);
    assert.equal(run({ hotExpiresAt: null, singleFlight: true }).state.dbLoad[0], 41);
  });
});

describe("cache under load: challenge, refusals, invariants and schemas", () => {
  it("under-the-limit needs single flight here", () => {
    const ok = (r: ReturnType<typeof run>) => model.checks["under-the-limit"]!(r.state, r.initial);
    assert.equal(ok(run({})), false);
    assert.equal(ok(replay(model, SC, [{ type: "setSingleFlight", on: true }, MINUTE])), true);
  });
  it("settings change only before the traffic starts", () => {
    const started = replay(model, SC, [{ type: "tick" }]).state;
    assert.match(model.step(started, { type: "setTtl", seconds: 30 }).error ?? "", /before the traffic starts/);
  });
  it("keeps its invariants every second", () => {
    for (const over of [{}, { cacheOn: false }, { singleFlight: true, ttl: 1 }]) {
      let s = model.init({ ...SC, ...over }).state;
      for (let t = 0; t < 60; t++) {
        s = model.step(s, { type: "tick" }).state;
        assert.deepEqual(violations(model, s), []);
      }
      assert.equal(model.describe(s).length, 3);
    }
  });
  it("schemas reject bad input", () => {
    assert.equal(CacheActionSchema.safeParse({ type: "setTtl", seconds: 0 }).success, false);
    assert.equal(CacheScenarioSchema.safeParse({ hotExpiresAt: 99 }).success, false);
  });
});

// ---- Memory limit and eviction policies ------------------------------------------------

const FULL: Partial<CacheScenario> = { ttl: 30, singleFlight: true, hotExpiresAt: null, maxKeys: 50, sessions: 10, sessionEvery: 5 };
const fresh = (over: Partial<CacheScenario> = {}): CacheState => model.init({ ...SC, hotExpiresAt: null, ...over }).state;

describe("cache under load: memory limit and eviction policies", () => {
  it("without a limit (the first scenarios), nothing is evicted or refused", () => {
    const s = run({}).state;
    assert.deepEqual([s.evicted, s.oom, s.maxKeys], [0, 0, null]);
  });
  it("noeviction: the write that crosses the limit succeeds; the next write is refused with OOM, reads still work", () => {
    const s = fresh({ maxKeys: 3, policy: "noeviction" });
    for (const k of ["a", "b", "c", "d"]) assert.equal(redisCommand(s, { op: "SET", key: k, expiresAt: 99 }), "OK");
    assert.equal(keyCount(s), 4, "memory is checked before a command, so one write can cross the limit");
    assert.equal(redisCommand(s, { op: "SET", key: "e", expiresAt: 99 }), "OOM");
    assert.equal(redisCommand(s, { op: "GET", key: "a" }), "hit");
    assert.deepEqual([s.oom, s.evicted], [1, 0]);
  });
  it("allkeys-lru evicts the least recently used key before the next command — even a GET", () => {
    const s = fresh({ maxKeys: 3, policy: "allkeys-lru" });
    for (const k of ["a", "b", "c"]) redisCommand(s, { op: "SET", key: k, expiresAt: 99 });
    redisCommand(s, { op: "GET", key: "a" });
    redisCommand(s, { op: "SET", key: "d", expiresAt: 99 });
    const evicted: string[] = [];
    assert.equal(redisCommand(s, { op: "GET", key: "b" }, evicted), "miss");
    assert.deepEqual(evicted, ["b"]);
  });
  it("volatile-lru evicts only keys with a TTL, and refuses writes when none has one", () => {
    const s = fresh({ maxKeys: 3, policy: "volatile-lru" });
    redisCommand(s, { op: "SET", key: "session:a", expiresAt: null });
    for (const k of ["b", "c"]) redisCommand(s, { op: "SET", key: k, expiresAt: 99 });
    redisCommand(s, { op: "GET", key: "b" });
    redisCommand(s, { op: "SET", key: "d", expiresAt: 99 });
    const evicted: string[] = [];
    redisCommand(s, { op: "GET", key: "session:a" }, evicted);
    assert.deepEqual(evicted, ["c"], "the session is older, but has no TTL");
    const persistent = fresh({ maxKeys: 3, policy: "volatile-lru" });
    for (const k of ["session:x", "session:y", "session:z", "session:w"]) assert.equal(redisCommand(persistent, { op: "SET", key: k, expiresAt: null }), "OK");
    assert.equal(redisCommand(persistent, { op: "SET", key: "session:v", expiresAt: null }), "OOM");
  });
  it("allkeys-lfu evicts the least frequently used key — which can be the key just written", () => {
    const s = fresh({ maxKeys: 3, policy: "allkeys-lfu" });
    for (const k of ["a", "b", "c"]) redisCommand(s, { op: "SET", key: k, expiresAt: 99 });
    for (const [k, n] of [["a", 3], ["b", 2], ["c", 1]] as const) for (let i = 0; i < n; i++) redisCommand(s, { op: "GET", key: k });
    redisCommand(s, { op: "SET", key: "d", expiresAt: 99 });
    const evicted: string[] = [];
    redisCommand(s, { op: "GET", key: "a" }, evicted);
    assert.deepEqual(evicted, ["d"]);
  });
  it("the shared-instance scenario: only volatile-lru keeps every session and refuses no write", () => {
    const outcome = (over: Partial<CacheScenario>) => {
      const r = run({ ...FULL, ...over });
      for (const v of violations(model, r.state)) assert.fail(`${JSON.stringify(over)}: ${v}`);
      return { lost: r.state.sessionsLost, oom: r.state.oom, peak: peak(r.state), ok: model.checks["sessions-safe"]!(r.state, r.initial) };
    };
    assert.deepEqual(outcome({ policy: "noeviction" }), { lost: 0, oom: 40, peak: 41, ok: false });
    assert.deepEqual(outcome({ policy: "allkeys-lru" }), { lost: 12, oom: 0, peak: 41, ok: false });
    assert.deepEqual(outcome({ policy: "allkeys-lfu" }), { lost: 12, oom: 0, peak: 41, ok: false });
    assert.deepEqual(outcome({ policy: "volatile-lru" }), { lost: 0, oom: 0, peak: 41, ok: true });
    // The cache space volatile-lru leaves is too small for the database's limit without single flight.
    assert.deepEqual(outcome({ policy: "volatile-lru", singleFlight: false }).ok, false);
  });
  it("explains evictions and refusals; the hot key stays cached under LRU, as its requests are spread over each second", () => {
    const r = run({ ...FULL, policy: "volatile-lru" });
    assert.ok(hitRatio(r.state) > 0.5, `hit ratio ${hitRatio(r.state)}`);
    assert.ok(r.events.some((e) => /Evicted \d+ keys \(volatile-lru\)/.test(e)));
    assert.ok(run({ ...FULL, policy: "allkeys-lru" }).events.some((e) => /including 1 session: those users are signed out/.test(e)));
    assert.ok(run({ ...FULL, policy: "noeviction" }).events.some((e) => /refused: OOM command not allowed when used memory > 'maxmemory'/.test(e)));
    assert.ok(run({ ...FULL, policy: "noeviction" }).events.some((e) => /A user could not sign in: SET session:\d+ was refused \(OOM\)/.test(e)));
  });
  it("keeps its invariants every second with a memory limit, for every policy", () => {
    for (const policy of ["noeviction", "allkeys-lru", "volatile-lru", "allkeys-lfu"] as const) {
      for (const over of [{}, { singleFlight: false }, { maxKeys: 5, sessions: 5 }, { hotExpiresAt: 25 }]) {
        let s = model.init({ ...SC, ...FULL, policy, ...over }).state;
        for (let t = 0; t < 60; t++) {
          s = model.step(s, { type: "tick" }).state;
          assert.deepEqual(violations(model, s), [], `${policy} ${JSON.stringify(over)} at ${t}`);
        }
      }
    }
  });
  it("policy and memory limit change only before the traffic starts, within bounds", () => {
    const started = replay(model, { ...SC, ...FULL }, [{ type: "tick" }]).state;
    assert.match(model.step(started, { type: "setPolicy", policy: "allkeys-lru" }).error ?? "", /before the traffic starts/);
    assert.match(model.step(fresh(), { type: "setMaxKeys", keys: 2 }).error ?? "", /5 to 100/);
    assert.equal(model.step(fresh(), { type: "setMaxKeys", keys: null }).state.maxKeys, null);
    assert.equal(model.step(fresh(), { type: "setPolicy", policy: "volatile-lru" }).state.policy, "volatile-lru");
    assert.equal(model.describe(fresh(FULL)).length, 4);
    assert.equal(CacheActionSchema.safeParse({ type: "setPolicy", policy: "allkeys-random" }).success, false);
    assert.equal(CacheScenarioSchema.parse({}).maxKeys, null, "the first scenarios keep no memory limit");
  });
});

// ---- The eviction rules against a real Redis --------------------------------------------
// A dedicated server, because the test changes maxmemory for the whole instance: a Redis 7.4 container
// (DEVFORGE_DOCKER_TEST=1, the same pin as server/test/rate-limit-redis.test.ts) or a local redis-server on a
// free port. The shared DEVFORGE_TEST_REDIS_URL server is not used: other tests write to it at the same time.
//
// Values are 100,000 bytes (about 230 KB of memory, with the spare room SETRANGE allocates), so maxmemory can be
// set to "the keys so far and half a key". Each model SET is sent as SET key x [EX 100], then SETRANGE key 99999 x
// (the server builds the value, so no large command sits in a buffer); each GET as STRLEN, which looks the key
// up like GET (updating its LRU time or LFU counter) without sending 100 KB back. Redis's LRU clock is coarse
// (OBJECT IDLETIME counts whole seconds), so accesses whose order matters are 1.2 s apart. lfu-log-factor 0 and
// lfu-decay-time 0 make the LFU counter exact (5 for a new key, plus one per access); maxmemory-samples 10 is
// more than the keys these cases hold. So Redis's approximations do not decide these results, and the model's
// exact LRU and LFU are what is compared.

type Step = RedisCommand | { op: "LIMIT" } | { op: "WAIT" };
const SET = (key: string, ttl = true): Step => ({ op: "SET", key, expiresAt: ttl ? 99 : null });
const GET = (key: string): Step => ({ op: "GET", key });
const WAIT: Step = { op: "WAIT" };
const LIMIT: Step = { op: "LIMIT" };
interface Case {
  policy: Policy;
  keys: number;
  steps: Step[];
}
const CASES: Record<string, Case> = {
  "noeviction: one write crosses the limit, the next is refused, reads work": { policy: "noeviction", keys: 3, steps: [SET("a"), SET("b"), SET("c"), LIMIT, SET("d"), SET("e"), GET("a"), GET("e")] },
  "allkeys-lru: the least recently used key goes, before the next command": {
    policy: "allkeys-lru",
    keys: 3,
    steps: [SET("a"), WAIT, SET("b"), WAIT, SET("c"), WAIT, GET("a"), WAIT, LIMIT, SET("d"), WAIT, GET("b"), GET("a"), WAIT, SET("e"), GET("c")],
  },
  "volatile-lru: only keys with a TTL go": { policy: "volatile-lru", keys: 3, steps: [SET("session:a", false), WAIT, SET("b"), WAIT, SET("c"), WAIT, GET("b"), WAIT, LIMIT, SET("d"), GET("session:a"), GET("c")] },
  "volatile-lru with no TTL anywhere behaves like noeviction": {
    policy: "volatile-lru",
    keys: 3,
    steps: [SET("session:x", false), SET("session:y", false), SET("session:z", false), LIMIT, SET("session:w", false), SET("session:v", false), GET("session:x")],
  },
  "allkeys-lfu: the least frequently used key goes, even one just written": {
    policy: "allkeys-lfu",
    keys: 3,
    steps: [SET("a"), SET("b"), SET("c"), GET("a"), GET("a"), GET("a"), GET("b"), GET("b"), GET("c"), LIMIT, SET("d"), GET("a"), GET("d"), SET("e"), GET("b")],
  },
};

/** The model's replies and stored keys for a case. */
function modelRun(c: Case): { replies: string[]; keys: string[] } {
  const s = fresh({ policy: c.policy });
  const replies: string[] = [];
  for (const step of c.steps) {
    if (step.op === "LIMIT") s.maxKeys = c.keys;
    else if (step.op !== "WAIT") replies.push(`${step.op} ${step.key}: ${redisCommand(s, step)}`);
  }
  return { replies, keys: [...s.sessions, ...Object.keys(s.expires)].sort() };
}

async function redisRun(url: string, c: Case, prefix: string): Promise<{ replies: string[]; keys: string[] }> {
  // Each case uses its own key names: Redis keeps a pool of eviction candidates between evictions, and a stale entry
  // left by an earlier case would otherwise name a key of this one.
  const key = (k: string) => `${prefix}${k}`;
  const client = new RedisClient(url, { commandTimeoutMs: 5000 });
  const cmd = (...args: (string | number)[]) => client.command(args).catch((e: Error) => `error: ${e.message}`);
  const used = async () => Number(/used_memory:(\d+)/.exec(String(await cmd("INFO", "memory")))?.[1]);
  try {
    assert.equal(await cmd("CONFIG", "SET", "maxmemory", 0), "OK");
    assert.equal(await cmd("FLUSHALL"), "OK");
    for (const [k, v] of [["maxmemory-policy", c.policy], ["maxmemory-samples", 10], ["lfu-log-factor", 0], ["lfu-decay-time", 0]] as const) assert.equal(await cmd("CONFIG", "SET", k, v), "OK");
    const replies: string[] = [];
    const sizes: number[] = [await used()];
    for (const step of c.steps) {
      if (step.op === "WAIT") await sleep(1200);
      else if (step.op === "LIMIT") {
        // Room for the keys stored so far and half a key more: the next new key crosses the limit.
        const perKey = (sizes.at(-1)! - sizes[1]!) / (sizes.length - 2);
        assert.ok(perKey > 100_000 && perKey < 300_000, `one key takes ${perKey} bytes`); // SETRANGE grows the string with spare room
        assert.equal(await cmd("CONFIG", "SET", "maxmemory", Math.round(sizes.at(-1)! + perKey / 2)), "OK");
      } else if (step.op === "GET") {
        replies.push(`GET ${step.key}: ${(await cmd("STRLEN", key(step.key))) === 100_000 ? "hit" : "miss"}`);
      } else {
        const first = String(await cmd("SET", key(step.key), "x", ...(step.expiresAt === null ? [] : ["EX", 100])));
        const reply = first === "OK" ? ((await cmd("SETRANGE", key(step.key), 99_999, "x")) === 100_000 ? "OK" : "SETRANGE failed") : first.startsWith("error: OOM command not allowed when used memory > 'maxmemory'") ? "OOM" : first;
        replies.push(`SET ${step.key}: ${reply}`);
        sizes.push(await used());
      }
    }
    await cmd("PING"); // every command first runs the memory check, so a pending eviction happens before the keys are listed
    const keys = ((await cmd("KEYS", "*")) as string[]).map((k) => k.slice(prefix.length)).sort();
    assert.equal(await cmd("CONFIG", "SET", "maxmemory", 0), "OK");
    return { replies, keys };
  } finally {
    client.close();
  }
}

const REDIS_IMAGE = "redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b";
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
async function freePort(): Promise<number> {
  const srv = createNetServer();
  await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((res) => srv.close(() => res()));
  return port;
}

async function startRedis(): Promise<{ url: string; source: string; stop: () => void } | string> {
  if (dockerTestingEnabled()) {
    const name = `devforge-test-redis-eviction-${process.pid}`;
    const stop = () => void spawnSync("docker", ["rm", "-f", "-v", name], { encoding: "utf8" });
    const started = spawnSync("docker", ["run", "-d", "--name", name, "-p", "127.0.0.1::6379", REDIS_IMAGE], { encoding: "utf8", timeout: 300_000 });
    if (started.status !== 0) {
      stop();
      return `docker run ${REDIS_IMAGE} failed: ${started.stderr.trim()}`;
    }
    const port = /:(\d+)\s*$/m.exec(spawnSync("docker", ["port", name, "6379/tcp"], { encoding: "utf8" }).stdout)?.[1];
    return { url: `redis://127.0.0.1:${port}`, source: `Docker ${REDIS_IMAGE.split("@")[0]}`, stop };
  }
  if (hasCommand("redis-server")) {
    const port = await freePort();
    const child: ChildProcess = spawn("redis-server", ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    return { url: `redis://127.0.0.1:${port}`, source: "local redis-server", stop: () => void child.kill("SIGKILL") };
  }
  return "needs a dedicated Redis: DEVFORGE_DOCKER_TEST=1 with Docker, or redis-server installed";
}

const redis = await startRedis();
describe(`eviction rules match a real Redis${typeof redis === "string" ? "" : ` (${redis.source})`}`, { skip: typeof redis === "string" ? redis : false }, () => {
  const real = redis as Exclude<typeof redis, string>;
  let version = "";
  before(async () => {
    const client = new RedisClient(real.url, { connectTimeoutMs: 500, commandTimeoutMs: 1000 });
    for (let i = 0; i < 120 && !version; i++) {
      version = await client.command(["INFO", "server"]).then(
        (info) => /redis_version:(\S+)/.exec(String(info))?.[1] ?? "",
        () => sleep(250).then(() => ""),
      );
    }
    client.close();
    assert.ok(version, "Redis answers");
  });
  after(() => real.stop());
  for (const [i, [name, c]] of Object.entries(CASES).entries()) {
    it(name, async () => {
      assert.deepEqual(await redisRun(real.url, c, `case${i}:`), modelRun(c), `Redis ${version}`);
    });
  }
});
