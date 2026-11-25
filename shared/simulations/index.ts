/**
 * Server-side registry of simulation models by id: each model's logic plus
 * the zod schemas that validate scenarios and actions. Content
 * (content/simulations/…) refers to models by these ids, and the server uses
 * them to replay and verify challenges. Browsers import the logic only
 * (web/src/simulations/), so zod is never shipped to them for simulations.
 */
import type { z } from "zod/v4";
import { commitGraph } from "./git/commit-graph.ts";
import { GitActionSchema, GitScenarioSchema } from "./git/schema.ts";
import { reconciliation } from "./kubernetes/reconciliation.ts";
import { K8sActionSchema, K8sScenarioSchema } from "./kubernetes/schema.ts";
import { PromActionSchema, PromScenarioSchema } from "./prometheus/schema.ts";
import { scrapeAndRate } from "./prometheus/scrape-and-rate.ts";
import { WaterfallActionSchema, WaterfallScenarioSchema } from "./opentelemetry/schema.ts";
import { traceWaterfall } from "./opentelemetry/trace-waterfall.ts";
import { consumerGroups } from "./kafka/consumer-groups.ts";
import { KafkaActionSchema, KafkaScenarioSchema } from "./kafka/schema.ts";
import { AirflowActionSchema, AirflowScenarioSchema } from "./airflow/schema.ts";
import { schedulerTimeline } from "./airflow/scheduler-timeline.ts";
import { experimentExplorer } from "./mlflow/experiment-explorer.ts";
import { ExplorerActionSchema, ExplorerScenarioSchema } from "./mlflow/schema.ts";
import type { SimulationModel } from "./types.ts";

// Each model has its own state, action and scenario types; callers validate
// actions and scenarios with the model's own schemas before using them.
export type AnyModel = SimulationModel<any, any, any> & { scenarioSchema: z.ZodType<any>; actionSchema: z.ZodType<any> };

export const MODELS: Readonly<Record<string, AnyModel>> = {
  [commitGraph.id]: { ...commitGraph, scenarioSchema: GitScenarioSchema, actionSchema: GitActionSchema },
  [reconciliation.id]: { ...reconciliation, scenarioSchema: K8sScenarioSchema, actionSchema: K8sActionSchema },
  [scrapeAndRate.id]: { ...scrapeAndRate, scenarioSchema: PromScenarioSchema, actionSchema: PromActionSchema },
  [traceWaterfall.id]: { ...traceWaterfall, scenarioSchema: WaterfallScenarioSchema, actionSchema: WaterfallActionSchema },
  [consumerGroups.id]: { ...consumerGroups, scenarioSchema: KafkaScenarioSchema, actionSchema: KafkaActionSchema },
  [schedulerTimeline.id]: { ...schedulerTimeline, scenarioSchema: AirflowScenarioSchema, actionSchema: AirflowActionSchema },
  [experimentExplorer.id]: { ...experimentExplorer, scenarioSchema: ExplorerScenarioSchema, actionSchema: ExplorerActionSchema },
};
