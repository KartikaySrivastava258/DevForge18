-- 0007_cms_submissions: content edits submitted as pull requests (ADR 0011, REMAINING_WORK.md §6.3).
--
-- One row per pull request the content editor opened. The content itself lives
-- in Git; this table records who submitted what and where to review it. Rows
-- outlive their author's account (user_id becomes NULL) so the history stays.

CREATE TABLE cms_submissions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  file_path  TEXT NOT NULL CHECK (length(file_path) BETWEEN 1 AND 200 AND file_path LIKE 'content/%'),
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  branch     TEXT NOT NULL,
  pr_url     TEXT NOT NULL CHECK (pr_url LIKE 'http%'),
  pr_number  INTEGER NOT NULL CHECK (pr_number > 0),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX cms_submissions_created_at_idx ON cms_submissions (created_at);
CREATE INDEX cms_submissions_user_idx ON cms_submissions (user_id, created_at);
