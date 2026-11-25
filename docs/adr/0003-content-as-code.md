# ADR 0003 — Learning content as version-controlled files

- **Status:** Accepted (2026-11-24)

## Context

The blueprint's data model lists tables for tracks, lessons, resources and quizzes, and also recommends a `content/` folder of YAML/Markdown with schema validation. Content accuracy is the product's main risk: invented commands, links or company claims would mislead students.

## Options considered

1. Content in the database, edited through an admin CMS.
2. **Content in Git, validated and compiled at build time.**
3. Hybrid: Git as source of truth, later a CMS that opens pull requests.

## Decision

Option 2 now, evolving to option 3 in Phase 5. The database stores only learner state and references content by stable slug/id.

## Positive consequences

Every change is reviewed, diffed and attributable; invalid content fails the build with exact file and field; content and code are versioned together; the server needs no content tables or editing endpoints (smaller attack surface).

## Negative consequences

Non-developers need Git (or the future CMS) to edit; publishing requires a rebuild and redeploy.

## Revisit when

Faculty need to edit content without Git (Phase 5 CMS that writes to the repository through pull requests).
