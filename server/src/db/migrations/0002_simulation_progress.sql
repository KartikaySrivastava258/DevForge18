-- 0002_simulation_progress: challenges completed in browser simulations.
--
-- A row is written only after the server has replayed the learner's actions
-- through the simulation's model (shared/simulations/) and the challenge's
-- check passed (ADR 0008), so it records verified work, not a claim.

CREATE TABLE simulation_progress (
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  simulation_id TEXT NOT NULL,
  challenge_id  TEXT NOT NULL,
  track_slug    TEXT NOT NULL,
  actions       INTEGER NOT NULL CHECK (actions > 0),
  completed_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, simulation_id, challenge_id)
) STRICT;
CREATE INDEX simulation_progress_user_track_idx ON simulation_progress (user_id, track_slug);
