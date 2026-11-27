/**
 * Content editor for faculty and admins: edits a content file and opens a pull
 * request on GitHub, so review and CI validation still apply (ADR 0003, ADR 0011).
 *
 * Every route is restricted to faculty and admins; the mutating ones also pass
 * the app-wide CSRF check. Files are read from the repository's default branch
 * (not the deployed build), validated against the matching schema, and
 * committed to a new branch. Each pull request is recorded in cms_submissions
 * and in the audit log.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { recordAudit } from "../auth/audit.ts";
import type { UserRecord } from "../auth/users.ts";
import { checkContentPath, EDITABLE_KINDS, MAX_CONTENT_BYTES, MAX_PATH_LENGTH, validateContentFile } from "../cms/content-files.ts";
import { GitHubClient, GitHubError } from "../cms/github.ts";
import { CMS_NOT_CONFIGURED, type CmsSettings } from "../config.ts";
import { ok, readJson } from "../http/context.ts";
import { HttpError } from "../http/errors.ts";
import { FixedWindowLimiter } from "../http/rate-limit.ts";
import type { Router } from "../http/router.ts";
import type { AppDeps } from "./deps.ts";

const STAFF = ["faculty", "admin"] as const;
/** JSON escaping makes the body somewhat larger than the file; this matches Nginx's client_max_body_size. */
const MAX_BODY_BYTES = 128 * 1024;
// eslint-disable-next-line no-control-regex
const noControl = (s: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);

const ValidateBody = z.object({ path: z.string().max(MAX_PATH_LENGTH), content: z.string() }).strict();
const SubmitBody = z
  .object({
    path: z.string().max(MAX_PATH_LENGTH),
    content: z.string(),
    baseSha: z.string().regex(/^[0-9a-f]{40}$/, "Reload the file and try again."),
    title: z.string().trim().min(5, "Write a title of at least 5 characters.").max(120).refine((s) => noControl(s) && !s.includes("\n"), "Use one line of plain text."),
    note: z.string().trim().max(2000).refine(noControl, "Remove control characters.").default(""),
  })
  .strict();

/**
 * Text placed in the pull request body: Markdown punctuation is escaped and "@" is written as an
 * HTML entity, so a display name or note cannot mention (notify) GitHub users or inject formatting.
 */
export function markdownText(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|~<>]/g, "\\$&").replace(/@/g, "&#64;");
}

function pullRequestBody(input: { name: string; role: string; path: string; label: string; note: string }): string {
  return [
    `Content change submitted through the DevForge content editor by **${markdownText(input.name)}** (${input.role}).`,
    "",
    `- File: \`${input.path}\``,
    `- Type: ${input.label}`,
    "",
    ...(input.note ? ["### Note from the author", "", markdownText(input.note), ""] : []),
    "### Checks",
    "",
    `- [x] The editor parsed the file and validated it against the ${input.label.toLowerCase()} schema (this file only).`,
    "- [ ] CI: cross-file checks (links between lessons, tracks and paths, media, prerequisites), the build and the tests.",
    "- [ ] Review by a maintainer, as for any other change (ADR 0003).",
  ].join("\n");
}

function branchName(path: string, now: Date): string {
  const base = (path.split("/").pop() ?? "file").replace(/\.(md|yaml)$/, "").slice(0, 50);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `cms/${base}-${stamp}-${randomBytes(3).toString("hex")}`;
}

/** Map GitHub failures to messages faculty can act on (or pass to an administrator). */
function fromGitHub(err: unknown, what: string): HttpError {
  if (!(err instanceof GitHubError)) throw err;
  if (err.status === 0) return new HttpError(502, "github_unreachable", `Could not reach GitHub to ${what}. Try again in a minute.`);
  if (err.status === 401) return new HttpError(502, "github_auth", `GitHub rejected the server's token while trying to ${what}. An administrator must renew GITHUB_TOKEN.`);
  if (err.status === 403 || err.status === 404) {
    return new HttpError(502, "github_access", `GitHub refused to ${what} (${err.status}: ${err.message}). Check that GITHUB_REPOSITORY is right and the token has Contents and Pull requests write access.`);
  }
  return new HttpError(502, "github_failed", `GitHub could not ${what} (${err.status}: ${err.message}).`);
}

export function registerCmsRoutes(router: Router, { db, config, logger }: AppDeps): void {
  const settings: CmsSettings = config.cms ?? { enabled: false, reason: CMS_NOT_CONFIGURED };
  const github = settings.enabled ? new GitHubClient(settings.github) : undefined;
  const submitLimiter = new FixedWindowLimiter(20, 60 * 60_000);
  // GitHub asks for contents writes to be made serially, not concurrently (ADR 0011).
  let queue: Promise<unknown> = Promise.resolve();
  const serially = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const requireGitHub = (): GitHubClient => {
    if (!github) throw new HttpError(503, "cms_disabled", settings.enabled ? CMS_NOT_CONFIGURED : settings.reason);
    return github;
  };
  const requirePath = (path: string) => {
    const check = checkContentPath(path);
    if (!check.ok) throw new HttpError(400, "invalid_path", check.message);
    return check;
  };

  router.get(
    "/api/cms/status",
    () =>
      ok({
        enabled: settings.enabled,
        ...(settings.enabled ? { repository: `${settings.github.owner}/${settings.github.repo}` } : { reason: settings.reason }),
        maxBytes: MAX_CONTENT_BYTES,
        kinds: EDITABLE_KINDS,
      }),
    { auth: [...STAFF] },
  );

  router.get(
    "/api/cms/files",
    async () => {
      const gh = requireGitHub();
      let branch: string;
      let listing: Awaited<ReturnType<GitHubClient["tree"]>>;
      try {
        branch = await gh.defaultBranch();
        listing = await gh.tree(branch);
      } catch (err) {
        throw fromGitHub(err, "list the content files");
      }
      const files = listing.entries
        .filter((e) => e.type === "blob")
        .flatMap((e) => {
          const check = checkContentPath(e.path);
          return check.ok ? [{ path: e.path, kind: check.kind, size: e.size ?? 0 }] : [];
        })
        .sort((a, b) => a.path.localeCompare(b.path));
      return ok({ defaultBranch: branch, truncated: listing.truncated, files });
    },
    { auth: [...STAFF] },
  );

  router.get(
    "/api/cms/file",
    async (ctx) => {
      const gh = requireGitHub();
      const check = requirePath(ctx.query.get("path") ?? "");
      const path = ctx.query.get("path") ?? "";
      let branch: string;
      let file: Awaited<ReturnType<GitHubClient["file"]>>;
      try {
        branch = await gh.defaultBranch();
        file = await gh.file(path, branch);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 404) throw new HttpError(404, "not_found", "This file does not exist on the default branch.");
        throw fromGitHub(err, "read the file");
      }
      if (file.text === undefined || file.size > MAX_CONTENT_BYTES) {
        throw new HttpError(413, "file_too_large", `This file is larger than ${MAX_CONTENT_BYTES / 1024} KB; edit it through Git instead.`);
      }
      return ok({ path, kind: check.kind, label: check.label, defaultBranch: branch, sha: file.sha, content: file.text });
    },
    { auth: [...STAFF] },
  );

  // Validation needs no GitHub access, so it also works while the editor is not configured.
  router.post(
    "/api/cms/validate",
    async (ctx) => {
      const body = await readJson(ctx, ValidateBody, MAX_BODY_BYTES);
      const check = requirePath(body.path);
      const errors = validateContentFile(check, body.content);
      return ok({ valid: errors.length === 0, kind: check.kind, errors });
    },
    { auth: [...STAFF] },
  );

  router.post(
    "/api/cms/submissions",
    async (ctx) => {
      const user = ctx.user as UserRecord;
      const gh = requireGitHub();
      const body = await readJson(ctx, SubmitBody, MAX_BODY_BYTES);
      const check = requirePath(body.path);
      const errors = validateContentFile(check, body.content);
      if (errors.length) {
        throw new HttpError(
          422,
          "content_invalid",
          "The file has validation errors. Fix them, then submit again.",
          errors.map((message) => ({ field: "content", message })),
        );
      }
      const limit = submitLimiter.hit(user.id);
      if (!limit.allowed) {
        throw new HttpError(429, "rate_limited", "You have opened many pull requests in the last hour. Try again later.", {
          retryAfterSeconds: limit.retryAfterSeconds,
        });
      }

      return serially(async () => {
        let step = "read the default branch";
        let branchCreated = false;
        const now = new Date();
        const branch = branchName(body.path, now);
        try {
          const base = await gh.defaultBranch();
          step = "read the current file";
          let current: Awaited<ReturnType<GitHubClient["file"]>>;
          try {
            current = await gh.file(body.path, base);
          } catch (err) {
            if (err instanceof GitHubError && err.status === 404) throw new HttpError(404, "not_found", "This file no longer exists on the default branch.");
            throw err;
          }
          if (current.sha !== body.baseSha) {
            throw new HttpError(409, "stale_base", `Someone changed this file on ${base} after you opened it. Copy your changes, reload the file and apply them again.`);
          }
          if (current.text === body.content) throw new HttpError(422, "no_changes", "There are no changes to submit.");
          step = "create a branch";
          const headSha = await gh.branchSha(base);
          await gh.createBranch(branch, headSha);
          branchCreated = true;
          step = "commit the file";
          await gh.updateFile({
            path: body.path,
            branch,
            sha: current.sha,
            text: body.content,
            message: `${body.title}\n\nSubmitted through the DevForge content editor by ${user.display_name}.`,
          });
          step = "open the pull request";
          const pr = await gh.openPullRequest({
            title: body.title,
            head: branch,
            base,
            body: pullRequestBody({ name: user.display_name, role: user.role, path: body.path, label: check.label, note: body.note }),
          });

          const id = randomUUID();
          const createdAt = now.toISOString();
          db.prepare(
            `INSERT INTO cms_submissions (id, user_id, file_path, kind, title, branch, pr_url, pr_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, user.id, body.path, check.kind, body.title, branch, pr.url, pr.number, createdAt);
          recordAudit(db, {
            actorUserId: user.id,
            action: "content.pull_request_opened",
            targetType: "content_file",
            targetId: body.path,
            metadata: { branch, prUrl: pr.url, prNumber: pr.number },
          });
          return ok({ submission: { id, path: body.path, kind: check.kind, title: body.title, branch, prUrl: pr.url, prNumber: pr.number, createdAt } }, 201);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          const mapped = fromGitHub(err, step);
          const status = (err as GitHubError).status;
          logger.warn("content editor: GitHub step failed", { step, status, requestId: ctx.requestId });
          recordAudit(db, {
            actorUserId: user.id,
            action: "content.pull_request_failed",
            targetType: "content_file",
            targetId: body.path,
            metadata: { step, status, ...(branchCreated ? { branch } : {}) },
          });
          if (!branchCreated) throw mapped;
          throw new HttpError(mapped.status, mapped.code, `${mapped.message} The branch ${branch} was left on GitHub; a maintainer can finish or delete it.`);
        }
      });
    },
    { auth: [...STAFF] },
  );

  router.get(
    "/api/cms/submissions",
    (ctx) => {
      const user = ctx.user as UserRecord;
      const mine = user.role !== "admin";
      const rows = db
        .prepare(
          `SELECT s.id, s.file_path AS path, s.kind, s.title, s.branch, s.pr_url AS prUrl, s.pr_number AS prNumber,
                  s.created_at AS createdAt, u.display_name AS author
           FROM cms_submissions s LEFT JOIN users u ON u.id = s.user_id
           ${mine ? "WHERE s.user_id = ?" : ""}
           ORDER BY s.created_at DESC, s.id LIMIT 50`,
        )
        .all(...(mine ? [user.id] : []));
      return ok({ scope: mine ? "mine" : "all", submissions: rows });
    },
    { auth: [...STAFF] },
  );
}
