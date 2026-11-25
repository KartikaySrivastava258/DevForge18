/**
 * Registry of simulation models by id. Content (content/simulations/…) refers
 * to models by these ids; the server uses them to replay and verify challenges.
 */
import { commitGraph } from "./git/commit-graph.ts";
import { reconciliation } from "./kubernetes/reconciliation.ts";
import type { SimulationModel } from "./types.ts";

// Each model has its own state, action and scenario types; callers validate
// actions and scenarios with the model's own schemas before using them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModel = SimulationModel<any, any, any>;

export const MODELS: Readonly<Record<string, AnyModel>> = {
  [commitGraph.id]: commitGraph,
  [reconciliation.id]: reconciliation,
};
