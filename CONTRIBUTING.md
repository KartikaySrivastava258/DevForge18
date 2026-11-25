# Contributing to DevForge 18

Thank you for helping. There are two kinds of contribution and both matter equally: **code** and **content**.

## Setup

Node.js 22.18+ is the only requirement. See the README quick start, then run `npm run verify` once to make sure everything passes on your machine.

## Workflow

1. Open or pick an issue; for anything large, discuss the approach first.
2. Branch from `main` (`feat/…`, `fix/…`, `content/<track>-…`).
3. Keep changes focused. Add or update tests with every behaviour change.
4. Run `npm run verify` before pushing.
5. Open a pull request using the template; CI must pass and one reviewer must approve.

Commit messages follow Conventional Commits (`feat:`, `fix:`, `content:`, `docs:`, `test:`, `chore:`).

## Code guidelines

- Strict TypeScript; no `any` without a comment explaining why.
- Validate every input on the server with zod; never build SQL by string concatenation.
- New database changes go in a **new** numbered migration; never edit an applied one.
- No inline scripts or styles in HTML (CSP).
- Every visible control must do what its label says; no placeholder buttons.
- Update `IMPLEMENTATION_STATUS.md` when you finish a milestone.

## Content guidelines

Read [`docs/content-authoring.md`](docs/content-authoring.md). The short version: never invent anything, cite official sources, test every command, label simulations, and write self-checks that test understanding.
