/**
 * zod schemas for the sprint-board model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { BACKLOG, type SprintAction, type SprintScenario } from "./sprint-board.ts";

const storyId = z.string().refine((id) => BACKLOG.some((s) => s.id === id), { message: "unknown story" });

export const SprintActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commit"), id: storyId }).strict(),
  z.object({ type: z.literal("uncommit"), id: storyId }).strict(),
  z.object({ type: z.literal("setWip"), limit: z.number().int().min(1).max(8) }).strict(),
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(10).optional() }).strict(),
]);

export const SprintScenarioSchema = z
  .object({
    committed: z.array(storyId).max(BACKLOG.length).default([]),
    wip: z.number().int().min(1).max(8).default(3),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof SprintActionSchema>, SprintAction> = true;
const scenarioTypesMatch: Same<z.output<typeof SprintScenarioSchema>, SprintScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
