/**
 * zod schemas for the scrape-and-rate model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { INTERVALS, P95_BY, QUERIES, WINDOWS, type PromAction, type PromScenario } from "./scrape-and-rate.ts";

const interval = z.union(INTERVALS.map((n) => z.literal(n)) as [z.ZodLiteral<5>, z.ZodLiteral<15>, z.ZodLiteral<30>, z.ZodLiteral<60>]);
const window = z.union(WINDOWS.map((n) => z.literal(n)) as [z.ZodLiteral<30>, z.ZodLiteral<60>, z.ZodLiteral<300>]);
const rps = z.number().int().min(0).max(50);

export const PromActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("setTraffic"), instance: z.number().int().min(0).max(1), rps }).strict(),
  z.object({ type: z.literal("restart"), instance: z.number().int().min(0).max(1) }).strict(),
  z.object({ type: z.literal("setInterval"), seconds: interval }).strict(),
  z.object({ type: z.literal("setWindow"), seconds: window }).strict(),
  z.object({ type: z.literal("setQuery"), query: z.enum(QUERIES), p95By: z.enum(P95_BY).optional() }).strict(),
]);

export const PromScenarioSchema = z
  .object({
    interval,
    window,
    rps: z.tuple([rps, rps]),
    query: z.enum(QUERIES).default("rate"),
    p95By: z.enum(P95_BY).default("le"),
    warmup: z.number().int().min(0).max(600).default(120),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof PromActionSchema>, PromAction> = true;
const scenarioTypesMatch: Same<z.output<typeof PromScenarioSchema>, PromScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
