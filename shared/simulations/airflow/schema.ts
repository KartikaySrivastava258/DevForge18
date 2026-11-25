/**
 * zod schemas for the scheduler-timeline model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { LAST_DAY, type AirflowAction, type AirflowScenario } from "./scheduler-timeline.ts";

const day = z.number().int().min(0).max(LAST_DAY);
const mode = z.enum(["append", "replace"]);

export const AirflowActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("setRetries"), retries: z.number().int().min(0).max(3) }).strict(),
  z.object({ type: z.literal("setWrite"), mode }).strict(),
  z.object({ type: z.literal("clear"), day }).strict(),
  z.object({ type: z.literal("backfill"), from: day, to: day, reprocess: z.enum(["none", "failed", "completed"]) }).strict(),
]);

export const AirflowScenarioSchema = z
  .object({
    start: day,
    deployed: day,
    now: day,
    catchup: z.boolean().default(false),
    retries: z.number().int().min(0).max(3).default(0),
    write: mode.default("replace"),
    flaky: z.array(day).max(20).default([]),
  })
  .strict()
  .refine((p) => p.start <= p.deployed && p.deployed <= p.now, { message: "start <= deployed <= now" });

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof AirflowActionSchema>, AirflowAction> = true;
const scenarioTypesMatch: Same<z.output<typeof AirflowScenarioSchema>, AirflowScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
