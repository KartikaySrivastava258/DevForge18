/**
 * Simulation: two concurrent transactions at an isolation level (REMAINING_WORK.md §5.4).
 *
 * Two transactions, T1 and T2, each run a short fixed script. The learner
 * chooses the isolation level and the order in which their statements run
 * — the timeline — and sees each statement's result, which transaction
 * waits for a row lock, which one fails with a serialization error, and
 * which anomalies appear (non-repeatable read, phantom read, lost update,
 * write skew).
 *
 * The model follows PostgreSQL 16, as documented in "Transaction
 * Isolation" (www.postgresql.org/docs/16/transaction-iso.html) and as
 * checked against a real PostgreSQL 16.15 server for every possible
 * order of every scenario at every level (isolation-timeline.test.ts):
 *
 * - Data is multi-version: an UPDATE writes a new row version; a snapshot
 *   decides which versions a statement sees. Nobody ever sees another
 *   transaction's uncommitted changes, so there are no dirty reads — READ
 *   UNCOMMITTED "behaves like Read Committed".
 * - READ COMMITTED takes a new snapshot for every statement. An UPDATE of a
 *   row that a concurrent transaction is changing waits for it; if it
 *   commits, the WHERE clause is re-evaluated against the new row version
 *   and the update is applied to that version.
 * - REPEATABLE READ and SERIALIZABLE take one snapshot, at the first
 *   statement after BEGIN. An UPDATE of a row changed by a transaction that
 *   committed after that snapshot fails with "could not serialize access
 *   due to concurrent update" (after waiting, if the other is still open).
 * - SERIALIZABLE also tracks read/write dependencies with predicate locks
 *   (SIREAD). The tables here have no indexes, so every read is a
 *   sequential scan, which "will always necessitate a relation-level
 *   predicate lock". The checks that turn dependencies into "could not
 *   serialize access due to read/write dependencies among transactions"
 *   mirror PostgreSQL's serializable snapshot isolation code
 *   (src/backend/storage/lmgr/predicate.c) for two transactions.
 *
 * Simplified (shown to learners): fixed scripts on tiny tables without
 * indexes; a failed statement is followed at once by ROLLBACK, as an
 * application would; one statement runs at a time (in a real server they
 * can overlap within milliseconds); no deadlocks are possible in these
 * scripts.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const LEVELS = ["read uncommitted", "read committed", "repeatable read", "serializable"] as const;
export type Level = (typeof LEVELS)[number];
export type TxName = "T1" | "T2";
export const TXS: readonly TxName[] = ["T1", "T2"];
export type Value = number | string | boolean;
export type Row = Record<string, Value>;

export interface Cond {
  column: string;
  op: "=" | ">=";
  value: Value;
}
export type SetExpr =
  /** column = column + n (the database does the arithmetic). */
  | { add: number }
  /** column = <value this transaction read in statement `read`> + n (the application does the arithmetic). */
  | { read: number; plus: number }
  | { value: Value };
export type Stmt =
  | { kind: "select"; table: string; columns: string[] | "count"; where?: Cond; orderBy?: string }
  | { kind: "update"; table: string; column: string; set: SetExpr; where: Cond; onlyIf?: { read: number; atLeast: number } }
  | { kind: "insert"; table: string; row: Row }
  | { kind: "commit" };

export interface TableDef {
  name: string;
  columns: string[];
  /** Column that identifies a row (no index exists on it). */
  key: string;
  rows: Row[];
}
export interface Script {
  title: string;
  tables: TableDef[];
  T1: Stmt[];
  T2: Stmt[];
}

const accounts = (rows: Row[]): TableDef => ({ name: "accounts", columns: ["id", "owner", "balance"], key: "id", rows });
const byId = (id: number): Cond => ({ column: "id", op: "=", value: id });
const COMMIT: Stmt = { kind: "commit" };
const RICH: Stmt = { kind: "select", table: "accounts", columns: ["id", "balance"], where: { column: "balance", op: ">=", value: 100 }, orderBy: "id" };
const balanceOf1: Stmt = { kind: "select", table: "accounts", columns: ["balance"], where: byId(1) };
const onCall: Stmt = { kind: "select", table: "doctors", columns: "count", where: { column: "on_call", op: "=", value: true } };
const goOff = (name: string): Stmt => ({ kind: "update", table: "doctors", column: "on_call", set: { value: false }, where: { column: "name", op: "=", value: name }, onlyIf: { read: 0, atLeast: 2 } });

/** The scenarios' scripts. */
export const SCRIPTS: Record<string, Script> = {
  reads: {
    title: "T1 reads the same rows twice while T2 changes them",
    tables: [accounts([{ id: 1, owner: "ana", balance: 120 }, { id: 2, owner: "ben", balance: 80 }])],
    T1: [RICH, RICH, COMMIT],
    T2: [{ kind: "update", table: "accounts", column: "balance", set: { add: 50 }, where: byId(1) }, { kind: "insert", table: "accounts", row: { id: 3, owner: "cy", balance: 200 } }, COMMIT],
  },
  deposits: {
    title: "Two read-modify-write updates of one balance",
    tables: [accounts([{ id: 1, owner: "ana", balance: 100 }])],
    T1: [balanceOf1, { kind: "update", table: "accounts", column: "balance", set: { read: 0, plus: 50 }, where: byId(1) }, COMMIT],
    T2: [balanceOf1, { kind: "update", table: "accounts", column: "balance", set: { read: 0, plus: -20 }, where: byId(1) }, COMMIT],
  },
  oncall: {
    title: "Two doctors each go off call if the other is on call",
    tables: [{ name: "doctors", columns: ["name", "on_call"], key: "name", rows: [{ name: "alice", on_call: true }, { name: "bob", on_call: true }] }],
    T1: [onCall, goOff("alice"), COMMIT],
    T2: [onCall, goOff("bob"), COMMIT],
  },
};

export const MAX_ATTEMPTS = 3;
export const SERIALIZATION_ERRORS = {
  update: "could not serialize access due to concurrent update",
  rw: "could not serialize access due to read/write dependencies among transactions",
} as const;

/** A row version (PostgreSQL's MVCC tuple). Attempt 0 is the committed setup. */
export interface Version {
  table: string;
  row: Row;
  /** Attempt that created this version. */
  xmin: number;
  /** Attempt that updated (replaced) it, if any. */
  xmax: number | null;
  /** The version that replaced it (PostgreSQL's update chain). */
  next: number | null;
}

/** One run of a transaction's script: the first, or a retry. */
export interface Attempt {
  id: number;
  tx: TxName;
  n: number;
  status: "active" | "committed" | "failed";
  /** Attempts committed when the transaction snapshot was taken (REPEATABLE READ and SERIALIZABLE). */
  snapshot: number[] | null;
  /** PostgreSQL transaction id, assigned at the first write. */
  xid: number | null;
  /** SELECT results of this attempt, by statement index, and the timeline position they were read at. */
  reads: Record<number, Row[]>;
  readAt: Record<number, number>;
  /** The attempts that wrote the row versions each SELECT returned. */
  readFrom: Record<number, number[]>;
  commitAt: number | null;
  error: string | null;
  // Serializable snapshot isolation bookkeeping (predicate.c's SERIALIZABLEXACT).
  siread: string[];
  doomed: boolean;
  prepareSeq: number | null;
  commitSeq: number | null;
  lastCommitBeforeSnapshot: number;
  snapXmin: number;
  finishedBefore: number | null;
  /** Committed with a rw-conflict out to a transaction that committed first. */
  conflictOut: boolean;
  readOnly: boolean;
}

export interface Waiting {
  stmt: number;
  version: number;
  holder: number;
  /** READ COMMITTED: the statement's own snapshot. */
  snapshot: number[];
}

export interface TxState {
  pc: number;
  attempt: number | null;
  waiting: Waiting | null;
  attempts: number;
}

export interface Entry {
  tx: TxName;
  attempt: number;
  kind: "begin" | "stmt" | "wait" | "resume" | "rollback" | "skip";
  sql: string;
  /** What psql prints (unaligned, tuples only), or a note for skipped statements. */
  out: string[];
  error?: boolean;
}

export interface IsoState {
  script: string;
  level: Level;
  versions: Version[];
  attempts: Attempt[];
  tx: Record<TxName, TxState>;
  timeline: Entry[];
  /** PostgreSQL's next transaction id and its serializable commit sequence number. */
  nextXid: number;
  seq: number;
  /** A statement ran while the other transaction was open. */
  overlapped: boolean;
  rwEdges: [number, number][];
}

export type IsoAction = { type: "setLevel"; level: Level } | { type: "run"; tx: TxName } | { type: "retry"; tx: TxName };

export interface IsoScenario {
  script: string;
  level: Level;
}

// ---- SQL text -----------------------------------------------------------------

const lit = (v: Value) => (typeof v === "string" ? `'${v}'` : String(v));
const cond = (c: Cond) => `${c.column} ${c.op} ${lit(c.value)}`;
const firstValue = (rows: Row[] | undefined): Value | undefined => {
  const r = rows?.[0];
  return r ? Object.values(r)[0] : undefined;
};

/** The SQL a statement sends; values read earlier are filled in once known (`:balance` until then). */
export function sql(stmt: Stmt, reads?: Record<number, Row[]>): string {
  switch (stmt.kind) {
    case "select":
      return `SELECT ${stmt.columns === "count" ? "count(*)" : stmt.columns.join(", ")} FROM ${stmt.table}${stmt.where ? ` WHERE ${cond(stmt.where)}` : ""}${stmt.orderBy ? ` ORDER BY ${stmt.orderBy}` : ""};`;
    case "update": {
      const s = stmt.set;
      let expr: string;
      if ("add" in s) expr = `${stmt.column} ${s.add < 0 ? "-" : "+"} ${Math.abs(s.add)}`;
      else if ("value" in s) expr = lit(s.value);
      else {
        const read = firstValue(reads?.[s.read]);
        expr = typeof read === "number" ? String(read + s.plus) : `:${stmt.column} ${s.plus < 0 ? "-" : "+"} ${Math.abs(s.plus)}`;
      }
      return `UPDATE ${stmt.table} SET ${stmt.column} = ${expr} WHERE ${cond(stmt.where)};`;
    }
    case "insert":
      return `INSERT INTO ${stmt.table} VALUES (${Object.values(stmt.row).map(lit).join(", ")});`;
    case "commit":
      return "COMMIT;";
  }
}

export const beginSql = (level: Level) => `BEGIN ISOLATION LEVEL ${level.toUpperCase()};`;
/** SQL that creates the scenario's tables (used by the real-PostgreSQL comparison and shown to learners). */
export function setupSql(script: Script): string[] {
  return script.tables.flatMap((t) => [
    `CREATE TABLE ${t.name} (${t.columns.map((c) => `${c} ${typeof t.rows[0]?.[c] === "number" ? "integer" : typeof t.rows[0]?.[c] === "boolean" ? "boolean" : "text"}`).join(", ")});`,
    `INSERT INTO ${t.name} VALUES ${t.rows.map((r) => `(${t.columns.map((c) => lit(r[c]!)).join(", ")})`).join(", ")};`,
  ]);
}

const psqlValue = (v: Value) => (typeof v === "boolean" ? (v ? "t" : "f") : String(v));
const psqlRows = (rows: Row[]) => rows.map((r) => Object.values(r).map(psqlValue).join("|"));

// ---- MVCC ---------------------------------------------------------------------

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const attemptOf = (s: IsoState, id: number): Attempt | undefined => (id === 0 ? undefined : s.attempts[id - 1]);
const committed = (s: IsoState, id: number) => id === 0 || attemptOf(s, id)?.status === "committed";
const failed = (s: IsoState, id: number) => attemptOf(s, id)?.status === "failed";
const takeSnapshot = (s: IsoState) => s.attempts.filter((a) => a.status === "committed").map((a) => a.id);
const inSnapshot = (snap: number[], id: number) => id === 0 || snap.includes(id);

/** Whether a row version is visible to attempt `me` reading with snapshot `snap`. */
export function visible(s: IsoState, v: Version, snap: number[], me: number): boolean {
  if (!(v.xmin === me || inSnapshot(snap, v.xmin))) return false;
  if (v.xmax === null || failed(s, v.xmax)) return true;
  if (v.xmax === me) return false;
  return !inSnapshot(snap, v.xmax);
}

const matches = (row: Row, c: Cond) => (c.op === "=" ? row[c.column] === c.value : (row[c.column] as number) >= (c.value as number));
const tableDef = (s: IsoState, name: string) => SCRIPTS[s.script]!.tables.find((t) => t.name === name)!;
const sortRows = (s: IsoState, table: string, rows: Row[]) => {
  const key = tableDef(s, table).key;
  return [...rows].sort((a, b) => (a[key]! < b[key]! ? -1 : a[key]! > b[key]! ? 1 : 0));
};

/** Rows of a table as a new transaction would see them now (only committed data). */
export function committedRows(s: IsoState, table: string): Row[] {
  const snap = takeSnapshot(s);
  return sortRows(s, table, s.versions.filter((v) => v.table === table && visible(s, v, snap, -1)).map((v) => v.row));
}

// ---- Serializable snapshot isolation (after predicate.c, for two transactions) ----

class SqlError extends Error {}

const edge = (s: IsoState, reader: number, writer: number) => s.rwEdges.some(([r, w]) => r === reader && w === writer);
const outOf = (s: IsoState, id: number) => s.rwEdges.filter(([r]) => r === id).map(([, w]) => attemptOf(s, w)!);
const inTo = (s: IsoState, id: number) => s.rwEdges.filter(([, w]) => w === id).map(([r]) => attemptOf(s, r)!);
const isCommitted = (a: Attempt) => a.status === "committed";

/** OnConflict_CheckForSerializationFailure: may fail `me`, or doom the writer. */
function onConflict(s: IsoState, me: Attempt, reader: Attempt, writer: Attempt) {
  let failure = isCommitted(writer) && writer.conflictOut;
  if (!failure) {
    failure = outOf(s, writer.id).some(
      (t2) =>
        isCommitted(t2) &&
        (!isCommitted(reader) || t2.prepareSeq! <= reader.commitSeq!) &&
        (!isCommitted(writer) || t2.prepareSeq! <= writer.commitSeq!) &&
        (!reader.readOnly || t2.prepareSeq! <= reader.lastCommitBeforeSnapshot),
    );
  }
  if (!failure && isCommitted(writer) && !reader.readOnly) {
    failure = inTo(s, reader.id).some((t0) => !t0.doomed && (!isCommitted(t0) || t0.commitSeq! >= writer.prepareSeq!) && (!t0.readOnly || t0.lastCommitBeforeSnapshot >= writer.prepareSeq!));
  }
  if (!failure) return;
  if (me === writer || isCommitted(writer)) throw new SqlError(SERIALIZATION_ERRORS.rw);
  writer.doomed = true;
}

function flagConflict(s: IsoState, me: Attempt, reader: Attempt, writer: Attempt) {
  onConflict(s, me, reader, writer);
  s.rwEdges.push([reader.id, writer.id]);
}

/** A sequential scan at SERIALIZABLE: relation-level SIREAD lock, then a conflict-out check per row version. */
function ssiScan(s: IsoState, me: Attempt, table: string, snap: number[]) {
  if (me.doomed) throw new SqlError(SERIALIZATION_ERRORS.rw);
  if (!me.siread.includes(table)) me.siread.push(table);
  for (const v of s.versions.filter((x) => x.table === table)) {
    const vis = visible(s, v, snap, me.id);
    if (failed(s, v.xmin)) continue; // dead
    let writer: number;
    if (!committed(s, v.xmin)) writer = v.xmin; // insert in progress
    else if (v.xmax === null || failed(s, v.xmax)) {
      if (vis) continue; // live and visible
      writer = v.xmin;
    } else writer = vis ? v.xmax : v.xmin; // delete in progress, or recently dead
    if (writer === me.id || writer === 0) continue;
    const w = attemptOf(s, writer)!;
    if (w.doomed) continue;
    if (inSnapshot(snap, writer)) continue; // not concurrent
    if (edge(s, me.id, writer)) continue;
    flagConflict(s, me, me, w);
  }
}

/** CheckForSerializableConflictIn: a write to `table` conflicts with every concurrent reader holding a SIREAD lock on it. */
function ssiConflictIn(s: IsoState, me: Attempt, table: string) {
  if (me.doomed) throw new SqlError(SERIALIZATION_ERRORS.rw);
  for (const reader of s.attempts) {
    if (reader.id === me.id || reader.status === "failed" || reader.snapshot === null || !reader.siread.includes(table)) continue;
    if (reader.doomed) continue;
    if (isCommitted(reader) && !(me.snapXmin < reader.finishedBefore!)) continue;
    if (edge(s, reader.id, me.id)) continue;
    flagConflict(s, me, reader, me);
  }
}

/** PreCommit_CheckForSerializationFailure, then commit (ReleasePredicateLocks). */
function ssiCommit(s: IsoState, me: Attempt) {
  if (me.doomed) throw new SqlError(SERIALIZATION_ERRORS.rw);
  for (const near of inTo(s, me.id)) {
    if (isCommitted(near) || near.doomed) continue;
    if (inTo(s, near.id).some((far) => far === me || (!isCommitted(far) && !far.readOnly && !far.doomed))) near.doomed = true;
  }
  me.prepareSeq = ++s.seq;
}

// ---- Statements -----------------------------------------------------------------

const script = (s: IsoState) => SCRIPTS[s.script]!;
const stmtsOf = (s: IsoState, tx: TxName) => script(s)[tx];
const serializable = (s: IsoState) => s.level === "serializable";
const txSnapshot = (s: IsoState) => s.level === "repeatable read" || s.level === "serializable";
const other = (tx: TxName): TxName => (tx === "T1" ? "T2" : "T1");

function assignXid(s: IsoState, a: Attempt) {
  a.xid ??= s.nextXid++;
}

function statementSnapshot(s: IsoState, a: Attempt): number[] {
  if (!txSnapshot(s)) return takeSnapshot(s);
  if (a.snapshot === null) {
    a.snapshot = takeSnapshot(s);
    a.lastCommitBeforeSnapshot = s.seq;
    const running = s.attempts.filter((x) => x.status === "active" && x.xid !== null).map((x) => x.xid!);
    a.snapXmin = running.length ? Math.min(...running) : s.nextXid;
  }
  return a.snapshot;
}

type Outcome = { out: string[] } | { wait: Waiting };

/** Lock the row version and update it — or wait, or (REPEATABLE READ / SERIALIZABLE) fail. */
function lockAndUpdate(s: IsoState, a: Attempt, stmtIndex: number, vid: number, snap: number[]): Outcome {
  const stmt = stmtsOf(s, a.tx)[stmtIndex] as Extract<Stmt, { kind: "update" }>;
  let v = s.versions[vid]!;
  for (;;) {
    if (v.xmax !== null && v.xmax !== a.id && !failed(s, v.xmax)) {
      const holder = attemptOf(s, v.xmax)!;
      if (holder.status === "active") return { wait: { stmt: stmtIndex, version: vid, holder: holder.id, snapshot: snap } };
      if (txSnapshot(s)) throw new SqlError(SERIALIZATION_ERRORS.update);
      // READ COMMITTED: follow the update chain to the newest version and re-check the WHERE clause.
      vid = v.next!;
      v = s.versions[vid]!;
      if (!matches(v.row, stmt.where)) return { out: ["UPDATE 0"] };
      continue;
    }
    break;
  }
  if (serializable(s)) ssiConflictIn(s, a, stmt.table);
  assignXid(s, a);
  const set = stmt.set;
  const value: Value = "add" in set ? (v.row[stmt.column] as number) + set.add : "value" in set ? set.value : (firstValue(a.reads[set.read]) as number) + set.plus;
  s.versions.push({ table: stmt.table, row: { ...v.row, [stmt.column]: value }, xmin: a.id, xmax: null, next: null });
  v.xmax = a.id;
  v.next = s.versions.length - 1;
  return { out: ["UPDATE 1"] };
}

function execute(s: IsoState, a: Attempt, stmtIndex: number): Outcome {
  const stmt = stmtsOf(s, a.tx)[stmtIndex]!;
  switch (stmt.kind) {
    case "select": {
      const snap = statementSnapshot(s, a);
      if (serializable(s)) ssiScan(s, a, stmt.table, snap);
      const seen = s.versions.filter((v) => v.table === stmt.table && visible(s, v, snap, a.id) && (!stmt.where || matches(v.row, stmt.where)));
      a.readFrom[stmtIndex] = seen.map((v) => v.xmin);
      const rows = sortRows(s, stmt.table, seen.map((v) => v.row));
      const result: Row[] = stmt.columns === "count" ? [{ count: rows.length }] : rows.map((r) => Object.fromEntries((stmt.columns as string[]).map((c) => [c, r[c]!])));
      a.reads[stmtIndex] = result;
      a.readAt[stmtIndex] = s.timeline.length;
      return { out: psqlRows(result) };
    }
    case "update": {
      const snap = statementSnapshot(s, a);
      if (serializable(s)) ssiScan(s, a, stmt.table, snap);
      const targets = s.versions.flatMap((v, i) => (v.table === stmt.table && visible(s, v, snap, a.id) && matches(v.row, stmt.where) ? [i] : []));
      if (!targets.length) return { out: ["UPDATE 0"] };
      return lockAndUpdate(s, a, stmtIndex, targets[0]!, snap);
    }
    case "insert": {
      statementSnapshot(s, a);
      if (serializable(s)) ssiConflictIn(s, a, stmt.table);
      assignXid(s, a);
      s.versions.push({ table: stmt.table, row: { ...stmt.row }, xmin: a.id, xmax: null, next: null });
      return { out: ["INSERT 0 1"] };
    }
    case "commit":
      if (serializable(s) && a.snapshot !== null) ssiCommit(s, a);
      finish(s, a, "committed");
      a.commitAt = s.timeline.length;
      return { out: ["COMMIT"] };
  }
}

/** End an attempt: commit or roll back, release its locks, and let a waiting transaction continue. */
function finish(s: IsoState, a: Attempt, status: "committed" | "failed") {
  a.status = status;
  if (status === "failed") {
    s.rwEdges = s.rwEdges.filter(([r, w]) => r !== a.id && w !== a.id);
    return;
  }
  if (a.snapshot === null || !serializable(s)) return;
  a.commitSeq = ++s.seq;
  a.finishedBefore = s.nextXid;
  if (a.xid === null) a.readOnly = true;
  // Conflicts out to transactions that already committed become a flag; conflicts in from committed or read-only ones are released.
  for (const [r, w] of s.rwEdges.filter(([r]) => r === a.id)) {
    const t = attemptOf(s, w)!;
    if (!a.readOnly && isCommitted(t)) a.conflictOut = true;
    if (isCommitted(t)) s.rwEdges = s.rwEdges.filter(([x, y]) => !(x === r && y === w));
  }
  for (const [r, w] of s.rwEdges.filter(([, w]) => w === a.id)) {
    const t = attemptOf(s, r)!;
    if (isCommitted(t) || t.readOnly) s.rwEdges = s.rwEdges.filter(([x, y]) => !(x === r && y === w));
  }
}

const describeOut = (out: string[]) => (out.length ? out.join(" / ") : "(no rows)");

/** Run one statement (or resume a waiting one) and record it on the timeline. */
function runStatement(s: IsoState, tx: TxName, events: string[], resume?: Waiting) {
  const t = s.tx[tx];
  const a = attemptOf(s, t.attempt!)!;
  const stmt = stmtsOf(s, tx)[t.pc]!;
  try {
    const outcome = resume ? lockAndUpdate(s, a, resume.stmt, resume.version, resume.snapshot) : execute(s, a, t.pc);
    const text = sql(stmt, a.reads);
    if ("wait" in outcome) {
      t.waiting = outcome.wait;
      const holder = attemptOf(s, outcome.wait.holder)!;
      s.timeline.push({ tx, attempt: a.n, kind: "wait", sql: text, out: [] });
      events.push(`${tx}: ${text} waits: ${holder.tx} has updated this row and has not finished yet.`);
      return;
    }
    t.waiting = null;
    s.timeline.push({ tx, attempt: a.n, kind: resume ? "resume" : "stmt", sql: text, out: outcome.out });
    events.push(`${tx}: ${text}${resume ? ` (no longer waiting)` : ""} → ${describeOut(outcome.out)}`);
    t.pc++;
  } catch (err) {
    if (!(err instanceof SqlError)) throw err;
    t.waiting = null;
    a.error = err.message;
    s.timeline.push({ tx, attempt: a.n, kind: resume ? "resume" : "stmt", sql: sql(stmt, a.reads), out: [`ERROR:  ${err.message}`], error: true });
    events.push(`${tx}: ${sql(stmt, a.reads)} → ERROR: ${err.message} (SQLSTATE 40001, a serialization failure).`);
    if (stmt.kind !== "commit") {
      s.timeline.push({ tx, attempt: a.n, kind: "rollback", sql: "ROLLBACK;", out: ["ROLLBACK"] });
      events.push(`${tx}: ROLLBACK; — the transaction is cancelled; none of its changes are kept.`);
    } else events.push(`${tx}: the COMMIT failed, so PostgreSQL rolled the transaction back.`);
    finish(s, a, "failed");
  }
  if (a.status !== "active") wake(s, other(tx), a.id, events);
}

function wake(s: IsoState, tx: TxName, ended: number, events: string[]) {
  const w = s.tx[tx].waiting;
  if (w && w.holder === ended) runStatement(s, tx, events, w);
}

function run(state: IsoState, tx: TxName): StepResult<IsoState> {
  const t0 = state.tx[tx];
  const current = t0.attempt === null ? null : attemptOf(state, t0.attempt)!;
  if (current?.status === "committed") return refuse(state, `${tx} has committed.`);
  if (current?.status === "failed") return refuse(state, `${tx} failed and was rolled back. Retry it to run it again from the start.`);
  if (t0.waiting) return refuse(state, `${tx} is waiting for ${other(tx)} to commit or roll back. Run ${other(tx)}.`);
  const s = clone(state);
  const t = s.tx[tx];
  const events: string[] = [];
  let a = current ? attemptOf(s, current.id)! : null;
  if (!a) {
    t.attempts++;
    a = {
      id: s.attempts.length + 1, tx, n: t.attempts, status: "active", snapshot: null, xid: null, reads: {}, readAt: {}, readFrom: {}, commitAt: null, error: null,
      siread: [], doomed: false, prepareSeq: null, commitSeq: null, lastCommitBeforeSnapshot: 0, snapXmin: 0, finishedBefore: null, conflictOut: false, readOnly: false,
    };
    s.attempts.push(a);
    t.attempt = a.id;
    s.timeline.push({ tx, attempt: a.n, kind: "begin", sql: beginSql(s.level), out: ["BEGIN"] });
    events.push(`${tx}: ${beginSql(s.level)}${a.n > 1 ? ` (attempt ${a.n})` : ""}${s.level === "read uncommitted" ? " PostgreSQL runs READ UNCOMMITTED exactly like READ COMMITTED." : ""}`);
  }
  const o = s.tx[other(tx)].attempt;
  if (o !== null && attemptOf(s, o)!.status === "active") s.overlapped = true;
  const stmt = stmtsOf(s, tx)[t.pc]!;
  if (stmt.kind === "update" && stmt.onlyIf) {
    const seen = firstValue(a.reads[stmt.onlyIf.read]) as number;
    if (seen < stmt.onlyIf.atLeast) {
      s.timeline.push({ tx, attempt: a.n, kind: "skip", sql: sql(stmt, a.reads), out: [`skipped: ${tx} read ${seen}, fewer than ${stmt.onlyIf.atLeast}`] });
      events.push(`${tx} read ${seen} on call, fewer than ${stmt.onlyIf.atLeast}, so the application skips its UPDATE.`);
      t.pc++;
      return { state: s, events };
    }
  }
  runStatement(s, tx, events);
  return { state: s, events };
}

const refuse = (state: IsoState, error: string): StepResult<IsoState> => ({ state, events: [], error });

function step(state: IsoState, a: IsoAction): StepResult<IsoState> {
  switch (a.type) {
    case "setLevel":
      if (state.timeline.length) return refuse(state, "Choose the isolation level before the first statement runs (press Reset).");
      return {
        state: { ...state, level: a.level },
        events: [`Both transactions will run at ${a.level.toUpperCase()}.${a.level === "read uncommitted" ? " In PostgreSQL this behaves exactly like READ COMMITTED: there are no dirty reads." : ""}`],
      };
    case "run":
      return run(state, a.tx);
    case "retry": {
      const t = state.tx[a.tx];
      const current = t.attempt === null ? null : attemptOf(state, t.attempt)!;
      if (current?.status !== "failed") return refuse(state, `Only a transaction that failed can be retried; ${a.tx} has not failed.`);
      if (t.attempts >= MAX_ATTEMPTS) return refuse(state, `This simulation allows ${MAX_ATTEMPTS} attempts per transaction.`);
      return { state: { ...state, tx: { ...state.tx, [a.tx]: { ...t, pc: 0, attempt: null, waiting: null } } }, events: [`${a.tx} will run again from its first statement, with a new snapshot.`] };
    }
  }
}

function init(p: IsoScenario): StepResult<IsoState> {
  const sc = SCRIPTS[p.script]!;
  const versions: Version[] = sc.tables.flatMap((t) => t.rows.map((row) => ({ table: t.name, row: { ...row }, xmin: 0, xmax: null, next: null })));
  const idle: TxState = { pc: 0, attempt: null, waiting: null, attempts: 0 };
  const state: IsoState = { script: p.script, level: p.level, versions, attempts: [], tx: { T1: { ...idle }, T2: { ...idle } }, timeline: [], nextXid: 1000, seq: 0, overlapped: false, rwEdges: [] };
  return { state, events: [`${sc.title}. Isolation level: ${p.level.toUpperCase()}. Run the statements in any order.`] };
}

// ---- Status and anomalies ---------------------------------------------------------

export type TxStatus = "not started" | "open" | "waiting" | "committed" | "failed" | "ready to retry";
export function txStatus(s: IsoState, tx: TxName): TxStatus {
  const t = s.tx[tx];
  if (t.waiting) return "waiting";
  if (t.attempt === null) return t.attempts ? "ready to retry" : "not started";
  return ({ active: "open", committed: "committed", failed: "failed" } as const)[attemptOf(s, t.attempt)!.status];
}
export const currentAttempt = (s: IsoState, tx: TxName): Attempt | null => (s.tx[tx].attempt === null ? null : attemptOf(s, s.tx[tx].attempt!)!);
/** The statement the transaction runs next, or null when it has finished. */
export function nextStatement(s: IsoState, tx: TxName): string | null {
  const status = txStatus(s, tx);
  if (status === "committed" || status === "failed") return null;
  const t = s.tx[tx];
  const stmt = stmtsOf(s, tx)[t.pc];
  if (!stmt) return null;
  const text = sql(stmt, currentAttempt(s, tx)?.reads);
  return t.attempt === null ? `${beginSql(s.level)} ${text}` : text;
}
export const finished = (s: IsoState, tx: TxName) => ["committed", "failed"].includes(txStatus(s, tx));

/** The anomalies (and serialization failures) visible in the state, in plain words. */
export function anomalies(s: IsoState): string[] {
  const out: string[] = [];
  for (const a of s.attempts) {
    const stmts = stmtsOf(s, a.tx);
    const idx = Object.keys(a.reads).map(Number);
    for (const i of idx) {
      for (const j of idx) {
        if (j <= i || sql(stmts[i]!) !== sql(stmts[j]!)) continue;
        const key = tableDef(s, (stmts[i] as { table: string }).table).key;
        const before = new Map(a.reads[i]!.map((r) => [r[key], JSON.stringify(r)]));
        const after = new Map(a.reads[j]!.map((r) => [r[key], JSON.stringify(r)]));
        const changed = [...before.keys()].filter((k) => after.has(k) && after.get(k) !== before.get(k));
        const phantom = [...after.keys()].filter((k) => !before.has(k)).concat([...before.keys()].filter((k) => !after.has(k)));
        if (changed.length) out.push(`Non-repeatable read: ${a.tx} read the same row (${key} ${changed.join(", ")}) twice and got different values.`);
        if (phantom.length) out.push(`Phantom read: running the same query again, ${a.tx} found a different set of rows (${key} ${phantom.join(", ")}).`);
      }
    }
  }
  for (const a of s.attempts) if (a.error) out.push(`Serialization failure (SQLSTATE 40001) in ${a.tx}${a.n > 1 ? ` attempt ${a.n}` : ""}: ${a.error}.`);
  if (finished(s, "T1") && finished(s, "T2")) {
    if (s.script === "deposits") {
      const expected = 100 + s.attempts.filter((a) => a.status === "committed").reduce((n, a) => n + ((stmtsOf(s, a.tx)[1] as { set: { plus: number } }).set.plus), 0);
      const balance = committedRows(s, "accounts")[0]?.balance;
      if (balance !== expected) out.push(`Lost update: the committed changes add up to ${expected}, but the balance is ${balance}. One transaction overwrote the other's change.`);
    }
    if (s.script === "oncall" && committedRows(s, "doctors").every((r) => !r.on_call)) out.push("Write skew: each transaction saw two doctors on call and took one off; together they left nobody on call.");
  }
  return out;
}

function describe(s: IsoState): string[] {
  const sc = script(s);
  const lines = [`Scenario: ${sc.title}. Isolation level: ${s.level.toUpperCase()}${s.level === "read uncommitted" ? " (runs as READ COMMITTED in PostgreSQL)" : ""}.`];
  for (const tx of TXS) {
    const next = nextStatement(s, tx);
    lines.push(`${tx}: ${txStatus(s, tx)}${s.tx[tx].attempts > 1 ? ` (attempt ${s.tx[tx].attempts})` : ""}.${next ? ` Next: ${next}` : ""}`);
  }
  if (!s.timeline.length) lines.push("Timeline: nothing has run yet.");
  s.timeline.forEach((e, i) => lines.push(`Timeline ${i + 1}. ${e.tx}: ${e.kind === "skip" ? `(${e.out[0]})` : `${e.sql} → ${e.kind === "wait" ? "waiting for the other transaction" : describeOut(e.out)}`}`));
  for (const t of sc.tables) lines.push(`Committed ${t.name}: ${committedRows(s, t.name).map((r) => t.columns.map((c) => psqlValue(r[c]!)).join("|")).join(", ")}.`);
  const found = anomalies(s);
  lines.push(found.length ? `Anomalies: ${found.join(" ")}` : "Anomalies: none so far.");
  return lines;
}

// ---- Challenge checks -------------------------------------------------------------

const committedAttempt = (s: IsoState, tx: TxName) => {
  const a = currentAttempt(s, tx);
  return a?.status === "committed" ? a : null;
};

export const isolationTimeline: SimulationModel<IsoState, IsoAction, IsoScenario> = {
  id: "postgresql-isolation-timeline",
  track: "postgresql",
  init,
  step,
  invariants: [
    {
      name: "no dirty reads: a SELECT only returns rows from committed transactions or its own",
      check: (s) => {
        for (const a of s.attempts) {
          for (const sources of Object.values(a.readFrom)) {
            const dirty = sources.find((x) => x !== a.id && !committed(s, x));
            if (dirty !== undefined) return `${a.tx} read a row version written by a transaction that has not committed`;
          }
        }
        return null;
      },
    },
    {
      name: "every row has exactly one current version",
      check: (s) => {
        for (const t of script(s).tables) {
          const keys = committedRows(s, t.name).map((r) => r[t.key]);
          if (new Set(keys).size !== keys.length) return `${t.name} has two committed versions of one row`;
        }
        return null;
      },
    },
    {
      name: "only a waiting transaction's lock holder is open",
      check: (s) => {
        for (const tx of TXS) {
          const w = s.tx[tx].waiting;
          if (w && attemptOf(s, w.holder)?.status !== "active") return `${tx} waits for a transaction that has ended`;
        }
        return null;
      },
    },
  ],
  checks: {
    /** T2 committed between T1's two identical reads, and T1 still read the same rows both times, then committed. */
    "stable-reads": (s) => {
      if (s.script !== "reads") return false;
      const t1 = committedAttempt(s, "T1");
      const t2 = committedAttempt(s, "T2");
      if (!t1 || !t2 || t1.readAt[0] === undefined || t1.readAt[1] === undefined) return false;
      return t1.readAt[0] < t2.commitAt! && t2.commitAt! < t1.readAt[1] && JSON.stringify(t1.reads[0]) === JSON.stringify(t1.reads[1]);
    },
    /** The transactions overlapped, both deposits committed, and the balance includes both. */
    "no-lost-update": (s) => s.script === "deposits" && s.overlapped && !!committedAttempt(s, "T1") && !!committedAttempt(s, "T2") && committedRows(s, "accounts")[0]?.balance === 130,
    /** The transactions overlapped, both finished, and at least one doctor is still on call. */
    "rule-holds": (s) => s.script === "oncall" && s.overlapped && finished(s, "T1") && finished(s, "T2") && committedRows(s, "doctors").some((r) => r.on_call === true),
  },
  describe,
};
