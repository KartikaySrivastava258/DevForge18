/**
 * zod schemas for the request-builder model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { ENDPOINTS, type BuilderAction, type BuilderScenario } from "./request-builder.ts";

const request = z
  .object({
    endpoint: z.number().int().min(0).max(ENDPOINTS.length - 1),
    csrf: z.boolean(),
    cookie: z.boolean(),
    body: z.enum(["none", "valid login", "wrong password", "not JSON"]),
  })
  .strict();

export const BuilderActionSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("send"), request }).strict()]);
export const BuilderScenarioSchema = z.object({ signedIn: z.boolean().default(false) }).strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof BuilderActionSchema>, BuilderAction> = true;
const scenarioTypesMatch: Same<z.output<typeof BuilderScenarioSchema>, BuilderScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
