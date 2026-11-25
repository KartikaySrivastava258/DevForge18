/**
 * zod schemas for the reconciliation model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { IMAGES, STRATEGY_VALUES, type K8sAction, type K8sScenario } from "./reconciliation.ts";

const strategyValue = z.enum(STRATEGY_VALUES);

export const K8sActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("deletePod"), pod: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal("drainNode"), node: z.string().min(1).max(20) }).strict(),
  z.object({ type: z.literal("uncordonNode"), node: z.string().min(1).max(20) }).strict(),
  z.object({ type: z.literal("scale"), replicas: z.number().int().min(0).max(10) }).strict(),
  z.object({ type: z.literal("setImage"), image: z.enum(IMAGES) }).strict(),
  z.object({ type: z.literal("setStrategy"), maxSurge: strategyValue, maxUnavailable: strategyValue }).strict(),
  z.object({ type: z.literal("undo") }).strict(),
]);

export const K8sScenarioSchema = z
  .object({
    nodes: z.number().int().min(1).max(4),
    replicas: z.number().int().min(1).max(8),
    image: z.enum(IMAGES).default("nginx:1.27-alpine"),
    maxSurge: strategyValue.default("25%"),
    maxUnavailable: strategyValue.default("25%"),
    setup: z.array(K8sActionSchema).max(20).default([]),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof K8sActionSchema>, K8sAction> = true;
const scenarioTypesMatch: Same<z.output<typeof K8sScenarioSchema>, K8sScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
