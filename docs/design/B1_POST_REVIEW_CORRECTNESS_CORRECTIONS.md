# B1 - Post-Review Correctness Corrections

## Status

- Objective source: follow-up review on 2026-03-27
- Backlog status after this note: `done`
- Phase reached: Phase 7 holistic evaluation passed on 2026-03-28
- Scope: close three repository-visible correctness gaps found after the earlier
  closure records for `R4`, `R5`, and `R8`

## Corrective scope closed

This objective closed three follow-up correctness gaps:

1. Gemini companion evidence now enters the captured-evidence path instead of
   being derivation-only metadata.
2. UNC `file://server/share/...` forms now preserve the authority component in
   the shared local-path identity helper and in dependent storage/CLI flows.
3. The web project tree slice is lint-clean again under the current React
   Compiler rules.

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-28.

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This environment does not provide a separate evaluator launcher, so the review
below is the recorded same-context evaluation for this host.

### Dimensions evaluated

- **Boundary evaluation**: passes. The Gemini evidence fix stayed in adapter
  capture flow, the UNC fix stayed in shared path normalization plus storage
  ingestion normalization, and the tree-view correction stayed local to the web
  component.
- **Stability assessment**: passes. Added regressions now cover Gemini
  companion evidence capture/reconstruction, UNC raw-path vs file-URI identity,
  and the lint failure condition. No new persistent runtime process dependency
  was introduced.
- **Scalability evaluation**: passes. The UNC normalization change is constant
  time string handling, and the tree-view lint fix removes a manual memoization
  point rather than adding heavier work.
- **Compatibility assessment**: passes. No schema migration was required.
  Existing persisted stores remain readable, and new storage writes normalize
  UNC-related session/project observation paths more defensively.
- **Security evaluation**: passes. No new network access, service lifecycle, or
  privilege boundary was introduced.
- **Maintainability assessment**: passes. The fixes align with existing package
  boundaries and rely on small, directly testable helpers.

### Commands run

- `pnpm --filter @cchistory/source-adapters test`
- `pnpm --filter @cchistory/storage test`
- `pnpm --filter @cchistory/domain test`
- `pnpm --filter @cchistory/cli test`
- `cd apps/web && pnpm lint`

### Issues found during evaluation

- None remaining at objective scope.

### Known limitations accepted

- `FTS5 unavailable` warnings remain expected on this host and continue to fall
  back to substring search.
- Phase 7 was recorded in the same agent context because no fresh evaluator
  launcher is available in this environment.
