# R38 Pillar Derivation And Session-Relation Audit

Status: completed audit for R38-KR4
Date: 2026-05-16

## Scope

This audit covers the code paths that sit below the R38 CLI/TUI product-UX
work. It exists because default-view polish is not enough evidence that the
project's primary semantics are healthy. The critical questions are:

- which tests exercise real source-shaped parsing versus prebuilt projection
  fixtures;
- how raw evidence becomes `UserTurn`, `TurnContext`, and token summaries;
- how delegated/subagent sessions and automation runs are represented and
  navigated;
- whether any current implementation goes beyond the frozen design boundary.

No frozen semantic change is proposed here. The design invariants still hold:
project-first recall, `UserTurn` as the primary recall object,
evidence-preserving ingestion, and one canonical model projected to UI/API/CLI.

## Runtime-Critical Paths Versus Test Helpers

### Runtime-critical

- CLI `sync`, TUI full mode, API probe/replay, and remote-agent upload paths
  enter through `runSourceProbe` and `replaceSourcePayload`.
- `packages/source-adapters/src/core/probe.ts` is the main capture pipeline:
  source files are captured, extracted into records, parsed into fragments,
  atomized, grouped into candidates, and finalized into sessions, turns, and
  contexts.
- `packages/source-adapters/src/core/projections.ts` owns the central
  derivation behavior for submission groups, `UserTurn`, `TurnContext`,
  assistant replies, tool calls, and token summaries.
- `packages/storage/src/internal/storage.ts` persists payloads, refreshes
  project-link projections, search state, and session related-work projections.
- `packages/storage/src/tui-browser.ts` is a product-facing read projection for
  TUI browse/search/stat surfaces.

### Projection fixture paths

Many storage, CLI, and TUI tests directly construct `SourceSyncPayload` and call
`replaceSourcePayload`. Examples:

- `packages/storage/src/test/helpers.ts:createFixturePayload`;
- `apps/tui/src/layout.test.ts:createFixturePayload`;
- `apps/tui/src/state.test.ts:createFixturePayload`;
- several CLI tests that seed stores through helper payloads.

These tests are valuable for read-side behavior, project linking, search,
layout, and output regressions. They do not prove adapter parsing, raw event
ordering, source-specific token fields, or noisy upstream transcript handling.
They should be read as projection tests, not parser truth tests.

### Source-shaped and built-entrypoint paths

Stronger tests and verifiers use source-shaped data or built commands:

- `packages/source-adapters/src/core/tokens.test.ts` uses `runSourceProbe` for
  token projection fixtures across Codex, Claude Code, Factory Droid, and AMP.
- platform tests under `packages/source-adapters/src/platforms/*.test.ts`
  exercise adapter-specific raw shapes.
- `tests/e2e/*.test.mjs` and scripts such as
  `verify:fixture-sync-recall`, `verify:real-layout-sync-recall`,
  `verify:related-work-recall`, and `verify:cli-tui-read-side` verify larger
  CLI/API/TUI paths from synced stores.
- `mock_data/` provides broad shape coverage, but the fixture manifest states
  that repository fixtures are structural and redacted. They are not a
  large-scale corpus.

## Raw Evidence To UserTurn And Token Summary

The core derivation chain is:

1. `runSourceProbe` captures files and companion evidence.
2. Records are parsed into `SourceFragment` values.
3. `atomizeFragments` turns text/tool/meta fragments into `ConversationAtom`
   values.
4. `buildSubmissionGroups` selects user-shaped atom groups.
5. `buildTurnsAndContext` creates `UserTurn` objects and matching
   `TurnContext` projections.
6. `buildTurnContext` attaches assistant replies, tool calls, model signals,
   stop reasons, and token usage.

Important behavior observed in code:

- `isUserTurnAtom` treats `user_authored` and `injected_user_shaped` text atoms
  as group candidates. The final turn is skipped only when there is no authored
  user input and no renderable context.
- `buildSubmissionGroups` starts a new group after assistant text has appeared,
  with an Antigravity-specific fresh-group rule for authored user atoms.
- Context for a turn is based on atom order between the user group and the next
  group. This makes source ordering and timestamp/sequence fidelity important.
- Token summaries are assistant-reply driven. Direct assistant payload usage is
  used first; later `token_usage_signal` atoms are applied to the most recent
  preceding visible assistant reply.
- If token signals include `delta_token_usage`, deltas are summed. Otherwise,
  the last token signal for that reply wins.
- Turn-level token usage is the sum of assistant reply usage values.

Coverage is meaningful but not exhaustive. Existing token tests cover multiple
platforms, model switches, multi-turn checkpoints, multi-reply turns, and
cumulative deltas. The main remaining risks are:

- field normalization is heuristic across platforms whose upstream token fields
  do not always mean the same thing;
- delayed or out-of-order token usage signals may attach to the wrong assistant
  reply;
- source records with nested or interleaved assistant/tool events may expose
  ordering assumptions not represented by current small fixtures;
- very large prompts, tool payloads, and multi-agent transcripts are mostly
  covered through truncation/layout tests, not ingestion-scale tests;
- synthetic user-shaped records must stay correctly classified or they can
  become false recall anchors.

## Delegated, Subagent, And Automation Session Organization

Relevant design decisions already exist:

- `R20_AUTOMATION_CRON_SUBAGENT_SEMANTICS.md` says delegated and cron-triggered
  inputs are not canonical `UserTurn` anchors by default, parent linkage must be
  explicit and partial, and missing lineage must not be guessed.
- `R23_CANONICAL_DELEGATION_GRAPH.md` says `UserTurn` remains primary,
  transcript-primary delegated work should be child sessions, evidence-only
  automation should be companion evidence, and a typed secondary relation layer
  should expose related work.

Current implementation partially follows that direction:

- `OriginKind` includes `delegated_instruction` and `automation_trigger`.
- `FragmentKind` includes `session_relation`.
- Claude Code, Factory Droid, OpenCode/generic, OpenClaw, and Accio paths can
  emit relation evidence when upstream fields exist.
- `SessionRelatedWorkProjection` distinguishes `delegated_session` from
  `automation_run`, `target_kind`, `transcript_primary`, evidence confidence,
  parent/tool references, child agent key, job/run references, and raw details.
- CLI, TUI, API client, presentation, and API route surfaces expose some
  related-work visibility.

R39 closure note: the original audit found a graph-orientation and queryability
gap. That gap is now closed by deriving query-relative relation edges from
existing `session_relation` fragments, without adding persisted normalized edge
tables:

- `getSessionRelatedWork(sessionId)` now uses a relation index derived from all
  typed `session_relation` fragments, then returns entries for the queried
  session only.
- Delegated child sessions can be queried in both directions: parent sessions
  receive `outbound` child entries, and child sessions receive `inbound` parent
  entries.
- Relation entries expose explicit parent, child, evidence, automation owner,
  and query-relative direction fields while preserving raw upstream identifiers
  in `raw_detail` and fragment refs.
- The implementation deliberately remains query-over-existing-fragments rather
  than a persisted graph table until profiling or broader cross-surface needs
  justify persistence.

The best current organization target is:

- keep `UserTurn` as the recall/search object;
- keep child work in its own `Session` when the source has transcript-primary
  child sessions;
- never merge child-session turns into the parent session's `UserTurn` stream;
- store or derive relation edges with explicit orientation:
  parent session -> child session for delegated work, and session/project/source
  -> automation run for evidence-only automation;
- support reverse lookup from child -> parent for traceability;
- show compact related-work counts in default recall surfaces, and put raw
  relation identifiers behind explicit expansion or admin/detail views.

## Fixture And Scale Realism

`mock_data/` is broad enough to protect many shape contracts. It includes
examples for stable and experimental adapters, malformed records, companion
metadata, subagent sidecars, cron automation evidence, Cursor/Antigravity
database-shaped inputs, and source-specific unknown content.

It is not enough to claim scale realism by itself:

- the corpus is intentionally redacted and structural;
- most source-shaped fixtures are small;
- there is no repeated 10k-turn project fixture;
- nested delegation, multiple child sessions per parent, delayed token signals,
  and huge tool outputs are not covered as first-class scale fixtures;
- UI/TUI layout tests cover long strings and narrow widths, but not a terminal
  screenshot or visual-diff matrix.

## Design Freeze Alignment

The current direction remains aligned with `HIGH_LEVEL_DESIGN_FREEZE.md`:

- `Ask` is only a user-facing label for the canonical `UserTurn`, not a new
  model object.
- Child sessions and automation runs should remain secondary related work, not
  alternate primary recall units.
- UI/CLI/TUI changes are projection changes and should not alter raw evidence,
  canonical IDs, or JSON contracts.

The main pressure point is no longer graph orientation itself. The remaining
future risk is breadth: R39 verifies bidirectional relation projection with
storage fixtures and generated Claude-shaped fanout, but every source family's
native delegation graph should still be reviewed as real samples expand.

## Follow-Up Test And Implementation Gaps

R39 closed the fix-now follow-ups from this audit:

1. Source-shaped related-work verification now covers one parent session with
   multiple transcript child sessions, parent-to-child navigation,
   child-to-parent traceability, CLI/TUI/API visibility, and no parent
   `UserTurn` pollution.
2. Token fixtures now cover delayed/interleaved token signals, cache field
   variants, and large multi-reply turns.
3. `scripts/verify-scale-recall.mjs` generates a temporary thousands-of-turn
   recall store without entering the default lightweight test path.
4. `BACKLOG.md` now contains a coverage inventory that labels parser/source-
   shaped, projection-fixture, built-entrypoint, verifier-only, visual/manual,
   and user-started-service coverage.
5. Storage now derives query-relative parent-to-child and child-to-parent
   related-work projections from the same typed relation semantics without
   persisting normalized edge tables.

## R38 Completion Impact

R38 should not be marked complete solely because the default CLI/TUI views are
cleaner. Completion requires:

- KR3 default-view regressions covered by tests;
- this KR4 audit recorded;
- follow-up graph and derivation gaps left as explicit backlog work rather than
  hidden uncertainty.
