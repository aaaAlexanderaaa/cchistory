# CCHistory — Full Project Review

**Date**: 2026-04-05  
**Version**: 0.1.0 (self-host v1)  
**Reviewer**: Coder agent  

---

## Executive Summary

CCHistory is a well-architected TypeScript monorepo that ingests, normalizes, and projects conversation history from 11 AI coding assistant platforms into a unified, evidence-preserving model. The codebase is **production-quality for a v1 self-hosted product**: clean domain boundaries, comprehensive test coverage (~230 tests across 8 packages), robust data integrity patterns, and thoughtful operator experience.

**Overall assessment: Strong.** The architecture is disciplined, the domain model is well-frozen, and the evidence-preserving pipeline is implemented faithfully. The main areas for improvement are scaling concerns in the storage layer and some web UI patterns that could mature.

---

## Architecture & Design — ★★★★★

### Strengths

- **Clean layered architecture**: `domain` → `source-adapters` / `storage` → `api-client` → `presentation` → `apps/*`. Each package has a clear responsibility boundary.
- **Frozen design invariants** ([HIGH_LEVEL_DESIGN_FREEZE.md](HIGH_LEVEL_DESIGN_FREEZE.md)): The design freeze document is exceptionally thorough — 800+ lines covering project essence, kernel pattern, lifecycle axes, and system invariants. This prevents scope creep and semantic drift.
- **Evidence-preserving pipeline**: The `Blob → Record → Fragment → Atom → Candidate → UserTurn` pipeline ensures raw evidence is retained and every derived object is traceable.
- **Project-first, UserTurn-centric model**: The core insight that the user's *intent* (what they asked, in which project) is the primary asset — not the session or assistant reply — is well-executed throughout.
- **11 platform adapters** converging to one canonical model: Platform-specific quirks stop at the parse boundary.

### Minor Concerns

- The `apps/web` package has its own `pnpm-lock.yaml`, requiring a two-step install. While documented, this is a friction point for contributors.
- The `node:sqlite` experimental API dependency ties the project to Node.js ≥22. This is reasonable for a v1 self-hosted tool but limits deployment options.

---

## Domain Model (`packages/domain`) — ★★★★★

The domain package is a pure type-and-utility layer with zero runtime dependencies beyond `node:crypto`. Key strengths:

- **Comprehensive type system**: `SourcePlatform`, `LinkState`, `SyncAxis`, `ValueAxis`, `RetentionAxis` — all union types with clear semantic meaning.
- **Canonical ordering policies**: Pre-defined ordering terms for every view (`global_turn_recall`, `project_feed`, `linking_inbox`, etc.) ensure consistent sorting across all surfaces.
- **Stable ID generation** via SHA-1 content-addressable hashing ([`stableId()`](packages/domain/src/index.ts:1113)).
- **Platform-agnostic path utilities**: `posixNormalize`, `posixBasename`, and `decodeUriPath` avoid pulling in `node:path`.
- **Source instance identity** via FNV-1a hashing of `host_id + base_dir`, ensuring deterministic IDs across re-syncs.

The ~1100-line single file is getting large but remains well-organized with clear section markers.

---

## Source Adapters (`packages/source-adapters`) — ★★★★☆

### Strengths

- **Registry pattern**: Clean adapter registry with `satisfies readonly PlatformAdapter[]` for compile-time safety ([registry.ts:28](packages/source-adapters/src/platforms/registry.ts:28)).
- **Support tier system**: `stable` vs `experimental` classification with `listStablePlatformAdapters()` helper.
- **Loss auditing**: Instead of silently dropping malformed data, adapters generate `LossAuditRecord` entries — making data quality visible to operators.
- **VSCode state safety**: Opens SQLite databases in read-only mode to avoid corrupting host application data.
- **Unified atomization**: The atomizer ensures all platforms converge to `ConversationAtom` regardless of source format.

### Concerns

| Severity | Issue | Location |
|----------|-------|----------|
| Medium | File-level reads into strings — multi-GB JSONL files could cause memory pressure | `parser.ts` record extraction |
| Low | `SourcePlatform` type includes `chatgpt`, `claude_web`, `other` with no corresponding adapters — could confuse contributors | [domain/src/index.ts:13-18](packages/domain/src/index.ts:13) |
| Low | Antigravity adapter has two complementary paths (live API + offline files) with complex fallback logic — high maintenance surface | [antigravity.ts](packages/source-adapters/src/platforms/antigravity.ts), [antigravity/live.ts](packages/source-adapters/src/platforms/antigravity/live.ts) |

---

## Storage (`packages/storage`) — ★★★★☆

### Strengths

- **Transactional ingestion**: `BEGIN IMMEDIATE` + `COMMIT/ROLLBACK` for atomic source payload replacement.
- **Tombstone-based deletion**: Preserves audit trail for deleted entities via the `tombstones` table.
- **WAL mode + busy timeout**: Appropriate SQLite configuration for concurrent reads.
- **Hybrid caching**: In-memory maps for projects, turns, and sessions with `refreshDerivedState()`.
- **FTS5 with graceful fallback**: If FTS5 is unavailable (common in Node.js built-in SQLite), falls back to substring search automatically.
- **Schema migration tracking**: `schema_migrations` table with idempotent migration recording.

### Concerns

| Severity | Issue | Location |
|----------|-------|----------|
| **Medium** | `replaceSearchIndex()` reads the entire search index into a Map for diffing — won't scale to very large datasets | [search.ts](packages/storage/src/queries/search.ts) |
| **Medium** | `performDeleteProject()` loads all related turns/sessions into memory | [queries.ts](packages/storage/src/internal/queries.ts) |
| Medium | `DatabaseSync` is synchronous — long-running reads can block ingestion on the same process | [storage.ts](packages/storage/src/internal/storage.ts) |
| Low | `atom_edges` endpoint backfill migration runs every schema init (scans all rows) — safe but wasteful after first run | [schema.ts:314](packages/storage/src/db/schema.ts:314) |

---

## API Server (`apps/api`) — ★★★★☆

### Strengths

- **Fastify with schema validation**: Routes use JSON Schema for request/response validation.
- **Security**: Timing-safe token comparison (`timingSafeEqual`), SHA-256 agent token hashing, lease-based upload authorization.
- **Modular route registration**: Clean separation into `data.ts`, `sources.ts`, `agents.ts`.
- **Appropriate HTTP semantics**: 401 for auth failures, 404 for missing resources, 409 for stale uploads, 410 for tombstoned entities.
- **32 MB body limit**: Handles large export bundles.
- **Configurable CORS**: Via `CCHISTORY_CORS_ORIGIN` environment variable.

### Concerns

| Severity | Issue | Location |
|----------|-------|----------|
| **Medium** | `listResolvedTurns()` loads all turns into memory before pagination slicing | [data.ts](apps/api/src/routes/data.ts) |
| Medium | Default CORS origins include localhost — needs strict management for remote agent scenarios | [app.ts:80](apps/api/src/app.ts:80) |
| Low | Manifest checksum uses `JSON.stringify(..., 2)` — fragile if client serializer differs | [upload-ops.ts](apps/api/src/remote-agent/upload-ops.ts) |
| Low | Agent IDs use 8 bytes of random hex — sufficient for single-user, but collision-prone at scale | [agent-ops.ts](apps/api/src/remote-agent/agent-ops.ts) |

---

## Web Frontend (`apps/web`) — ★★★★☆

### Strengths

- **SWR for data fetching**: Consistent caching and real-time updates.
- **Virtual list rendering**: `@tanstack/react-virtual` for efficient turn lists.
- **Dynamic imports**: Heavy views are lazily loaded to reduce initial bundle size.
- **Error boundaries**: Both route-level and global error boundaries with consistent styling.
- **API proxy route**: Properly handles body size limits and path allow-listing.
- **Keyboard navigation**: Global `/` shortcut for search, `Escape` to close panels.

### Concerns

| Severity | Issue | Location |
|----------|-------|----------|
| Medium | Uses local `useState` for view routing instead of Next.js URL routing — breaks deep linking and browser back/forward | [page.tsx](apps/web/app/page.tsx) |
| Medium | `SessionMap` component is ~1100 lines with complex SVG rendering — should be decomposed | [session-map.tsx](apps/web/components/session-map.tsx) |
| Low | SWR `revalidateOnFocus: false` globally — may show stale data after background syncs | [api.ts](apps/web/lib/api.ts) |
| Low | Inline Markdown parser in `TurnDetailPanel` should be extracted to a utility | [turn-detail-panel.tsx](apps/web/components/turn-detail-panel.tsx) |
| Low | Missing `useCallback` wrappers on callbacks passed down from `page.tsx` | [page.tsx](apps/web/app/page.tsx) |

---

## CLI (`apps/cli`) — ★★★★★

### Strengths

- **Comprehensive command surface**: sync, discover, health, ls, tree, show, search, stats, export, backup, import, merge, gc, query, templates, agent.
- **Two-tier entry point**: `index.ts` → `main.ts` lazy import for clean warning filter installation.
- **Smart session resolution**: Tiered matching (ID → Prefix → Title → Workspace) for flexible `show` commands.
- **`--full` mode**: In-memory scan without requiring a persistent store — excellent for ad-hoc inspection.
- **JSON output mode**: Every command supports `--json` for programmatic consumption.
- **Robust error messages**: Context-aware hints when store is missing.

### Minor Concerns

- Custom arg parser lacks short-flag support (e.g., `-s` for `--store`) — a minor DX gap.
- Some duplicated utility code between CLI renderers and TUI browser (markup cleaning).

---

## TUI (`apps/tui`) — ★★★★☆

- **Snapshot mode**: Prints a non-interactive summary in non-TTY environments — useful for CI.
- **Clean reducer pattern**: `reduceBrowserState` for deterministic state transitions.
- **Source health summary**: Dedicated pane for sync status visibility.
- Some markup-cleaning utilities are duplicated from the CLI.

---

## Test Infrastructure — ★★★★★

### Strengths

- **~230 tests across 8 packages** using Node.js built-in test runner.
- **Integration-style API tests**: `app.inject()` for full HTTP lifecycle testing without network sockets.
- **Edge case coverage**: FTS5 special characters, Unicode/Emoji, Windows path normalization, idempotent ingestion.
- **14 automated verification scripts**: Clean install, CLI artifact, web build offline, seeded acceptance, bundle conflict recovery, real-layout sync, and more.
- **Fixture corpus validation**: `mock_data:validate` ensures fixture integrity after edits.

### Minor Gaps

- CLI tests focus on happy paths — limited coverage for import conflict scenarios and network failures in agent workflows.
- No explicit load/performance tests for the scaling concerns noted in storage.

---

## Documentation — ★★★★★

- **README.md**: Comprehensive with architecture diagram, platform table, quick start, screenshots.
- **AGENTS.md**: Thorough repository guidelines including memory constraints, data safety, and dev service policies.
- **Design docs**: 15+ design documents in `docs/design/` covering everything from automation semantics to operator experience.
- **User guides**: CLI, API, Web, TUI, inspection, and bug reporting guides in `docs/guide/`.
- **Source notes**: Technical notes for each validated platform layout.
- **Changelog**: Clean conventional changelog for v0.1.0.

---

## Security — ★★★★☆

| Aspect | Assessment |
|--------|------------|
| Token comparison | Timing-safe (`timingSafeEqual`) ✅ |
| Token storage | SHA-256 hashed ✅ |
| CORS | Configurable but defaults to localhost ⚠️ |
| Input validation | JSON Schema on API routes ✅ |
| File operations | Read-only mode for external SQLite DBs ✅ |
| Path handling | Normalized to prevent traversal ✅ |
| Secrets | No hardcoded secrets, env-var based ✅ |
| Auth model | Pairing token + agent token with lease enforcement ✅ |

The main security consideration is the CORS default and the fact that this is designed for localhost/trusted-LAN deployment only.

---

## Top Recommendations

### Priority 1 — Scaling

1. **Paginated storage queries**: Replace in-memory-load-then-slice patterns in `listResolvedTurns()` and `replaceSearchIndex()` with cursor-based or LIMIT/OFFSET queries at the SQLite level.
2. **Stream-based file parsing**: For adapters processing large JSONL files, use line-by-line streaming instead of reading entire files into memory.

### Priority 2 — Web UX

3. **URL-based routing**: Migrate the web app's view state from `useState` to Next.js App Router paths (e.g., `/inbox`, `/projects`, `/search?q=...`). This enables deep linking, browser history, and shareable URLs.
4. **Decompose large components**: Break `SessionMap` (~1100 lines) into smaller sub-components.

### Priority 3 — Developer Experience

5. **Shared utilities**: Extract duplicated markup-cleaning logic between CLI and TUI into a shared package.
6. **Short flags**: Add `-s` (store), `-p` (project), `-q` (query) aliases to the CLI arg parser.

### Priority 4 — Resilience

7. **Manifest checksum robustness**: Use a canonical JSON serialization (sorted keys, no whitespace) for bundle manifest checksums to avoid formatting-dependent failures.
8. **Search index scaling**: Consider incremental indexing (only re-index changed turns) instead of full-table diff on every sync.

---

## Conclusion

CCHistory v0.1.0 is a mature, well-engineered product for its stated scope: single-user self-hosted AI coding history. The domain model is thoughtful, the pipeline is rigorous, and the operator experience is polished across four entry points (CLI, TUI, API, Web). The identified issues are growth-path concerns rather than blocking defects — the codebase is ready for production use at individual-developer scale.
