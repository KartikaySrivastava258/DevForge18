-- 0003_lab_progress: completed labs (REMAINING_WORK.md §4.4).
--
-- evidence records how completion was established, so it is never
-- overstated: 'self-reported' for local labs (the learner ticked every
-- checkpoint; a browser cannot prove work done on their machine),
-- 'verified' when the server checked it (simulation challenges already
-- verified by replay, or read-through questions graded on the server).

CREATE TABLE lab_progress (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lab_id       TEXT NOT NULL,
  track_slug   TEXT NOT NULL,
  evidence     TEXT NOT NULL CHECK (evidence IN ('self-reported', 'verified')),
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lab_id)
) STRICT;
CREATE INDEX lab_progress_user_track_idx ON lab_progress (user_id, track_slug);
