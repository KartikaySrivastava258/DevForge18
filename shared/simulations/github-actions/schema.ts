/**
 * zod schemas for the workflow-run model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import type { WorkflowRunAction, WorkflowRunScenario } from "./workflow-run.ts";

const job = z.enum(["lint", "build", "unit", "e2e", "docs", "deploy"]);
const mode = z.enum(["sequential", "matrix"]);

export const WorkflowRunActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggleNeed"), job, on: job }).strict(),
  z.object({ type: z.literal("setUnitMode"), mode }).strict(),
  z.object({ type: z.literal("setFailing"), job, failing: z.boolean() }).strict(),
  z.object({ type: z.literal("run") }).strict(),
]);

const needs = z.object({ lint: z.array(job), build: z.array(job), unit: z.array(job), e2e: z.array(job), docs: z.array(job), deploy: z.array(job) }).strict();

export const WorkflowRunScenarioSchema = z
  .object({ needs, unitMode: mode.default("matrix"), failing: z.array(job).max(6).default([]) })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof WorkflowRunActionSchema>, WorkflowRunAction> = true;
const scenarioTypesMatch: Same<z.output<typeof WorkflowRunScenarioSchema>, WorkflowRunScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
