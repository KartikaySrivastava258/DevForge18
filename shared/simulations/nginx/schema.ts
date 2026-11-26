/**
 * zod schemas for the location-matcher model, used by the server and the
 * content build (never shipped to browsers). Locations come from a fixed
 * palette, so no user-supplied regular expression is ever compiled. The
 * type checks at the bottom fail to compile if these schemas and the
 * model's own types ever disagree.
 */
import { z } from "zod/v4";
import { PALETTE, PATH, type MatcherAction, type MatcherScenario } from "./location-matcher.ts";

const id = z.string().refine((x) => PALETTE.some((l) => l.id === x), { message: "not in the palette" });

export const MatcherActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), id }).strict(),
  z.object({ type: z.literal("remove"), id }).strict(),
  z.object({ type: z.literal("moveUp"), id }).strict(),
  z.object({ type: z.literal("request"), path: z.string().regex(PATH) }).strict(),
]);

export const MatcherScenarioSchema = z.object({ locations: z.array(id).max(10) }).strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof MatcherActionSchema>, MatcherAction> = true;
const scenarioTypesMatch: Same<z.output<typeof MatcherScenarioSchema>, MatcherScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
