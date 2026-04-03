# R14 CodeBuddy Transcript Intake

## Status

- Objective: `R14 - CodeBuddy Transcript Intake`
- Original delivery date: 2026-04-01
- Current self-host v1 tier: `stable` as of 2026-04-02 after `R16 - CodeBuddy Stable Promotion Review`
- Scope: CodeBuddy transcript parsing, companion evidence capture, regression proof, and the 2026-04-02 stable-promotion review

## Delivered Slice

The repository first registered `codebuddy` as a new **experimental** local coding-agent platform on 2026-04-01. The 2026-04-02 promotion review confirmed that the same intake slice now satisfies the current self-host v1 `stable` bar on the reviewed local-host path.

Delivered behavior:

- discovers the default local root at `~/.codebuddy`
- ingests non-empty `.codebuddy/projects/**/*.jsonl` transcript files
- captures companion evidence from `.codebuddy/settings.json` and `.codebuddy/local_storage/*.info`
- keeps `providerData.skipRun` command echoes as raw evidence only instead of promoting them into derived user turns
- avoids promoting zero-byte sibling JSONL files into standalone sessions
- emits canonical session/turn/context projections through the existing shared source-adapter pipeline

## Validation

Promotion and intake are now grounded in the reviewed local archive at `.realdata/config_dots_20260331_212353/.codebuddy`, the 2026-03-31 archive review note, sanitized fixtures, and parser regressions.

Validated with:

- direct local-host archive review of `.realdata/config_dots_20260331_212353/.codebuddy`
- `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`
- `mock_data/.codebuddy/`
- `pnpm --filter @cchistory/source-adapters test`

Targeted regression and evidence coverage now proves:

- registry and discovery surfaces include `codebuddy`
- probing `mock_data/.codebuddy` yields healthy sync output
- skip-run command echoes do not become canonical turns
- zero-byte sibling JSONL files do not become standalone sessions
- companion evidence is captured alongside transcript-bearing JSONL
- the repository ships a repeatable collector path for the reviewed `.codebuddy` root

## Stable Promotion Review (2026-04-02)

The promotion checklist passes on the current host review path because all of the following are already true:

- a reviewed real local archive exists in-repo under `.realdata/config_dots_20260331_212353/.codebuddy`
- the transcript-bearing boundary is explicit: non-empty `.codebuddy/projects/**/*.jsonl`
- companion evidence capture is explicit and evidence-preserving for `settings.json` plus `local_storage/*.info`
- sanitized fixtures cover the two reviewed edge cases that most affect truthful projection: `providerData.skipRun` command noise and zero-byte sibling JSONL files
- parser regressions already cover the adopted transcript boundary and companion behavior
- support-surface caveats about Windows autodiscovery remain explicit, so the stable claim does not depend on unverified Windows default-root assumptions

No additional parser or fixture blocker remains for the currently reviewed local `.codebuddy` layout, so the truthful next state is `stable`, not a lingering generic `experimental` warning.

## Phase 7 - Holistic Evaluation

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7. This pass was recorded in the same implementation session because the repository currently has a single active agent context.

### Boundary Evaluation

- CodeBuddy now widens support claims only for the reviewed local `.codebuddy` layout; it does not imply support for unrelated cloud, remote-sync, or other vendor-specific roots.
- Source-specific behavior stays at the parse boundary: `providerData.skipRun` affects only derived projection, while raw JSONL rows remain preserved as evidence.
- Companion files remain evidence-bearing inputs rather than parallel transcript streams.

### Stability Assessment

- Real local data confirms that `.codebuddy/projects/**` can mix non-empty transcript JSONL, zero-byte sibling files, and companion local-storage entries under one visible project root.
- Discovery remains rooted under `~/.codebuddy`, avoiding cross-tool path guessing.
- The parser continues to reuse the shared generic conversation runtime after CodeBuddy-specific normalization, reducing bespoke branching risk.

### Scalability Evaluation

- CodeBuddy uses line-oriented JSONL parsing rather than loading unrelated local roots into memory.
- Companion evidence capture remains bounded to one settings file plus `local_storage/*.info` siblings under the same reviewed base root.

### Compatibility Assessment

- No schema migration is introduced.
- Existing source-adapter registry, DTO unions, and domain unions already support CodeBuddy without widening canonical product semantics beyond the reviewed local family.

### Security Evaluation

- No new network path or service lifecycle dependency is introduced.
- Captured companion artifacts are treated as evidence only; no executable local content is interpreted.

### Maintainability Assessment

- Adapter registration lives in the same registry/default-source surfaces as other stable local adapters.
- CodeBuddy-specific projection logic stays intentionally minimal: skip-run suppression, provider-data usage lifting, and native project-ref derivation.
- Regression coverage uses the existing sanitized fixtures under `mock_data/.codebuddy` plus the archive-review note that documents the real-host basis.

### Known Limitations Accepted

- The stable claim is limited to the reviewed local `.codebuddy` layout, not unreviewed cloud or remote-sync variants.
- Windows should still use an explicit source root configuration until a real Windows host independently confirms the default-root path.
- The current slice does not attempt richer interpretation of every `providerData` field beyond skip-run suppression and usage extraction.

## Result

Phase 7 evaluation passes for the current `R14` scope, and the 2026-04-02 promotion review confirms CodeBuddy as a `stable` adapter for the reviewed local `.codebuddy` transcript family.
