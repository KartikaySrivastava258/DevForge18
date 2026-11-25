/**
 * Simulation: a sprint board (REMAINING_WORK.md §5.12).
 *
 * A three-person team plans a ten-day sprint from a prioritised backlog,
 * sets a work-in-progress (WIP) limit on the In Progress column, and plays
 * the sprint day by day. Each morning the team starts the next committed
 * stories while In Progress is under its limit; the day's work is shared
 * between the stories in progress that are not blocked; a story is done
 * when no work remains. A burndown and a cumulative flow are recorded.
 *
 * Follows the ideas the lesson teaches from Atlassian's documentation:
 * only work in the last column counts as done; unfinished work does not
 * count when the sprint ends; a WIP limit is a team rule the board shows,
 * and here the team follows it when starting work.
 *
 * Simplified (shown to learners): work is measured in story points and
 * the team does 3 points a day at full focus; every story started beyond
 * the three developers costs 10 % of the team's focus (context switching),
 * down to half; blockers happen on fixed days, not at random; there are
 * no new requests during the sprint.
 */
import type { SimulationModel, StepResult } from "../types.ts";

export interface Story {
  id: string;
  title: string;
  points: number;
  goal: boolean;
  /** Blocked for `days` days once it has been in progress for `after` days. */
  blocker?: { after: number; days: number; reason: string };
}

export const BACKLOG: readonly Story[] = [
  { id: "DEV-1", title: "Sign-up form", points: 3, goal: true },
  { id: "DEV-2", title: "Email confirmation", points: 5, goal: true, blocker: { after: 1, days: 2, reason: "waiting for the email provider's API key" } },
  { id: "DEV-3", title: "Course list page", points: 3, goal: true },
  { id: "DEV-4", title: "Profile photo upload", points: 5, goal: false },
  { id: "DEV-5", title: "Dark mode", points: 3, goal: false },
  { id: "DEV-6", title: "Export grades to CSV", points: 2, goal: false },
  { id: "DEV-7", title: "Admin report", points: 5, goal: false, blocker: { after: 2, days: 3, reason: "the report's numbers need a decision" } },
  { id: "DEV-8", title: "Search", points: 8, goal: false },
];
export const SPRINT_DAYS = 10;
export const DEVS = 3;
const TENTHS = 10;

export type Column = "todo" | "progress" | "done";
export interface CardState {
  id: string;
  /** Work left, in tenths of a point (integers keep the model exact). */
  left: number;
  column: Column;
  daysInProgress: number;
  blockedUntil: number | null;
}

export interface SprintState {
  day: number;
  wip: number;
  committed: string[];
  cards: CardState[];
  /** Committed points left at the end of each day (day 0 = plan). */
  burndown: number[];
  /** Cards per column at the end of each day. */
  flow: { todo: number; progress: number; done: number }[];
}

export type SprintAction =
  | { type: "commit"; id: string }
  | { type: "uncommit"; id: string }
  | { type: "setWip"; limit: number }
  | { type: "tick"; count?: number | undefined };

export interface SprintScenario {
  committed: string[];
  wip: number;
}

export const story = (id: string) => BACKLOG.find((s) => s.id === id)!;
export const focus = (active: number) => Math.max(0.5, 1 - 0.1 * Math.max(0, active - DEVS));
const pointsLeft = (s: Pick<SprintState, "cards">) => s.cards.reduce((n, c) => n + c.left, 0) / TENTHS;
const counts = (cards: CardState[]) => ({ todo: cards.filter((c) => c.column === "todo").length, progress: cards.filter((c) => c.column === "progress").length, done: cards.filter((c) => c.column === "done").length });
export const committedPoints = (s: Pick<SprintState, "committed">) => s.committed.reduce((n, id) => n + story(id).points, 0);
export const goalDone = (s: SprintState) => BACKLOG.filter((x) => x.goal).every((x) => s.cards.find((c) => c.id === x.id)?.column === "done");

function cardsFor(committed: string[]): CardState[] {
  return BACKLOG.filter((x) => committed.includes(x.id)).map((x) => ({ id: x.id, left: x.points * TENTHS, column: "todo", daysInProgress: 0, blockedUntil: null }));
}

function playDay(s: SprintState): { state: SprintState; event: string } {
  const day = s.day + 1;
  const cards = s.cards.map((c) => ({ ...c }));
  const started: string[] = [];
  // Morning: start the next committed stories while In Progress is under the limit.
  for (const c of cards) {
    if (c.column === "todo" && cards.filter((x) => x.column === "progress").length < s.wip) {
      c.column = "progress";
      started.push(c.id);
    }
  }
  // Blockers begin after a story has been in progress for a while.
  const blockedNow: string[] = [];
  for (const c of cards) {
    const b = story(c.id).blocker;
    if (c.column === "progress" && b && c.daysInProgress === b.after && c.blockedUntil === null) {
      c.blockedUntil = day + b.days - 1;
      blockedNow.push(`${c.id} (${b.reason})`);
    }
  }
  const active = cards.filter((c) => c.column === "progress" && !(c.blockedUntil !== null && day <= c.blockedUntil));
  let budget = Math.round(DEVS * focus(cards.filter((c) => c.column === "progress").length) * TENTHS);
  const budgetStart = budget;
  // Share the day's work evenly, in priority order; leftovers go to the next stories.
  let open = active.filter((c) => c.left > 0);
  while (budget > 0 && open.length) {
    const share = Math.max(1, Math.floor(budget / open.length));
    for (const c of open) {
      const w = Math.min(share, c.left, budget);
      c.left -= w;
      budget -= w;
    }
    open = open.filter((c) => c.left > 0);
  }
  const finished: string[] = [];
  for (const c of cards) {
    if (c.column === "progress") c.daysInProgress++;
    if (c.column === "progress" && c.left === 0) {
      c.column = "done";
      finished.push(c.id);
    }
  }
  const next: SprintState = { ...s, day, cards, burndown: [...s.burndown, pointsLeft({ cards })], flow: [...s.flow, counts(cards)] };
  const parts = [
    started.length ? `started ${started.join(", ")}` : null,
    blockedNow.length ? `blocked ${blockedNow.join(", ")}` : null,
    `${(budgetStart / TENTHS).toFixed(1)} points of work at ${Math.round(focus(cards.filter((c) => c.column === "progress").length + finished.length) * 100)} % focus`,
    finished.length ? `finished ${finished.join(", ")}` : null,
  ].filter(Boolean);
  return { state: next, event: `Day ${day}: ${parts.join("; ")}. ${pointsLeft(next).toFixed(1)} points left.` };
}

const refuse = (state: SprintState, error: string): StepResult<SprintState> => ({ state, events: [], error });

function step(s: SprintState, a: SprintAction): StepResult<SprintState> {
  switch (a.type) {
    case "commit":
    case "uncommit": {
      if (s.day > 0) return refuse(s, "The sprint has started: planning is over.");
      if (!BACKLOG.some((x) => x.id === a.id)) return refuse(s, `There is no story ${a.id}.`);
      const committed = a.type === "commit" ? BACKLOG.map((x) => x.id).filter((id) => id === a.id || s.committed.includes(id)) : s.committed.filter((id) => id !== a.id);
      const cards = cardsFor(committed);
      const next = { ...s, committed, cards, burndown: [pointsLeft({ cards })], flow: [counts(cards)] };
      return { state: next, events: [`${a.type === "commit" ? "Committed" : "Removed"} ${a.id} (${story(a.id).points} points). The sprint holds ${committedPoints(next)} points; the team's full-focus capacity is ${DEVS * SPRINT_DAYS}.`] };
    }
    case "setWip":
      if (a.limit < 1 || a.limit > 8) return refuse(s, "The WIP limit must be 1 to 8.");
      return { state: { ...s, wip: a.limit }, events: [`In Progress now has a WIP limit of ${a.limit}.`] };
    case "tick": {
      let state = s;
      const events: string[] = [];
      for (let i = 0; i < (a.count ?? 1); i++) {
        if (state.day >= SPRINT_DAYS) return i === 0 ? refuse(s, "The sprint is over.") : { state, events };
        const r = playDay(state);
        state = r.state;
        events.push(r.event);
      }
      if (state.day === SPRINT_DAYS && s.day < SPRINT_DAYS) {
        const open = state.cards.filter((c) => c.column !== "done").map((c) => c.id);
        events.push(`Sprint over. Sprint goal ${goalDone(state) ? "met" : "MISSED"}; ${open.length ? `not finished: ${open.join(", ")} — they would go back to the backlog or into the next sprint` : "every committed story is done"}.`);
      }
      return { state, events };
    }
  }
}

function init(p: SprintScenario): StepResult<SprintState> {
  const committed = BACKLOG.map((x) => x.id).filter((id) => p.committed.includes(id));
  const cards = cardsFor(committed);
  const state: SprintState = { day: 0, wip: p.wip, committed, cards, burndown: [pointsLeft({ cards })], flow: [counts(cards)] };
  return { state, events: [`Sprint planning: ${committed.length} stories, ${committedPoints(state)} points committed; WIP limit ${p.wip}. Sprint goal: ${BACKLOG.filter((x) => x.goal).map((x) => x.id).join(", ")}.`] };
}

function describe(s: SprintState): string[] {
  const col = (c: Column) => s.cards.filter((x) => x.column === c).map((x) => `${x.id} (${(x.left / TENTHS).toFixed(1)} left${x.blockedUntil !== null && s.day <= x.blockedUntil && x.column === "progress" ? ", blocked" : ""})`).join(", ") || "none";
  return [
    `Day ${s.day} of ${SPRINT_DAYS}. ${s.committed.length} stories, ${committedPoints(s)} points committed; WIP limit ${s.wip}.`,
    `To Do: ${col("todo")}.`,
    `In Progress: ${col("progress")}.`,
    `Done: ${col("done")}.`,
    `Burndown (points left each day): ${s.burndown.map((p) => p.toFixed(1)).join(", ")}.`,
    `Sprint goal (${BACKLOG.filter((x) => x.goal).map((x) => x.id).join(", ")}): ${goalDone(s) ? "done" : "not done yet"}.`,
  ];
}

export const sprintBoard: SimulationModel<SprintState, SprintAction, SprintScenario> = {
  id: "jira-sprint-board",
  track: "jira",
  init,
  step,
  tick: { type: "tick" },
  cost: (a) => (a.type === "tick" ? (a.count ?? 1) : 1),
  invariants: [
    { name: "work left is never negative or more than the story's size", check: (s) => (s.cards.every((c) => c.left >= 0 && c.left <= story(c.id).points * TENTHS) ? null : "bad work left") },
    { name: "a done story has no work left", check: (s) => (s.cards.every((c) => c.column !== "done" || c.left === 0) ? null : "done with work left") },
    { name: "every committed story is on the board exactly once", check: (s) => (s.cards.length === s.committed.length && s.cards.every((c, i) => c.id === s.committed[i]) ? null : "board and plan disagree") },
  ],
  checks: {
    /** The sprint is over and every sprint-goal story is done. */
    "goal-met": (s) => s.day === SPRINT_DAYS && goalDone(s),
    /** The sprint is over, the goal is met and every committed story is done (nothing carried over). */
    "all-done": (s) => s.day === SPRINT_DAYS && goalDone(s) && s.cards.length > 0 && s.cards.every((c) => c.column === "done"),
  },
  describe,
};
