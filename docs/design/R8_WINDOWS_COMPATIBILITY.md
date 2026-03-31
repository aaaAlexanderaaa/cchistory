# R8 - Windows Compatibility

## Status

- Objective source: `docs/ROADMAP.md`
- Current phase: `R8-KR1` through `R8-KR3` were implemented on 2026-03-27, but
  a follow-up review found that UNC file-URI authorities are still not preserved
  by the shared path helper
- Scope: path parsing, default source roots, URI/separator normalization, and
  local file/runtime differences on Windows hosts

## Phase 1 - Domain Understanding

### Problem statement

The roadmap calls out Windows compatibility as a first-class objective, but the
current repository has only partial Windows-aware behavior. The riskiest areas
are source auto-discovery, path normalization consistency across layers,
workspace/repo identity derivation, and user-facing read paths that compare or
present workspace strings.

### What is already implemented

#### Canonical/path identity helpers

- `packages/domain/src/index.ts` includes `normalizeSourceBaseDir`, which:
  - converts backslashes to `/`
  - collapses repeated separators
  - trims trailing `/`
  - lowercases the Windows drive letter
- `packages/source-adapters/src/core/legacy.ts` includes
  `normalizeWorkspacePath`, which:
  - decodes URI escapes
  - converts backslashes to `/`
  - normalizes via `path.posix.normalize`
  - lowercases drive letters for paths that already match `C:` style input
- `packages/storage/src/linker.ts` and
  `packages/storage/src/linking/fallback.ts` already normalize backslashes to
  `/` for workspace-derived linking keys.

#### Windows-aware default roots already present

- `cursor` adapter has an explicit `win32` default-root branch under
  `%APPDATA%/Cursor/...` in `packages/source-adapters/src/platforms/cursor.ts`.
- `antigravity` adapter has an explicit `win32` default-root branch under
  `%APPDATA%/Antigravity/...` in
  `packages/source-adapters/src/platforms/antigravity.ts`.

#### Existing Windows-oriented test coverage

- `packages/source-adapters/src/index.test.ts` now proves `getDefaultSourcesForHost`
  prefers the verified Windows `Cursor` and `Antigravity` user-data roots.
- `packages/storage/src/index.test.ts` proves Windows-style `base_dir` values do
  not crash persistence and that equivalent Windows source-root spellings remain
  one source identity.
- `apps/cli/src/index.test.ts` proves Windows-style workspace references can be
  resolved on non-Windows hosts.

### Gaps and inconsistencies found

#### 1. Default-root discovery is incomplete across adapters

The following adapters currently expose only POSIX-style default roots in their
`getDefaultBaseDirCandidates` implementations and therefore are not ready to
claim Windows auto-discovery parity:

- `codex`
- `claude_code`
- `factory_droid`
- `amp`
- `openclaw`
- `opencode`
- `lobechat`

This means a Windows host may require manual source configuration even where the
same source type is auto-discovered on macOS/Linux.

#### 2. Path normalization behavior is still inconsistent across layers

Normalization is now defined once for the first KR1 call sites, but full
cross-layer convergence is not complete yet.

Examples:

- `normalizeSourceBaseDir` lowercases drive letters, but storage linking
  `normalizePathKey` helpers do not yet share the same canonical helper.
- `packages/source-adapters/src/core/legacy.ts` and some platform-specific path
  helpers still carry adjacent normalization logic instead of reusing the new
  shared identity helper.
- `R8-KR1` removed the known user-facing drift in `apps/cli` session reference
  matching and `apps/web` workspace comparison, but the rest of the pipeline has
  not converged yet.

#### 3. Windows file URI handling is likely incomplete

`packages/source-adapters/src/core/legacy.ts` strips `file://` with a raw string
replacement. For a Windows URI like `file:///C:/Users/...`, this yields
`/C:/Users/...`, which does not match the `C:`-style drive-letter branch and can
produce a normalized path that differs from the canonical `c:/Users/...` form.

`packages/source-adapters/src/platforms/antigravity/live.ts` has a similar
pattern in `normalizeLocalPath`: `file:///C:/...` can remain `/C:/...` instead of
canonicalizing to a drive-letter form.

#### 4. User-facing path comparisons required an immediate first slice

Before `R8-KR1`, the highest-risk user-facing comparison points were:

- `apps/web/components/session-map.tsx`, which could fail to recognize
  equivalent workspace paths when one side used backslashes or drive-letter case
  differences.
- `apps/cli/src/index.ts`, which used `path.basename(session.working_directory)`
  when matching human-friendly session references and could mis-handle
  Windows-shaped paths on non-Windows hosts.

`R8-KR1` now fixes those two call sites. Remaining work is primarily in source
normalization, storage/linking consistency, and verified default-root discovery.

#### 5. Real Windows runtime behavior is not validated on this host

This Linux-hosted environment cannot verify:

- actual Windows source root locations for all supported platforms
- SQLite and local file-path behavior on Windows Node runtimes
- real source-emitted Windows URI/path shapes for each adapter

### Why this matters to frozen semantics

These issues do not suggest a change to `HIGH_LEVEL_DESIGN_FREEZE.md`. The
frozen semantics remain intact:

- project-first history still applies
- `UserTurn` remains the primary object
- evidence-preserving ingestion still applies
- UI/API remain projections over one canonical model

The compatibility work is about making Windows hosts reach the same canonical
model reliably, not about redefining that model.

### Assumptions

- Cross-platform canonical path identity should normalize to forward slashes and
  stable drive-letter casing for Windows paths.
- Source auto-discovery should be treated as a compatibility surface, not just a
  convenience feature.
- User-facing matching and presentation paths should reuse the same normalization
  rules as ingestion/linking wherever practical.

### Remaining unknowns

- Official Windows data-root locations for `codex`, `claude_code`,
  `factory_droid`, `amp`, `openclaw`, `opencode`, and `lobechat` still need
  verification from real installations or primary source documentation.
- Real Windows source samples are not available on this host, so Windows URI
  edge cases still need fixture evidence.
- It is still unknown whether any adapter emits Windows UNC paths, percent-
  encoded drive URIs, or mixed-separator paths in the wild.

## Recommended next step

Proceed to Phase 2 and Phase 3 for a Windows-compatibility slice that:

1. defines one canonical path-normalization policy reused across layers,
2. enumerates verified Windows default-root candidates per adapter,
3. adds Windows-shaped fixture/test coverage for path identity and source
   discovery,
4. fixes the highest-risk user-facing mismatches first (`CLI` session matching
   and web path comparison), and
5. defers any adapter-specific Windows support claims until real roots are
   verified.

## Phase 2 - Test Data Preparation

### Required fixture and evidence scenarios

Windows compatibility needs both synthetic path fixtures and real-host evidence.
The minimum scenario set is:

- backslash workspace and base-dir paths
- drive-letter case variants (`C:` vs `c:`)
- `file:///C:/...` URIs
- mixed separators plus trailing slash variants
- non-Windows-host reads of Windows-shaped workspace paths
- adapter default-root discovery snapshots from a real Windows host

### Current limitation

This host is not Windows, so real local source roots and source-emitted Windows
path samples are unavailable here.

### Collection support added

Use `scripts/collect-r8-windows-path-samples.mjs` on a Windows machine to gather
candidate-root existence evidence for the current adapter roster:

```bash
node scripts/collect-r8-windows-path-samples.mjs
```

That script does not prove support by itself; it produces a reviewable evidence
snapshot to guide fixture creation and discovery-policy decisions.

## Phase 3 - Functional Design

Environment note: this objective is system-level and benefits from the required
multi-perspective design protocol. In this agent environment there is no
sub-agent launcher, so the protocol is recorded as explicitly separated lenses
plus a synthesis decision.

### Agent A - System Consistency

**Recommendation**: define one shared, canonical local-path identity helper and
make all layers converge on it.

**Reasoning**:

- Today, path identity rules differ across domain, source-adapters, storage,
  CLI, and web.
- Windows compatibility should not be solved separately in every layer.
- The canonical helper should normalize file URIs, separators, redundant
  slashes, trailing slashes, and drive-letter casing without introducing source-
  specific semantics.

**Risk**: over-centralization could mix concerns between source discovery and
presentation.

**Mitigation**: keep the helper focused on local-path identity only; let adapter-
specific default-root policies remain adapter-owned.

### Agent B - User Experience

**Recommendation**: first ship the user-visible path-consistency slice before
expanding discovery claims.

**Reasoning**:

- The most immediate user pain is mismatched workspace references and UI path
  comparisons.
- If a Windows path is ingested but cannot be matched or compared consistently,
  recall feels broken even if discovery technically worked.
- CLI session reference matching and web workspace comparison are high-value,
  low-surface fixes.

**Risk**: fixing UX-only symptoms without storage/ingestion parity could create
partial consistency.

**Mitigation**: make the first slice use the same shared path helper that later
storage and adapter work will adopt.

### Agent C - Engineering Cost

**Recommendation**: decompose the objective into three KRs and execute them in
order of lowest blocker and highest leverage.

**Reasoning**:

- One slice can fix normalization consistency and user-facing mismatches without
  waiting for real Windows discovery evidence.
- A second slice can add verified Windows default-root candidates once evidence
  is collected.
- A third slice can broaden regression coverage and host validation.

**Risk**: trying to finish discovery, normalization, runtime validation, and
fixture generation in one change would be too broad.

**Mitigation**: make `KR1` the first executable implementation slice and keep
Windows root verification separate.

### Synthesis

The recommended path forward is:

1. Introduce one shared Windows-safe path identity helper reusable from source,
   storage, CLI, and web layers.
2. Use that helper first in the highest-risk user-facing comparison points.
3. Treat Windows default-root coverage as a separate KR that requires verified
   evidence before support claims are strengthened.
4. Expand automated regression coverage with Windows-shaped fixtures after the
   helper contract is fixed.

### Decided KRs

#### KR: R8-KR1 Shared path normalization and user-facing matching

Acceptance: Windows separators, drive-letter casing, and file URI forms are
normalized consistently in the highest-risk path-identity call sites, including
CLI session reference matching and web workspace comparison.

#### KR: R8-KR2 Verified Windows default source roots

Acceptance: each supported adapter either has verified Windows default-root
candidates or is explicitly documented as requiring manual configuration on
Windows.

#### KR: R8-KR3 Windows fixture and regression coverage

Acceptance: Windows-shaped fixtures and tests cover normalization, linking,
source discovery, and user-facing reference behavior.

### Impacted areas

- `packages/domain` or another shared pure helper location for canonical path
  identity
- `packages/source-adapters` path/URI normalization and default-root discovery
- `packages/storage` linking path keys
- `apps/cli` human-friendly workspace/session reference matching
- `apps/web` workspace/path comparison surfaces
- docs for platform support and operator expectations

### First executable slice

Implement `R8-KR1` first. It is the smallest unblocked slice and does not depend
on verified Windows default-root evidence.

## Phase 5 - KR1 Implementation

`R8-KR1` was implemented on 2026-03-27 with one shared local-path identity
helper in `packages/domain/src/index.ts`:

- `normalizeLocalPathIdentity`
- `getLocalPathBasename`
- `localPathIdentitiesMatch`

That helper is now used in the first two highest-risk user-facing call sites:

- `apps/cli/src/index.ts` resolves human-friendly session references against
  normalized workspace paths and normalized basenames, including Windows-shaped
  paths read on non-Windows hosts.
- `apps/web/components/session-map.tsx` now uses the shared helper for
  workspace/path comparison instead of its local comparison-only behavior.
- `apps/web/tsconfig.json` maps `@cchistory/domain` so the canonical web app can
  consume the shared helper without introducing a new package-install path.

## Phase 6 - KR1 Regression And Acceptance

`R8-KR1` acceptance was verified on 2026-03-27 with the following targeted
commands:

- `pnpm --filter @cchistory/domain build`
- `pnpm --filter @cchistory/cli test`
- `cd apps/web && pnpm lint`
- `cd apps/web && NODE_OPTIONS=--max-old-space-size=1536 pnpm build`

Results:

- CLI regression coverage now proves Windows-style workspace references match on
  non-Windows hosts.
- Web lint and production build both pass with the shared helper import.
- The KR1 acceptance criterion is satisfied for the currently targeted
  user-facing comparison surfaces.

## KR2 - Windows Default-Root Policy And Validation

`R8-KR2` was completed on 2026-03-27 by making the Windows discovery policy
explicit across runtime and operator surfaces:

- `docs/design/CURRENT_RUNTIME_SURFACE.md` now records, for every registered
  adapter, whether Windows default-root auto-discovery is verified or should be
  treated as manual configuration.
- `docs/guide/web.md`, `docs/guide/cli.md`, and `docs/sources/README.md` now
  tell operators to use the `Sources` view or `/api/admin/source-config` when a
  Windows adapter does not yet have verified default roots.
- `docs/sources/codex.md`, `docs/sources/claude-code.md`,
  `docs/sources/factory-droid.md`, and `docs/sources/amp.md` no longer present
  unverified Windows home-relative paths as stable support claims.

`R8-KR2` was regression-checked with:

- `pnpm --filter @cchistory/source-adapters test`
- `pnpm --filter @cchistory/storage test`

Results:

- Verified Windows auto-discovery is now explicitly limited to `Cursor` and
  `Antigravity`.
- All other adapters are explicitly documented as requiring manual
  confirmation/override on Windows until real-host evidence exists.
- Source-adapter and storage regressions now pin the verified Windows discovery
  branches and equivalent Windows source-root identity behavior.

## KR3 - Windows Fixture And Regression Coverage

`R8-KR3` was completed on 2026-03-27 by expanding Windows-shaped regression
coverage across normalization, linking, source discovery, and user-facing
reference behavior:

- `packages/source-adapters/src/index.test.ts` now covers Windows `file:///C:/...`
  and `file://localhost/C:/...` workspace inputs across generic source parsing
  and Antigravity live-summary projection.
- `packages/source-adapters/src/core/legacy.ts` and
  `packages/source-adapters/src/platforms/antigravity/live.ts` now reuse the
  shared domain path-identity helper instead of carrying divergent Windows URI
  normalization rules.
- `packages/storage/src/index.test.ts`, `packages/storage/src/linker.ts`, and
  `packages/storage/src/linking/fallback.ts` now verify and use the same Windows
  path identity rules for source-root identity and workspace-path continuity.
- `apps/cli/src/index.test.ts` now covers mixed-separator and `file://localhost`
  session references in addition to plain Windows paths.

`R8-KR3` was regression-checked with:

For the canonical meaning and operator usage of `probe:smoke`, see
`docs/guide/inspection.md`. The command below is the historical validation path
recorded for this KR.

- `pnpm --filter @cchistory/source-adapters test`
- `pnpm --filter @cchistory/domain build`
- `pnpm --filter @cchistory/storage test`
- `pnpm --filter @cchistory/cli test`
- `pnpm run probe:smoke -- --source-id=srcinst-codex-8a4ce054 --limit=1`

Results:

- Windows file URIs, mixed separators, drive-letter variants, and
  `file://localhost` paths are now covered by executable regressions.
- Storage linking now commits same-host Windows workspace variants into one
  project instead of splitting them by spelling differences.
- The KR3 acceptance criterion is satisfied, and Objective `R8` is ready for
  Phase 7 holistic evaluation in a fresh agent context.

### Post-completion correction on 2026-03-27

A follow-up review found that `normalizeLocalPathIdentity` currently drops the
authority component for UNC file URIs such as `file://server/share/project`,
normalizing them to `server/share/project` instead of `//server/share/project`.
Because the shared helper now feeds CLI, web, and linker path identity, this is
not just a documentation limitation; it is a remaining correctness gap.

Implication:

- the existing KR3 regression set is still useful for drive-letter and
  `file://localhost` forms
- the original KR3 acceptance claim was too broad because UNC authority
  preservation is still uncovered
- corrective follow-up is required before `R8` should be treated as fully
  closed again

### Corrective closure on 2026-03-28

The shared-path corrective follow-up landed on 2026-03-28.

Results:

- `normalizeLocalPathIdentity` now preserves UNC authorities for
  `file://server/share/...` forms, normalizing them to `//server/share/...`
- storage ingestion now re-normalizes session working directories and
  project-observation path evidence so imported or legacy payloads do not keep
  stale UNC file-URI spellings
- executable regressions now cover the shared helper directly plus storage and
  CLI workflows that must treat raw UNC paths and UNC file URIs as the same
  workspace/session/project identity

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-27.

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This environment does not provide a separate evaluator launcher, so the review
below is the best available same-context evaluation and should be treated as the
recorded objective evaluation for this host.

### Dimensions evaluated

- **Boundary evaluation**: passes.
  - Windows-specific normalization is centralized in `packages/domain` and then
    reused from `packages/source-adapters`, `packages/storage`, `apps/cli`, and
    `apps/web` rather than leaking source-specific rules into product
    semantics.
  - The frozen invariants remain intact: project-first history, evidence-
    preserving ingestion, and `UserTurn`-centered projections were not changed.

- **Stability assessment**: passes with accepted limitations.
  - Regression coverage now spans Windows file URIs, `file://localhost`, mixed
    separators, drive-letter variants, same-host workspace continuity, source
    discovery, and human-friendly CLI references.
  - The main remaining risk is real-host Windows diversity not present on this
    Linux machine, especially UNC paths and source-specific Windows exports not
    yet sampled.

- **Scalability evaluation**: passes for objective scope.
  - The implementation reuses existing normalization at parse/link boundaries and
    adds constant-time string normalization rather than introducing new global
    scans or schema changes.
  - No change expanded the asymptotic cost of linking or projection building.

- **Compatibility assessment**: passes.
  - No schema migration was introduced.
  - Existing persistence continues to work, and storage regressions prove Windows
    path variants resolve to stable source and project identity instead of
    fragmenting existing records.

- **Security evaluation**: passes.
  - The change only broadens normalization of local path strings already treated
    as evidence metadata.
  - No new network surface, secret-bearing config, or service lifecycle behavior
    was added.

- **Maintainability assessment**: passes.
  - The canonical helper location is easy to find in `packages/domain`.
  - Regression coverage is package-local and follows existing Node test runner
    patterns.
  - Runtime/operator docs now match the implemented Windows policy.

### Issues found

- **Medium, accepted**: true fresh-context evaluation was not available in this
  harness.
- **Medium, accepted**: real Windows-host evidence is still absent for UNC paths
  and for unverified adapter root claims beyond the documented `Cursor` and
  `Antigravity` cases.

### Issues resolved during evaluation

- None. The evaluation did not uncover a new blocking implementation defect.

### Accepted known limitations

- Real Windows host validation remains outside this Linux-hosted environment.
- `scripts/collect-r8-windows-path-samples.mjs` remains the follow-up path for
  collecting additional Windows evidence if future issues appear.

### Conclusion

The original 2026-03-27 Phase 7 pass record is preserved above as historical
execution evidence, but it is superseded for the current repository-visible
state by the post-completion correction note. Treat `R8` as requiring
corrective follow-up until UNC file-URI authorities are preserved by the shared
path-identity helper and covered by executable regressions.
