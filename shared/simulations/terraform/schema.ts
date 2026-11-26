/**
 * zod schemas for the plan-diff model, used by the server and the content
 * build (never shipped to browsers). The type checks at the bottom fail to
 * compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import type { PlanAction, PlanScenario } from "./plan-diff.ts";

const address = z.string().regex(/^server\.[a-z][a-z0-9_]{0,19}$/);
const size = z.enum(["small", "medium", "large"]);
const name = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/);

export const PlanActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename"), from: address, to: address }).strict(),
  z.object({ type: z.literal("setSize"), address, size }).strict(),
  z.object({ type: z.literal("setName"), address, name }).strict(),
  z.object({ type: z.literal("addMoved"), from: address, to: address }).strict(),
  z.object({ type: z.literal("removeMoved"), from: address }).strict(),
  z.object({ type: z.literal("outsideResize"), address, size }).strict(),
  z.object({ type: z.literal("outsideDelete"), address }).strict(),
  z.object({ type: z.literal("apply") }).strict(),
]);

export const PlanScenarioSchema = z
  .object({
    servers: z.array(z.object({ address, name, size }).strict()).min(1).max(4),
    drift: z.array(z.object({ address, size }).strict()).max(4).default([]),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof PlanActionSchema>, PlanAction> = true;
const scenarioTypesMatch: Same<z.output<typeof PlanScenarioSchema>, PlanScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
