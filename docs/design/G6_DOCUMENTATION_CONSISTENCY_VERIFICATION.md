# G6 Documentation Consistency Verification

## Status

- Objective: `G6 - Documentation Consistency Verification`
- Backlog status after this note: `done`
- Scope: decomposition, verifier implementation, validation, and holistic
  evaluation in one execution pass

## Phase 1: Domain Understanding

### What exists today

- `README.md` and `README_CN.md` already publish a self-host v1 support-tier
  table that lists the nine registered adapters and marks six as `Stable` and
  three as `Experimental`.
- `docs/design/CURRENT_RUNTIME_SURFACE.md` publishes the same adapter roster
  with explicit support tiers.
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md` freezes the stable-vs-experimental
  contract and the rule that `registered` and `supported` are not synonymous.
- `docs/sources/README.md` implicitly makes support claims by documenting only
  the stable adapters and excluding the experimental ones from stable source
  references.
- The adapter registry remains the code-level source for support tiers via the
  platform definitions in `packages/source-adapters/src/platforms/*.ts`.

### Gaps confirmed

1. No automated check currently proves that README, runtime-surface, release-
   gate, and source-note support claims still match the adapter registry.
2. Tier drift would currently be discovered only by manual cross-reading.
3. The repository has no single command operators can run before release to
   validate support-status documentation.

### Constraints and design boundaries

- This objective should validate existing support claims, not redesign support
  tiers or adapter semantics.
- The check should read repository files directly and must not require building
  TypeScript packages first.
- The verifier should focus on support-tier consistency rather than unrelated
  doc wording or source-location prose.

## Phase 3: Functional Design

### Problem statement

Gate 6 requires user-facing support claims to match code-level support-tier
metadata. The repository already states those tiers in several places, but the
agreement is manual and therefore fragile. A light repository-owned verifier is
needed so tier drift becomes an executable failure instead of a release review
surprise.

### Decided approach

1. Add a root verifier script that reads adapter support tiers from
   `packages/source-adapters/src/platforms/*.ts`.
2. Parse the support-tier tables in `README.md`, `README_CN.md`,
   `docs/design/CURRENT_RUNTIME_SURFACE.md`, and
   `docs/design/SELF_HOST_V1_RELEASE_GATE.md`.
3. Parse the stable and experimental support claims in `docs/sources/README.md`.
4. Fail if any documented platform set or tier assignment differs from the
   registry, and expose the check via `pnpm run verify:support-status`.

### Trade-offs and rejected alternatives

- A manually maintained manifest was rejected because it would add another drift
   surface instead of checking the docs that users actually read.
- A package-scoped test was rejected because this objective spans root docs and
   does not need a build step; a root verifier script is smaller and cheaper.
- Full prose diffing was rejected because Gate 6 is about support-status truth,
   not sentence-level copy synchronization.

### Acceptance criteria

1. A repository command verifies support-tier claims in README, runtime-surface,
   release-gate, and source-reference docs against the adapter registry.
2. The verifier fails when a platform is missing, extra, or assigned the wrong
   tier in any checked document.
3. Release-gate-facing docs point to the verifier as the Gate 6 validation path.

## Current execution evidence

- Added `scripts/verify-support-status.mjs` and exposed it as
  `pnpm run verify:support-status`.
- Wired the verifier to compare registry tiers against `README.md`,
  `README_CN.md`, `docs/design/CURRENT_RUNTIME_SURFACE.md`,
  `docs/design/SELF_HOST_V1_RELEASE_GATE.md`, and `docs/sources/README.md`.
- Updated `README.md`, `README_CN.md`, and
  `docs/design/SELF_HOST_V1_RELEASE_GATE.md` to point to the verifier.

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change adds only a docs/registry verifier,
  package script, and supporting documentation; no adapter semantics or frozen
  product invariants changed.
- **Stability assessment**: pass. The checked documents now fail fast if support
  tiers drift away from code-level metadata.
- **Scalability evaluation**: pass for the gate scope. The verifier reads a
  small set of repository files and has negligible runtime cost.
- **Compatibility assessment**: pass. No API, CLI, storage, or ingestion
  behavior changed.
- **Security evaluation**: pass. The verifier reads local repository files only
  and introduces no new network or runtime surface.
- **Maintainability assessment**: pass. Future support-tier changes now have one
  explicit command that reveals all doc drift across the main user-facing
  surfaces.

### Known limitations accepted

- The verifier checks support-tier tables and stable/experimental inclusion
  claims, not every sentence that mentions a platform elsewhere in prose. That
  is acceptable because Gate 6 is about support-status truth rather than full
  copy synchronization.

### Conclusion

- `G6 - Documentation Consistency Verification` satisfies its current
  acceptance criteria and can be marked `done`.
