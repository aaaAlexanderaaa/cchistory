# R13 Cursor Chat-Store Intake

## Status

- Objective: `R13 - Cursor Chat-Store Intake`
- Date: 2026-04-01
- Scope: experimental Cursor chat-store metadata/readable-fragment intake under the existing `cursor` platform

## Delivered Slice

The repository now supports a **truthful experimental intake slice** for
`.cursor/chats/**/store.db` while keeping ownership under the `cursor`
platform and without widening the current stable Cursor support claim.

Delivered behavior:

- discovers `store.db` files under `.cursor/chats/<workspace-hash>/<agent-id>/`
- decodes the safe session-level fields from hex-encoded `meta.value`
- recovers one minimal directly readable prompt fragment plus latest-root or fallback assistant evidence when the blob bytes are plainly readable
- emits canonical session/turn/context projections only for that narrow slice
- preserves all SQLite blobs as captured evidence even when most of the blob graph remains opaque
- emits an explicit `cursor_chat_store_blob_graph_opaque` loss audit so the intake does not pretend to be full transcript reconstruction

## Validation

Validated with:

- `pnpm --filter @cchistory/source-adapters test`

Targeted regression coverage now proves:

- the `cursor` adapter matches `.cursor/chats/**/store.db`
- probing `mock_data/.cursor/chats` yields healthy experimental intake output
- titles and model/session metadata come from decoded `meta.value`
- readable prompt fragments become minimal user turns without requiring full blob-graph reconstruction
- the intake records an explicit opaque-graph diagnostic instead of silently overclaiming completeness

## Boundary Rules Preserved

- The chat-store slice remains under `cursor`, but it is **not** treated as the
  same support surface as `workspaceStorage/state.vscdb` or
  `agent-transcripts/*.jsonl`.
- The slice does not claim workspace-path or full project reconstruction from
  chat-store data alone.
- Blob-graph ordering remains explicitly incomplete; the current intake uses a
  narrow readable-fragment heuristic rather than pretending to rebuild the full
  conversation structure.

## Phase 7 Evaluation

Environment note: `PIPELINE.md` recommends a fresh agent context for Phase 7.
This pass was recorded in the same implementation session because the current
repository run has only one active agent context.

### Boundary Evaluation

- Platform ownership stays with `cursor`, but the stable support claim remains
  limited to the previously validated Cursor surfaces.
- The new logic is cursor-specific and confined to chat-store decoding and
  related doc surfaces.

### Stability Assessment

- Invalid or unreadable SQLite inputs still fall through the existing probe
  error path and stay visible as captured blobs plus loss audits.
- The intake is deliberately narrow: if no directly readable fragment can be
  recovered, it does not invent a full session transcript.

### Scalability Evaluation

- The parser reads one small SQLite store at a time and extracts only the `meta`
  row plus blob rows needed for minimal recovery.
- It avoids recursive blob-graph traversal or whole-thread reconstruction that
  has not yet been validated.

### Compatibility Assessment

- No schema migration is introduced.
- Existing stable Cursor tests remain green while the new experimental slice is
  covered by its own targeted regression.

### Security Evaluation

- The slice introduces no network path or executable behavior.
- Blob bytes are treated as local evidence and decoded only into plain text or
  JSON fragments when directly readable.

### Maintainability Assessment

- Cursor chat-store logic lives in `packages/source-adapters/src/platforms/cursor/runtime.ts`
  and plugs into the existing source-adapter pipeline through one narrow branch.
- The explicit opaque-graph diagnostic makes the current limitation clear to
  future contributors instead of burying it in heuristics.

### Known Limitations Accepted

- The current slice is not full transcript reconstruction.
- It does not yet recover complete ordering, turn boundaries, workspace paths,
  or tool-call structure from the blob graph.
- Promotion beyond `experimental` still requires stronger real-world decoding
  proof than this slice provides.

## Result

Phase 7 evaluation passes for the current repository-visible `R13` scope.
Cursor chat-store data now has a truthful experimental intake path with decoded
metadata, minimal readable-fragment recovery, and explicit opaque-graph
signaling.
