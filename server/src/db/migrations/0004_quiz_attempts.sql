-- 0004_quiz_attempts: per-track quiz attempts (REMAINING_WORK.md §4.7).
--
-- One row per graded attempt by a signed-in learner. A passed quiz lets a
-- learning path show its module as "skipped by quiz" (the alternate route).

CREATE TABLE quiz_attempts (
  id           INTEGER PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  quiz_id      TEXT NOT NULL,
  track_slug   TEXT NOT NULL,
  score        REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  passed       INTEGER NOT NULL CHECK (passed IN (0, 1)),
  attempted_at TEXT NOT NULL
) STRICT;
CREATE INDEX quiz_attempts_user_track_idx ON quiz_attempts (user_id, track_slug);
