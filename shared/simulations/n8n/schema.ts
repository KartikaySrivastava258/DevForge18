/**
 * zod schemas for the workflow-executor model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { SUBMISSIONS, type WorkflowAction, type WorkflowScenario } from "./workflow-executor.ts";

const rule = z.enum(["nameRequired", "emailHasAt", "knownTrack"]);
const branch = z.enum(["none", "errorWorkflow"]);
const onError = z.enum(["stop", "errorOutput"]);

export const WorkflowActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggleRule"), rule }).strict(),
  z.object({ type: z.literal("setFalseBranch"), to: branch }).strict(),
  z.object({ type: z.literal("setOnError"), mode: onError }).strict(),
  z.object({ type: z.literal("setRetries"), retries: z.number().int().min(0).max(3) }).strict(),
  z.object({ type: z.literal("run") }).strict(),
]);

export const WorkflowScenarioSchema = z
  .object({
    rules: z.array(rule).max(3).default(["nameRequired", "emailHasAt", "knownTrack"]),
    falseBranch: branch.default("none"),
    onError: onError.default("stop"),
    retries: z.number().int().min(0).max(3).default(0),
    flaky: z.array(z.number().int().min(1).max(SUBMISSIONS.length)).max(SUBMISSIONS.length).default([]),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof WorkflowActionSchema>, WorkflowAction> = true;
const scenarioTypesMatch: Same<z.output<typeof WorkflowScenarioSchema>, WorkflowScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
