/**
 * zod schemas for the RAG-pipeline model, used by the server and the
 * content build (never shipped to browsers). The type checks at the bottom
 * fail to compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { DOCS, type RagAction, type RagScenario } from "./rag-pipeline.ts";

const weight = z.number().int().min(0).max(5);
const sentenceId = z.string().refine((id) => DOCS.some((d) => d.sentences.some((s) => s.id === id)), { message: "unknown sentence" });

export const RagActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setChunkSize"), size: z.number().int().min(1).max(4) }).strict(),
  z.object({ type: z.literal("setK"), k: z.number().int().min(1).max(6) }).strict(),
]);

export const RagScenarioSchema = z
  .object({
    question: z.object({ text: z.string().min(3).max(200), vec: z.tuple([weight, weight, weight, weight]), support: sentenceId }).strict(),
    chunkSize: z.number().int().min(1).max(4).default(2),
    k: z.number().int().min(1).max(6).default(2),
    budget: z.number().int().min(20).max(500).default(80),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof RagActionSchema>, RagAction> = true;
const scenarioTypesMatch: Same<z.output<typeof RagScenarioSchema>, RagScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
