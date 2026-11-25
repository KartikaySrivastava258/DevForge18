# ADR 0001 — A minimal, verifiable technology stack

- **Status:** Accepted (2026-11-24)

## Context

The blueprint suggests React + TypeScript, a Node.js/TypeScript backend, PostgreSQL, Redis, Nginx and Docker. The platform was built in an environment without internet access, so only packages already present could be installed and tested. The blueprint also insists that no test be claimed as passing unless it was run.

## Problem

Choose a stack that meets the blueprint, can be fully tested where it was built, and stays easy for students to run and maintain.

## Options considered

1. Conventional stack (Express, Vite, Prisma, Vitest, ESLint) — familiar, but none could be installed or tested offline; shipping it untested would contradict the testing rules.
2. A full-stack framework (Next.js) — couples UI and server, larger surface, not available.
3. **Minimal stack on platform features**: Node 22 `node:http`, native TypeScript type stripping, `node:test`, `node:sqlite`, zod for validation, React 19 bundled by esbuild, Playwright for browser tests.

## Decision

Option 3. zod (Zod 4 API, imported from `"zod/v4"`) is the only runtime dependency. Development tooling: TypeScript, esbuild, js-yaml, marked, highlight.js, Playwright.

## Positive consequences

- Every part was exercised by tests in the build environment.
- `npm install && npm run build && npm start` is the whole setup; no compiler step for the server.
- Small dependency surface reduces supply-chain risk and upgrade work.

## Negative consequences

- A hand-written router and test harness instead of widely documented libraries; contributors must read ~150 lines of router/context code.
- No ESLint/Prettier yet; formatting relies on `.editorconfig` and review.
- `@types/react` could not be installed offline, so the frontend typecheck first ran on the owner's machine (2026-11-25: 0 errors).

## Risks

Native TypeScript stripping requires Node ≥ 22.18 and forbids non-erasable syntax (enums, parameter properties); `erasableSyntaxOnly` enforces this at typecheck time.

## Revisit when

Routing needs grow (nested layouts, data loaders) → adopt a router library. Team grows → add ESLint and Prettier to CI.
