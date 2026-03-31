# G3 Backup And Restore

## Status

- Objective: `G3 - Backup And Restore`
- Backlog status after this note: `done`
- Scope: decomposition output for Pipeline Phases 1-3, with immediate follow-on
  execution on the primary acceptance test

## Phase 1: Domain Understanding

### What exists today

- The CLI already implements export/import bundle workflows in
  `apps/cli/src/index.ts` and `apps/cli/src/bundle.ts`.
- The canonical portable backup unit is already documented in
  `docs/guide/cli.md` as an export bundle.
- The docs already state that raw evidence snapshots are included by default and
  that restore should target an empty or new store directory.
- Existing CLI regression coverage already proves a basic export/import
  round-trip preserves counts, and conflict/idempotency flows are also covered.

### Gaps confirmed

1. The backlog description is stale: backup/restore tooling and operator docs do
   exist.
2. The current regression suite does not yet encode Gate 3 as an acceptance
   criterion: default raw inclusion, restore into a clean directory, and
   post-restore CLI readability checks for sources/sessions/turns.
3. The release-gate claim is therefore only partially proven even though the
   implementation surface already exists.

### Constraints and design boundaries

- G3 should validate the existing export/import model rather than invent a new
  backup format.
- The acceptance proof should stay at the CLI layer because Gate 3 is an
  operator-facing workflow.
- The test should use a clean target store directory and real bundle files so it
  exercises the same path a self-host operator would run.

## Phase 3: Functional Design

### Problem statement

The repository already has bundle export/import functionality and user-facing
docs, but the release gate requires a stronger proof than the current tests
provide. The system must show that the documented backup unit is correct,
restore works into a clean directory, and restored data is readable through the
same CLI surface an operator would use.

### Decided approach

1. Treat the export bundle as the canonical backup unit.
2. Add a CLI acceptance test that exports from a populated source store using
   default settings, verifies the bundle manifest reports `includes_raw_blobs:
   true`, and imports into a clean target store directory.
3. After restore, validate readability through CLI commands covering the gate
   surface: `stats`, `ls sources`, `ls sessions`, and `search` for a known turn.
4. Reuse the existing round-trip/count tests as adjacent proof, not as the sole
   acceptance test.

### Trade-offs and rejected alternatives

- Restricting proof to storage-layer assertions was rejected because Gate 3 is
  explicitly operator-facing.
- Verifying only bundle file presence without a restore was rejected because it
  would not prove recovery.
- Adding a second backup format was rejected because export bundles already map
  to the product semantics and are documented.

### Acceptance criteria

1. The backup unit is documented and explicitly states whether raw blobs are
   included.
2. A CLI acceptance test restores a bundle into a clean target directory.
3. After restore, CLI validation confirms sources, sessions, and turns are
   readable.
4. Targeted CLI regression validation passes.

## Current execution evidence

- Added a CLI acceptance test that exports a default bundle, verifies
  `includes_raw_blobs: true`, restores into a clean target directory, and checks
  post-restore readability through `stats`, `ls sources`, `ls sessions`, and
  `search`.
- Confirmed the existing operator guide already documents the canonical backup
  unit, default raw inclusion behavior, and clean-directory restore path; no doc
  edit was required in this execution pass.
- Validation completed successfully on 2026-03-27 with:
  - `pnpm --filter @cchistory/cli test`

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change stays at the CLI acceptance layer
  and validates the existing export/import design instead of introducing a new
  backup mechanism.
- **Stability assessment**: pass. The new test proves the operator path against
  a clean target directory and verifies raw snapshot restoration plus readable
  source/session/turn surfaces after import.
- **Scalability evaluation**: pass for the gate scope. Gate 3 requires
  correctness of the restore workflow, not large-bundle performance tuning.
- **Compatibility assessment**: pass. No bundle schema or storage schema change
  was needed; the work strengthens proof around the existing bundle format.
- **Security evaluation**: pass. The change exercises existing local file and
  checksum-verified bundle behavior without adding new network or service
  surfaces.
- **Maintainability assessment**: pass. The acceptance test is readable,
  operator-oriented, and colocated with existing CLI regression coverage.

### Issues found

- None above low severity.

### Known limitations accepted

- The new test validates the default bundle behavior with raw blobs included; it
  does not try to prove `--no-raw` is an equivalent archival strategy. That is
  acceptable because the docs already frame `--no-raw` as an explicitly lighter,
  non-default export mode.

### Conclusion

- `G3 - Backup And Restore` satisfies its current acceptance criteria and can be
  marked `done`.
