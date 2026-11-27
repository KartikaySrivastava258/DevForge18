-- 0005_architecture_decisions: learners' architecture decision records (REMAINING_WORK.md §7, milestone 10).
--
-- One record per learner and reference architecture: a draft the learner can keep editing, or
-- submitted for feedback. Faculty review of submitted records comes with milestone 11.

CREATE TABLE architecture_decisions (
  id              INTEGER PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  architecture_id TEXT NOT NULL,
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  context         TEXT NOT NULL CHECK (length(context) <= 8000),
  decision        TEXT NOT NULL CHECK (length(decision) <= 8000),
  consequences    TEXT NOT NULL CHECK (length(consequences) <= 8000),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'submitted')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (user_id, architecture_id)
) STRICT;
