# R6 - Generic Parser Abstraction

## Status

- Objective source: `docs/ROADMAP.md`
- Backlog status after this note: `done`
- Phase reached: KR1-KR3 implemented on 2026-03-27, with Phase 7 evaluation passing the same day
- Scope: reduce per-adapter parser duplication by converging common source file
  shapes into a small set of reusable extraction and normalization paths

## Phase 1 - Domain Understanding

### Problem statement

At the original 2026-03-27 decomposition point, the roadmap called for generic parser abstraction across four recurring source
shapes:

- message arrays / session-tree JSON
- JSONL line records
- VS Code state databases
- export-bundle style conversation payloads

The repository already contained partial abstraction in these areas, but the
implementation surface was still split between reusable helpers and a large
`packages/source-adapters/src/core/legacy.ts` orchestration file.

### What was already implemented at that review point

At that decomposition point, the source-adapter system already had the beginnings of parser-family
abstraction:

- `packages/source-adapters/src/platforms/generic/runtime.ts` parses generic
  conversation records once role/content items have been normalized.
- `packages/source-adapters/src/core/vscode-state.ts` abstracts the SQLite
  key/value scanning path shared by Cursor and Antigravity.
- `packages/source-adapters/src/platforms/cursor/runtime.ts` already factors out
  Cursor-specific composer/prompt-history normalization from `legacy.ts`.
- `collectConversationSeedsFromValue` and related helpers already act like a
  generic seed builder for AMP, OpenCode, Gemini CLI, LobeChat, Cursor
  fallbacks, and some VS Code state rows.

### Duplication and gaps found at decomposition time

#### 1. Conversation-seed family was reusable in behavior but not yet in placement

At that point, the message-array / session-tree abstraction existed, but until this objective it
lived inside `core/legacy.ts` even though it was consumed conceptually by:

- AMP whole-thread JSON
- OpenCode session/message trees
- Gemini CLI local chat JSON
- LobeChat export JSON
- Cursor fallback conversation extraction
- VS Code state chat payload scanning

This makes the behavior reusable in practice but hard to evolve safely as a
first-class parser family.

#### 2. JSONL collection and sidecar injection remained monolithic

Codex, Claude Code, Factory Droid, and OpenClaw still relied on file-shape logic
that was coordinated in `legacy.ts` through ad hoc branches. Factory Droid’s
sidecar settings merge was especially useful, but it was still expressed as a
source-specific conditional rather than a reusable JSONL+sidecar pattern.

#### 3. VS Code state abstraction still depended on a broad helper contract

`core/vscode-state.ts` was already shared, but its helper contract was broad and
still reached into seed-building logic that historically lived in `legacy.ts`.
The boundary is serviceable, but not yet minimal or clearly documented as one of
only a few canonical parser families.

#### 4. Source-format profiles described families, but migration was incomplete

`SourceFormatProfile` already hinted at parser families (`jsonl`, `thread-json`,
`vscode-state-sqlite`, export JSON), but the codebase did not yet treat those
families as explicit reusable modules with clear ownership and migration order.

### Why this matters to frozen semantics

This objective does not change product semantics. It exists to preserve them
more reliably:

- parser quirks should stop at the source-adapter boundary
- canonical objects should still be rebuilt from raw evidence
- `UserTurn` remains the primary derived object
- project identity remains evidence-based, not parser-family-based

Generic parser abstraction is about reducing duplicated file-shape logic without
flattening source-specific semantics into one lossy lowest-common-denominator
parser.

### Assumptions

- The right abstraction layer is parser-family reuse, not one universal parser
  for every source.
- File-shape reuse should happen before canonical conversation derivation,
  because different sources still need different evidence and precedence rules.
- The first slice should extract the already-shared conversation-seed family,
  because it is used by the widest cross-section of current adapters.
- Each abstraction slice must preserve current behavior through package-local
  regression coverage.

## Phase 2 - Test Data Preparation

### Required evidence scenarios

The abstraction work must continue to validate at least these families:

1. message-array/session-tree JSON with user + assistant content
2. JSONL line records with source-specific event types and optional sidecars
3. VS Code state DB key/value rows that produce one or more session seeds
4. export-like JSON bundles with nested message maps or arrays
5. malformed or partially missing records that must still preserve loss audits

### Current fixture position

The repository already has fixture coverage for all currently supported parser
families, but the tests are organized by source rather than by reusable parser
family. The first slice can therefore be validated by reusing existing source
adapter tests instead of inventing a brand-new fixture family.

## Phase 3 - Functional Design

Environment note: this objective benefits from the multi-perspective design
protocol. In this environment there is no sub-agent launcher, so the protocol is
recorded as separated lenses plus a synthesis.

### Agent A - System Consistency

**Recommendation**: define parser-family modules around existing behavior, then
migrate sources to them incrementally.

**Reasoning**:

- The generic runtime path, VS Code state path, and conversation-seed path
  already exist conceptually.
- Extracting them into explicit modules is lower risk than redesigning all
  adapters around a new abstraction at once.
- This keeps source-specific semantics at the edge while making file-shape reuse
  legible.

### Agent B - Operator Safety

**Recommendation**: keep support claims unchanged while abstraction lands.

**Reasoning**:

- Parser abstraction is an internal engineering objective, not a user-facing
  support-tier upgrade by itself.
- Stable vs experimental claims must remain grounded in the same real-world
  evidence and regression coverage.
- Refactors should therefore reuse existing source fixtures and support-surface
  verification rather than changing promises prematurely.

### Agent C - Engineering Cost

**Recommendation**: ship in three KRs.

**Reasoning**:

- KR1: extract the conversation-seed family already shared by message-array and
  export-like sources
- KR2: factor JSONL line-record + sidecar collection into a narrower reusable
  path
- KR3: narrow the VS Code state helper contract and document the resulting
  parser-family inventory

This sequence starts with the highest-leverage low-risk extraction before moving
into the more source-sensitive JSONL and state-db families.

### Synthesis

The recommended path is:

1. formalize the conversation-seed family as a dedicated reusable module
2. extract JSONL line-record and sidecar collection as a second reusable family
3. narrow the VS Code state family contract and document the family inventory
4. keep all support claims and frozen semantics unchanged unless validation says
   otherwise

### Decided KRs

#### KR: R6-KR1 Conversation-seed family extraction

Acceptance: the message-array/export/session-tree seed builder is implemented as
an explicit reusable module consumed from multiple adapter paths without source
behavior drift.

#### KR: R6-KR2 JSONL line-record and sidecar family

Acceptance: JSONL-based local sources reuse a narrower line-record collector and
optional sidecar merge path instead of relying on ad hoc per-source branches in
`legacy.ts`.

#### KR: R6-KR3 VS Code state family and parser inventory

Acceptance: the VS Code state extractor depends on a smaller helper contract,
and the repository documents the parser-family inventory and migration rules.

### Impacted areas

- `BACKLOG.md`
- `docs/design/` for the decomposition and future migration record
- `packages/source-adapters/src/core/legacy.ts`
- `packages/source-adapters/src/core/vscode-state.ts`
- `packages/source-adapters/src/platforms/generic/*`
- `packages/source-adapters/src/platforms/cursor/runtime.ts`
- `packages/source-adapters/src/index.test.ts`

### First executable slice at decomposition time

The initial plan was to implement `R6-KR1` first by extracting the conversation-seed helpers then
buried in `core/legacy.ts` into a dedicated module, then revalidate the existing
source-adapter suite.

## KR1 Execution Log

### Completed on 2026-03-27

#### Implementation summary

- Added `packages/source-adapters/src/core/conversation-seeds.ts` as the owned
  home for `ExtractedSessionSeed`, `ConversationSeedOptions`,
  `collectConversationSeedsFromValue`, and `normalizeMessageCandidate`.
- Reduced `packages/source-adapters/src/core/legacy.ts` to thin wrappers around
  the extracted conversation-seed runtime so existing source-specific call sites
  keep their behavior while the parser family becomes explicit.
- Moved direct type dependencies in `packages/source-adapters/src/core/vscode-state.ts`,
  `packages/source-adapters/src/platforms/cursor/runtime.ts`,
  `packages/source-adapters/src/platforms/antigravity/runtime.ts`, and
  `packages/source-adapters/src/platforms/antigravity/live.ts` to the new
  module so the reusable seed family no longer hangs off `legacy.ts`.

#### Validation

- `pnpm --filter @cchistory/source-adapters test`
  - Result: 50 tests passed on 2026-03-27 with no parser-behavior drift found
    in existing source fixtures.

#### Notes

- Support-tier and runtime-surface claims remain unchanged; this KR is an
  internal parser-family extraction only.
- The subsequent delivered slice was `R6-KR2`: extract JSONL line-record collection and sidecar
  merge hooks from `core/legacy.ts` into a narrower reusable family.

## KR2 Execution Log

### Completed on 2026-03-27

#### Implementation summary

- Added `packages/source-adapters/src/core/jsonl-records.ts` as the reusable
  JSONL collector for non-empty line records plus optional sidecar attachment
  loading.
- Moved the shared JSONL line-splitting logic and Factory Droid sidecar merge
  path out of `packages/source-adapters/src/core/legacy.ts` into the new module.
- Updated `packages/source-adapters/src/core/legacy.ts` to delegate JSONL raw
  record extraction for Codex, Claude Code, Factory Droid, OpenClaw, and other
  line-record sources through `collectJsonlRecords`, while also reusing the new
  first-line helper for Codex session ID derivation.

#### Validation

- `pnpm --filter @cchistory/source-adapters test`
  - Result: 50 tests passed on 2026-03-27 after the JSONL extraction, with no
    regression in Codex, Claude Code, Factory Droid, OpenClaw, or broader
    source-adapter fixture coverage.

#### Notes

- This slice narrows record collection only; source-specific parse semantics
  remain in the platform runtime parsers.
- The subsequent delivered slice was `R6-KR3`: narrow the VS Code state helper contract and add
  the parser-family inventory/migration rules to this document.

## KR3 Execution Log

### Completed on 2026-03-27

#### Implementation summary

- Updated `packages/source-adapters/src/core/vscode-state.ts` to import Cursor
  and Antigravity runtime helpers directly instead of receiving those platform
  callbacks through `core/legacy.ts`.
- Reduced the `VscodeStateHelpers` contract to parsing primitives plus the
  shared conversation-seed bridge, and localized seed merge helpers inside the
  VS Code state module.
- Kept Cursor prompt-history fallback, composer extraction, Antigravity
  trajectory extraction, and history-row recovery behavior unchanged while
  reducing the helper surface that `legacy.ts` must provide.

## Parser Family Inventory

### Family 1: Conversation-seed JSON

**Owned by:** `packages/source-adapters/src/core/conversation-seeds.ts`

**Use for:** message arrays, export-like conversation maps, session trees, and
other JSON payloads that can be normalized into ordered message records before
fragment parsing.

**Current consumers:** AMP-like nested message payloads, Gemini CLI chat JSON,
OpenCode export/session trees, LobeChat exports, Cursor/Antigravity chat-state
fallbacks, and other export-style conversation blobs.

### Family 2: JSONL line records with optional sidecars

**Owned by:** `packages/source-adapters/src/core/jsonl-records.ts`

**Use for:** append-only local session logs where each non-empty line is an
independent raw record, optionally accompanied by lightweight metadata sidecars.

**Current consumers:** Codex, Claude Code, Factory Droid, OpenClaw, and any
other source that reuses the shared raw-record line collector from `legacy.ts`.

### Family 3: VS Code state databases

**Owned by:** `packages/source-adapters/src/core/vscode-state.ts`

**Use for:** SQLite key/value stores where conversation evidence is spread
across composer rows, prompt-history rows, chat blobs, or platform-specific
history/trajectory keys.

**Current consumers:** Cursor and Antigravity `state.vscdb` sources.

### Family boundaries and migration rules

- Prefer an existing parser family before adding a new one; a new family is
  justified only when the raw storage shape and recovery rules are materially
  different.
- Keep source-specific quirks inside the family entrypoint or platform runtime;
  do not leak them into canonical `UserTurn` semantics.
- Use the conversation-seed family when the raw payload already resembles a
  recoverable conversation tree or export bundle.
- Use the JSONL family when capture is fundamentally line-oriented and record
  order is the primary truth source; sidecars may enrich session metadata but
  must not rewrite preserved raw evidence.
- Use the VS Code state family when evidence lives in SQLite key/value rows and
  recovery requires row selection plus platform-aware seed extraction.
- Family reuse stops before canonical fragment semantics: platform runtime
  parsers still own record-type interpretation, evidence precedence, and
  loss-audit behavior.

## Phase 7 - Holistic Evaluation

### Evaluation summary

`R6` now has explicit reusable parser-family modules for conversation-seed JSON,
JSONL line records, and VS Code state databases. The remaining source-specific
runtime parsers continue to own semantic interpretation at the raw-record to
fragment boundary, which preserves the frozen invariants around
project-first/evidence-preserving derivation.

### Validation

- `pnpm --filter @cchistory/source-adapters test`
  - Result: 50 tests passed on 2026-03-27 after KR1, KR2, and KR3 landed.

### Outcome

Phase 7 evaluation passed on 2026-03-27. `R6 - Generic Parser Abstraction` is
ready to be marked `done` in `BACKLOG.md`.
