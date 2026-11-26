/**
 * zod schemas for the build-queue model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import type { QueueAction, QueueScenario } from "./build-queue.ts";

const label = z.enum(["linux", "docker"]);
export const QueueActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addAgent"), label, executors: z.number().int().min(1).max(4) }).strict(),
  z.object({ type: z.literal("removeAgent"), name: z.string().regex(/^(linux|docker)-\d$/) }).strict(),
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(30).optional() }).strict(),
]);
export const QueueScenarioSchema = z
  .object({ agents: z.array(z.object({ name: z.string().regex(/^(linux|docker)-\d$/), label, executors: z.number().int().min(1).max(4) }).strict()).max(5) })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof QueueActionSchema>, QueueAction> = true;
const scenarioTypesMatch: Same<z.output<typeof QueueScenarioSchema>, QueueScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
