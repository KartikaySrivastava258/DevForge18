import { z } from "zod/v4";
import { MODELS } from "../../../shared/simulations/index.ts";
import { REPLAY_LIMITS, replay } from "../../../shared/simulations/types.ts";
import { ok, readJson } from "../http/context.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const VerifyBody = z.object({
  actions: z.array(z.unknown()).min(1, "Do something in the simulation first.").max(REPLAY_LIMITS.actions, "Too many actions to verify."),
});

export function registerSimulationRoutes(router: Router, { db, content }: AppDeps): void {
  const completedFor = (userId: string | undefined, simulationId: string): string[] =>
    userId
      ? (db.prepare("SELECT challenge_id FROM simulation_progress WHERE user_id = ? AND simulation_id = ? ORDER BY completed_at").all(userId, simulationId) as { challenge_id: string }[]).map((r) => r.challenge_id)
      : [];

  router.get("/api/simulations/:id", (ctx) => {
    const sim = content.getSimulation(ctx.params.id ?? "");
    if (!sim) throw notFound("Simulation");
    const track = content.getTrack(sim.track);
    return ok({ simulation: content.publicSimulation(sim), track: track ? content.summarise(track) : null, completed: completedFor(ctx.user?.id, sim.id) });
  });

  /**
   * Verify a challenge by replaying the learner's actions through the same
   * model on the server (ADR 0008). Public, so anyone can check their work;
   * progress is saved only for signed-in learners and only when it passes.
   */
  router.post("/api/simulations/:id/challenges/:challenge/verify", async (ctx) => {
    const sim = content.getSimulation(ctx.params.id ?? "");
    const model = sim ? MODELS[sim.id] : undefined;
    const challenge = sim?.challenges.find((c) => c.id === ctx.params.challenge);
    if (!sim || !model || !challenge) throw notFound("Challenge");
    const scenario = sim.scenarios.find((s) => s.id === challenge.scenario);
    const check = model.checks[challenge.check];
    if (!scenario || !check) throw notFound("Challenge");

    const body = await readJson(ctx, VerifyBody);
    const actions = [];
    for (const [i, raw] of body.actions.entries()) {
      const parsed = model.actionSchema.safeParse(raw);
      if (!parsed.success) throw new HttpError(400, "validation_failed", `Action ${i + 1} is not valid in this simulation.`, [{ field: `actions.${i}`, message: parsed.error.issues[0]?.message ?? "Invalid." }]);
      actions.push(parsed.data);
    }
    const cost = actions.reduce((n: number, a) => n + (model.cost ? model.cost(a) : 1), 0);
    if (cost > REPLAY_LIMITS.cost) throw new HttpError(400, "validation_failed", "This run is too long to verify. Reset the scenario and try a shorter path.");

    const run = replay(model, model.scenarioSchema.parse(scenario.params), actions);
    const passed = check(run.state, run.initial);
    if (!passed || !ctx.user) return ok({ passed, saved: false, completed: completedFor(ctx.user?.id, sim.id) });
    db.prepare(
      `INSERT INTO simulation_progress (user_id, simulation_id, challenge_id, track_slug, actions, completed_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, simulation_id, challenge_id) DO NOTHING`,
    ).run(ctx.user.id, sim.id, challenge.id, sim.track, actions.length, new Date().toISOString());
    return ok({ passed, saved: true, completed: completedFor(ctx.user.id, sim.id) });
  });
}
