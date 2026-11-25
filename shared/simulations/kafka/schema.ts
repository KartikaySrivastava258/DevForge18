/**
 * zod schemas for the consumer-groups model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { KEYS, type KafkaAction, type KafkaScenario } from "./consumer-groups.ts";

const key = z.enum(KEYS);

export const KafkaActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tick"), count: z.number().int().min(1).max(60).optional() }).strict(),
  z.object({ type: z.literal("addConsumer") }).strict(),
  z.object({ type: z.literal("crashConsumer"), name: z.string().regex(/^consumer-\d{1,2}$/) }).strict(),
  z.object({ type: z.literal("burst"), key, count: z.number().int().min(1).max(50) }).strict(),
  z.object({ type: z.literal("addPartitions"), count: z.number().int().min(1).max(4) }).strict(),
  z.object({ type: z.literal("resetOffsets") }).strict(),
]);

export const KafkaScenarioSchema = z
  .object({
    partitions: z.number().int().min(1).max(8),
    consumers: z.number().int().min(0).max(8),
    capacity: z.number().int().min(1).max(10).default(3),
    incoming: z.array(key).max(8).default(["asha", "ravi", "meera", "nikhil"]),
    warmup: z.number().int().min(0).max(60).default(10),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof KafkaActionSchema>, KafkaAction> = true;
const scenarioTypesMatch: Same<z.output<typeof KafkaScenarioSchema>, KafkaScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
