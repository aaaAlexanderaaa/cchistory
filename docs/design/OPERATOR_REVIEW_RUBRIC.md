# Operator Review Rubric

## Purpose

This document is the single source of truth for the friction categories, severity scale, and diary rules used across all operator-experience reviews in this repository. Individual design docs (R22, R29, R31, etc.) reference this rubric instead of duplicating the definitions.

## Friction Categories

| Category | Description |
| --- | --- |
| Discoverability | Next action is unclear or hidden |
| Readability | Information exists but hard to parse quickly |
| Traceability | Can find a turn but cannot connect to session/source/context |
| Guardrail truthfulness | Missing store/data/partial support presented unclearly |
| Workflow overhead | Too many steps or flags for a common operator task |
| Parity drift | CLI, TUI, API, and web disagree about the same canonical object |

## Severity Scale

- **S0** — cosmetic; no backlog follow-up unless repeated
- **S1** — noticeable friction, journey still succeeds
- **S2** — major friction or misleading behavior; backlog follow-up required
- **S3** — canonical workflow failure or semantic mismatch; mandatory backlog item

## Diary Rules

- A diary entry is evidence of operator experience, not a replacement for the design freeze.
- Corroborate semantic bugs with targeted code/tests before changing product semantics.
- Every S2/S3 friction point must become a concrete backlog task before broader corrective work.
- Manual web review must record the user-started service command explicitly.
