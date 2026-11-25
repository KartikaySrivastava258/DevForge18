/**
 * zod schemas for the experiment-explorer model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { KINDS, RUNS, type ExplorerAction, type ExplorerScenario } from "./experiment-explorer.ts";

const runId = z.string().refine((id) => RUNS.some((r) => r.id === id), { message: "unknown run" });
const latency = z.number().min(0.1).max(100);

export const ExplorerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sort"), by: z.enum(["rmse", "latencyMs", "name"]), dir: z.enum(["asc", "desc"]) }).strict(),
  z.object({ type: z.literal("filter"), kind: z.enum([...KINDS, "all"]), maxLatencyMs: latency.nullable() }).strict(),
  z.object({ type: z.literal("register"), runId }).strict(),
  z.object({ type: z.literal("setChampion"), version: z.number().int().min(1).max(12) }).strict(),
]);

export const ExplorerScenarioSchema = z
  .object({
    limitMs: latency.nullable().default(null),
    registered: z.array(runId).max(12).default([]),
    champion: z.number().int().min(1).max(12).nullable().default(null),
  })
  .strict()
  .refine((p) => p.champion === null || p.champion <= p.registered.length, { message: "champion must be a registered version" });

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof ExplorerActionSchema>, ExplorerAction> = true;
const scenarioTypesMatch: Same<z.output<typeof ExplorerScenarioSchema>, ExplorerScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
