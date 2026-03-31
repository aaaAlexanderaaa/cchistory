# R3 - Export And Import Optimization

## Status

- Objective source: `docs/ROADMAP.md`
- Current implementation slices: import preflight / dry-run planning; export dry-run bundle preview
- Multi-perspective design protocol: skipped for this slice because the change is
  a narrow CLI and bundle-workflow planning improvement that does not alter
  frozen import semantics, evidence rules, or reconciliation behavior.

## Phase 1 - Domain Understanding

### Current behavior

- `apps/cli/src/index.ts` supports `export` and `import`, but `import` performs
  bundle validation, conflict detection, raw materialization, and store writes in
  one step.
- The current import command can fail on source conflicts, but the operator only
  learns that after invoking the mutating command.
- Existing import behavior compares incoming payload checksums against the target
  store per `source.id`, then chooses one of three actions: skip identical,
  import new, or replace / error for conflicting sources.
- The CLI already has a global `--dry-run` concept for `sync` and `gc`, but not
  for bundle import.
- Existing tests in `apps/cli/src/index.test.ts` already cover round-trip,
  default raw inclusion, idempotency, and conflict modes.

### What is known

- The design freeze requires offline import to remain raw-first and to preserve
  evidence semantics.
- This slice does not need to change bundle contents, source identity,
  reconciliation rules, or canonical derivation.
- The missing usability gap is planning visibility: operators need to know what
  an import would do before mutating a target store, especially for large
  bundles and cross-machine handoff.

### What remains uncertain

- Whether a future roadmap item should address authoritative vs partial import
  scope or cross-host source adoption semantics beyond preview-oriented workflow
  improvements.

## Phase 2 - Test Data Preparation

No new `mock_data/` corpus is required for this slice.

- Existing CLI bundle tests already synthesize realistic bundle workflows with
  checksum-based conflict scenarios.
- Additional dry-run cases can be expressed as package-scoped CLI tests using
  the same temporary fixture setup.

## Phase 3 - Functional Design

### Problem statement

The roadmap calls out friction in large bundles, conflict handling, and
cross-machine migration. Today `cchistory import` jumps directly from bundle
selection to mutation. That makes it harder for operators to inspect what will
happen, reason about conflicts, and safely plan migration on another machine.

### Decided approach

Add dry-run planning to both sides of the bundle workflow.

#### Slice 1 - `import --dry-run`

The import dry-run command:

1. Reads and validates the bundle normally.
2. Compares each incoming source payload against the target store using the same
   checksum and conflict rules as the real import path.
3. Reports a source-level action plan: `import`, `replace`, `skip`, or
   `conflict`.
4. Returns bundle summary counts and a `would_fail` signal when
   `--on-conflict error` would block the actual import.
5. Avoids all store writes, raw blob copies, and raw-GC side effects.

To keep the actual import path and preview path consistent, the conflict-planning
logic lives in shared bundle helper code rather than CLI-only conditionals.

#### Slice 2 - `export --dry-run`

The export dry-run command previews which sources, sessions, turns, and blobs
would be written to a bundle and does so without creating the target bundle
folder. This reduces operator friction for large-bundle planning before the
actual filesystem write step.

### Trade-offs and rejected alternatives

- Rejected: change import semantics in the same patch. The slice is about
  operator visibility, not redesigning reconciliation.
- Rejected: add a separate `inspect bundle` command first. `import --dry-run`
  maps directly onto the operator decision they already need to make.
- Rejected: return success-without-signal for conflict previews. The preview
  must surface whether the chosen conflict mode would block the real import.

### Acceptance criteria

- `cchistory import <bundle> --dry-run` validates the bundle and prints a source
  action plan without mutating the target store.
- Dry-run import reports whether the chosen `--on-conflict` mode would fail on
  the current target store.
- Actual import continues to use the same conflict-planning logic as dry-run.
- `cchistory export --dry-run` previews bundle contents without creating the
  bundle directory.
- Existing import behaviors for idempotent, skip, replace, and error modes stay
  intact.

### Impact on existing system

- Affected package: `apps/cli`
- Affected files: `apps/cli/src/index.ts`, `apps/cli/src/bundle.ts`,
  `apps/cli/src/index.test.ts`, and CLI docs.
- No change to frozen import model semantics, canonical storage schema, or
  evidence-preserving layers.
