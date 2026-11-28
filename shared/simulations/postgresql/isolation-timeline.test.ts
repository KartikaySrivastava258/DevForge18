/**
 * The isolation-timeline model: every action, refusal, invariant and challenge check; every possible
 * order of every scenario at every isolation level keeps the invariants, and at SERIALIZABLE the
 * committed result always equals some one-at-a-time order.
 *
 * Then the model against a real PostgreSQL 16.15 (with DEVFORGE_DOCKER_TEST=1 and Docker, like the
 * other container tests): for every one of those orders, the same statements are sent through two
 * psql sessions, and every statement's output, every wait for a row lock, every error and the final
 * table must be the same as the model's.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { dockerTestingEnabled } from "../../../scripts/lib/lesson-runner.ts";
import { replay, violations } from "../types.ts";
import {
  anomalies,
  committedRows,
  finished,
  isolationTimeline as model,
  LEVELS,
  SCRIPTS,
  setupSql,
  txStatus,
  TXS,
  type IsoAction,
  type IsoState,
  type Level,
  type TxName,
} from "./isolation-timeline.ts";
import { IsoActionSchema, IsoScenarioSchema } from "./schema.ts";

const r = (tx: TxName): IsoAction => ({ type: "run", tx });
const retry = (tx: TxName): IsoAction => ({ type: "retry", tx });
const run = (script: string, level: Level, actions: IsoAction[]) => replay(model, { script, level }, actions);
const outs = (s: IsoState, tx: TxName) => s.timeline.filter((e) => e.tx === tx && e.kind !== "begin").map((e) => (e.kind === "wait" ? "(waiting)" : e.out.join(" / ")));
const ALT = [r("T1"), r("T2"), r("T1"), r("T2"), r("T1"), r("T2")];

describe("isolation timeline: reads", () => {
  const order = [r("T1"), r("T2"), r("T2"), r("T2"), r("T1"), r("T1")];
  it("READ COMMITTED: T1's second read sees T2's committed update and insert", () => {
    const s = run("reads", "read committed", order).state;
    assert.deepEqual(outs(s, "T1"), ["1|120", "1|170 / 3|200", "COMMIT"]);
    assert.equal(anomalies(s).length, 2);
    assert.match(anomalies(s)[0]!, /Non-repeatable read/);
    assert.match(anomalies(s)[1]!, /Phantom read/);
  });
  it("READ UNCOMMITTED gives exactly the same timeline as READ COMMITTED (no dirty reads in PostgreSQL)", () => {
    const ru = run("reads", "read uncommitted", order).state;
    const rc = run("reads", "read committed", order).state;
    assert.deepEqual(ru.timeline.map((e) => e.out), rc.timeline.map((e) => e.out));
    const dirty = run("reads", "read uncommitted", [r("T2"), r("T1")]).state;
    assert.deepEqual(outs(dirty, "T1"), ["1|120"], "T2's uncommitted update is invisible");
  });
  for (const level of ["repeatable read", "serializable"] as const) {
    it(`${level.toUpperCase()}: both reads see the snapshot taken at T1's first statement (no phantom either)`, () => {
      const s = run("reads", level, order).state;
      assert.deepEqual(outs(s, "T1"), ["1|120", "1|120", "COMMIT"]);
      assert.deepEqual(anomalies(s), []);
    });
  }
  it("REPEATABLE READ: the snapshot is taken at the first statement, not at BEGIN", () => {
    // T2 commits after T1's BEGIN but before T1's first SELECT: T1 sees it.
    const s = run("reads", "repeatable read", [r("T2"), r("T2"), r("T2"), r("T1"), r("T1")]).state;
    assert.deepEqual(outs(s, "T1"), ["1|170 / 3|200", "1|170 / 3|200"]);
  });
});

describe("isolation timeline: two read-modify-write deposits", () => {
  it("READ COMMITTED: T2 waits for T1's row lock, then overwrites T1's deposit (lost update)", () => {
    const s = run("deposits", "read committed", ALT).state;
    assert.deepEqual(outs(s, "T2"), ["100", "(waiting)", "UPDATE 1", "COMMIT"]);
    assert.equal(committedRows(s, "accounts")[0]?.balance, 80);
    assert.match(anomalies(s).join(" "), /Lost update: the committed changes add up to 130, but the balance is 80/);
  });
  for (const level of ["repeatable read", "serializable"] as const) {
    it(`${level.toUpperCase()}: the waiting UPDATE fails when T1 commits; a retry reads the new balance`, () => {
      const s = run("deposits", level, [...ALT.slice(0, 5), retry("T2"), r("T2"), r("T2"), r("T2")]).state;
      assert.deepEqual(outs(s, "T2"), ["100", "(waiting)", "ERROR:  could not serialize access due to concurrent update", "ROLLBACK", "150", "UPDATE 1", "COMMIT"]);
      assert.equal(committedRows(s, "accounts")[0]?.balance, 130);
      assert.equal(model.checks["no-lost-update"]!(s, s), true);
    });
  }
  it("REPEATABLE READ: no waiting when T1 already committed — the UPDATE fails at once", () => {
    const s = run("deposits", "repeatable read", [r("T1"), r("T2"), r("T1"), r("T1"), r("T2")]).state;
    assert.deepEqual(outs(s, "T2"), ["100", "ERROR:  could not serialize access due to concurrent update", "ROLLBACK"]);
  });
});

describe("isolation timeline: write skew", () => {
  for (const level of ["read committed", "repeatable read"] as const) {
    it(`${level.toUpperCase()}: both doctors go off call (write skew)`, () => {
      const s = run("oncall", level, ALT).state;
      assert.deepEqual(committedRows(s, "doctors").map((d) => d.on_call), [false, false]);
      assert.match(anomalies(s).join(" "), /Write skew/);
    });
  }
  it("SERIALIZABLE: the second COMMIT fails with a read/write dependency error; a retry sees one doctor and stays", () => {
    const s = run("oncall", "serializable", [...ALT, retry("T2"), r("T2"), r("T2"), r("T2")]).state;
    assert.deepEqual(outs(s, "T2"), ["2", "UPDATE 1", "ERROR:  could not serialize access due to read/write dependencies among transactions", "1", "skipped: T2 read 1, fewer than 2", "COMMIT"]);
    assert.deepEqual(committedRows(s, "doctors").map((d) => d.on_call), [false, true]);
  });
});

describe("isolation timeline: refusals, checks and schemas", () => {
  it("refuses what PostgreSQL or the scenario would not allow", () => {
    const started = run("deposits", "read committed", [r("T1")]).state;
    assert.match(model.step(started, { type: "setLevel", level: "serializable" }).error ?? "", /before the first statement/);
    const waiting = run("deposits", "read committed", [r("T1"), r("T2"), r("T1"), r("T2")]).state;
    assert.match(model.step(waiting, r("T2")).error ?? "", /waiting for T1/);
    assert.match(model.step(waiting, retry("T2")).error ?? "", /Only a transaction that failed/);
    const done = run("reads", "read committed", [r("T1"), r("T1"), r("T1")]).state;
    assert.match(model.step(done, r("T1")).error ?? "", /has committed/);
    const failed = run("deposits", "repeatable read", [r("T1"), r("T2"), r("T1"), r("T1"), r("T2")]).state;
    assert.match(model.step(failed, r("T2")).error ?? "", /Retry it/);
    assert.equal(model.step(model.init({ script: "deposits", level: "repeatable read" }).state, { type: "setLevel", level: "serializable" }).state.level, "serializable");
  });
  it("allows at most three attempts per transaction", () => {
    // These scripts cannot make one transaction fail three times, so the counter is set directly.
    const s = run("deposits", "repeatable read", [r("T1"), r("T2"), r("T1"), r("T1"), r("T2"), retry("T2")]).state;
    assert.equal(s.tx.T2.attempts, 1);
    const tooMany = { ...s, tx: { ...s.tx, T2: { ...s.tx.T2, attempts: 3, attempt: 2 } } };
    assert.match(model.step(tooMany, retry("T2")).error ?? "", /3 attempts/);
  });
  it("challenge checks fail at the start and for the wrong level", () => {
    for (const [check, script] of [["stable-reads", "reads"], ["no-lost-update", "deposits"], ["rule-holds", "oncall"]] as const) {
      const start = model.init({ script, level: "read committed" }).state;
      assert.equal(model.checks[check]!(start, start), false, check);
    }
    const rc = run("reads", "read committed", [r("T1"), r("T2"), r("T2"), r("T2"), r("T1"), r("T1")]).state;
    assert.equal(model.checks["stable-reads"]!(rc, rc), false);
    const rr = run("reads", "repeatable read", [r("T1"), r("T2"), r("T2"), r("T2"), r("T1"), r("T1")]).state;
    assert.equal(model.checks["stable-reads"]!(rr, rr), true);
    // Not overlapping is not a solution: one after the other never loses an update, at any level.
    const serial = run("deposits", "read committed", [r("T1"), r("T1"), r("T1"), r("T2"), r("T2"), r("T2")]).state;
    assert.equal(committedRows(serial, "accounts")[0]?.balance, 130);
    assert.equal(model.checks["no-lost-update"]!(serial, serial), false);
    const skew = run("oncall", "repeatable read", ALT).state;
    assert.equal(model.checks["rule-holds"]!(skew, skew), false);
    const ser = run("oncall", "serializable", ALT).state;
    assert.equal(model.checks["rule-holds"]!(ser, ser), true);
  });
  it("text mode describes the whole state", () => {
    const s = run("deposits", "read committed", ALT.slice(0, 4)).state;
    const lines = model.describe(s);
    assert.equal(lines.length, 3 + 6 + 2);
    assert.match(lines[2]!, /^T2: waiting\. Next: UPDATE accounts SET balance = 80 WHERE id = 1;$/);
    assert.equal(lines[7], "Timeline 5. T1: UPDATE accounts SET balance = 150 WHERE id = 1; → UPDATE 1");
    assert.equal(lines[8], "Timeline 6. T2: UPDATE accounts SET balance = 80 WHERE id = 1; → waiting for the other transaction");
    assert.equal(lines[9], "Committed accounts: 1|ana|100.");
  });
  it("schemas reject bad scenarios and actions", () => {
    assert.equal(IsoScenarioSchema.safeParse({ script: "drop table" }).success, false);
    assert.equal(IsoScenarioSchema.safeParse({ script: "reads", level: "snapshot" }).success, false);
    assert.deepEqual(IsoScenarioSchema.parse({ script: "reads" }), { script: "reads", level: "read committed" });
    assert.equal(IsoActionSchema.safeParse({ type: "run", tx: "T3" }).success, false);
    assert.equal(IsoActionSchema.safeParse({ type: "run", tx: "T1", sql: "DROP TABLE accounts" }).success, false);
  });
});

// ---- Every order ---------------------------------------------------------------------

/** Every complete order of the scenario's statements, with at most one retry per failed transaction. */
function schedules(script: string, level: Level): IsoAction[][] {
  const out: IsoAction[][] = [];
  const go = (s: IsoState, acts: IsoAction[]) => {
    if (finished(s, "T1") && finished(s, "T2")) out.push(acts);
    for (const tx of TXS) {
      const res = model.step(s, r(tx));
      if (!res.error) go(res.state, [...acts, r(tx)]);
      if (txStatus(s, tx) === "failed" && s.tx[tx].attempts < 2) go(model.step(s, retry(tx)).state, [...acts, retry(tx)]);
    }
  };
  go(model.init({ script, level }).state, []);
  return out;
}

/** Run the committed transactions one after the other; the result PostgreSQL's SERIALIZABLE promises to match. */
function serialOutcomes(script: string, level: Level, txs: TxName[]): { data: string; reads: string }[] {
  const orders = txs.length === 2 ? [txs, [...txs].reverse()] : [txs];
  return orders.map((order) => {
    const s = run(script, level, order.flatMap((tx) => SCRIPTS[script]![tx].map(() => r(tx)))).state;
    return { data: dataOf(s), reads: readsOf(s, txs) };
  });
}
const dataOf = (s: IsoState) => JSON.stringify(SCRIPTS[s.script]!.tables.map((t) => committedRows(s, t.name)));
const readsOf = (s: IsoState, txs: TxName[]) => JSON.stringify(txs.map((tx) => s.attempts.filter((a) => a.tx === tx && a.status === "committed").map((a) => a.reads)));

describe("isolation timeline: every order of every scenario", () => {
  for (const script of Object.keys(SCRIPTS)) {
    for (const level of LEVELS) {
      it(`${script} at ${level}: invariants hold${level === "serializable" ? " and the result is serializable" : ""}`, () => {
        const all = schedules(script, level);
        assert.ok(all.length >= 10, `${all.length} orders`);
        let anomalous = 0;
        for (const acts of all) {
          let s = model.init({ script, level }).state;
          for (const a of acts) {
            s = model.step(s, a).state;
            assert.deepEqual(violations(model, s), [], JSON.stringify(acts));
          }
          const committedTxs = TXS.filter((tx) => txStatus(s, tx) === "committed");
          const serial = serialOutcomes(script, level, committedTxs);
          const ok = serial.some((o) => o.data === dataOf(s) && o.reads === readsOf(s, committedTxs));
          if (!ok) anomalous++;
          if (level === "serializable") assert.ok(ok, `not serializable: ${JSON.stringify(acts)}`);
        }
        // Which levels let a non-serializable result through, for these scripts.
        const expected = level === "serializable" ? false : level === "repeatable read" ? script === "oncall" : true;
        assert.equal(anomalous > 0, expected, `${anomalous} of ${all.length} orders give a result no one-at-a-time order gives`);
      });
    }
  }
});

// ---- The model against a real PostgreSQL --------------------------------------------------

const PG_IMAGE = "postgres:16.15-bookworm@sha256:5264710be20f409750ac6dc4e5706dcef929c87e241605463f0f9aefa932a8d9";
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** A psql session over `docker exec`, unaligned and tuples-only like the model's output; a marker ends each statement's output. */
class Psql {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private n = 0;
  private waiters: { marker: string; resolve: (lines: string[]) => void }[] = [];
  pending: Promise<string[]> | null = null;
  done = false;
  constructor(container: string, db: string) {
    this.proc = spawn("docker", ["exec", "-i", container, "sh", "-c", `exec psql -X -A -t -h 127.0.0.1 -U postgres -d ${db} -v ON_ERROR_STOP=0 2>&1`]);
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (d: string) => {
      this.buf += d;
      for (;;) {
        const w = this.waiters[0];
        const at = w ? this.buf.indexOf(`${w.marker}\n`) : -1;
        if (!w || at < 0) break;
        const lines = this.buf.slice(0, at).split("\n").filter(Boolean);
        this.buf = this.buf.slice(at + w.marker.length + 1);
        this.waiters.shift();
        w.resolve(lines);
      }
    });
  }
  /** Send SQL; the promise resolves with its output lines when psql has finished it. */
  send(sql: string): Promise<string[]> {
    const marker = `@@done-${++this.n}@@`;
    const p = new Promise<string[]>((resolve) => this.waiters.push({ marker, resolve }));
    this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);
    this.done = false;
    this.pending = p.then((lines) => {
      this.done = true;
      return lines;
    });
    return this.pending;
  }
  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/** psql's output as the model writes it: the first ERROR line only (no DETAIL or HINT), no notices or warnings. */
const normalise = (lines: string[]) => {
  const error = lines.find((l) => l.startsWith("ERROR:"));
  return error ? [error] : lines.filter((l) => !/^(WARNING|NOTICE|DETAIL|HINT):/.test(l));
};

class Worker {
  sessions: Record<TxName, Psql>;
  monitor: Psql;
  pids: Record<TxName, string> = { T1: "", T2: "" };
  constructor(container: string, db: string) {
    this.sessions = { T1: new Psql(container, db), T2: new Psql(container, db) };
    this.monitor = new Psql(container, db);
  }
  async start() {
    for (const tx of TXS) this.pids[tx] = (await this.sessions[tx].send("SELECT pg_backend_pid();"))[0]!;
  }
  /** Wait until the statement finishes, or until PostgreSQL shows the session waiting for a lock. */
  async outcome(tx: TxName): Promise<string[] | "waiting"> {
    const session = this.sessions[tx];
    for (let i = 0; i < 1000; i++) {
      await sleep(i < 5 ? 2 : 10);
      if (session.done) return normalise(await session.pending!);
      if (i % 3 === 2) {
        const [wait] = await this.monitor.send(`SELECT coalesce(wait_event_type, '-') FROM pg_stat_activity WHERE pid = ${this.pids[tx]};`);
        if (wait === "Lock" && !session.done) return "waiting";
      }
    }
    throw new Error(`${tx} neither finished nor waited for a lock within 10 s`);
  }
  async still(tx: TxName): Promise<string> {
    const [wait] = await this.monitor.send(`SELECT coalesce(wait_event_type, '-') FROM pg_stat_activity WHERE pid = ${this.pids[tx]};`);
    return this.sessions[tx].done ? "finished" : wait === "Lock" ? "waiting" : `not waiting (${wait})`;
  }
  /** Replays the schedule in the model and in PostgreSQL; returns both transcripts. */
  async compare(script: string, level: Level, acts: IsoAction[]): Promise<{ model: string[]; real: string[] }> {
    const tables = SCRIPTS[script]!.tables;
    await this.monitor.send(`DROP TABLE IF EXISTS ${Object.values(SCRIPTS).flatMap((s) => s.tables.map((t) => t.name)).filter((n, i, a) => a.indexOf(n) === i).join(", ")}; ${setupSql(SCRIPTS[script]!).join(" ")}`);
    const modelLog: string[] = [];
    const realLog: string[] = [];
    let s = model.init({ script, level }).state;
    for (const a of acts) {
      const before = s.timeline.length;
      s = model.step(s, a).state;
      for (const e of s.timeline.slice(before)) {
        if (e.kind === "skip") continue;
        const line = `${e.tx}: ${e.sql} → `;
        modelLog.push(line + (e.kind === "wait" ? "(waiting)" : e.out.join(" / ")));
        if (e.kind !== "resume") void this.sessions[e.tx].send(e.sql);
        const got = e.kind === "resume" ? normalise(await Promise.race([this.sessions[e.tx].pending!, sleep(10_000).then(() => ["(still waiting after 10 s)"])])) : await this.outcome(e.tx);
        realLog.push(line + (got === "waiting" ? "(waiting)" : got.join(" / ")));
      }
      // A statement the model still has waiting must still be waiting in PostgreSQL.
      for (const tx of TXS) if (s.tx[tx].waiting) {
        const state = await this.still(tx);
        modelLog.push(`${tx} still waiting`);
        realLog.push(state === "waiting" ? `${tx} still waiting` : `${tx} ${state}`);
      }
    }
    for (const t of tables) {
      const rows = (await this.monitor.send(`SELECT ${t.columns.join(", ")} FROM ${t.name} ORDER BY ${t.key};`)).join(" / ");
      realLog.push(`final ${t.name}: ${rows}`);
      modelLog.push(`final ${t.name}: ${committedRows(s, t.name).map((row) => t.columns.map((c) => (typeof row[c] === "boolean" ? (row[c] ? "t" : "f") : String(row[c]))).join("|")).join(" / ")}`);
    }
    return { model: modelLog, real: realLog };
  }
  close() {
    for (const p of [this.sessions.T1, this.sessions.T2, this.monitor]) p.close();
  }
}

describe(`isolation timeline model matches a real PostgreSQL (${PG_IMAGE.split("@")[0]})`, { skip: dockerTestingEnabled() ? false : "needs DEVFORGE_DOCKER_TEST=1 and a Docker engine" }, () => {
  const name = `devforge-test-pg-isolation-${process.pid}`;
  const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 300_000 });
  before(async () => {
    const started = docker("run", "-d", "--name", name, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", PG_IMAGE);
    assert.equal(started.status, 0, started.stderr);
    // During initialisation the server listens only on its Unix socket, so TCP readiness means the final server.
    for (let i = 0; i < 120 && docker("exec", name, "pg_isready", "-q", "-h", "127.0.0.1").status !== 0; i++) await sleep(500);
    const version = docker("exec", name, "psql", "-X", "-A", "-t", "-h", "127.0.0.1", "-U", "postgres", "-c", "SHOW server_version;");
    assert.match(version.stdout, /^16\.15/);
    for (const level of LEVELS) docker("exec", name, "createdb", "-h", "127.0.0.1", "-U", "postgres", level.replace(" ", "_"));
  });
  after(() => void docker("rm", "-f", "-v", name));

  for (const script of Object.keys(SCRIPTS)) {
    it(`${script}: every order at every isolation level`, { timeout: 600_000 }, async () => {
      // One database and one pair of sessions per level, run in parallel.
      await Promise.all(
        LEVELS.map(async (level) => {
          const w = new Worker(name, level.replace(" ", "_"));
          try {
            await w.start();
            for (const acts of schedules(script, level)) {
              const { model: m, real } = await w.compare(script, level, acts);
              assert.deepEqual(real, m, `${script} at ${level}, order ${JSON.stringify(acts)}`);
            }
          } finally {
            w.close();
          }
        }),
      );
    });
  }
});
