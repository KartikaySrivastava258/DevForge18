# ADR 0008 — Simulations: shared pure models, challenges verified by replay

- **Status:** Accepted (2026-11-25)

## Context

REMAINING_WORK.md §4.3 asks for one interactive simulation per track, with challenges whose progress is recorded through the API. A simulation runs in the browser, so the server cannot see what the learner did. ADR 0005 forbids running learner code on the server.

## Problem

How can the server record "challenge completed" honestly, without trusting a claim from the browser and without executing anything a learner wrote?

## Options considered

1. **Trust the browser:** the page posts "completed". Trivial to forge, so progress would mean nothing — the same reason self-check answers are graded on the server.
2. **Label simulation progress as self-reported** (as planned for local labs, §4.4). Honest, but weaker than necessary: unlike a learner's laptop, the simulation is fully deterministic and its model is our own code.
3. **Replay on the server:** the page posts the list of actions the learner took; the server validates each one with the model's zod schema and replays them through the same pure model (`shared/simulations/`), then runs the challenge's check.

## Decision

Option 3.

- Every model is a pure, deterministic function (`next = step(state, action)`) with no randomness, clock or I/O; the same code runs in the browser and on the server.
- Actions are data, not code: each must match the model's strict schema (unknown fields are rejected). A request may contain at most 400 actions and 3,000 ticks of simulated time, which bounds the work per request; the existing per-IP API limit applies.
- A passing result is stored in a new table, `simulation_progress` (migration 0002), only for signed-in learners and only once per challenge.
- Each challenge carries a reference solution in content. The build replays it and fails unless it passes the check (and the check does not already pass at the start), so every challenge is known to be solvable. Solutions are never sent to browsers, like self-check answers.

## Positive consequences

Simulation progress is verified, not self-reported; models are unit-testable and replayable; the same validation code protects the browser UI and the API.

## Negative consequences

- The browser must keep the action list since the scenario started (consecutive ticks are merged to keep it short).
- Changing a model's behaviour can invalidate old action lists. Stored progress is not affected (it records the result), but content authors must keep reference solutions passing — the build enforces it.

## Revisit when

A simulation needs randomness (use a seeded generator whose seed is part of the scenario), or a model becomes expensive enough that replay limits need lowering.
