/**
 * Simulation views, loaded on demand (code splitting keeps them out of the
 * main bundle). Each module's default export pairs the pure model from
 * shared/simulations/ with the React view that draws its state.
 */
import type { ComponentType } from "react";
import type { SimulationModel } from "../../../shared/simulations/types.ts";

export interface ViewProps<S = any, A = any> {
  state: S;
  dispatch: (action: A) => void;
}

export interface SimulationEntry {
  model: SimulationModel<any, any, any>;
  View: ComponentType<ViewProps>;
  /** Short label for an action, shown in the event log (for example the git or kubectl command). */
  command: (action: any) => string;
}

export const SIMULATIONS: Record<string, () => Promise<{ default: SimulationEntry }>> = {
  "git-commit-graph": () => import("./GitGraph.tsx"),
  "kubernetes-reconciliation": () => import("./K8sCluster.tsx"),
  "prometheus-scrape-and-rate": () => import("./PromScrape.tsx"),
  "opentelemetry-trace-waterfall": () => import("./TraceWaterfall.tsx"),
  "kafka-consumer-groups": () => import("./KafkaGroups.tsx"),
  "airflow-scheduler-timeline": () => import("./AirflowTimeline.tsx"),
  "mlflow-experiment-explorer": () => import("./MlflowExplorer.tsx"),
  "langchain-rag-pipeline": () => import("./RagPipeline.tsx"),
  "n8n-workflow-executor": () => import("./N8nWorkflow.tsx"),
};
