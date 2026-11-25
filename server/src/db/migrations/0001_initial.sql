-- 0001_initial: users, sessions, learning progress, bookmarks and audit log.
--
-- Conventions
--   * Text UUID primary keys; ISO-8601 UTC timestamps stored as TEXT.
--   * STRICT tables so SQLite enforces column types.
--   * Learning content (tracks, lessons, paths) lives in /content and is
--     validated at build time; tables reference it by stable slug/id.
--   * Never edit an applied migration — add a new numbered file instead.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  disabled_at   TEXT
) STRICT;

-- The id is the SHA-256 hash of the session token. The raw token exists only
-- in the user's cookie, so a database leak does not leak usable sessions.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
) STRICT;
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- A lesson is "completed" only after its self-check is answered correctly;
-- opening a page records "in_progress" for continue-learning, never mastery.
CREATE TABLE lesson_progress (
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    TEXT NOT NULL,
  track_slug   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  best_score   REAL CHECK (best_score IS NULL OR (best_score >= 0 AND best_score <= 1)),
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
) STRICT;
CREATE INDEX lesson_progress_user_track_idx ON lesson_progress (user_id, track_slug);
CREATE INDEX lesson_progress_user_updated_idx ON lesson_progress (user_id, updated_at);

CREATE TABLE bookmarks (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL CHECK (item_type IN ('track', 'lesson', 'path')),
  item_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
) STRICT;

-- Append-only record of security-relevant and administrative actions.
CREATE TABLE audit_events (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX audit_events_created_at_idx ON audit_events (created_at);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id);
