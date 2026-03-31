# G2 Schema Upgrade Safety

## Status

- Objective: `G2 - Schema Upgrade Safety`
- Backlog status after this note: `done`
- Scope: decomposition output for Pipeline Phases 1-3, with immediate follow-on
  execution on the first regression task

## Phase 1: Domain Understanding

### What exists today

- Storage schema evolution is explicit and versioned in
  `packages/storage/src/db/schema.ts` via `STORAGE_SCHEMA_VERSION`, a migration
  ledger, and idempotent initialization helpers.
- The storage layer already records schema metadata and backfills it on open
  when older stores are missing `schema_meta` / `schema_migrations`.
- Existing regression coverage already tests two upgrade-related slices:
  upgrading legacy `atom_edges` tables that lack endpoint columns, and
  backfilling schema metadata on stores created before the schema ledger.
- The CLI guide already documents operator-facing upgrade safety steps,
  including a mandatory pre-upgrade export bundle and post-upgrade validation
  commands.

### Gaps confirmed

1. No acceptance test currently opens a legacy store and verifies that the main
   user-facing objects remain readable after upgrade: turns, sessions, and
   projects.
2. Existing upgrade tests validate migration mechanics in isolation, but they do
   not prove the broader release-gate claim that an upgraded store remains safe
   to read.
3. The backlog description for G2 lags current docs: upgrade instructions now
   exist in `docs/guide/cli.md`, but they have not yet been validated against a
   full legacy-store readability scenario.

### Constraints and design boundaries

- This objective should validate the existing automatic-on-open migration model;
  it should not redesign schema bootstrap or require a new manual migration CLI.
- The acceptance path should use a synthesized legacy SQLite file created from
  current fixtures plus deterministic downgrade helpers, rather than checking in
  opaque binary database snapshots.
- The primary proof belongs in `@cchistory/storage` tests. `@cchistory/cli`
  remains an adjacent regression surface because operator verification flows run
  through CLI commands like `stats` and `search`.

## Phase 3: Functional Design

### Problem statement

The repository already has versioned schema metadata, targeted migration logic,
and operator docs, but Gate 2 requires a stronger proof: opening an existing
store created by an older schema must not make turns, sessions, or projects
unreadable. The current regression suite does not yet prove that end-to-end
readability claim.

### Decided approach

1. Seed a representative store using existing storage fixtures that create a
   turn, a session, and project-link evidence.
2. Programmatically downgrade the SQLite file to a legacy shape by removing
   schema metadata tables and rewriting `atom_edges` to the prior column shape.
3. Reopen the store with the current storage layer and assert that schema
   metadata is restored and the seeded turn, session, and project remain
   readable.
4. Reuse existing CLI upgrade regression coverage as the adjacent read-surface
   check, then decide whether any doc adjustments are still needed.

### Trade-offs and rejected alternatives

- A checked-in legacy `.sqlite` fixture was rejected because it is opaque,
  harder to review, and more brittle across future schema changes.
- A brand-new manual upgrade command was rejected because the current product
  model already upgrades on open; Gate 2 is about safety proof, not a new
  migration UX.
- Restricting validation to schema metadata tables alone was rejected because it
  does not prove user-visible readability.

### Acceptance criteria

1. A storage acceptance test opens a synthesized legacy store and verifies that
   the current schema version and migration ledger are restored on open.
2. The same test verifies that at least one seeded turn, one seeded session,
   and one seeded project remain readable after upgrade.
3. Targeted regression validation covers both `@cchistory/storage` and the
   relevant `@cchistory/cli` read path.
4. Operator upgrade docs remain aligned with the validated backup-first path.

### Immediate Phase 4 / 5 tasks

- Write a storage test named like an acceptance criterion for legacy store
  readability.
- If that test fails, implement the minimum storage migration fix required.
- Validate with `pnpm --filter @cchistory/storage test` and adjacent CLI tests.

## Current execution evidence

- Added a storage acceptance test that opens a synthesized legacy SQLite store,
  restores schema metadata, and verifies turn/session/project readability after
  upgrade.
- Confirmed the operator upgrade path documented in `docs/guide/cli.md` already
  matches the backup-first workflow required by Gate 2; no doc edit was needed
  in this execution pass.
- Validation completed successfully on 2026-03-27 with:
  - `pnpm --filter @cchistory/storage test`
  - `pnpm --filter @cchistory/cli test`

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change stays within storage regression
  coverage and backlog/design documentation. No runtime schema semantics,
  product invariants, or service startup flows were redesigned.
- **Stability assessment**: pass. The new acceptance test covers a broader
  legacy-store scenario than the previous isolated migration checks by combining
  schema-ledger backfill, `atom_edges` table upgrade, and user-visible read
  paths.
- **Scalability evaluation**: pass for the gate scope. The added test operates
  on a minimal synthesized legacy store, which is appropriate because Gate 2 is
  about upgrade correctness rather than large-scale performance.
- **Compatibility assessment**: pass. No new schema migration was introduced;
  the work strengthens proof that the current auto-upgrade path preserves
  readability of existing stores.
- **Security evaluation**: pass. The change adds only local test helpers that
  rewrite temporary SQLite files; it does not introduce new user-facing input or
  network exposure.
- **Maintainability assessment**: pass. The legacy-shape helpers remain small,
  readable, and colocated with storage regression tests instead of relying on a
  checked-in opaque database artifact.

### Issues found

- None above low severity.

### Known limitations accepted

- The acceptance fixture is a synthesized legacy store produced by deterministic
  downgrade helpers, not a literal archived database from an older tagged
  release. This is accepted because it is reviewable, cross-platform, and still
  exercises the upgrade path required by the current schema contract.

### Conclusion

- `G2 - Schema Upgrade Safety` satisfies its current acceptance criteria and can
  be marked `done`.
