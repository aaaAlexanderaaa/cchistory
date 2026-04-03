# R13 Cursor Chat-Store Decoding Scope

## Status

- Objective: `R13 - Cursor Chat-Store Intake`
- Task closed by this note: `define the minimal Cursor chat-store decode target before parser work`
- Date: 2026-04-01

## Why This Note Exists

The real 2026-03-31 archive proves `.cursor/chats/<workspace-hash>/<agent-id>/store.db`
is a Cursor-owned local history surface, but the persisted structure is not the
same as Cursor `workspaceStorage/state.vscdb` and not the same as JSONL
transcript sources already supported elsewhere.

Before adding parser regressions, the project needs an explicit line between:

- what can already be surfaced truthfully from `meta` + `blobs`, and
- what must remain out of scope until blob-graph decoding is proven.

## Confirmed Safe Inputs

From the reviewed real samples and the sanitized fixtures, these fields are
safe to recover without overclaiming transcript semantics.

### `meta.value` (hex-encoded JSON)

Safe phase-1 fields:

- `agentId`
- `latestRootBlobId`
- `name`
- `mode`
- `createdAt`
- `lastUsedModel`

These are session-level or store-level cues. They can support source/session
inventory, labels, timestamps, and debugging views.

### `blobs.data` searchable text fragments

Safe phase-1 recoverables:

- visible prompt-like text fragments when they are directly embedded in blob
  bytes,
- reasoning-like text fragments when clearly present as readable text,
- assistant-output-like text fragments when clearly present as readable text,
- JSON-shaped fragments embedded inside blobs when the fragment itself is
  readable without inventing hidden structure.

These fragments are evidence, not yet canonical turns.

## Confirmed Non-Goals For Phase 1

The following are **not** safe to derive yet from the current evidence set.

- full conversation ordering from blob references alone,
- parent/child turn structure from blob ids,
- canonical `UserTurn` boundaries,
- complete tool-call or assistant-reply reconstruction,
- workspace path or project identity from chat-store data alone,
- stable guarantees that `latestRootBlobId` is sufficient to rebuild the whole
  thread graph.

## Minimal Truthful Decode Target

Before deeper parser work, the first truthful Cursor chat-store ingestion slice
should stop at:

1. store discovery under `.cursor/chats/<workspace-hash>/<agent-id>/store.db`,
2. session-level metadata from decoded `meta.value`,
3. searchable evidence blobs or extracted readable blob fragments,
4. explicit loss-audit / unsupported-decoder signaling for the parts that
   remain opaque.

If the project wants a phase-1 parser before full blob-graph reconstruction,
it should behave like an evidence-preserving experimental intake path, not like
full transcript recovery.

## Implication For Parser Regressions

The first parser regressions under `R13` should prove only what this note marks
as safe:

- metadata decode from `meta.value`,
- evidence preservation for readable blob fragments,
- no false claim of complete turn/session reconstruction,
- explicit out-of-scope behavior when blob relationships remain opaque.

Any regression that synthesizes canonical `UserTurn` objects from the current
fixture corpus needs a stronger decoding rule than this note presently allows.

## Recommended Next Slice

The next executable parser step should target one narrow question:

- can the current blob corpus support **metadata-plus-readable-fragment**
  ingestion without synthesizing bogus turns?

If yes, add experimental regressions for that limited behavior first.
If no, keep the chat-store path at fixture/design status until decoding proof is
stronger.
