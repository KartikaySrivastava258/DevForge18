/**
 * Shared rate limits in Redis (ADR 0010): the RESP client, the fail-open decision logic, and — against a
 * real Redis — atomic counting, window expiry, two DevForge instances sharing one limit, and an outage.
 *
 * The real Redis comes from, in order: DEVFORGE_TEST_REDIS_URL (a server these tests may write to; they
 * only touch keys under a unique prefix and never flush), a Redis 7.4 container (with DEVFORGE_DOCKER_TEST=1),
 * or a local redis-server binary started on a free port. Without any of them those tests are skipped.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { dockerTestingEnabled, hasCommand } from "../../scripts/lib/lesson-runner.ts";
import { defaultLimiters, sharedLimiters } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { FixedWindowLimiter } from "../src/http/rate-limit.ts";
import { decide, RedisFixedWindowLimiter, RedisRateLimitStore } from "../src/http/rate-limit-redis.ts";
import { createLogger, silentLogger } from "../src/observability/logger.ts";
import { encodeCommand, parseReply, RedisClient, RedisReplyError, type RedisCommander, type RespValue } from "../src/redis/client.ts";
import type { Limiters } from "../src/routes/deps.ts";
import { Client, startTestServer, STRONG_PASSWORD } from "./helpers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("RESP encoding and parsing", () => {
  it("encodes commands as arrays of bulk strings (UTF-8 byte lengths)", () => {
    assert.equal(encodeCommand(["SET", "k", "é", 5]).toString(), "*4\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n$1\r\n5\r\n");
  });
  it("parses every RESP2 reply type, and waits for incomplete replies", () => {
    const all = Buffer.from("+OK\r\n-ERR wrong\r\n:42\r\n$5\r\nhello\r\n$-1\r\n*2\r\n:1\r\n*1\r\n$1\r\nx\r\n");
    const values: unknown[] = [];
    for (let at = 0; ; ) {
      const r = parseReply(all, at);
      if (!r) break;
      values.push(r.value);
      at = r.next;
    }
    assert.equal(values[0], "OK");
    assert.ok(values[1] instanceof RedisReplyError && values[1].message === "ERR wrong");
    assert.deepEqual(values.slice(2), [42, "hello", null, [1, ["x"]]]);
    // Every strict prefix of a reply is incomplete, never a wrong value.
    const reply = Buffer.from("*2\r\n:7\r\n$3\r\nabc\r\n");
    for (let i = 0; i < reply.length; i++) assert.equal(parseReply(reply.subarray(0, i)), undefined, `prefix ${i}`);
    assert.deepEqual(parseReply(reply)?.value, [7, "abc"]);
  });
  it("rejects garbage", () => {
    assert.throws(() => parseReply(Buffer.from("?what\r\n")), /unexpected reply type/);
    assert.throws(() => parseReply(Buffer.from("$-5\r\n")), /bad bulk length/);
  });
});

/** A fake Redis over TCP: records commands; `reply` decides the answer (undefined = never answer). */
async function fakeRedis(reply: (args: string[]) => string | undefined): Promise<{ port: number; commands: string[][]; close: () => Promise<void> }> {
  const commands: string[][] = [];
  const sockets = new Set<Socket>();
  const server: NetServer = createNetServer((socket) => {
    sockets.add(socket);
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const r = parseReply(buf);
        if (!r) break;
        buf = buf.subarray(r.next);
        const args = (r.value as string[]).map(String);
        commands.push(args);
        const answer = reply(args);
        if (answer !== undefined) socket.write(answer);
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    commands,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

describe("RedisClient", () => {
  it("authenticates and selects the database from the URL before the first command", async () => {
    const fake = await fakeRedis((args) => (args[0] === "EVAL" ? "*2\r\n:1\r\n:60000\r\n" : "+OK\r\n"));
    const client = new RedisClient(`redis://app:p%40ss@127.0.0.1:${fake.port}/3`);
    try {
      assert.deepEqual(await client.command(["EVAL", "script", 1, "k", 60000]), [1, 60000]);
      assert.deepEqual(fake.commands.map((c) => c[0]), ["AUTH", "SELECT", "EVAL"]);
      assert.deepEqual(fake.commands[0], ["AUTH", "app", "p@ss"]);
      assert.deepEqual(fake.commands[1], ["SELECT", "3"]);
      assert.equal(client.address, `127.0.0.1:${fake.port}`, "the address for logs has no password");
    } finally {
      client.close();
      await fake.close();
    }
  });
  it("rejects error replies without dropping the connection", async () => {
    const fake = await fakeRedis((args) => (args[0] === "BAD" ? "-ERR unknown command\r\n" : "+PONG\r\n"));
    const client = new RedisClient(`redis://127.0.0.1:${fake.port}`);
    try {
      await assert.rejects(client.command(["BAD"]), /unknown command/);
      assert.equal(await client.command(["PING"]), "PONG");
    } finally {
      client.close();
      await fake.close();
    }
  });
  it("times out a command that gets no answer, then reconnects for the next one", async () => {
    let answer = false;
    const fake = await fakeRedis(() => (answer ? "+PONG\r\n" : undefined));
    const client = new RedisClient(`redis://127.0.0.1:${fake.port}`, { commandTimeoutMs: 100 });
    try {
      const started = Date.now();
      await assert.rejects(client.command(["PING"]), /timed out after 100 ms/);
      assert.ok(Date.now() - started < 1000);
      answer = true;
      assert.equal(await client.command(["PING"]), "PONG");
    } finally {
      client.close();
      await fake.close();
    }
  });
  it("fails fast when nothing listens", async () => {
    const fake = await fakeRedis(() => "+OK\r\n");
    const port = fake.port;
    await fake.close();
    const client = new RedisClient(`redis://127.0.0.1:${port}`, { connectTimeoutMs: 300 });
    await assert.rejects(client.command(["PING"]), /ECONNREFUSED|timed out/);
    client.close();
  });
});

/** A scripted RedisCommander for the decision logic. */
class FakeCommander implements RedisCommander {
  calls: (string | number)[][] = [];
  failing = false;
  counts = new Map<string, number>();
  async command(args: (string | number)[]): Promise<RespValue> {
    this.calls.push(args);
    if (this.failing) throw new Error("connect ECONNREFUSED");
    if (args[0] === "DEL") {
      this.counts.delete(String(args[1]));
      return 1;
    }
    const key = String(args[3]);
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return [n, Number(args[4])];
  }
  close(): void {}
}

describe("shared rate limiter decisions", () => {
  it("decide(): allowed up to the limit, then a Retry-After of at least one second", () => {
    assert.deepEqual(decide(2, 1, 60_000), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
    assert.deepEqual(decide(2, 2, 60_000), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
    assert.deepEqual(decide(2, 3, 59_001), { allowed: false, remaining: 0, retryAfterSeconds: 60 });
    assert.deepEqual(decide(2, 3, 5), { allowed: false, remaining: 0, retryAfterSeconds: 1 });
  });
  it("counts in Redis under a hashed key that never contains the e-mail address or IP", async () => {
    const fake = new FakeCommander();
    const store = new RedisRateLimitStore(fake, { logger: silentLogger });
    const limiter = new RedisFixedWindowLimiter("loginFailuresByEmail", 2, 60_000, store);
    assert.equal((await limiter.hit("login-email:someone@example.edu")).allowed, true);
    assert.equal((await limiter.hit("login-email:someone@example.edu")).allowed, true);
    const third = await limiter.hit("login-email:someone@example.edu");
    assert.equal(third.allowed, false);
    assert.equal(third.retryAfterSeconds, 60);
    const key = String(fake.calls[0]?.[3]);
    assert.match(key, /^devforge:rl:loginFailuresByEmail:[0-9a-f]{64}$/);
    assert.equal(fake.calls[0]?.[0], "EVAL");
    assert.equal(fake.calls[0]?.[4], 60_000);
    await limiter.reset("login-email:someone@example.edu");
    assert.deepEqual(fake.calls.at(-1), ["DEL", key]);
    assert.equal((await limiter.hit("login-email:someone@example.edu")).allowed, true, "reset clears the shared counter");
  });
  it("fails open to the per-process limiter, logs once, backs off, and recovers", async () => {
    let now = 1_000_000;
    const fake = new FakeCommander();
    const lines: string[] = [];
    const store = new RedisRateLimitStore(fake, { logger: createLogger("info", (l) => lines.push(l)), retryAfterMs: 5_000, now: () => now, address: "redis.internal:6379" });
    const limiter = new RedisFixedWindowLimiter("register", 2, 60_000, store, () => now);
    fake.failing = true;
    // Redis down: the in-memory fallback with the same limit still applies, per process.
    assert.equal((await limiter.hit("register:10.0.0.1")).allowed, true);
    assert.equal(store.isDown, true);
    assert.equal((await limiter.hit("register:10.0.0.1")).allowed, true);
    assert.equal((await limiter.hit("register:10.0.0.1")).allowed, false, "fail open is not 'no limit'");
    assert.equal(fake.calls.length, 1, "no Redis call during the back-off window: an outage costs one timeout, not one per request");
    assert.equal(store.stats.fallbacks, 3);
    assert.equal(store.stats.errors, 1);
    assert.equal(lines.length, 1);
    const warn = JSON.parse(lines[0] ?? "{}");
    assert.equal(warn.level, "warn");
    assert.equal(warn.msg, "rate-limit store unavailable; using per-process limits");
    assert.equal(warn.redis, "redis.internal:6379");
    assert.match(store.metricLines().join("\n"), /^devforge_rate_limit_store_up 0$/m);
    assert.match(store.metricLines().join("\n"), /^devforge_rate_limit_fallbacks_total 3$/m);

    // Still failing after the back-off: one more attempt, still one warning.
    now += 5_001;
    await limiter.hit("register:10.0.0.2");
    assert.equal(fake.calls.length, 2);
    assert.equal(lines.length, 1);

    // Redis back: the next attempt after the back-off uses it again and says so.
    fake.failing = false;
    now += 5_001;
    assert.equal((await limiter.hit("register:10.0.0.3")).allowed, true);
    assert.equal(store.isDown, false);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1] ?? "{}").msg, "rate-limit store reachable again; limits are shared");
    assert.match(store.metricLines().join("\n"), /^devforge_rate_limit_store_up 1$/m);
  });
  it("treats an unexpected reply as unavailable", async () => {
    const odd: RedisCommander = { command: async () => "OK", close() {} };
    const store = new RedisRateLimitStore(odd, { logger: silentLogger });
    assert.equal(await store.increment("api", "k", 1000), undefined);
    assert.equal(store.isDown, true);
  });
  it("without REDIS_URL the in-memory limiters are used, unchanged", () => {
    assert.equal(loadConfig({}).redisUrl, undefined);
    assert.equal(loadConfig({ REDIS_URL: "redis://redis:6379/0" }).redisUrl, "redis://redis:6379/0");
    assert.throws(() => loadConfig({ REDIS_URL: "http://redis:6379" }), /REDIS_URL/);
    for (const limiter of Object.values(defaultLimiters())) assert.ok(limiter instanceof FixedWindowLimiter);
    const shared = sharedLimiters(new RedisRateLimitStore(new FakeCommander(), { logger: silentLogger }));
    for (const limiter of Object.values(shared)) assert.ok(limiter instanceof RedisFixedWindowLimiter);
  });
});

// ------------------------------------------------------------------------------------------------------
// A real Redis server

// redis:7.4.11-bookworm, the same pin as content/projects/redis/redis-rate-limiter/check.sh.
const REDIS_IMAGE = "redis:7.4.11-bookworm@sha256:44960b3100c48159a66d28c18b0588c193492e25f7551d60e51dd464fc3eca5b";

interface RealRedis {
  url: string;
  source: string;
  /** Make Redis stop answering (paused container or stopped process); undefined when not possible. */
  pause?: () => void;
  resume?: () => void;
  stop: () => void;
}

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function waitForPing(url: string): Promise<string | undefined> {
  const client = new RedisClient(url, { connectTimeoutMs: 500, commandTimeoutMs: 500 });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await client.command(["PING"])) === "PONG") {
          const info = String(await client.command(["INFO", "server"]));
          return /redis_version:(\S+)/.exec(info)?.[1] ?? "unknown";
        }
      } catch {
        await sleep(250);
      }
    }
    return undefined;
  } finally {
    client.close();
  }
}

async function startRealRedis(): Promise<RealRedis | string> {
  if (process.env.DEVFORGE_TEST_REDIS_URL) {
    const version = await waitForPing(process.env.DEVFORGE_TEST_REDIS_URL);
    if (!version) return "DEVFORGE_TEST_REDIS_URL is set but Redis does not answer PING";
    return { url: process.env.DEVFORGE_TEST_REDIS_URL, source: `DEVFORGE_TEST_REDIS_URL (Redis ${version})`, stop() {} };
  }
  if (dockerTestingEnabled()) {
    const name = `devforge-test-redis-${process.pid}`;
    const run = spawnSync("docker", ["run", "-d", "--name", name, "-p", "127.0.0.1::6379", REDIS_IMAGE], { encoding: "utf8", timeout: 300_000 });
    const stop = () => void spawnSync("docker", ["rm", "-f", "-v", name], { encoding: "utf8" });
    if (run.status !== 0) {
      stop();
      return `docker run ${REDIS_IMAGE} failed: ${run.stderr.trim()}`;
    }
    const port = /:(\d+)\s*$/m.exec(spawnSync("docker", ["port", name, "6379/tcp"], { encoding: "utf8" }).stdout)?.[1];
    const url = `redis://127.0.0.1:${port}`;
    const version = await waitForPing(url);
    if (!version) {
      stop();
      return "the Redis container did not answer PING";
    }
    return {
      url,
      source: `Docker ${REDIS_IMAGE.split("@")[0]} (Redis ${version})`,
      pause: () => void spawnSync("docker", ["pause", name]),
      resume: () => void spawnSync("docker", ["unpause", name]),
      stop,
    };
  }
  if (hasCommand("redis-server")) {
    const port = await freePort();
    const child: ChildProcess = spawn("redis-server", ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    const url = `redis://127.0.0.1:${port}`;
    const version = await waitForPing(url);
    if (!version) {
      child.kill("SIGKILL");
      return "redis-server did not start";
    }
    return {
      url,
      source: `local redis-server (Redis ${version})`,
      pause: () => void child.kill("SIGSTOP"),
      resume: () => void child.kill("SIGCONT"),
      stop: () => void child.kill("SIGKILL"),
    };
  }
  return "no Redis: set DEVFORGE_TEST_REDIS_URL, or DEVFORGE_DOCKER_TEST=1 with Docker, or install redis-server";
}

const redis = await startRealRedis();
const skipReal = typeof redis === "string" ? redis : false;

describe(`shared rate limits against a real Redis${typeof redis === "string" ? "" : ` — ${redis.source}`}`, { skip: skipReal }, () => {
  const real = redis as RealRedis;
  const prefix = `devforge-test:${process.pid}:${randomBytes(4).toString("hex")}:`;
  const clients: RedisClient[] = [];
  const newStore = (options: { retryAfterMs?: number; logger?: ReturnType<typeof createLogger> } = {}) => {
    const client = new RedisClient(real.url, { connectTimeoutMs: 500, commandTimeoutMs: 300 });
    clients.push(client);
    return new RedisRateLimitStore(client, { logger: options.logger ?? silentLogger, prefix, retryAfterMs: options.retryAfterMs ?? 5_000, address: client.address });
  };

  before(() => {
    if (skipReal) return;
    console.log(`# Redis for these tests: ${real.source}`);
  });
  after(async () => {
    if (skipReal) return;
    // Remove this run's keys (never FLUSHDB: the server may be shared).
    const admin = new RedisClient(real.url);
    try {
      const keys = (await admin.command(["KEYS", `${prefix}*`])) as string[];
      if (keys.length) await admin.command(["DEL", ...keys]);
    } finally {
      admin.close();
      for (const c of clients) c.close();
      real.stop();
    }
  });

  it("counts atomically: 100 concurrent hits from two clients allow exactly the limit", async () => {
    const a = new RedisFixedWindowLimiter("atomic", 30, 60_000, newStore());
    const b = new RedisFixedWindowLimiter("atomic", 30, 60_000, newStore());
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).hit("api:203.0.113.9")));
    assert.equal(results.filter((r) => r.allowed).length, 30);
    const blocked = results.find((r) => !r.allowed);
    assert.ok(blocked && blocked.retryAfterSeconds >= 59 && blocked.retryAfterSeconds <= 60, JSON.stringify(blocked));
    // The key has an expiry, and its name is a hash.
    const admin = newStore();
    const key = admin.redisKey("atomic", "api:203.0.113.9");
    const ttl = (await clients.at(-1)!.command(["PTTL", key])) as number;
    assert.ok(ttl > 0 && ttl <= 60_000, `PTTL ${ttl}`);
    const keys = (await clients.at(-1)!.command(["KEYS", `${prefix}*`])) as string[];
    assert.ok(keys.length > 0 && keys.every((k) => !k.includes("203.0.113.9")));
  });

  it("starts a new window when the old one expires", async () => {
    const limiter = new RedisFixedWindowLimiter("expiry", 1, 300, newStore());
    assert.equal((await limiter.hit("k")).allowed, true);
    const blocked = await limiter.hit("k");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    await sleep(400);
    assert.equal((await limiter.hit("k")).allowed, true);
  });

  it("two DevForge instances sharing one Redis enforce one limit", async () => {
    const limitersFor = (store: RedisRateLimitStore): Limiters => ({
      register: new RedisFixedWindowLimiter("register", 2, 60_000, store),
      loginByIp: new RedisFixedWindowLimiter("loginByIp", 100, 60_000, store),
      loginFailuresByEmail: new RedisFixedWindowLimiter("loginFailuresByEmail", 3, 60_000, store),
      api: new RedisFixedWindowLimiter("api", 1000, 60_000, store),
    });
    const storeA = newStore();
    const storeB = newStore();
    const a = await startTestServer({}, limitersFor(storeA), { rateLimitStore: storeA });
    const b = await startTestServer({}, limitersFor(storeB), { rateLimitStore: storeB });
    try {
      const ca = new Client(a.url);
      const cb = new Client(b.url);
      const register = (c: Client, email: string) => c.post("/api/auth/register", { email, password: STRONG_PASSWORD, displayName: "Shared" });
      assert.equal((await register(ca, "one@example.edu")).status, 201);
      assert.equal((await register(cb, "two@example.edu")).status, 201);
      const third = await register(ca, "three@example.edu");
      assert.equal(third.status, 429, "the third registration from the same IP is refused, although instance A has seen only two");
      assert.ok(Number(third.headers.get("retry-after")) > 0);
      assert.equal((await register(cb, "four@example.edu")).status, 429);

      // Failed logins against one account, spread over both instances, lock it on both.
      await a.createUser("target@example.edu", STRONG_PASSWORD);
      await b.createUser("target@example.edu", STRONG_PASSWORD);
      for (const c of [ca, cb, ca]) assert.equal((await c.post("/api/auth/login", { email: "target@example.edu", password: "wrong guess here" })).status, 401);
      assert.equal((await cb.post("/api/auth/login", { email: "target@example.edu", password: "wrong guess again" })).status, 429);
      assert.equal((await ca.post("/api/auth/login", { email: "target@example.edu", password: "wrong guess again" })).status, 429);

      const metrics = await new Client(a.url).get("/metrics");
      assert.match(metrics.text, /^devforge_rate_limit_store_up 1$/m);
      assert.match(metrics.text, /^devforge_rate_limit_fallbacks_total 0$/m);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("keeps serving when Redis stops answering, with per-process limits, and shares again afterwards", { skip: real.pause ? false : "cannot pause a server given by URL" }, async () => {
    const lines: string[] = [];
    const store = newStore({ retryAfterMs: 500, logger: createLogger("info", (l) => lines.push(l)) });
    const limiter = new RedisFixedWindowLimiter("outage", 2, 60_000, store);
    const app = await startTestServer({}, { ...defaultLimiters(), register: limiter }, { rateLimitStore: store });
    const c = new Client(app.url);
    const register = (email: string) => c.post("/api/auth/register", { email, password: STRONG_PASSWORD, displayName: "Outage" });
    try {
      assert.equal((await register("o1@example.edu")).status, 201);
      real.pause?.();
      const started = Date.now();
      assert.equal((await register("o2@example.edu")).status, 201, "fail open: the request is served");
      assert.ok(Date.now() - started < 2_000, "within the command timeout, not hanging");
      assert.equal(store.isDown, true);
      assert.equal((await register("o3@example.edu")).status, 201, "the per-process window started fresh: 2nd hit");
      assert.equal((await register("o4@example.edu")).status, 429, "the per-process limit still applies");
      const metrics = await c.get("/metrics");
      assert.match(metrics.text, /^devforge_rate_limit_store_up 0$/m);
      assert.match(metrics.text, /^devforge_rate_limit_fallbacks_total [1-9]/m);
      assert.equal(lines.filter((l) => l.includes("rate-limit store unavailable")).length, 1);

      real.resume?.();
      await sleep(600);
      // Shared again: after the back-off the next hit is counted in Redis. (Whether Redis also executed the
      // command that timed out during the pause is up to Redis, so compare the counter before and after.)
      const admin = clients.at(-1)!;
      const [key] = (await admin.command(["KEYS", `${prefix}outage:*`])) as string[];
      assert.ok(key);
      const before = Number(await admin.command(["GET", key]));
      await register("o5@example.edu");
      assert.equal(store.isDown, false);
      assert.equal(Number(await admin.command(["GET", key])), before + 1);
      assert.ok(lines.some((l) => l.includes("rate-limit store reachable again")));
    } finally {
      real.resume?.();
      await app.close();
    }
  });
});
