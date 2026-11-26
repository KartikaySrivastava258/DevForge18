/**
 * Simulation: the query planner and indexes (REMAINING_WORK.md §5.4).
 *
 * A fixed table of 100,000 orders with known column distributions. The
 * learner creates and drops B-tree indexes (one or two columns) and runs
 * EXPLAIN on a query; a simplified planner compares a sequential scan
 * with every usable index and picks the cheapest, showing the rows each
 * plan touches.
 *
 * Follows the PostgreSQL documentation: the planner picks the plan it
 * estimates is cheapest; a sequential scan reads every row and filters;
 * a B-tree index can be used for =, <, > on its columns, and a
 * multicolumn index is most efficient with conditions on its leading
 * columns; fetching rows through an index is much more expensive per row
 * than reading the table in order, so an index only pays off for
 * selective conditions.
 *
 * Simplified (shown to learners): costs are invented units (a sequential
 * scan costs 1,637; each row fetched through an index costs 0.25 plus 3
 * for the descent); row counts come from exact distributions instead of
 * sampled statistics; only one index is used per plan.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export const ROWS = 100_000;
export const SEQ_COST = 637 + ROWS * 0.01;
export const COLUMNS = ["customer_id", "status", "day"] as const;
export type Column = (typeof COLUMNS)[number];

export interface Condition {
  column: Column;
  op: "=" | ">";
  value: string;
  /** Fraction of the table this condition matches. */
  selectivity: number;
}
export interface Query {
  sql: string;
  conditions: Condition[];
}

/** The queries the scenarios use (selectivities from the table's distributions). */
export const QUERIES: Record<string, Query> = {
  customer: { sql: "SELECT * FROM orders WHERE customer_id = 42", conditions: [{ column: "customer_id", op: "=", value: "42", selectivity: 1 / 5000 }] },
  pendingDay: {
    sql: "SELECT * FROM orders WHERE status = 'pending' AND day = 100",
    conditions: [
      { column: "status", op: "=", value: "'pending'", selectivity: 0.1 },
      { column: "day", op: "=", value: "100", selectivity: 1 / 365 },
    ],
  },
  shipped: { sql: "SELECT * FROM orders WHERE status = 'shipped'", conditions: [{ column: "status", op: "=", value: "'shipped'", selectivity: 0.9 }] },
};

export interface Index {
  name: string;
  columns: Column[];
}
export interface Plan {
  kind: "seq" | "index";
  index?: string;
  /** Rows the plan reads (sequential scan: all; index: those matching the index condition). */
  touched: number;
  /** Rows returned by the query. */
  returned: number;
  cost: number;
  /** The other plans the planner compared, for the explanation. */
  considered: { label: string; cost: number; touched: number }[];
}

export interface PlannerState {
  query: string;
  indexes: Index[];
  last: Plan | null;
}

export type PlannerAction = { type: "createIndex"; columns: Column[] } | { type: "dropIndex"; name: string } | { type: "explain" };

export interface PlannerScenario {
  query: string;
  indexes: Column[][];
}

const rowsFor = (sel: number) => Math.round(ROWS * sel);
export const indexName = (cols: Column[]) => `orders_${cols.join("_")}_idx`;

/** Which of the query's conditions an index can use: its leading columns, left to right, stopping at a range. */
export function usableConditions(index: Index, q: Query): Condition[] {
  const used: Condition[] = [];
  for (const col of index.columns) {
    const c = q.conditions.find((x) => x.column === col);
    if (!c) break;
    used.push(c);
    if (c.op !== "=") break;
  }
  return used;
}

export function plan(s: Pick<PlannerState, "query" | "indexes">): Plan {
  const q = QUERIES[s.query]!;
  const returned = rowsFor(q.conditions.reduce((p, c) => p * c.selectivity, 1));
  const considered: Plan["considered"] = [{ label: "Seq Scan", cost: SEQ_COST, touched: ROWS }];
  let best: Plan = { kind: "seq", touched: ROWS, returned, cost: SEQ_COST, considered };
  for (const ix of s.indexes) {
    const used = usableConditions(ix, q);
    if (!used.length) continue;
    const touched = rowsFor(used.reduce((p, c) => p * c.selectivity, 1));
    const cost = 3 + touched * 0.25;
    considered.push({ label: `Index Scan using ${ix.name}`, cost, touched });
    if (cost < best.cost) best = { kind: "index", index: ix.name, touched, returned, cost, considered };
  }
  return { ...best, considered };
}

const refuse = (state: PlannerState, error: string): StepResult<PlannerState> => ({ state, events: [], error });
const pct = (n: number) => `${((n / ROWS) * 100).toFixed(n < ROWS / 100 ? 2 : 0)} %`;

function step(s: PlannerState, a: PlannerAction): StepResult<PlannerState> {
  switch (a.type) {
    case "createIndex": {
      if (a.columns.length < 1 || a.columns.length > 2 || new Set(a.columns).size !== a.columns.length) return refuse(s, "An index here has one or two different columns.");
      const name = indexName(a.columns);
      if (s.indexes.some((i) => i.name === name)) return refuse(s, `${name} already exists.`);
      if (s.indexes.length >= 4) return refuse(s, "This simulation allows at most 4 indexes.");
      return { state: { ...s, indexes: [...s.indexes, { name, columns: a.columns }], last: null }, events: [`CREATE INDEX ${name} ON orders (${a.columns.join(", ")}).`] };
    }
    case "dropIndex":
      if (!s.indexes.some((i) => i.name === a.name)) return refuse(s, `There is no index ${a.name}.`);
      return { state: { ...s, indexes: s.indexes.filter((i) => i.name !== a.name), last: null }, events: [`DROP INDEX ${a.name}.`] };
    case "explain": {
      const p = plan(s);
      const others = p.considered.filter((c) => !(p.kind === "seq" ? c.label === "Seq Scan" : c.label.endsWith(p.index ?? "")));
      return {
        state: { ...s, last: p },
        events: [
          `${p.kind === "seq" ? "Seq Scan on orders" : `Index Scan using ${p.index}`}: touched ${p.touched.toLocaleString("en")} rows (${pct(p.touched)}) to return ${p.returned.toLocaleString("en")}; cost ${p.cost.toFixed(0)}.${others.length ? ` Also considered: ${others.map((o) => `${o.label} (cost ${o.cost.toFixed(0)})`).join("; ")}.` : ""}`,
        ],
      };
    }
  }
}

function init(p: PlannerScenario): StepResult<PlannerState> {
  const state: PlannerState = { query: p.query, indexes: p.indexes.map((cols) => ({ name: indexName(cols), columns: cols })), last: null };
  return { state, events: [`Query: ${QUERIES[p.query]!.sql}. Indexes: ${state.indexes.length ? state.indexes.map((i) => i.name).join(", ") : "none besides the primary key"}.`] };
}

function describe(s: PlannerState): string[] {
  const q = QUERIES[s.query]!;
  return [
    `Table orders: ${ROWS.toLocaleString("en")} rows. Query: ${q.sql}.`,
    `Indexes: ${s.indexes.length ? s.indexes.map((i) => `${i.name} (${i.columns.join(", ")})`).join("; ") : "none"}.`,
    s.last
      ? `Last plan: ${s.last.kind === "seq" ? "Seq Scan" : `Index Scan using ${s.last.index}`}, touched ${s.last.touched} rows (${pct(s.last.touched)}), returned ${s.last.returned}, cost ${s.last.cost.toFixed(0)}. Considered: ${s.last.considered.map((c) => `${c.label} cost ${c.cost.toFixed(0)}`).join("; ")}.`
      : "Not explained yet.",
  ];
}

export const queryPlanner: SimulationModel<PlannerState, PlannerAction, PlannerScenario> = {
  id: "postgresql-query-planner",
  track: "postgresql",
  init,
  step,
  invariants: [
    { name: "a plan never touches fewer rows than it returns", check: (s) => (s.last && s.last.touched < s.last.returned ? "touched < returned" : null) },
    { name: "the planner picks the cheapest plan it considered", check: (s) => (s.last && s.last.considered.some((c) => c.cost < s.last!.cost) ? "a cheaper plan was ignored" : null) },
  ],
  checks: {
    /** The last EXPLAIN used an index and touched fewer than 1 % of the rows. */
    "under-1-percent": (s) => !!s.last && s.last.kind === "index" && s.last.touched < ROWS / 100,
  },
  describe,
};
