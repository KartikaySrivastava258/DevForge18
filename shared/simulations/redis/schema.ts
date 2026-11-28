/**
 * zod schemas for the cache-load model, used by the server and the content
 * build (never shipped to browsers). The type checks at the bottom fail to
 * compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { POLICIES, type CacheAction, type CacheScenario } from "./cache-load.ts";

export const CacheActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("setCache"), on: z.boolean() }).strict(),
  z.object({ type: z.literal("setTtl"), seconds: z.number().int().min(1).max(120) }).strict(),
  z.object({ type: z.literal("setSingleFlight"), on: z.boolean() }).strict(),
  z.object({ type: z.literal("setPolicy"), policy: z.enum(POLICIES) }).strict(),
  z.object({ type: z.literal("setMaxKeys"), keys: z.number().int().min(5).max(100).nullable() }).strict(),
]);

export const CacheScenarioSchema = z
  .object({
    cacheOn: z.boolean().default(true),
    ttl: z.number().int().min(1).max(120).default(10),
    singleFlight: z.boolean().default(false),
    limit: z.number().int().min(10).max(1000).default(60),
    hotExpiresAt: z.number().int().min(0).max(59).nullable().default(null),
    // The defaults keep the first scenarios exactly as they were: no memory limit (maxmemory 0) and Redis's default policy.
    maxKeys: z.number().int().min(5).max(100).nullable().default(null),
    policy: z.enum(POLICIES).default("noeviction"),
    sessions: z.number().int().min(0).max(40).default(0),
    sessionEvery: z.number().int().min(1).max(60).nullable().default(null),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof CacheActionSchema>, CacheAction> = true;
const scenarioTypesMatch: Same<z.output<typeof CacheScenarioSchema>, CacheScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
