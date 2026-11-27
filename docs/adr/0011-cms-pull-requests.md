# ADR 0011 — Content editor that opens pull requests

- **Status:** Accepted (2026-11-27)

## Context

ADR 0003 keeps learning content in Git, validated at build time, and planned a CMS for faculty who do not use Git (REMAINING_WORK.md §6.3). The CMS must not bypass what makes content trustworthy: review, the build's validation and CI.

## Options considered

1. **Edit content in the database** and publish from there. Rejected by ADR 0003: no review, no diff, content and code drift apart.
2. **Write to the server's checkout and commit with a Git binary.** Needs Git and credentials on the app host, and edits would start from whatever version is deployed.
3. **Open pull requests through the GitHub REST API.** The server reads the file from the default branch, the faculty member edits it in a form, and the server creates a branch, commits the file and opens a pull request. Review and CI stay exactly as for any other change.

## Decision

Option 3, using `fetch` (no GitHub SDK).

- **Who:** faculty and admins only (`/api/cms/*`, role checks on every route; students get 403). The mutating routes go through the app-wide CSRF check.
- **Configuration:** `GITHUB_REPOSITORY` (`owner/name`), `GITHUB_TOKEN`, `GITHUB_API_URL` (default `https://api.github.com`; tests point it at a local fake). Missing or invalid values disable the editor with a reason shown on the page and logged at start-up; the server never fails to start because of them. `GITHUB_API_URL` must be `https://` unless it is a loopback address, so the token is never sent in clear text to another machine.
- **Token:** a fine-grained personal access token (or GitHub App token) for this one repository with **Contents: read and write** and **Pull requests: read and write** (Metadata: read is included automatically). It does not need, and should not get, Workflows permission: the editor cannot touch `.github/`.
- **Which files:** only paths under `content/` ending in `.md` or `.yaml`, made of plain segments (no `..`, `.`, empty segments, absolute paths, backslashes, `%` or control characters), at most 200 characters, and only at locations that have a schema: lessons, labs, quizzes, projects, simulations, case studies, capstones, reference architectures, integrations, learning paths, `track.yaml` and `alternatives.yaml`. Media (SVG figures and their sidecars) and project starter/solution files are edited through Git. Files are limited to 64 KB (about three times the largest lesson); the request body to 128 KB, matching Nginx's `client_max_body_size`.
- **Validation before the pull request:** the file is parsed with the build's own YAML wrapper (`scripts/lib/yaml.ts`, js-yaml `CORE_SCHEMA`) and front-matter splitter, then checked with the matching zod schema from `shared/content-schema.ts`, plus the per-file rules the loader applies (`id` matches the file name, `track` matches the folder). Checks that need other files — links between lessons, tracks and paths, prerequisites, media, executed lesson output — are left to CI on the pull request; the page says so. All 371 editable files in the repository pass this validation unchanged (checked 2026-11-27).
- **Edits start from the default branch:** the file and its blob SHA are read through the contents API at the default branch, not from the deployed build. On submit the server re-reads the file; if its SHA changed since it was opened, the request is refused (409) instead of overwriting someone else's change.
- **Writes:** one branch per submission (`cms/<file>-<UTC timestamp>-<random>`), created from the default branch's head, one commit (contents API `PUT` with the blob SHA it replaces), one pull request into the default branch. Submissions are processed one at a time per server process, because GitHub's documentation asks for contents writes to be made serially. A per-user limit of 20 submissions an hour protects the token's rate limit.
- **Attribution and privacy:** the commit is made by the token's owner; the commit message and pull request body name the editor by **display name only**, never by e-mail. Display names and notes are escaped in the pull request body (Markdown punctuation, and `@` written as `&#64;`) so they cannot mention GitHub users or inject formatting.
- **Records:** each pull request is stored in `cms_submissions` (migration 0007: who, file, kind, title, branch, pull request URL and number, created_at) and in the audit log (`content.pull_request_opened`); failures at any GitHub step are audited as `content.pull_request_failed` with the step and status.
- **YAML parser at runtime:** js-yaml moves from `devDependencies` to `dependencies` (with its only dependency, argparse). It was already in the lockfile and audited, and using the same parser and wrapper as the build means the editor and CI cannot disagree about what a file means. Alternatives rejected: parsing in the browser and trusting the result (the server would validate data it did not derive), bundling js-yaml into a build artefact the server loads (a second, unusual load path for one module), or writing a YAML subset parser (a new source of disagreement with the build).

## GitHub REST endpoints used (checked on docs.github.com on 2026-11-27)

| Call | Endpoint | Documentation page |
|---|---|---|
| Default branch | `GET /repos/{owner}/{repo}` (`default_branch`) | <https://docs.github.com/en/rest/repos/repos#get-a-repository> |
| List files | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` (`tree_sha` accepts a branch name; result may be `truncated` above 100,000 entries or 7 MB) | <https://docs.github.com/en/rest/git/trees#get-a-tree> |
| Read a file | `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` (Base64 content for files up to 1 MB) | <https://docs.github.com/en/rest/repos/contents#get-repository-content> |
| Head commit | `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` | <https://docs.github.com/en/rest/git/refs#get-a-reference> |
| Create branch | `POST /repos/{owner}/{repo}/git/refs` with `ref: refs/heads/…` and `sha` | <https://docs.github.com/en/rest/git/refs#create-a-reference> |
| Commit the file | `PUT /repos/{owner}/{repo}/contents/{path}` with `message`, Base64 `content`, the replaced blob `sha` and `branch` | <https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents> |
| Open the pull request | `POST /repos/{owner}/{repo}/pulls` with `title`, `head`, `base`, `body` | <https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request> |
| Token permissions | Metadata read; Contents read/write; Pull requests write | <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens> |

Requests send `Accept: application/vnd.github+json`, `Authorization: Bearer <token>` and `X-GitHub-Api-Version: 2026-03-10`, the newest supported version on <https://docs.github.com/en/rest/about-the-rest-api/api-versions> on the date checked (`2022-11-28` is supported until 2028-03-10; an unsupported version gets `410 Gone`).

## Positive consequences

Faculty can correct and improve content without Git, while every change is still reviewed, diffed, attributed and validated by CI. Invalid files are caught before a pull request exists. The server holds no content tables.

## Negative consequences

- The server holds a token that can write to the repository's contents and open pull requests. It must be scoped to this one repository, stored like any other secret, and rotated (fine-grained tokens expire).
- Only existing files can be edited; creating, renaming or deleting files, and editing figures, still needs Git.
- If a GitHub step fails after the branch was created, the branch is left behind (the error message and the audit event name it) for a maintainer to finish or delete.
- **Untested against the real GitHub API** in this repository's tests: they use an in-process fake (`server/test/fake-github.ts`) that follows the documented behaviour. Try one submission against a scratch repository before enabling it for faculty.

## Revisit when

Faculty need to create new lessons (add file creation with the `new:*` templates), several app instances run (the serial queue and the per-user limit are per process), or the college wants pull requests opened by a GitHub App instead of a personal token.
