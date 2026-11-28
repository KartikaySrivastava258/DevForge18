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
import { ragPipeline } from "./langchain/rag-pipeline.ts";
import { RagActionSchema, RagScenarioSchema } from "./langchain/schema.ts";
import { WorkflowActionSchema, WorkflowScenarioSchema } from "./n8n/schema.ts";
import { workflowExecutor } from "./n8n/workflow-executor.ts";
import { SprintActionSchema, SprintScenarioSchema } from "./jira/schema.ts";
import { sprintBoard } from "./jira/sprint-board.ts";
import { layerCache } from "./docker/layer-cache.ts";
import { LayerActionSchema, LayerScenarioSchema } from "./docker/schema.ts";
import { queryPlanner } from "./postgresql/query-planner.ts";
import { isolationTimeline } from "./postgresql/isolation-timeline.ts";
import { IsoActionSchema, IsoScenarioSchema, PlannerActionSchema, PlannerScenarioSchema } from "./postgresql/schema.ts";
import { planDiff } from "./terraform/plan-diff.ts";
import { PlanActionSchema, PlanScenarioSchema } from "./terraform/schema.ts";
import { workflowRun } from "./github-actions/workflow-run.ts";
import { WorkflowRunActionSchema, WorkflowRunScenarioSchema } from "./github-actions/schema.ts";
import { cacheLoad } from "./redis/cache-load.ts";
import { CacheActionSchema, CacheScenarioSchema } from "./redis/schema.ts";
import { locationMatcher } from "./nginx/location-matcher.ts";
import { MatcherActionSchema, MatcherScenarioSchema } from "./nginx/schema.ts";
import { requestBuilder } from "./postman/request-builder.ts";
import { BuilderActionSchema, BuilderScenarioSchema } from "./postman/schema.ts";
import { buildQueue } from "./jenkins/build-queue.ts";
import { QueueActionSchema, QueueScenarioSchema } from "./jenkins/schema.ts";
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
  [ragPipeline.id]: { ...ragPipeline, scenarioSchema: RagScenarioSchema, actionSchema: RagActionSchema },
  [workflowExecutor.id]: { ...workflowExecutor, scenarioSchema: WorkflowScenarioSchema, actionSchema: WorkflowActionSchema },
  [sprintBoard.id]: { ...sprintBoard, scenarioSchema: SprintScenarioSchema, actionSchema: SprintActionSchema },
  [layerCache.id]: { ...layerCache, scenarioSchema: LayerScenarioSchema, actionSchema: LayerActionSchema },
  [queryPlanner.id]: { ...queryPlanner, scenarioSchema: PlannerScenarioSchema, actionSchema: PlannerActionSchema },
  [isolationTimeline.id]: { ...isolationTimeline, scenarioSchema: IsoScenarioSchema, actionSchema: IsoActionSchema },
  [planDiff.id]: { ...planDiff, scenarioSchema: PlanScenarioSchema, actionSchema: PlanActionSchema },
  [workflowRun.id]: { ...workflowRun, scenarioSchema: WorkflowRunScenarioSchema, actionSchema: WorkflowRunActionSchema },
  [cacheLoad.id]: { ...cacheLoad, scenarioSchema: CacheScenarioSchema, actionSchema: CacheActionSchema },
  [locationMatcher.id]: { ...locationMatcher, scenarioSchema: MatcherScenarioSchema, actionSchema: MatcherActionSchema },
  [requestBuilder.id]: { ...requestBuilder, scenarioSchema: BuilderScenarioSchema, actionSchema: BuilderActionSchema },
  [buildQueue.id]: { ...buildQueue, scenarioSchema: QueueScenarioSchema, actionSchema: QueueActionSchema },
};
