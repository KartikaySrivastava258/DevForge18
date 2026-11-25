/**
 * The contract every simulation model follows (REMAINING_WORK.md §4.3, ADR 0008).
 *
 * A model is pure and deterministic: next = step(state, action). The same
 * scenario and the same list of actions always give the same state, so the
 * browser can run it interactively and the server can replay a learner's
 * actions to verify a challenge before recording progress. Models never use
 * Math.random, Date or I/O.
 */
import type { z } from "zod/v4";

export interface StepResult<S> {
  state: S;
  /** Plain-language explanation of what changed, one entry per change (the event log). */
  events: string[];
  /** Set when the action was refused; the state is then unchanged. */
  error?: string;
}

export interface Invariant<S> {
  name: string;
  /** Returns a description of the violation, or null when the invariant holds. */
  check: (state: S) => string | null;
}

export interface SimulationModel<S, A, P> {
  id: string;
  track: string;
  /** Validates a scenario's params from content/simulations/<track>/<id>.yaml. */
  scenarioSchema: z.ZodType<P>;
  /** Validates one action, in the browser and again on the server. */
  actionSchema: z.ZodType<A>;
  init: (params: P) => StepResult<S>;
  step: (state: S, action: A) => StepResult<S>;
  /** Present for models where time passes (Play advances by this action). */
  tick?: A;
  invariants: Invariant<S>[];
  /** Challenge checks by name; `initial` is the scenario's starting state. */
  checks: Record<string, (state: S, initial: S) => boolean>;
  /** Text mode: the whole state as plain-language lines (also the text alternative). */
  describe: (state: S) => string[];
  /** The ticks an action represents, for the server's replay limit. */
  cost?: (action: A) => number;
}

/** Limits for replaying a learner's actions on the server. */
export const REPLAY_LIMITS = { actions: 400, cost: 3000 } as const;

export interface ReplayResult<S> {
  state: S;
  initial: S;
  events: string[];
  /** Index and message of the first refused action, if any. */
  refused?: { index: number; error: string };
}

/** Run a scenario and a list of actions through a model. Refused actions are skipped, as in the UI. */
export function replay<S, A, P>(model: SimulationModel<S, A, P>, params: P, actions: A[]): ReplayResult<S> {
  const start = model.init(params);
  if (start.error) throw new Error(`scenario does not initialise: ${start.error}`);
  let state = start.state;
  const events = [...start.events];
  let refused: ReplayResult<S>["refused"];
  actions.forEach((action, index) => {
    const result = model.step(state, action);
    if (result.error) {
      refused ??= { index, error: result.error };
      return;
    }
    state = result.state;
    events.push(...result.events);
  });
  return { state, initial: start.state, events, ...(refused ? { refused } : {}) };
}

/** All invariant violations of a state (empty when it is valid). */
export function violations<S>(model: { invariants: Invariant<S>[] }, state: S): string[] {
  return model.invariants.flatMap((inv) => {
    const problem = inv.check(state);
    return problem ? [`${inv.name}: ${problem}`] : [];
  });
}
