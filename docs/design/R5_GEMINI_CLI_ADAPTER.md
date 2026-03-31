# R5 - Gemini CLI Adapter

## Status

- Objective source: `docs/ROADMAP.md`
- Backlog status after this note: corrective follow-up under `B1-KR1` closed on
  2026-03-28
- Phase reached: original KR1-KR3 completion was recorded on 2026-03-27, and a
  2026-03-28 corrective follow-up closed the remaining evidence-preservation
  gap in Gemini companion-file capture
- Scope: sync-supported Gemini CLI ingestion from local `~/.gemini` state,
  including source discovery, parsing, project/workspace mapping, docs, and
  regression coverage

## Phase 1 - Domain Understanding

### Problem statement

The roadmap calls for a new Gemini CLI adapter, but the repository currently has
only partial Gemini awareness:

- `packages/domain` allows `gemini` as a platform enum value
- `apps/web` already treats `gemini` as a recognizable platform label/icon
- `cchistory discover` exposes Gemini CLI local state as a `discover_only` tool
- the live adapter registry does **not** yet include a sync-supported `gemini`
  adapter

This means the product can tell an operator that Gemini CLI state exists on the
host, but it cannot yet sync that state into canonical sessions, project
observations, or `UserTurn` history.

### What is already implemented

- `packages/source-adapters/src/core/legacy.ts` already exposes discovery-only
  Gemini CLI artifacts under `~/.gemini`, specifically:
  - `settings.json`
  - `tmp`
  - `history`
- `docs/guide/cli.md` already documents Gemini CLI as a discovery-only tool.
- `packages/domain/src/index.ts` already includes `gemini` in the broader
  platform enum, which means schema-level consumers are already prepared to
  label synced records with that platform.
- This host contains real Gemini CLI local state under `/root/.gemini`, giving
  Phase 1 access to real disk evidence instead of pure guesswork.

### Host findings on 2026-03-27

The current host has a real Gemini CLI root:

- present: `/root/.gemini`
- present: `/root/.gemini/projects.json`
- present: `/root/.gemini/history/agentresearch/.project_root`
- present: `/root/.gemini/tmp/agentresearch/.project_root`
- present:
  `/root/.gemini/tmp/agentresearch/chats/session-2026-03-04T01-47-550867ae.json`

The sampled session file proves a repository-visible baseline session shape:

- top-level fields: `sessionId`, `projectHash`, `startTime`, `lastUpdated`,
  `messages`
- each message currently observed includes: `id`, `timestamp`, `type`, and
  `content[]`
- the observed content payload contains text blocks with preserved user-authored
  prompt text

The companion files suggest a project-mapping scheme distinct from existing
adapters:

- `projects.json` maps an absolute workspace path to a short project label
- `.project_root` sidecars under both `history/<project>/` and `tmp/<project>/`
  point back to the absolute workspace path
- the `tmp/<project>/chats/*.json` directory appears to contain the actual local
  session transcript files

### Gaps and unknowns

The available host evidence is enough to define an initial adapter boundary, but
several important unknowns remain:

- whether Gemini CLI session files also contain assistant replies, tool calls,
  tool results, token usage, or interruption markers beyond the minimal sampled
  user-only session
- whether the `history/` tree contains additional per-session artifacts besides
  `.project_root`
- whether `projectHash` is stable enough to use as a secondary project signal or
  should remain diagnostic-only
- whether cross-platform roots differ beyond the repository-visible `~/.gemini`
  layout
- whether a base dir of `~/.gemini` is the right sync root, or whether the
  adapter should anchor on `~/.gemini/tmp` and read `history/` plus
  `projects.json` as companion artifacts

### Why this matters to frozen semantics

This objective does not require a change to `HIGH_LEVEL_DESIGN_FREEZE.md`.
Gemini CLI should converge into the existing canonical model:

- preserve raw evidence from local Gemini session files
- derive canonical sessions and `UserTurn` objects from that evidence
- derive project identity through evidence such as workspace paths and project
  companion metadata
- keep Gemini-specific storage quirks inside the adapter boundary rather than in
  product semantics

### Assumptions

- Gemini CLI belongs to the same `local_coding_agent` family as other local CLI
  tools in this repository.
- The canonical sync root will likely be under `~/.gemini`, because the actual
  transcript files and project companion files are split across `tmp/`,
  `history/`, and root-level metadata.
- `projects.json` and `.project_root` are project-observation evidence, not
  substitutes for user-authored turns.
- Initial implementation should prefer under-linking over false project merges
  if `projectHash` and path-based signals disagree.

## Phase 2 - Test Data Preparation

### Required evidence scenarios

A credible Gemini CLI adapter needs anonymized fixtures for at least these
scenarios:

1. minimal session JSON with one user turn
2. multi-message session containing assistant output
3. tool-use / tool-result session if Gemini CLI records them locally
4. project companion files: `projects.json` plus `.project_root` sidecars
5. missing optional files (`settings.json` absent, `history/` partially present)
6. malformed or truncated session JSON for loss-audit coverage

### Current fixture gap

The repository has no Gemini CLI fixture corpus yet. Existing Gemini references
only document discovery-only local roots and Antigravity companion artifacts
under `.gemini/antigravity`.

### Collection path prepared

To unblock fixture creation and future validation, the repository should expose a
repeatable sample collector for Gemini CLI roots. The collector should copy only
Gemini CLI-relevant artifacts:

- `.gemini/projects.json`
- `.gemini/settings.json` when present
- `.gemini/installation_id` when present
- `.gemini/history/*/.project_root`
- `.gemini/tmp/*/.project_root`
- `.gemini/tmp/*/chats/*.json`

## Phase 3 - Functional Design

Environment note: this objective benefits from the multi-perspective design
protocol. In this environment there is no sub-agent launcher, so the protocol is
recorded as separated lenses plus a synthesis.

### Agent A - System Consistency

**Recommendation**: keep Gemini CLI source parsing inside one dedicated adapter
instead of extending the current discovery-only tool surface with ad hoc parsing
logic.

**Reasoning**:

- `discover` already exposes host visibility; sync should remain a separate,
  adapter-owned capability.
- Gemini-specific sidecars such as `projects.json` and `.project_root` should be
  translated into canonical project observations, not leak into the storage or
  presentation layers.
- The adapter boundary is the right place to normalize any future Gemini
  message-shape variants.

### Agent B - Reporter / Operator Experience

**Recommendation**: preserve a simple operator story.

**Reasoning**:

- Operators should ultimately be able to `sync` Gemini CLI with the same mental
  model as other local sources.
- Discovery should continue to expose Gemini roots clearly even before full sync
  support is stable.
- Source docs should distinguish between transcript-bearing Gemini CLI files and
  unrelated `.gemini/antigravity/*` companion artifacts used by a different
  adapter.

### Agent C - Engineering Cost

**Recommendation**: ship in three KRs.

**Reasoning**:

- KR1: collect real samples and establish sanitized fixture coverage
- KR2: add sync-supported adapter registration, discovery, and parser behavior
- KR3: add docs, runtime-surface updates, and regression/probe validation

This sequence respects the pipeline rule that realistic fixture coverage should
exist before parser implementation expands.

### Synthesis

The recommended path is:

1. capture and anonymize real Gemini CLI samples from `~/.gemini`
2. register a dedicated `gemini` sync adapter with a narrow file-matching rule
3. parse session JSON into canonical turns while treating project companion
   files as evidence, not turn text
4. document support tier and operator expectations only after parser behavior
   and regressions exist

### Decided KRs

#### KR: R5-KR1 Real-source understanding and fixture preparation

Acceptance: Gemini CLI disk structure is documented from real samples, a
repeatable collection path exists, and anonymized fixtures cover transcript plus
project-companion evidence.

#### KR: R5-KR2 Adapter registration and canonical parsing

Acceptance: the repository exposes a sync-supported `gemini` adapter that
parses local Gemini CLI session data into canonical sessions, project
observations, and `UserTurn`-compatible fragments without violating frozen
semantics.

#### KR: R5-KR3 Docs and regression coverage

Acceptance: runtime surface, CLI/user docs, and targeted regression suites
accurately reflect Gemini CLI support status and expected behavior.

### Impacted areas

- `BACKLOG.md`
- `docs/design/` for the decomposition and future implementation record
- `scripts/` for Gemini CLI sample collection
- `mock_data/` for anonymized Gemini fixtures
- `packages/source-adapters` for adapter registration, discovery, and parsing
- `apps/cli`, `docs/guide/`, and runtime-surface docs for operator-facing
  support claims

### First executable slice

Implement `R5-KR1` first by adding a Gemini CLI sample collection path and then
using those samples to prepare sanitized fixtures before parser work begins.

## KR1 - Real-Source Understanding And Fixture Preparation

The first executable slice was implemented on 2026-03-27 by adding a repeatable
sample collector:

Canonical operator guidance for inspection helpers now lives in
`docs/guide/inspection.md`. The command below is preserved here as the
historical collection path used during the R5 slice.

- `scripts/inspect/collect-source-samples.mjs`
- root command: `pnpm run inspect:collect-source-samples -- --platform gemini`

The collector copies only Gemini CLI-relevant artifacts from `~/.gemini` into a
manifested inspection bundle.

Results:

- the repository now has a one-command path to gather real Gemini CLI evidence
  without guessing file coverage
- future fixture work can start from a consistent collection shape instead of ad
  hoc manual copying
- the collector intentionally excludes unrelated binaries such as
  `.gemini/tmp/bin/*` and avoids treating `.gemini/antigravity/*` as Gemini CLI
  transcript evidence

KR1 acceptance was verified on 2026-03-27 with:

- `pnpm run inspect:collect-source-samples -- --platform gemini --output /tmp/r5-gemini-cli-samples-test` (stable usage documented in `docs/guide/inspection.md`)
- `pnpm run mock-data:validate`


## KR2 - Adapter Registration And Canonical Parsing

`R5-KR2` was completed on 2026-03-27 by adding a sync-supported Gemini CLI
adapter and parser path:

- `packages/source-adapters/src/platforms/gemini.ts`
- `packages/source-adapters/src/platforms/registry.ts`
- `packages/source-adapters/src/platforms/types.ts`
- `packages/source-adapters/src/core/legacy.ts`
- `packages/source-adapters/src/index.test.ts`

The implementation chooses a narrow adapter boundary:

- the sync root defaults to `~/.gemini`
- only `.gemini/tmp/<project>/chats/*.json` is treated as transcript-bearing
  source input
- `.project_root` sidecars and `projects.json` are read as project/workspace
  evidence
- unrelated `.gemini/antigravity/*` artifacts stay outside the Gemini CLI
  parser surface

Results:

- Gemini CLI is now a registered sync-supported adapter with `experimental`
  support tier
- session JSON is normalized into canonical sessions, turns, and context using
  the existing generic conversation runtime path
- project/workspace signals are derived from `.project_root` and `projects.json`
  without leaking Gemini-specific path rules into product semantics

KR2 acceptance was verified on 2026-03-27 with:

- `pnpm --filter @cchistory/source-adapters test`

### Post-completion correction on 2026-03-27

A follow-up review found that the current adapter derives `title` and
`working_directory` from `projects.json` and `.project_root`, but only
`.gemini/tmp/<project>/chats/*.json` currently enters the transcript capture
path. That means project-linking evidence used during derivation is not yet
reproducible through the captured-blob or raw-snapshot flow used by export,
import, and audit surfaces.

Implication:

- the narrow scanning rule remains valid for transcript-bearing chat files
- the evidence-preservation claim for companion-derived metadata was too strong
- corrective follow-up is required before this objective should be treated as
  fully closed again

## KR3 - Docs And Regression Coverage

`R5-KR3` was completed on 2026-03-27 by updating the repository-visible support
surface and regression artifacts:

- `README.md`
- `README_CN.md`
- `docs/design/CURRENT_RUNTIME_SURFACE.md`
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md`
- `docs/guide/cli.md`
- `docs/sources/README.md`
- `scripts/verify-support-status.mjs`
- `mock_data/README.md`
- `mock_data/scenarios.json`
- `scripts/validate_mock_data.py`

Results:

- the support-tier docs now describe Gemini CLI as `experimental` everywhere the
  registry is compared against user-facing support claims
- sanitized Gemini CLI fixture coverage is documented and validated under
  `mock_data/`
- CLI guidance now reflects Gemini CLI as a sync-supported source root instead
  of describing it only as discovery-only host state

KR3 acceptance was verified on 2026-03-27 with:

- `pnpm --filter @cchistory/source-adapters test`
- `pnpm run mock-data:validate`
- `pnpm run verify:support-status`

## Phase 7 - Holistic Evaluation

Evaluation date: 2026-03-27.

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This environment does not provide a separate evaluator launcher, so the review
below is the best available same-context evaluation and should be treated as the
recorded objective evaluation for this host.

### Dimensions evaluated

- **Boundary evaluation**: passes.
  - Gemini-specific storage details remain inside the source-adapter boundary.
  - The implementation preserves frozen invariants: raw evidence remains the
    source of truth, `UserTurn` remains derived, and project identity remains
    evidence-based.

- **Stability assessment**: passes with accepted limitations.
  - The new adapter has executable regression coverage and a sanitized fixture
    slice for transcript plus project-companion files.
  - The main remaining risk is broader real-world Gemini CLI diversity not yet
    represented on this host, especially tool-use, token-usage, and Windows-host
    variations.

- **Scalability evaluation**: passes for objective scope.
  - The adapter uses the existing generic conversation runtime and scans a
    narrow chat-file subset instead of expanding `.gemini` into an unbounded
    artifact crawl.
  - No schema migration or global asymptotic cost increase was introduced.

- **Compatibility assessment**: passes.
  - Existing stable-adapter support claims remain unchanged.
  - Gemini CLI is documented as `experimental`, so the new support surface does
    not overstate self-host v1 readiness.

- **Security evaluation**: passes.
  - The collector and parser operate only on local host files already under the
    user’s home directory.
  - No new network surface, secret-bearing config, or service lifecycle behavior
    was introduced.

- **Maintainability assessment**: passes.
  - The adapter is isolated in one platform module and reuses existing generic
    parse helpers.
  - Support-tier docs are kept executable through `pnpm run verify:support-status`.

### Issues found

- **Medium, accepted**: true fresh-context evaluation was not available in this
  harness.
- **Medium, accepted**: real-world Gemini CLI evidence on this host currently
  covers only the transcript + project-companion slice, not richer tool-use or
  token-usage variants.
- **Low, accepted**: Windows root behavior is documented as manual-confirmation
  territory until real-host verification exists.

### Issues resolved during evaluation

- Registry, support-tier docs, and mock-data inventory now agree on Gemini CLI
  support status and fixture presence.

### Accepted known limitations

- Gemini CLI remains `experimental` until more real-world samples validate the
  broader message-shape surface.
- `discoverHostToolsForHost` still exposes auxiliary Gemini CLI artifact roots,
  but operator-facing docs now treat Gemini CLI primarily as a sync-supported
  source root.

### Conclusion

The original 2026-03-27 Phase 7 pass record is preserved above as historical
execution evidence, but it is superseded for the current repository-visible
state by the post-completion correction note. Treat `R5` as requiring
corrective follow-up until Gemini companion evidence enters the captured-
evidence path.
