/**
 * zod schemas for the PostgreSQL models (query planner, isolation timeline), used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { LEVELS, SCRIPTS, type IsoAction, type IsoScenario } from "./isolation-timeline.ts";
import { QUERIES, type PlannerAction, type PlannerScenario } from "./query-planner.ts";

const column = z.enum(["customer_id", "status", "day"]);
const columns = z.array(column).min(1).max(2);

export const PlannerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createIndex"), columns }).strict(),
  z.object({ type: z.literal("dropIndex"), name: z.string().regex(/^orders_[a-z_]+_idx$/) }).strict(),
  z.object({ type: z.literal("explain") }).strict(),
]);

export const PlannerScenarioSchema = z
  .object({
    query: z.string().refine((q) => q in QUERIES, { message: "unknown query" }),
    indexes: z.array(columns).max(4).default([]),
  })
  .strict();

const level = z.enum(LEVELS);
const txName = z.enum(["T1", "T2"]);

export const IsoActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setLevel"), level }).strict(),
  z.object({ type: z.literal("run"), tx: txName }).strict(),
  z.object({ type: z.literal("retry"), tx: txName }).strict(),
]);

export const IsoScenarioSchema = z
  .object({
    script: z.string().refine((s) => s in SCRIPTS, { message: "unknown script" }),
    level: level.default("read committed"),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof PlannerActionSchema>, PlannerAction> = true;
const scenarioTypesMatch: Same<z.output<typeof PlannerScenarioSchema>, PlannerScenario> = true;
const isoActionTypesMatch: Same<z.infer<typeof IsoActionSchema>, IsoAction> = true;
const isoScenarioTypesMatch: Same<z.output<typeof IsoScenarioSchema>, IsoScenario> = true;
void [actionTypesMatch, scenarioTypesMatch, isoActionTypesMatch, isoScenarioTypesMatch];
