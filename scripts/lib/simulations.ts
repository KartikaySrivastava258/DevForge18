/**
 * Loads content/simulations/<track>/<id>.yaml and validates it against the
 * simulation's model (shared/simulations/). Beyond the schema, it proves that
 * every scenario starts in a valid state and that every challenge is solvable:
 * the reference solution is replayed and must pass the challenge's check,
 * which must not already pass at the start.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SimulationSchema, type Simulation } from "../../shared/content-schema.ts";
import { MODELS } from "../../shared/simulations/index.ts";
import { replay, violations } from "../../shared/simulations/types.ts";
import { parseYaml } from "./yaml.ts";

export function loadSimulations(root: string, trackSlugs: Set<string>, errors: string[]): Simulation[] {
  const dir = join(root, "simulations");
  if (!existsSync(dir)) return [];
  const out: Simulation[] = [];
  for (const track of readdirSync(dir).sort()) {
    const trackDir = join(dir, track);
    if (track.startsWith(".") || !statSync(trackDir).isDirectory()) continue;
    if (!trackSlugs.has(track)) errors.push(`simulations/${track}: no track with this slug`);
    for (const file of readdirSync(trackDir).filter((f) => f.endsWith(".yaml")).sort()) {
      const path = join(trackDir, file);
      const rel = relative(root, path);
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(path, "utf8"), path);
      } catch (err) {
        errors.push(`${rel}: invalid YAML — ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      const parsed = SimulationSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(...parsed.error.issues.map((i) => `${rel}: ${i.path.join(".") || "(root)"} — ${i.message}`));
        continue;
      }
      const sim = parsed.data;
      const problems: string[] = [];
      if (`${sim.id}.yaml` !== file) problems.push("id must match the file name");
      if (sim.track !== track) problems.push(`track "${sim.track}" must match folder "${track}"`);
      const model = MODELS[sim.id];
      if (!model) {
        errors.push(`${rel}: no simulation model with id "${sim.id}" in shared/simulations/index.ts`);
        continue;
      }
      if (model.track !== sim.track) problems.push(`the model belongs to track "${model.track}"`);

      const scenarios = new Map<string, unknown>();
      for (const scenario of sim.scenarios) {
        if (scenarios.has(scenario.id)) problems.push(`duplicate scenario "${scenario.id}"`);
        const params = model.scenarioSchema.safeParse(scenario.params);
        if (!params.success) {
          problems.push(...params.error.issues.map((i) => `scenario ${scenario.id}: params.${i.path.join(".")} — ${i.message}`));
          continue;
        }
        const start = model.init(params.data);
        if (start.error) problems.push(`scenario ${scenario.id} does not start: ${start.error}`);
        else for (const v of violations(model, start.state)) problems.push(`scenario ${scenario.id} starts in an invalid state: ${v}`);
        scenarios.set(scenario.id, params.data);
        scenario.params = params.data; // normalised, with defaults applied
      }

      const challengeIds = new Set<string>();
      for (const challenge of sim.challenges) {
        const where = `challenge ${challenge.id}`;
        if (challengeIds.has(challenge.id)) problems.push(`duplicate challenge "${challenge.id}"`);
        challengeIds.add(challenge.id);
        const params = scenarios.get(challenge.scenario);
        if (params === undefined) {
          problems.push(`${where}: unknown scenario "${challenge.scenario}"`);
          continue;
        }
        const check = model.checks[challenge.check];
        if (!check) {
          problems.push(`${where}: the model has no check "${challenge.check}" (it has: ${Object.keys(model.checks).join(", ")})`);
          continue;
        }
        const actions = [];
        for (const [i, a] of challenge.solution.entries()) {
          const action = model.actionSchema.safeParse(a);
          if (action.success) actions.push(action.data);
          else problems.push(`${where}: solution step ${i + 1} is not a valid action — ${action.error.issues[0]?.message}`);
        }
        if (actions.length !== challenge.solution.length) continue;
        const run = replay(model, params, actions);
        if (run.refused) problems.push(`${where}: solution step ${run.refused.index + 1} was refused — ${run.refused.error}`);
        else if (!check(run.state, run.initial)) problems.push(`${where}: the reference solution does not pass the check "${challenge.check}"`);
        if (check(run.initial, run.initial)) problems.push(`${where}: the check already passes before the learner does anything`);
      }
      if (problems.length) errors.push(...problems.map((p) => `${rel}: ${p}`));
      else out.push(sim);
    }
  }
  return out;
}
