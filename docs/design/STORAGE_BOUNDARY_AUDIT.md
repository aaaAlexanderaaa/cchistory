# Storage Boundary Audit

Status: audit and improvement plan, not a redesign approval.

This document indexes the repository-visible definitions, implementation points,
and tests that currently define CCHistory storage boundaries and sync persistence.
It then records an architecture assessment and a staged improvement plan.
`HIGH_LEVEL_DESIGN_FREEZE.md` remains the source of truth for product semantics.

## Scope

This audit covers:

- how source material enters the pipeline
- how evidence, derived intermediates, canonical projections, and search state are
  persisted today
- which tests currently protect that behavior
- where the current implementation conflicts with the design intent for
  reference-first context and bounded hot-path storage
- a proposed long-term storage boundary that preserves evidence without making
  every layer a large JSON payload store

This audit does not propose changing the frozen product invariants:

- project-first history
- `UserTurn` as the primary recall object
- evidence-preserving ingestion
- UI and API as projections of one canonical model

## Current Authority Index

### Frozen Semantics

| Path | Relevant scope | Notes |
| --- | --- | --- |
| `HIGH_LEVEL_DESIGN_FREEZE.md` | Product semantics and architecture | Defines the kernel pattern: preserve evidence, derive stable objects, govern lifecycle, project to UI/API. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#7-canonical-pipeline` | Canonical pipeline | Defines Capture -> Parse -> Normalize -> Observe project evidence -> Link -> Build turns -> Mask -> Index -> Present. Also names the adapter-level chain: Blobs -> Records -> Fragments -> Atoms -> Candidates. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#9-userturn-model` | `UserTurn` and context semantics | Defines `UserTurn` as the primary product object and requires raw references for traceability. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#95-context-storage-semantics` | Context storage intent | Explicitly says `TurnContext` is reference-first, hot-path turn storage should keep bounded context materialization only, full context should be reconstructed or cached on demand, and large assistant/tool payloads must not be blindly duplicated into primary turn storage. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#11-lifecycle-model` | Retention and sync axes | Defines `keep_raw_and_derived`, `keep_raw_only`, `purged`, `current`, `superseded`, and `source_absent`. This is the design basis for retaining evidence while dropping or rebuilding derived state. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#12-import-model` | Import and evidence dedupe | Defines raw-first hybrid bundles, evidence dedupe by source identity and checksum, and rebuilding canonical objects from raw evidence on import. |
| `HIGH_LEVEL_DESIGN_FREEZE.md#16-operational-envelope` | Scale and rebuild intent | Allows raw evidence in the hundreds of thousands to low millions of events, but says hot-path history should load bounded detail and full rebuild should be exceptional maintenance. |

### Runtime And Source Documentation

| Path | Relevant scope | Notes |
| --- | --- | --- |
| `docs/design/CURRENT_RUNTIME_SURFACE.md` | Runtime inventory | Lists entrypoints, registered source adapters, CLI read modes, and the current runtime surface. |
| `docs/sources/README.md` | Source collection and local store description | Documents recursive source scanning, blob -> record -> fragment -> atom -> `UserTurn` flow, local SQLite store layout, raw snapshot directory, and SQLite object layers. |
| `docs/sources/codex.md` | Codex source layout | Documents `~/.codex/sessions` source assumptions and JSONL session file intake. |
| `docs/sources/claude-code.md` | Claude Code source layout | Documents `~/.claude/projects` JSONL intake. |
| `docs/sources/*.md` | Per-source storage boundaries | Documents transcript-bearing files versus evidence-only companions for stable source families. |

Important current inconsistency:

- `docs/sources/README.md` says regular `sync` writes raw file snapshots under
  the selected store `raw/` directory.
- Current CLI sync passes `snapshotRawBlobs: true` to `syncSelectedSources`, but
  the parameter is not used in `apps/cli/src/commands/sync.ts`.
- API persisted sync does snapshot raw blobs in `apps/api/src/app.ts`.

This should be reconciled before making stronger claims about raw snapshot
availability in the CLI store.

Until then, regular CLI sync should be described as preserving evidence-derived
raw records, blob metadata, checksums, and lineage references. Byte-exact raw
file snapshots are available through API persisted sync and bundle/import
workflows, but are not guaranteed for the regular CLI store.

## Current Code Index

### Domain Contracts

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `packages/domain/src/index.ts` | `CapturedBlob`, `RawRecord`, `SourceFragment`, `ConversationAtom`, `AtomEdge`, `DerivedCandidate` | Defines evidence and adapter-derived intermediate objects. |
| `packages/domain/src/index.ts` | `SessionProjection`, `UserTurnProjection`, `TurnContextProjection` | Defines canonical projections and currently permits large context materialization via assistant replies and tool output fields. |
| `packages/domain/src/index.ts` | `SourceSyncPayload` | Defines one aggregate payload containing source status, stage runs, loss audits, blobs, records, fragments, atoms, edges, candidates, sessions, turns, and contexts. This aggregate is the central current boundary between source-adapters and storage. |

### Source Discovery, Capture, Parse, And Projection

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `packages/source-adapters/src/core/discovery.ts` | `getDefaultSources`, source format profiles | Defines default source roster and parser profile metadata. |
| `packages/source-adapters/src/core/utils.ts` | `listSourceFiles`, `walkFiles` | Recursively walks source roots, filters by adapter matcher, sorts, and applies limit after walking. This is the current source-file discovery boundary. |
| `packages/source-adapters/src/core/probe.ts` | `runSourceProbe`, `processSource`, `collectSourceInputs` | Main runtime ingestion path. Produces `SourceSyncPayload` objects for selected sources. |
| `packages/source-adapters/src/core/probe.ts` | previous payload reuse helpers | Builds previous-source indexes from persisted payload slices and supports unchanged-file reuse and append parsing for JSONL sources. |
| `packages/source-adapters/src/core/parser.ts` | `captureBlob` | Reads each selected source file, computes checksum, records file identity metadata, and returns a captured blob plus file buffer. |
| `packages/source-adapters/src/core/parser.ts` | `extractRecords`, `parseRecord` | Converts source blobs into raw records and source fragments. JSONL-like sources retain each line as `RawRecord.raw_json`. |
| `packages/source-adapters/src/core/atomizer.ts` | `atomizeFragments` | Converts fragments into conversation atoms and atom edges. |
| `packages/source-adapters/src/core/projections.ts` | `buildProjectObservationCandidates`, `buildSubmissionGroups`, `buildTurnsAndContext` | Builds project observations, turn candidates, `UserTurnProjection`, and `TurnContextProjection`. |

### CLI Sync

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `apps/cli/src/commands/sync.ts` | `handleSync` | Opens the selected store and calls `syncSelectedSources`. |
| `apps/cli/src/commands/sync.ts` | `syncSelectedSources` | Resolves sources, runs source probes, writes payloads, and refreshes derived projections once after selected sources are written. |
| `apps/cli/src/commands/sync.ts` | `syncCodexSourceInBatches` | Special batched Codex path to keep full scans bounded by target byte size. |
| `apps/cli/src/commands/sync.ts` | `shouldUseMergeByOriginPath` | Enables merge-by-origin-path for Codex, Claude Code, and Factory Droid when `--limit-files` is absent. |
| `apps/cli/src/commands/sync.ts` | progress reporting and stage timing | Emits `--detail`/`--progress jsonl` events and annotates stage-run stats with scan, parse, write, merge, metadata, prune, and projection refresh timings. |
| `apps/cli/src/main.ts` | `openReadStoreDefault` | In `--full` read mode, runs `syncSelectedSources` into an in-memory store rather than reading the persisted index. |

### API Sync

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `apps/api/src/app.ts` | `bootstrapStorage`, `syncSources` | API runtime bootstraps empty storage by probing configured sources and replacing source payloads. |
| `apps/api/src/app.ts` | `snapshotRawBlobs` | API persisted sync copies raw source files, or materializes virtual blobs from records, before calling `storage.replaceSourcePayload`. |
| `apps/api/src/routes/sources.ts` | source config and probe routes | Exposes admin source configuration and manual probe/sync operations. |

### Storage Schema And Persistence

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `packages/storage/src/db/schema.ts` | `initializeStorageSchema` | Creates all storage tables. Most tables store one `payload_json` column plus a few indexed structural columns. |
| `packages/storage/src/db/schema.ts` | `STORAGE_INDEXES` | Defines structural indexes used by source-scoped and session-scoped queries. |
| `packages/storage/src/db/schema.ts` | `ensureSearchIndex` | Creates FTS5 `search_index`, tracks rebuild state with `schema_meta.search_index_status`, and drops/rebuilds old search-index state when needed. |
| `packages/storage/src/ingest/source-payload.ts` | `replaceSourcePayloadWithOptions` | Full source replacement: deletes source rows, then inserts every layer from `SourceSyncPayload` into SQLite as JSON payload rows. |
| `packages/storage/src/ingest/source-payload.ts` | `mergeSourcePayloadByOriginPath` | Incremental source merge by origin path: selects replace/preserve origin paths, deletes affected session/blob-scoped rows, and inserts changed layers. |
| `packages/storage/src/ingest/source-payload.ts` | `updateSourceSyncMetadata` | Metadata-only update path for unchanged batches. |
| `packages/storage/src/ingest/source-payload.ts` | `pruneSourcePayloadByObservedOriginPaths` | Removes stale rows for source files no longer observed. |
| `packages/storage/src/internal/storage.ts` | `CCHistoryStorage` | Runtime storage facade used by CLI, TUI, API, tests, and verifiers. |
| `packages/storage/src/internal/storage.ts` | `refreshDerivedState` | Recomputes project link snapshot, writes `project_current`, revisions, lineage events, and refreshes search index. |
| `packages/storage/src/internal/storage.ts` | `buildSourcePayload`, `buildSourceIncrementalPayload*` | Rehydrates persisted payload slices from SQLite for export and incremental reuse. |
| `packages/storage/src/internal/queries.ts` | JSON row selectors | Reads `payload_json` rows and parses them back into typed objects. |
| `packages/storage/src/queries/search.ts` | `replaceSearchIndex`, `querySearchIndex` | Maintains FTS5 search index and fallback substring search. |
| `packages/storage/src/linker.ts` | `deriveProjectLinkSnapshot` | Computes project identities, linked turns, sessions, and observations from stored sessions, turns, candidates, and overrides. |

### Bundles, Import, Backup, And Raw Snapshots

| Path | Relevant symbols | Notes |
| --- | --- | --- |
| `apps/cli/src/bundle.ts` | `streamSourcePayloadJson` call sites | Bundle export can stream source payload JSON rather than loading an entire payload at once. |
| `apps/cli/src/bundle.ts` | `snapshotPayloadRawBlobs` | CLI bundle snapshot helper copies source files or materializes virtual raw snapshots for bundle/import workflows. |
| `apps/cli/src/bundle.ts` | `materializePayloadRawBlobs*` | Imports raw blobs from bundles into local raw directories. |
| `packages/storage/src/raw-gc.ts` | `pruneOrphanRawSnapshots` | Raw snapshot garbage collection based on `CapturedBlob.captured_path` references. |
| `apps/cli/src/commands/maintenance.ts` | backup/import/merge/gc commands | CLI maintenance surface over bundles, backup, restore-check, import, merge, and raw GC. |

## Current Test And Verifier Index

### Storage Package Tests

| Path | Coverage | Current limitation |
| --- | --- | --- |
| `packages/storage/src/test/ingest.test.ts` | `replaceSourcePayload`, row persistence, source replacement, idempotence, lineage drill-down, duplicate tolerance | Uses small fixture payloads. It validates semantics, not large payload storage boundaries or write amplification. |
| `packages/storage/src/test/search.test.ts` | FTS/fallback search behavior, special characters, path-text search, search-index rebuild recovery | Covers search correctness and crash recovery in small stores. Does not test multi-GB search rebuild cost. |
| `packages/storage/src/test/linking.test.ts` | Project linking, related work, delegated sessions, automation evidence | Mostly projection fixtures. Validates semantic output, not storage growth. |
| `packages/storage/src/test/maintenance.test.ts` | Tombstones, future schema refusal, evidence query-column migrations, severity migration | Covers schema safety and migration basics. Does not validate migration cost on large stores. |
| `packages/storage/src/test/stats.test.ts` | Usage and stats rollups | Read-side correctness over fixture payloads. |
| `packages/storage/src/test/store-layout.test.ts` | Default store layout and path resolution | Layout semantics only. |

### Source Adapter Tests

| Path | Coverage | Current limitation |
| --- | --- | --- |
| `packages/source-adapters/src/core/discovery.test.ts` | Source-shaped probe, parser convergence, masks, injected context, relation fragments | Strong semantic coverage but synthetic and small. |
| `packages/source-adapters/src/core/projections.test.ts` | Turn/context derivation over generated atoms | Validates algorithmic behavior, not storage persistence. |
| `packages/source-adapters/src/platforms/*.test.ts` | Per-adapter real-shape and fixture-shape parser behavior | Protects source-specific evidence boundaries; not a storage design test. |
| `packages/source-adapters/src/core/tokens.test.ts` | Token projection and cumulative token behavior | Domain-specific parse/derive correctness. |

### CLI/API/TUI And E2E Verifiers

| Path | Coverage | Current limitation |
| --- | --- | --- |
| `apps/cli/src/test/commands-diagnostics.test.ts` | `sync --detail`, single projection refresh, Codex batching, stale row pruning, parser invalidation, `--since`, metadata-only reuse, append parsing, no-op reindex skip | Best current sync-process test set. Data sizes remain intentionally small. |
| `apps/cli/src/test/commands-core.test.ts` | CLI sync/read/search/stats usability over source-shaped fixtures | User-surface correctness, not storage boundary stress. |
| `apps/cli/src/test/commands-portability.test.ts` | export, backup, import, restore-check, merge, gc | Bundle and portability semantics over small stores. |
| `apps/api/src/app.test.ts` | API bootstrap, probe/replay, raw snapshot persistence, source config sync, read-only behavior, remote-agent upload/import | API path coverage; not CLI sync storage boundary stress. |
| `packages/api-client/src/index.test.ts` | Managed API DTO read and admin workflows | Contract parity over in-process runtime. |
| `tests/e2e/*.test.mjs` | Seeded journeys for recall, traceability, admin, restore, real-layout sync | Combines surfaces; mostly small and fixture-backed. |
| `scripts/verify-fixture-sync-to-recall.mjs` | Clean-store sync from `mock_data` to CLI/API/TUI recall | Good source-shaped E2E parity; small fixture corpus. |
| `scripts/verify-real-layout-sync-recall.mjs` | Stable adapter real-layout fixture sync/read parity | Structural coverage across adapters; fixture scale is small. |
| `scripts/verify-related-work-recall.mjs` | Related-work recall over source-shaped fixtures | Relation semantics, not storage growth. |
| `scripts/verify-scale-recall.mjs` | Generated Codex and Claude Code corpus with 2400 turns across 24 sessions | Best existing scale-shaped verifier, but still far smaller than real long-term stores and not focused on storage bytes or write amplification. |
| `scripts/verify-cli-artifact.mjs` | Installed CLI artifact workflows including sync, backup, import, search/show | Release packaging plus user workflows, not storage architecture validation. |

## Current Architecture Assessment

### What The Current Model Gets Right

- The product semantics are coherent: evidence-derived raw records, checksums,
  and traceability are preserved, `UserTurn` is the primary recall object, and
  source-specific quirks converge through a shared model. Regular CLI sync does
  not currently guarantee byte-exact raw file snapshots.
- The current implementation exposes traceability from turn detail back through
  candidates, atoms, fragments, records, and blobs.
- Incremental sync exists for the Primary sources and is tested: unchanged-file
  reuse, append parsing, metadata-only reuse, batched Codex sync, stale-row prune,
  and no-op reindex skip are all represented.
- The storage schema added structural columns and indexes for source/session/blob
  queries, which is necessary for any incremental path.

### What Is Structurally Unreasonable Long Term

The current storage boundary uses `SourceSyncPayload` as both:

- the adapter-to-storage transfer object
- the replacement/merge write unit
- the export/import payload shape
- the debug lineage object
- the source of canonical read projections

That makes one aggregate object carry too many responsibilities.

The SQLite schema then persists most layers as full JSON payload rows:

- source instances
- stage runs
- loss audits
- captured blobs
- raw records
- source fragments
- conversation atoms
- atom edges
- derived candidates
- sessions
- user turns
- turn contexts
- projects, revisions, lineage, artifacts, imports

This is practical for an MVP, but it creates long-term pressure:

- Text is duplicated across raw records, fragments, atoms, user turns, and
  turn contexts.
- Large assistant replies and tool outputs can be stored inline inside
  `TurnContextProjection`, despite the frozen design saying context should be
  reference-first and bounded on the hot path.
- Incremental reuse can require loading old records/fragments/atoms back out of
  SQLite just to prove unchanged data remains unchanged.
- Routine sync and routine source changes can still touch large intermediate
  layers instead of only a source-file ledger and affected canonical objects.
- SQLite becomes both metadata index and bulk evidence/content warehouse.

The mismatch is not just a performance bug. It is a boundary problem:

- Evidence storage should preserve source material.
- Canonical read storage should serve product reads.
- Pipeline/debug storage should support traceability and rebuilds.
- Cache storage should be disposable and scoped.

Today those roles are heavily co-located in JSON-over-SQLite.

## Design Principles For A Better Boundary

1. Store raw evidence once.

   Raw source bytes should live in a content-addressed evidence store. SQLite
   should hold metadata, checksums, file identities, origin paths, byte ranges,
   and lifecycle state. Derived objects should reference evidence spans rather
   than duplicate raw text in every layer.

2. Make ingestion append-ledger driven.

   JSONL sources should track file identity, size, modified time, changed time,
   checksum or rolling prefix checksum, parsed byte offset, last complete line
   boundary, parser profile, and source identity. Routine sync should process
   only new or changed ranges.

   This is only safe for append-compatible source layouts when file identity,
   parser profile, prefix checksum, and JSONL line boundaries prove the old
   prefix is unchanged. Truncated, rewritten, virtual/live, database-backed, or
   parser-profile-changed inputs must fall back to a scoped reparse/rebuild.

3. Keep canonical read objects small.

   `UserTurn` should keep canonical text, bounded raw text or raw-text
   references, bounded display segments, source/evidence references,
   project/session references, search fields, summary metrics, and lineage refs.
   It should not inline full tool output or full assistant context.

4. Treat full context as reference-first and lazy.

   `TurnContext` should be reconstructed on demand from atoms/fragments/evidence
   spans or loaded from a bounded/compressed cache. Hot-path tables should not
   blindly duplicate multi-MB assistant/tool payloads.

5. Demote adapter intermediates to rebuildable derived state.

   Records, fragments, atoms, and candidates are useful. They do not all need to
   be stored as first-class hot-path JSON rows forever. Some can be compact
   span indexes, compressed debug bundles, or scoped rebuild caches.

6. Separate search index from evidence bulk.

   Default search targets `UserTurn.canonical_text` and selected path/project
   fields. Search should not depend on large raw/context payloads except through
   explicit secondary search modes.

7. Make rebuilds scoped by design.

   Parser, linker, builder, and mask changes should declare affected source
   family, source instance, file, session, project, or turn sets. Full-system
   rebuild must remain exceptional.

## Improvement Plan

The phase labels below are internal work-management slices, not user approval
gates. Phase 1 through Phase 5 are one continuous implementation scope once this
audit is accepted for execution. Implement them in order, or with local overlap
where that is simpler, and do not stop for user confirmation between those
phases unless a frozen design invariant would change, a default decision below
is proven invalid, or preserving user evidence requires an explicit tradeoff.

Phase 0 is the documentation/backlog preparation step. Phase 6 and Phase 7 are
follow-on migration and scale-validation work after the V2 boundary exists.

### Phase 0: Record The Boundary Gap

Goal: make the current architecture debt explicit before changing storage.

Deliverables:

- Keep this audit as the index for existing storage boundary definitions.
- Add a short note to `BACKLOG.md` pointing to this audit and classifying the
  issue as storage boundary redesign, not a local sync optimization.
- Fix or clarify the CLI raw snapshot documentation mismatch:
  - either implement CLI raw snapshot persistence, or
  - update `docs/sources/README.md` to distinguish API persisted sync, bundle
    workflows, and current CLI sync behavior.

Validation:

- Documentation-only review against `HIGH_LEVEL_DESIGN_FREEZE.md`.

### Phase 1: Add A Storage Footprint Inventory

Goal: make storage growth observable without altering semantics.

Deliverables:

- Add a read-only store inventory command or verifier that reports:
  - row counts by table
  - summed `payload_json` bytes by table
  - largest payload rows by table
  - SQLite main/WAL/SHM file sizes
  - search index state
  - source file counts and total source-root bytes
- Store no new runtime data unless explicitly requested.
- Keep the report safe for user stores: no sync, no vacuum, no migrations, no
  schema initialization, and no search-index rebuild. The inventory path should
  open SQLite directly in read-only mode, similar to the current doctor-style
  inspection path, rather than going through the normal `CCHistoryStorage`
  facade.

Validation:

- Storage test for inventory against fixture stores.
- CLI test for human and JSON output.

### Phase 2: Define A V2 Storage Boundary Contract

Goal: define interfaces before migration code.

Deliverables:

- A design doc for:
  - `EvidenceBlob` and `EvidenceSpan`
  - `SourceFileLedger`
  - `ParsedRecordSpan`
  - bounded `UserTurn` read model
  - reference-first `TurnContext`
  - disposable derived caches
- Map each current `SourceSyncPayload` field to one of:
  - evidence store
  - ingestion ledger
  - canonical read model
  - derived/debug cache
  - lifecycle/admin metadata
- Define which objects are required for default CLI/TUI/Web/API reads and which
  are only required for lineage/debug/rebuild.

Validation:

- Design review against:
  - `HIGH_LEVEL_DESIGN_FREEZE.md#9-userturn-model`
  - `HIGH_LEVEL_DESIGN_FREEZE.md#95-context-storage-semantics`
  - `HIGH_LEVEL_DESIGN_FREEZE.md#16-operational-envelope`

### Phase 3: Introduce Evidence Store And Ledger In Parallel

Goal: add the new boundary without breaking current reads.

Deliverables:

- Add content-addressed evidence storage under the store directory, for example:
  - `evidence/blobs/<sha-prefix>/<sha>`
  - optional compression for large text blobs
  - metadata rows in SQLite for source instance, origin path, file identity,
    checksum, size, and capture state
- Add source-file ledger rows with high-water marks:
  - source id
  - origin path
  - file identity
  - size
  - modified/changed times
  - parsed byte offset
  - last valid JSONL boundary
  - parser profile
  - last derived session refs
- Keep current tables populated during the transition.

Validation:

- Tests proving same evidence key and checksum is a no-op.
- Tests proving same source-file identity or origin path with changed checksum
  creates a new evidence blob/revision and supersedes affected derived state.
- Tests proving append-only JSONL sync reads only appended bytes when file
  identity, parser profile, prefix checksum, and line-boundary checks make that
  safe.
- Tests proving truncated, rewritten, virtual/live, database-backed, or
  parser-profile-changed inputs do not use append-only reuse.

### Phase 4: Shrink The Hot Read Model

Goal: align implementation with reference-first context semantics.

Deliverables:

- Split current `turn_contexts.payload_json` into:
  - small context summary and references in the hot table
  - optional compressed context cache by turn id/revision
  - evidence/span refs for reconstruction
- Keep `UserTurnProjection` hot fields bounded:
  - bounded raw text or raw text references
  - canonical text
  - bounded display segments
  - source/evidence references
  - path text
  - session/project refs
  - lifecycle axes
  - context summary
  - lineage refs
- Add on-demand context reconstruction for CLI/API/TUI detail paths.

Validation:

- Existing search, show turn, show session, tree session, API detail, and TUI
  detail tests must continue to pass.
- New tests should prove large tool output is not blindly duplicated in hot
  `user_turns` or hot `turn_contexts` rows.

### Phase 5: Demote Intermediate Layers To Scoped Caches

Goal: keep traceability without permanently bloating SQLite with every
intermediate object as uncompressed JSON.

Deliverables:

- Decide per layer:
  - `RawRecord`: store record spans and raw JSON references rather than full raw
    JSON where possible.
  - `SourceFragment`: store compact references and typed fields needed for rebuild
    or admin; move large payload text to evidence spans or compressed cache.
  - `ConversationAtom`: keep searchable/orderable minimal fields; move large text
    to refs.
  - `DerivedCandidate`: keep project/turn/linking candidates needed for current
    linking; make obsolete candidate details rebuildable or cached.
- Add scoped rebuild APIs by source id, origin path, session id, project id, or
  parser profile.

Validation:

- Lineage drill-down must still resolve from turn -> candidate -> atom -> fragment
  -> record -> blob/evidence.
- Fixture and real-layout verifiers must prove no evidence-only companions are
  silently dropped.

### Phase 6: Migrate Existing Stores Safely

Goal: avoid destructive migration and preserve user evidence.

Deliverables:

- Add a preview migration that reports:
  - estimated bytes moved to evidence store
  - estimated bytes removed from hot JSON tables
  - affected sources/sessions/turns
  - required free disk
- Add a write migration that:
  - keeps old tables until validation succeeds
  - writes migration markers
  - can resume after interruption
  - does not purge old payloads until an explicit compact step
- Add a separate compact/vacuum maintenance step for users who accept the cost.

Validation:

- Migration tests from current schema.
- Crash/resume tests.
- Bundle export/import parity before and after migration.
- Read-only admin behavior for future or partially migrated stores.

### Phase 7: Rebaseline Scale Validation

Goal: validate the new storage boundary under realistic long-term use.

Deliverables:

- Expand scale verifier beyond turn count:
  - table row counts
  - payload bytes
  - evidence-store bytes
  - WAL size
  - first sync time
  - unchanged sync time
  - append sync time
  - context detail reconstruction time
  - search time
- Include at least:
  - many small JSONL files
  - a few very large JSONL files
  - large tool output
  - appended records
  - truncated/rewritten files
  - evidence-only companions

Validation:

- Keep current semantic verifiers.
- Add storage-boundary-specific acceptance thresholds once the new design is
  implemented enough to measure honestly.

## Default Implementation Decisions

Use these defaults for Phase 1 through Phase 5 unless implementation proves one
invalid. Do not treat them as approval gates.

1. Evidence store layout: use plain content-addressed files by default, with the
   schema leaving room for future compression metadata. Do not compress all
   evidence as the first implementation step.
2. Existing `raw/` snapshots: keep `raw/` as a compatibility snapshot area.
   Introduce `evidence/` as the V2 content-addressed evidence store rather than
   silently repurposing `raw/`.
3. Hot context budget: hot context rows may store summaries, counts, previews,
   references, ordering fields, lifecycle fields, and bounded display material.
   Full assistant replies, full tool input, and full tool output must move to
   evidence/span references or an explicitly scoped cache. Set a concrete inline
   byte budget in the V2 boundary contract and add tests for large payloads.
4. Intermediate queryability: keep enough structured fields for current default
   reads, project linking, lineage drill-down, diagnostics, and scoped rebuild
   selection without reconstructing everything. Move large text bodies and
   obsolete/debug-only detail out of hot JSON rows first.
5. V2 rollout shape: introduce side-by-side V2 tables and evidence files while
   keeping current tables populated during Phase 1 through Phase 5. Do not make
   destructive schema migration or compaction part of this continuous scope.
6. Operator surface: expose Phase 1 inventory as read-only inspection first.
   Add migration preview, compact, and rebuild commands only in the later
   migration scope.

Stop and ask only if one of these defaults would break a frozen invariant,
require destructive migration, or make evidence preservation ambiguous.

## Audit Conclusion

The current implementation is not merely slow in isolated loops. Its storage
boundary is too broad: SQLite `payload_json` rows are used for raw evidence,
intermediate derivation state, canonical read models, debug lineage, search
inputs, and export/import payloads at the same time.

That boundary conflicts with the frozen design's own reference-first context
intent and operational envelope. The right long-term direction is to separate:

- evidence content storage
- ingestion ledger state
- small canonical read projections
- rebuildable derived/debug caches
- search indexes

This preserves the product semantics while removing the need for routine sync to
move historical raw/context/intermediate JSON through the hot storage path.
