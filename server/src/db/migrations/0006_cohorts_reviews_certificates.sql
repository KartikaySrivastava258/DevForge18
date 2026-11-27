-- 0006_cohorts_reviews_certificates: institutional features (REMAINING_WORK.md §6.3).
--
--   * cohorts and their members: learners join with a code and are told that the cohort's faculty
--     will see their name, e-mail and progress; faculty create cohorts.
--   * assignments: a lesson, lab, quiz, project, capstone or architecture record, with a due date.
--     Completion is never stored here — it is derived from the learner's own progress records.
--   * submissions: a learner's link to their project or capstone work (one per item, resubmitting
--     replaces it and asks for a new review).
--   * reviews: faculty feedback against the item's rubric, for submissions and for submitted
--     architecture decision records (architecture_decisions.id, stored as text).
--   * portfolios: opt-in public page; private unless the learner switches it on.
--   * certificates: issued only when the track's assessment threshold is met; the evidence that met
--     it is stored with the certificate, and the random id is the public verification link.

CREATE TABLE cohorts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  join_code   TEXT NOT NULL UNIQUE,
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE cohort_members (
  cohort_id TEXT NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('learner', 'faculty')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (cohort_id, user_id)
) STRICT;
CREATE INDEX cohort_members_user_idx ON cohort_members (user_id);

CREATE TABLE assignments (
  id           TEXT PRIMARY KEY,
  cohort_id    TEXT NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('lesson', 'lab', 'quiz', 'project', 'capstone', 'architecture')),
  item_id      TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 4000),
  due_at       TEXT NOT NULL,
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (cohort_id, kind, item_id)
) STRICT;

CREATE TABLE submissions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('project', 'capstone')),
  item_id        TEXT NOT NULL,
  repository_url TEXT NOT NULL CHECK (length(repository_url) BETWEEN 12 AND 500 AND repository_url LIKE 'https://%'),
  notes          TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  status         TEXT NOT NULL CHECK (status IN ('submitted', 'accepted', 'changes_requested')),
  submitted_at   TEXT NOT NULL,
  UNIQUE (user_id, kind, item_id)
) STRICT;

CREATE TABLE reviews (
  id               TEXT PRIMARY KEY,
  target_type      TEXT NOT NULL CHECK (target_type IN ('submission', 'decision')),
  target_id        TEXT NOT NULL,
  reviewer_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  scores           TEXT NOT NULL CHECK (json_valid(scores)),
  feedback         TEXT NOT NULL CHECK (length(feedback) BETWEEN 1 AND 8000),
  outcome          TEXT NOT NULL CHECK (outcome IN ('accepted', 'changes_requested')),
  created_at       TEXT NOT NULL
) STRICT;
CREATE INDEX reviews_target_idx ON reviews (target_type, target_id, created_at);

CREATE TABLE portfolios (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  slug       TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 40),
  headline   TEXT NOT NULL DEFAULT '' CHECK (length(headline) <= 200),
  is_public  INTEGER NOT NULL CHECK (is_public IN (0, 1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE certificates (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_slug  TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  evidence    TEXT NOT NULL CHECK (json_valid(evidence)),
  issued_at   TEXT NOT NULL,
  revoked_at  TEXT,
  UNIQUE (user_id, track_slug)
) STRICT;
