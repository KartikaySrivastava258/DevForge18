/**
 * API rate limits for shared networks (docs/deployment.md, "Rate limits").
 *
 * A classroom often reaches DevForge from one public address (NAT), so every request in these tests comes from
 * 127.0.0.1. The limiters use a frozen clock so that every request falls into one one-minute window, however long
 * the test takes; the limits themselves are the shipped defaults.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_API_RATE_LIMITS } from "../src/config.ts";
import { FixedWindowLimiter } from "../src/http/rate-limit.ts";
import type { Limiters } from "../src/routes/deps.ts";
import { Client, STRONG_PASSWORD, startTestServer, type TestServer } from "./helpers.ts";

const STUDENTS = 60;
/**
 * "Normal usage": one API request a second for a whole minute per student. That is more than a student reading
 * lessons generates (a lesson page loads a handful of API requests, then the student reads for minutes), so it
 * is a generous stand-in for a class working at the same time.
 */
const NORMAL_REQUESTS_PER_MINUTE = 60;
const LESSON = "docker-images-vs-containers";

function frozenLimiters(perIpPerMinute: number, perUserPerMinute: number): Limiters {
  const t0 = Date.now();
  const make = (limit: number) => new FixedWindowLimiter(limit, 60_000, () => t0);
  return {
    register: make(1000),
    loginByIp: make(200), // as shipped (200 sign-ins per address); each test signs in at most 61 accounts
    loginFailuresByEmail: make(10),
    api: make(perIpPerMinute),
    apiByUser: make(perUserPerMinute),
  };
}

/** The requests a student's browser sends while reading lessons, cycled. */
function studentRequest(c: Client, i: number) {
  switch (i % 4) {
    case 0:
      return c.get(`/api/lessons/${LESSON}`);
    case 1:
      return c.get("/api/me/progress");
    case 2:
      return c.get("/api/tracks/docker");
    default:
      return c.get("/api/auth/me");
  }
}

async function signInClass(app: TestServer, n: number, prefix = "student"): Promise<Client[]> {
  const clients: Client[] = [];
  for (let i = 0; i < n; i++) {
    const email = `${prefix}${i}@example.edu`;
    await app.createUser(email, STRONG_PASSWORD);
    const c = new Client(app.url);
    const res = await c.post("/api/auth/login", { email, password: STRONG_PASSWORD });
    assert.equal(res.status, 200, `student ${i} signs in`);
    clients.push(c);
  }
  return clients;
}

/** Every student sends `perStudent` requests, round-robin and 60 at a time, as a class working together. */
async function classMinute(students: Client[], perStudent: number, abuser?: { client: Client; requests: number }) {
  const statuses = { students: new Map<number, number>(), abuser: new Map<number, number>() };
  const count = (m: Map<number, number>, s: number) => m.set(s, (m.get(s) ?? 0) + 1);
  const abuserPerRound = abuser ? Math.ceil(abuser.requests / perStudent) : 0;
  let abuserSent = 0;
  for (let round = 0; round < perStudent; round++) {
    const batch: Promise<void>[] = students.map((c) => studentRequest(c, round).then((r) => void count(statuses.students, r.status)));
    for (let k = 0; abuser && k < abuserPerRound && abuserSent < abuser.requests; k++, abuserSent++) {
      batch.push(abuser.client.get("/api/tracks").then((r) => void count(statuses.abuser, r.status)));
    }
    await Promise.all(batch);
  }
  return statuses;
}

describe("API rate limits behind one shared address", () => {
  it("defaults to 6,000 requests a minute per address and 600 per signed-in user", () => {
    assert.deepEqual(DEFAULT_API_RATE_LIMITS, { perIpPerMinute: 6000, perUserPerMinute: 600 });
  });

  describe("a classroom of 60 students at normal usage", () => {
    let app: TestServer;
    let students: Client[];
    before(async () => {
      const { perIpPerMinute, perUserPerMinute } = DEFAULT_API_RATE_LIMITS;
      app = await startTestServer({}, frozenLimiters(perIpPerMinute, perUserPerMinute));
      students = await signInClass(app, STUDENTS);
    });
    after(() => app.close());

    it("is never blocked", async () => {
      const { students: s } = await classMinute(students, NORMAL_REQUESTS_PER_MINUTE);
      assert.deepEqual([...s.entries()], [[200, STUDENTS * NORMAL_REQUESTS_PER_MINUTE]]);
    });
  });

  it("the same classroom was blocked by the old fixed limit of 1,200 a minute per address", async () => {
    const app = await startTestServer({}, frozenLimiters(1200, DEFAULT_API_RATE_LIMITS.perUserPerMinute));
    try {
      const students = await signInClass(app, STUDENTS);
      const { students: s } = await classMinute(students, NORMAL_REQUESTS_PER_MINUTE);
      assert.ok((s.get(429) ?? 0) > 0, "the old limit refuses part of a normal class's requests");
    } finally {
      await app.close();
    }
  });

  describe("one abusive user in the same classroom", () => {
    let app: TestServer;
    let students: Client[];
    let abuser: Client | undefined;
    before(async () => {
      const { perIpPerMinute, perUserPerMinute } = DEFAULT_API_RATE_LIMITS;
      app = await startTestServer({}, frozenLimiters(perIpPerMinute, perUserPerMinute));
      students = await signInClass(app, STUDENTS);
      [abuser] = await signInClass(app, 1, "abuser");
    });
    after(() => app.close());

    it("is limited to 600 requests a minute without affecting the 60 students", async () => {
      if (!abuser) throw new Error("the abuser did not sign in");
      // More requests than the whole address may send in a minute: refused requests must not use up the class's budget.
      const ABUSE = DEFAULT_API_RATE_LIMITS.perIpPerMinute + 500;
      const s = await classMinute(students, NORMAL_REQUESTS_PER_MINUTE, { client: abuser, requests: ABUSE });
      assert.deepEqual([...s.students.entries()], [[200, STUDENTS * NORMAL_REQUESTS_PER_MINUTE]], "no student is refused");
      assert.equal(s.abuser.get(200), DEFAULT_API_RATE_LIMITS.perUserPerMinute, "the abuser gets exactly the per-user limit");
      assert.equal(s.abuser.get(429), ABUSE - DEFAULT_API_RATE_LIMITS.perUserPerMinute, "and is refused after that");
      const refused = await abuser.get("/api/tracks");
      assert.equal(refused.status, 429);
      assert.equal(refused.json?.error?.code, "rate_limited");
      assert.ok(Number(refused.headers.get("retry-after")) > 0, "with Retry-After");
    });
  });

  it("anonymous requests are limited per address, at the configured value", async () => {
    const app = await startTestServer({ apiRateLimits: { perIpPerMinute: 5, perUserPerMinute: 600 } });
    try {
      const c = new Client(app.url);
      const statuses = [];
      for (let i = 0; i < 7; i++) statuses.push((await c.get("/api/tracks")).status);
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
    } finally {
      await app.close();
    }
  });

  it("the per-user limit is configurable and keyed on the account, not the session", async () => {
    const app = await startTestServer({ apiRateLimits: { perIpPerMinute: 1000, perUserPerMinute: 3 } });
    try {
      await app.createUser("two-tabs@example.edu", STRONG_PASSWORD);
      const a = new Client(app.url);
      const b = new Client(app.url); // a second browser: its own session, the same account
      for (const c of [a, b]) assert.equal((await c.post("/api/auth/login", { email: "two-tabs@example.edu", password: STRONG_PASSWORD })).status, 200);
      const statuses = [];
      for (const c of [a, b, a, b]) statuses.push((await c.get("/api/me/progress")).status);
      // The sign-in requests are anonymous (no session yet) and count only against the address.
      assert.deepEqual(statuses, [200, 200, 200, 429]);
      assert.equal((await new Client(app.url).get("/api/tracks")).status, 200, "an anonymous visitor on the same address is unaffected");
    } finally {
      await app.close();
    }
  });
});
