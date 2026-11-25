/**
 * zod schemas for the trace-waterfall model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { LATENCIES, SERVICES, type WaterfallAction, type WaterfallScenario } from "./trace-waterfall.ts";

const latency = z.union(LATENCIES.map((n) => z.literal(n)) as [z.ZodLiteral<0>, z.ZodLiteral<50>, z.ZodLiteral<100>, z.ZodLiteral<300>]);

export const WaterfallActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("send") }).strict(),
  z.object({ type: z.literal("setCache"), hit: z.boolean() }).strict(),
  z.object({ type: z.literal("setParallel"), parallel: z.boolean() }).strict(),
  z.object({ type: z.literal("setLatency"), service: z.enum(SERVICES), ms: latency }).strict(),
  z.object({ type: z.literal("select"), spanId: z.string().regex(/^[0-9a-f]{16}$/) }).strict(),
]);

export const WaterfallScenarioSchema = z
  .object({
    cacheHit: z.boolean().default(false),
    parallel: z.boolean().default(false),
    extra: z.partialRecord(z.enum(SERVICES), latency).default({}),
    sent: z.number().int().min(0).max(5).default(1),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof WaterfallActionSchema>, WaterfallAction> = true;
const scenarioTypesMatch: Same<z.output<typeof WaterfallScenarioSchema>, WaterfallScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
