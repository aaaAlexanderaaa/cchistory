# R17 LobeChat Export Validation

## Status

- Objective: `R17 - LobeChat Real-Sample Validation And Promotion Decision`
- Date: 2026-04-02
- Scope: evaluate the current LobeChat experimental slice, name the missing evidence, and define the next truthful real-sample path

## Current Repository Slice

The repository currently exposes `lobechat` as an **experimental** `conversational_export` adapter.

Current visible behavior:

- registers `lobechat` in the platform registry with default root candidate `~/.config/lobehub-storage`
- matches `.json` files under the configured base root
- routes those files through the generic export-conversation seed extractor rather than a LobeChat-specific parser
- keeps LobeChat out of the stable manifest and stable source-reference docs
- preserves a minimal synthetic regression fixture in `packages/source-adapters/src/index.test.ts`

## Evidence Reviewed

This review is based on the repository-visible evidence that already exists today:

- `packages/source-adapters/src/platforms/lobechat.ts`
- `packages/source-adapters/src/core/legacy.ts`
- `packages/source-adapters/src/index.test.ts`
- `docs/design/REAL_SOURCE_ARCHIVE_REVIEW_2026-03-31.md`
- `docs/design/CURRENT_RUNTIME_SURFACE.md`
- `docs/design/SELF_HOST_V1_RELEASE_GATE.md`
- `docs/sources/README.md`

## Findings

### What is already true

- LobeChat has a truthful experimental registration in the adapter registry.
- The parser path can ingest at least one synthetic export-shaped JSON fixture with `messages[]`, `role`, `content`, and assistant usage metadata.
- User-facing support surfaces already keep LobeChat in the experimental bucket and do not over-claim stable support.

### What is still missing

- No reviewed real LobeHub/LobeChat transcript or export sample is present in `.realdata/`; the 2026-03-31 archive review explicitly recorded zero observed LobeChat transcript data.
- No sanitized `mock_data/` corpus currently backs the LobeChat parser; the only regression coverage is a synthetic fixture created inside the source-adapter test file.
- No machine-readable stable validation basis exists for LobeChat, so it cannot satisfy Gate 5 today.
- The current default root candidate `~/.config/lobehub-storage` and broad `.json` matcher are still unverified against a reviewed real local sample, which means they must not be treated as promotion-ready evidence.
- A canonical sample-collection path now exists through `scripts/inspect/collect-source-samples.mjs` and `docs/guide/inspection.md`, but it only stages candidate JSON evidence from the still-unverified `~/.config/lobehub-storage` root assumption; it does not by itself prove that the root candidate, transcript boundary, or parser contract are promotion-ready.

## Review Conclusion

The current repository slice is enough to justify a **registered experimental export parser**, but it is not enough to justify a stable-promotion review like the recent Gemini, OpenClaw, OpenCode, or CodeBuddy slices.

The real blocker is not missing doc sync; it is missing evidence:

1. a real LobeHub/LobeChat export or local-root sample bundle,
2. a structure review that confirms which files are transcript-bearing versus config-only,
3. sanitized fixtures derived from that review, and
4. parser/regression proof grounded in those reviewed samples.

Until that evidence exists, the truthful state is:

- keep `lobechat` registered as `experimental`
- keep it out of `docs/sources/` stable source references
- do not add it to `mock_data/stable-adapter-validation.json`
- do not widen support claims beyond the current export-parser baseline

## Recommended Next Step

Collect one real LobeHub/LobeChat sample bundle from a host with actual local data—using the shipped `inspect:collect-source-samples -- --platform lobechat` helper when helpful—then use that bundle to answer four concrete questions before any non-trivial parser or support-tier work starts:

1. Is `~/.config/lobehub-storage` the truthful default root on the reviewed host, or only one companion/config location?
2. Which JSON files are transcript-bearing exports versus account/config/index files?
3. Does the generic export parser already match the real message shape closely enough, or is LobeChat-specific extraction needed?
4. Which edge cases belong in sanitized fixtures and regression coverage once real data is available?
