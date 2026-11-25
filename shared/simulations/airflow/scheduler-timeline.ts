/**
 * Simulation: the scheduler timeline (REMAINING_WORK.md §5.16).
 *
 * One daily DAG loads each day's orders into a table. "Now" moves forward a
 * day at a time; the scheduler creates one run per logical date. Some days
 * the source is briefly down, so the first attempt for that day fails. The
 * learner sets retries, chooses how the load task writes (append or
 * replace the day's rows), clears runs and creates backfills, and watches
 * both the runs and the data they leave in the table.
 *
 * Follows the Airflow 3 documentation: @daily runs at midnight and a run's
 * logical date is that midnight; with catchup the scheduler creates every
 * missed run since start_date, without it (the default) only the most
 * recent one; a task is retried up to `retries` extra times; a backfill's
 * reprocess behaviour decides which dates get a new run — none (missing
 * dates only), failed (missing and failed) or completed (all of them).
 *
 * Simplified (shown to learners): time moves in whole days and runs finish
 * instantly; a new run for a date replaces the old one in the view; the
 * source is down only for the first attempt on a day; in replace mode the
 * delete and the insert happen in one transaction, so a failed attempt
 * leaves the table as it was; in append mode a failed attempt leaves the
 * rows it inserted before failing.
 */
import type { SimulationModel, StepResult } from "../types.ts";

/** Days are counted from 1 January 2026 (day 0). */
export const LAST_DAY = 59;
const MONTHS: [string, number][] = [["Jan", 31], ["Feb", 28], ["Mar", 31]];

export function dayLabel(day: number): string {
  let d = day;
  for (const [name, len] of MONTHS) {
    if (d < len) return `${d + 1} ${name}`;
    d -= len;
  }
  return `day ${day}`;
}

/** The number of orders the source holds for a day (what a correct load writes). */
export const expectedRows = (day: number) => 10 + ((day * 7) % 5);
/** Rows an append-mode attempt has inserted when the source times out. */
export const partialRows = (day: number) => Math.floor(expectedRows(day) / 2);

export type WriteMode = "append" | "replace";
export type Reprocess = "none" | "failed" | "completed";
export type RunKind = "scheduled" | "backfill";

export interface DagRun {
  day: number;
  kind: RunKind;
  state: "success" | "failed";
  /** Attempts in this run (try numbers 1..tries). */
  tries: number;
  /** How many times a run for this date has been created or cleared. */
  runCount: number;
}

export interface AirflowState {
  now: number;
  start: number;
  catchup: boolean;
  retries: number;
  write: WriteMode;
  /** Days whose first attempt fails because the source is briefly down. */
  flaky: number[];
  /** The latest run for each logical date, sorted by date. */
  runs: DagRun[];
  /** Rows in the orders table per day. */
  rows: Record<number, number>;
  /** Attempts made so far per day (the source outage hits only the first). */
  attempts: Record<number, number>;
}

export type AirflowAction =
  | { type: "tick"; count?: number | undefined }
  | { type: "setRetries"; retries: number }
  | { type: "setWrite"; mode: WriteMode }
  | { type: "clear"; day: number }
  | { type: "backfill"; from: number; to: number; reprocess: Reprocess };

export interface AirflowScenario {
  start: number;
  /** The day the DAG is deployed (and unpaused). */
  deployed: number;
  /** The day the learner starts at; days between are scheduled normally. */
  now: number;
  catchup: boolean;
  retries: number;
  write: WriteMode;
  flaky: number[];
}

const runFor = (s: AirflowState, day: number) => s.runs.find((r) => r.day === day);

/** Execute one run for a date: attempts up to retries + 1, writing rows as the task does. */
function execute(s: AirflowState, day: number, kind: RunKind): { state: AirflowState; event: string } {
  let rows = s.rows[day] ?? 0;
  let attempts = s.attempts[day] ?? 0;
  const before = rows;
  const notes: string[] = [];
  let tries = 0;
  let ok = false;
  for (let t = 0; t <= s.retries && !ok; t++) {
    tries++;
    const outage = s.flaky.includes(day) && attempts === 0;
    attempts++;
    if (outage) {
      if (s.write === "append") {
        rows += partialRows(day);
        notes.push(`try ${tries} timed out after inserting ${partialRows(day)} rows`);
      } else notes.push(`try ${tries} timed out (its transaction was rolled back)`);
      continue;
    }
    rows = s.write === "append" ? rows + expectedRows(day) : expectedRows(day);
    ok = true;
    notes.push(`try ${tries} ${s.write === "append" ? `inserted ${expectedRows(day)} rows` : `replaced the day's rows with ${expectedRows(day)}`}`);
  }
  const previous = runFor(s, day);
  const run: DagRun = { day, kind, state: ok ? "success" : "failed", tries, runCount: (previous?.runCount ?? 0) + 1 };
  const runs = [...s.runs.filter((r) => r.day !== day), run].sort((a, b) => a.day - b.day);
  const state = { ...s, runs, rows: { ...s.rows, [day]: rows }, attempts: { ...s.attempts, [day]: attempts } };
  const want = expectedRows(day);
  const table = rows === want ? `the table has the correct ${want} rows` : `the table now has ${rows} rows for ${dayLabel(day)} (it should have ${want})`;
  return { state, event: `${kind === "backfill" ? "Backfill run" : previous ? "Re-run" : "Scheduled run"} for ${dayLabel(day)}: ${notes.join("; ")} — ${ok ? "success" : "failed"}; ${rows === before && !ok ? "the table is unchanged" : table}.` };
}

const refuse = (state: AirflowState, error: string): StepResult<AirflowState> => ({ state, events: [], error });

function step(s: AirflowState, a: AirflowAction): StepResult<AirflowState> {
  switch (a.type) {
    case "tick": {
      const count = a.count ?? 1;
      if (s.now + count > LAST_DAY) return refuse(s, `This simulation ends on ${dayLabel(LAST_DAY)}.`);
      let state = s;
      const events: string[] = [];
      for (let i = 0; i < count; i++) {
        state = { ...state, now: state.now + 1 };
        const r = execute(state, state.now, "scheduled");
        state = r.state;
        events.push(`Midnight, ${dayLabel(state.now)}. ${r.event}`);
      }
      return { state, events };
    }
    case "setRetries":
      return { state: { ...s, retries: a.retries }, events: [`The task now has retries=${a.retries}: up to ${a.retries + 1} attempt(s) per run.`] };
    case "setWrite":
      return {
        state: { ...s, write: a.mode },
        events: [a.mode === "append" ? "The load task now appends: INSERT the day's orders." : "The load task now replaces the day: DELETE that day's rows, then INSERT, in one transaction."],
      };
    case "clear": {
      if (!runFor(s, a.day)) return refuse(s, `There is no run for ${dayLabel(a.day)} to clear.`);
      const r = execute(s, a.day, runFor(s, a.day)!.kind);
      return { state: r.state, events: [`Cleared the run for ${dayLabel(a.day)}. ${r.event}`] };
    }
    case "backfill": {
      if (a.from > a.to) return refuse(s, "The start of the range must not be after its end.");
      if (a.from < s.start) return refuse(s, `The DAG's start_date is ${dayLabel(s.start)}; a backfill cannot start before it.`);
      if (a.to > s.now) return refuse(s, `A backfill is for past dates; today is ${dayLabel(s.now)}.`);
      let state = s;
      const events: string[] = [`Backfill ${dayLabel(a.from)} to ${dayLabel(a.to)} with reprocess behaviour "${a.reprocess}".`];
      for (let day = a.from; day <= a.to; day++) {
        const existing = runFor(state, day);
        const redo = !existing || a.reprocess === "completed" || (a.reprocess === "failed" && existing.state === "failed");
        if (!redo) continue;
        const r = execute(state, day, "backfill");
        state = r.state;
        events.push(r.event);
      }
      if (events.length === 1) events.push("Every date in the range already has a run this behaviour leaves alone: nothing to do.");
      return { state, events };
    }
  }
}

function init(p: AirflowScenario): StepResult<AirflowState> {
  if (p.deployed < p.start || p.now < p.deployed) return { state: undefined as never, events: [], error: "deployed must be between start and now" };
  let s: AirflowState = { now: p.deployed, start: p.start, catchup: p.catchup, retries: p.retries, write: p.write, flaky: p.flaky, runs: [], rows: {}, attempts: {} };
  // On deployment: with catchup, every missed date since start_date; without it, only the most recent one.
  for (let day = p.catchup ? p.start : p.deployed; day <= p.deployed; day++) s = execute(s, day, "scheduled").state;
  while (s.now < p.now) {
    s = { ...s, now: s.now + 1 };
    s = execute(s, s.now, "scheduled").state;
  }
  const failed = s.runs.filter((r) => r.state === "failed").length;
  return {
    state: s,
    events: [`Scenario ready: today is ${dayLabel(s.now)}; the DAG starts on ${dayLabel(p.start)} with catchup=${p.catchup ? "True" : "False"}. ${s.runs.length} run(s) so far, ${failed} failed. ${describeRows(s)}`],
  };
}

export const wrongDays = (s: AirflowState) =>
  Object.keys(s.rows)
    .map(Number)
    .filter((d) => (s.rows[d] ?? 0) !== 0 && s.rows[d] !== expectedRows(d));

function describeRows(s: AirflowState): string {
  const wrong = wrongDays(s);
  return wrong.length ? `Days with the wrong number of rows: ${wrong.map(dayLabel).join(", ")}.` : "Every loaded day has the right number of rows.";
}

function describe(s: AirflowState): string[] {
  const lines = [
    `Today is ${dayLabel(s.now)}. The DAG runs @daily from ${dayLabel(s.start)}, catchup=${s.catchup ? "True" : "False"}, retries=${s.retries}, and its load task ${s.write === "append" ? "appends rows" : "replaces the day's rows"}.`,
  ];
  for (let day = s.start; day <= s.now; day++) {
    const r = runFor(s, day);
    const rows = s.rows[day] ?? 0;
    lines.push(`${dayLabel(day)}: ${r ? `${r.kind} run ${r.state} after ${r.tries} tr${r.tries === 1 ? "y" : "ies"}` : "no run"}; ${rows} of ${expectedRows(day)} rows in the table${rows !== 0 && rows !== expectedRows(day) ? " — wrong" : ""}.`);
  }
  lines.push(describeRows(s));
  return lines;
}

const firstWeek = (s: AirflowState) => Array.from({ length: 7 }, (_, i) => s.start + i);

export const schedulerTimeline: SimulationModel<AirflowState, AirflowAction, AirflowScenario> = {
  id: "airflow-scheduler-timeline",
  track: "airflow",
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : a.type === "backfill" ? a.to - a.from + 1 : 1),
  invariants: [
    {
      name: "a logical date has at most one current run",
      check: (s) => {
        const days = s.runs.map((r) => r.day);
        return new Set(days).size === days.length ? null : "two runs share a logical date";
      },
    },
    {
      name: "no run has a logical date in the future or before start_date",
      check: (s) => {
        const bad = s.runs.find((r) => r.day > s.now || r.day < s.start);
        return bad ? `a run for ${dayLabel(bad.day)}` : null;
      },
    },
    {
      name: "a run tries at least once and at most retries + 1 times",
      check: (s) => {
        const bad = s.runs.find((r) => r.tries < 1 || r.tries > 4);
        return bad ? `${bad.tries} tries for ${dayLabel(bad.day)}` : null;
      },
    },
  ],
  checks: {
    /** Every date in the first week has a successful run. */
    "week-all-success": (s) => firstWeek(s).every((d) => runFor(s, d)?.state === "success"),
    /** Every date in the first week has a successful run and exactly the right rows, and no day anywhere has duplicates. */
    "week-correct": (s) => firstWeek(s).every((d) => runFor(s, d)?.state === "success" && s.rows[d] === expectedRows(d)) && wrongDays(s).length === 0,
  },
  describe,
};
