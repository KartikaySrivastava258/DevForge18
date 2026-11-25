/**
 * zod schemas for the commit-graph model, used by the server and the content
 * build (never shipped to browsers). The type checks at the bottom fail to
 * compile if these schemas and the model's own types ever disagree.
 */
import { z } from "zod/v4";
import { RULES, type GitAction, type GitScenario } from "./commit-graph.ts";

const branchName = z.string().regex(RULES.branchName, RULES.branchNameMessage);
const message = z.string().trim().min(1, "A commit needs a message.").max(RULES.messageMax, `Keep the message under ${RULES.messageMax} characters.`);
const ref = z.string().min(1).max(RULES.refMax);

export const GitActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("commit"), message }).strict(),
  z.object({ type: z.literal("branch"), name: branchName }).strict(),
  z.object({ type: z.literal("switch"), branch: branchName }).strict(),
  z.object({ type: z.literal("merge"), branch: branchName, mode: z.enum(["default", "no-ff", "ff-only"]) }).strict(),
  z.object({ type: z.literal("rebase"), onto: branchName }).strict(),
  z.object({ type: z.literal("reset"), to: ref }).strict(),
  z.object({ type: z.literal("revert"), commit: ref }).strict(),
]);

export const GitScenarioSchema = z
  .object({
    setup: z.array(GitActionSchema).max(40),
    pushed: z.boolean().default(false),
  })
  .strict();

type Same<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
const actionTypesMatch: Same<z.infer<typeof GitActionSchema>, GitAction> = true;
const scenarioTypesMatch: Same<z.output<typeof GitScenarioSchema>, GitScenario> = true;
void [actionTypesMatch, scenarioTypesMatch];
