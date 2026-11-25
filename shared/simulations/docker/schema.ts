/**
 * zod schemas for the layer-cache model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import type { LayerAction, LayerScenario } from "./layer-cache.ts";

const stepId = z.enum(["from", "copyAll", "copyDeps", "install", "copySrc", "cmd"]);

export const LayerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("toggle"), id: stepId }).strict(),
  z.object({ type: z.literal("moveUp"), id: stepId }).strict(),
  z.object({ type: z.literal("moveDown"), id: stepId }).strict(),
  z.object({ type: z.literal("setIgnore"), on: z.boolean() }).strict(),
  z.object({ type: z.literal("edit"), file: z.enum(["src", "deps"]) }).strict(),
  z.object({ type: z.literal("build") }).strict(),
]);

export const LayerScenarioSchema = z
  .object({
    lines: z.array(z.object({ id: stepId, on: z.boolean() }).strict()).min(1).max(6).refine((l) => new Set(l.map((x) => x.id)).size === l.length, { message: "each step at most once" }),
    ignoreSecrets: z.boolean().default(false),
    prebuilt: z.boolean().default(true),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof LayerActionSchema>, LayerAction> = true;
const scenarioTypesMatch: Same<z.output<typeof LayerScenarioSchema>, LayerScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
