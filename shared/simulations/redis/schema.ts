/**
 * zod schemas for the cache-load model, used by the server and the content
 * build (never shipped to browsers). The type checks at the bottom fail to
 * compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import type { CacheAction, CacheScenario } from "./cache-load.ts";

export const CacheActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("setCache"), on: z.boolean() }).strict(),
  z.object({ type: z.literal("setTtl"), seconds: z.number().int().min(1).max(120) }).strict(),
  z.object({ type: z.literal("setSingleFlight"), on: z.boolean() }).strict(),
]);

export const CacheScenarioSchema = z
  .object({
    cacheOn: z.boolean().default(true),
    ttl: z.number().int().min(1).max(120).default(10),
    singleFlight: z.boolean().default(false),
    limit: z.number().int().min(10).max(1000).default(60),
    hotExpiresAt: z.number().int().min(0).max(59).nullable().default(null),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof CacheActionSchema>, CacheAction> = true;
const scenarioTypesMatch: Same<z.output<typeof CacheScenarioSchema>, CacheScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
