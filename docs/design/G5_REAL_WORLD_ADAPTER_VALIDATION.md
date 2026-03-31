# G5 Real-World Adapter Validation

## Status

- Objective: `G5 - Real-World Adapter Validation`
- Backlog status after this note: `done`
- Scope: decomposition, validation formalization, regression wiring, and
  holistic evaluation in one execution pass

## Phase 1: Domain Understanding

### What exists today

- The adapter registry already distinguishes `stable` and `experimental` tiers
  in `packages/source-adapters/src/platforms/registry.ts`.
- `packages/source-adapters/src/index.test.ts` already exercises the six
  `stable` adapters against sanitized `mock_data/` roots derived from real local
  source structures, and separately preserves Antigravity live-trajectory
  fixtures.
- `mock_data/README.md` and `docs/sources/README.md` already describe the stable
  source references as real-world validated, but that proof is spread across
  docs, fixtures, and tests rather than captured in one machine-readable place.
- This host currently has real local roots for `codex`, `claude_code`,
  `factory_droid`, and `amp`, but not for `cursor` or `antigravity`.

### Gaps confirmed

1. No repository-owned manifest currently defines what evidence makes a stable
   adapter "real-world validated".
2. No regression test currently proves that every `stable` adapter and only
   `stable` adapters have documented real-world validation assets.
3. The main stable-adapter mock-data test still hardcodes the stable list,
   which means tier changes and validation coverage can drift apart.

### Constraints and design boundaries

- This objective should formalize the existing support-tier contract, not
  redesign adapter semantics or support policy.
- The proof should build on the existing sanitized fixture corpus in
  `mock_data/`; it should not require checking unsanitized operator data into
  the repository.
- Antigravity remains a two-surface exception: offline fixtures prove disk
  evidence, while sanitized live-trajectory fixtures prove the runtime-only raw
  prompt path.
- Fresh local recollection for Cursor or Antigravity is not required to close
  this gate because the repository already contains sanitized real-world-derived
  fixtures; the missing piece is formalized linkage between those fixtures and
  the `stable` support claim.

## Phase 3: Functional Design

### Problem statement

Gate 5 says `stable` means an adapter is validated against real-world source
samples and protected by regression tests. The repository already has most of
that evidence, but it is implicit. Without a machine-readable contract, the
`stable` label can drift away from the fixture corpus and the regression suite.

### Decided approach

1. Add a machine-readable manifest under `mock_data/` that maps each `stable`
   adapter to the sanitized real-world scenarios and runtime-only fixture files
   that justify its support claim.
2. Update the source-adapter regression suite so it asserts the manifest covers
   exactly the registry's `stable` adapters and excludes `experimental`
   adapters.
3. Rewire the real mock-data probe test to consume the manifest instead of a
   hardcoded stable adapter list.
4. Update release-gate-facing docs and backlog state to make the validation path
   explicit.

### Trade-offs and rejected alternatives

- A new repo-level verifier script was rejected because
  `pnpm --filter @cchistory/source-adapters test` already is the canonical
  behavioral proof for this layer; adding another wrapper would duplicate the
  existing package-scoped validation path.
- Treating docs alone as sufficient proof was rejected because Gate 5 is about
  executable support claims, not prose assertions.
- Requiring fresh samples from the current host before formalizing the gate was
  rejected because the fixture corpus is already sanitized from real local data;
  the missing gap is traceability, not raw-data availability.

### Acceptance criteria

1. `mock_data/stable-adapter-validation.json` exists and lists every stable
   adapter, its probe root, and its real-world scenario coverage.
2. `@cchistory/source-adapters` tests fail if a stable adapter lacks manifest
   coverage or if an experimental adapter appears in the stable manifest.
3. The stable-adapter mock-data probe regression runs from the manifest-backed
   source list rather than a duplicated hardcoded list.
4. Release-gate docs explain the manifest-backed proof and Antigravity's live
   fixture requirement.

## Current execution evidence

- Added `mock_data/stable-adapter-validation.json` as the machine-readable proof
  surface for the six stable adapters.
- Updated `scripts/validate_mock_data.py` so the manifest is part of fixture
  layout validation.
- Added a source-adapter regression test that enforces manifest coverage for all
  stable adapters and exclusion for experimental adapters.
- Rewired the stable-adapter mock-data probe regression to consume the manifest.
- Updated `mock_data/README.md` and
  `docs/design/SELF_HOST_V1_RELEASE_GATE.md` to point at the formalized proof.

## Phase 7 Evaluation Report

### Result

- Pass on 2026-03-27.

### Dimensions evaluated

- **Boundary evaluation**: pass. The change formalizes validation assets and
  regression coverage without changing adapter parsing semantics or frozen
  product invariants.
- **Stability assessment**: pass. Stable-tier evidence now lives in one
  repository-owned manifest that tests can verify directly.
- **Scalability evaluation**: pass for the gate scope. The added checks operate
  on existing fixture inventory and the existing source-adapter regression path.
- **Compatibility assessment**: pass. No storage, API, or CLI contract changes
  were introduced.
- **Security evaluation**: pass. The work strengthens reliance on sanitized
  fixtures and avoids introducing new access to operator-local data.
- **Maintainability assessment**: pass. Future tier changes now have one obvious
  place where validation evidence must be declared and one existing test suite
  that will fail if the declaration drifts.

### Known limitations accepted

- This host still lacks live local Cursor and Antigravity roots, so the current
  proof relies on the repository's sanitized real-world fixture corpus rather
  than fresh recollection from this machine. That is acceptable for Gate 5
  because the gate is about traceable validation evidence plus regression
  protection, both of which now live in the repository.

### Conclusion

- `G5 - Real-World Adapter Validation` satisfies its current acceptance
  criteria and can be marked `done`.
