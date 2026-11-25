# ADR 0006 — Visual design direction

- **Status:** Accepted (2026-11-24)

## Context

The blueprint asks for a premium developer tool, not a generic college portal: dark-first with a careful light mode, deep navy surfaces, restrained electric-blue or violet accents, architecture diagrams as the visual signature, and no decorative gradients or empty card grids.

## Decision

- **Palette:** navy ink `#0E1526`, panels `#141D30`/`#1B2640`, hairlines `#2A3654`; one interactive accent (signal blue `#7AA2FF`; `#2C56D6` in light mode). Categories are encoded by position on the system map, not by a rainbow of colours.
- **Type:** Fira Sans (SIL OFL), self-hosted as Latin subsets, because the CSP forbids font CDNs and students may be offline or on slow networks; system monospace for code; a 1.25 type scale.
- **Signature:** the home-page system map — all 18 tracks positioned by role, with edges drawn only from authored `related` entries, so every line has an explanation.
- **Restraint:** lists and grouped rows rather than identical cards; sentence-case labels; motion only in response to user actions; `prefers-reduced-motion` respected.

## Consequences

A distinctive, coherent look with ~110 KB of fonts. See `docs/design-system.md` for tokens and usage rules.
