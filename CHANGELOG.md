# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

No changes yet.

## [0.3.0] — 2026-07-02

Storage boundary V1→V2 cutover completes (read paths, bundle/export, search,
and V1 table drop), sync performance gets a streaming rewrite with bounded peak
RSS, and the operator-scale path is hardened against OOM. First release with
schema `2026-06-30.1`.

### Storage Boundary (V1 → V2)

- Schema bumped to `2026-06-30.1` — adds `source_file_ledger.content_max_timestamp` for incremental JSONL sources, plus the V2 full-content sidecar columns from B.5.0.
- B.1–B.4 migration framework landed: `cchistory migration preview | run | status | validate | reset | compact`, with `migration_state` markers for resumable backfill and `2x free disk` assertion before bundle export.
- B.5 read-path cutover: search scan (B.5.1), detail/list reads (B.5.2), bundle/export shape (B.5.5), and V2 lineage reconstruction (B.5.0f/g). V1 fallback dropped from `getTurnContext` (B.5.6).
- B.6 — V1 `user_turns` and `turn_contexts` tables can now be dropped via `cchistory migration compact --step drop-v1-tables`. Gated behind an explicit operator step; not auto-run on sync. Post-B.6 read paths, validator gates, and marker guards hardened.
- Evidence-blob integrity violations now surfaced via `process.emitWarning` instead of silent skips.
- `boundedString` / `boundedJson` correctness fixes when truncation lands mid-codepoint or on oversized single-string object values.

### Sync Performance

- Streaming sync hot path bounds peak RSS at one file's worth of derived structures, regardless of source size.
- Per-source auto-resume marker + recency-bucketed batching — sync resumes from the last captured record per origin path instead of re-scanning.
- Adaptive reuse preload avoids OOM on operator-scale stores by limiting prefetched tail blobs.
- Deferred prune: `evidence-blob` prune and global cache-ref aggregation move to end-of-sync, cutting per-batch overhead. Source-scoped `derived_cache_refs` skipped during per-batch merges.
- Streaming JSONL line iterator + `captureBlobStreaming` + `materializeBytesStream` for oversized JSONL captures (Codex, Claude Code, etc.) — file prefix read via `fs.open` instead of materializing the whole blob.
- `getTailBlobsByOriginPaths` returns a Map without materializing payload, cutting RSS on the non-batched path.
- Incremental sync speedup: external touches to a captured file no longer force a reparse (mtime dropped from `canReuseCapturedBlob`).

### Fixes

- Dedupe Claude Code multi-chunk assistant message token usage so totals aren't double-counted across display surfaces.
- `migration reset --phase` validated against the known phase set; mismatched phases rejected up front.
- Token usage unified across all option-B display surfaces (CLI, TUI, Web).

### Refactor

- Split `source-adapters/core/utils.ts` into 8 themed modules.
- Extracted `sync-timing` and `sync-progress` from `sync.ts`.
- Hoisted `selectTailBlob` into a shared `source-adapters` helper.

### Platforms

- Stable adapter set unchanged from 0.2.0.

### Release Metadata

- Bumped workspace package versions, OpenAPI metadata, and Web UI version label to `0.3.0`.
- Bumped GitHub Actions (checkout, pnpm/action-setup, setup-node) to v5.

## [0.2.0] — 2026-05-17

Release maintenance for the current self-host support baseline.

### Documentation

- Reorganized README and `docs/` entrypoints around reader tasks: operate,
  understand architecture, validate release/support claims, inspect source data,
  report issues, and track roadmap work.
- Added `docs/README.md` as the top-level documentation map and clarified which
  documents are semantic source-of-truth versus runtime inventory.
- Clarified that `self-host v1` is a support-scope gate while `0.2.0` is the
  package/API/Web release marker.

### Platforms

- Added **Accio Work** as a registered `experimental` adapter for local-runtime session evidence while its support boundary remains under validation.

### Release Metadata

- Bumped workspace package versions, OpenAPI metadata, and the Web UI version
  label to `0.2.0`.

## [0.1.0] — 2026-04-04

First tagged release — self-host v1 for single-user localhost / trusted-LAN deployment.

### Platforms

- **10 stable adapters**: Codex, Claude Code, Cursor, AMP, Factory Droid, Antigravity, Gemini CLI, OpenClaw, OpenCode, CodeBuddy
- **Experimental at release time**: LobeChat (registered, not yet real-world validated)

### Entry Points

- **CLI** (`cchistory`) — sync, search, stats, export/import, backup/restore, garbage collection, remote-agent workflows
- **TUI** — Ink-based local browser with project/session/turn panes, search drill-down, and source-health summary
- **API** — Fastify REST server (default `:8040`) with recall, project, admin, probe/replay, and remote-agent control-plane routes
- **Web** — Next.js 16 frontend (default `:8085`) with All Turns, Projects, Inbox, Search, Sources, Linking, Masks, and Drift views

### Architecture

- Monorepo: `domain` → `source-adapters` / `storage` → `api-client` → `presentation` → apps
- SQLite via Node.js built-in `node:sqlite` (`DatabaseSync`)
- Evidence-preserving pipeline: Blob → Record → Fragment → Atom → Candidate → UserTurn
- Project linking via repo fingerprints, workspace paths, and manual overrides

### Highlights

- Full-text search with project and source filters
- Token usage analytics across models, projects, sources, and time
- Portable export bundles with conflict-aware import (skip/replace)
- Standalone CLI artifact channel (`pnpm run cli:artifact`)
- Remote agent collection: pair, upload, schedule, pull
- 14 automated verification scripts covering install, recall, admin, bundle, and real-layout workflows
