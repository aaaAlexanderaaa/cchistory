# Storage Boundary Migration Plan (Phase 6/7)

Status: execution plan for Phase 6 (migrate existing stores safely) and Phase 7
(scale rebaseline) defined in `docs/design/STORAGE_BOUNDARY_AUDIT.md`. Phases 1-5
are closed under R41 in `BACKLOG.md`; this plan picks up where Phase 5 leaves off.

`HIGH_LEVEL_DESIGN_FREEZE.md` remains the product source of truth. This plan does
not change product semantics: evidence is preserved, `UserTurn` remains the
primary recall object, UI/API/TUI/CLI reads remain projections of the same
canonical model, and `STORAGE_BOUNDARY_V2_CONTRACT.md` purge rules (lines
176-177) hold throughout: no migration may purge old payloads without the later
Phase 6 preview, validation, and explicit compact step.

## Context

A production store observed at ~5 GB. Investigation attributes the bulk of that
size to four classes of duplication between the V1 payload-JSON layer and the V2
sidecar layer:

1. **Full V1+V2 dual-write of every turn and context** (`packages/storage/src/internal/storage.ts:191-278`, `evidence-store.ts:656-773`). `user_turns.payload_json` and `user_turns_v2` overlap; `turn_contexts.payload_json` and `turn_context_refs_v2` plus the on-disk `evidence/blobs/<sha256>` content-addressed file overlap on the same data.
2. **`captured_blobs` metadata duplicated by `evidence_captures` and `source_file_ledger`** (`schema.ts:171-178, 347-397`, `evidence-store.ts:511-612`).
3. **`raw_records.payload_json` body duplicated as byte-spans in `parsed_record_spans`** plus the evidence blob (`evidence-store.ts:614-654`).
4. **FTS5 `search_index` shadow tables maintained but the scan path no longer uses them** (`storage.ts:1693`, `queries/search.ts:194-246`). The shadow tables hold a third copy of canonical/raw text.

The V1 layer remains the default read path everywhere except `getTurnContext`
(`storage.ts:653-662`). No feature flag or env var gates this. See
`STORAGE_BOUNDARY_V2_CONTRACT.md` lines 105-106, 124-125 for the additive
rollout rule that produced this state.

The conclusion from that audit: **migration and optimization are the same work**.
The four duplications above collapse only when V1 payload columns are dropped,
which is exactly Phase 6.6. Pre-migration "optimization" that does not address
the duplication will rearrange bytes without shrinking the store.

## Strategy

Three execution tracks, sequenced:

- **Phase A** — cheap wins that do not touch schema and can ship independently.
  Reduces 5 GB by an estimated 1.0-1.5 GB and removes the worst on-going
  duplication source (FTS5 maintenance).
- **Phase B** — Phase 6 from `STORAGE_BOUNDARY_AUDIT.md` lines 469-492. Resolves
  the audit's hand-wavy parts (marker semantics, compact vs vacuum separation,
  validation criteria, resume protocol) into concrete sub-stages with acceptance
  criteria. Reduces 5 GB to an estimated 1.5-2.0 GB by eliminating V1 payload
  duplication.
- **Phase C** — Phase 7 from `STORAGE_BOUNDARY_AUDIT.md` lines 494-522. Splits
  into a pre-migration baseline pass (C.1, ships with Phase A) and a
  post-migration rebaseline (C.2, ships after Phase B).

Phase A is the unlock. C.1 must run before Phase B so that Phase 7 has a
comparison baseline. Phase B is the bulk of the work. Phase C.2 is the
validation gate that closes the storage boundary work.

## Phase A: Cheap Wins (pre-migration)

Four independent changes. Each can be its own branch and ship independently. No
schema migration required for A.1, A.2, or A.4. A.3 requires an index rebuild.

### A.1 Stop FTS5 search_index maintenance on the hot path

The scan path no longer consults FTS5 (`queries/search.ts:194-246`). The
`replaceSearchIndex` call in `storage.ts:1693` runs on every
`refreshDerivedState` and fully re-inserts canonical/path/raw text. FTS5 shadow
tables (`search_index_data`, `_docsize`, `_idx`, `_content`, `_config`,
`_hashes`) carry a third copy of that text at ~1.5-2x cost.

Plan:

- Remove the `replaceSearchIndex` call from the refresh path.
- Decide between deleting the FTS5 schema entries and keeping them inert for a
  potential future read-path switch. Recommendation: keep the schema entries
  inert; remove the writes. Re-enabling writes is a one-line change if search
  later needs FTS5.
- Add a `rebuildSearchIndex` maintenance command (no auto-trigger) so an
  operator can rebuild the FTS5 table on demand.

Acceptance:

- `refreshDerivedState` no longer writes to `search_index_*`.
- Search behavior unchanged (the scan path was already not using FTS5).
- An explicit maintenance command exists to rebuild FTS5 if needed.

### A.2 V2 evidence GC on turn/source/blob delete

`purgeTurnInTransaction` (`packages/storage/src/internal/gc.ts:49-83`) deletes
V1 rows and V2 ref rows (`user_turns_v2`, `turn_context_refs_v2`) but does not
delete from `evidence_blobs`, `evidence_captures`, `parsed_record_spans`, or
`source_file_ledger`. The content-addressed files in `evidence/blobs/<sha256>`
are never unlinked. `retireStorageBoundaryV2Sources` (`evidence-store.ts:129-152`)
only marks the ledger absent. `raw-gc.ts` only prunes the V1 raw snapshot tree.

Result: every deleted source/turn leaves its evidence blob, evidence_capture
row, parsed_record_span rows, and source_file_ledger row behind indefinitely.

Plan:

- Extend `purgeTurnInTransaction` to delete from `evidence_captures` and
  `parsed_record_spans` for the affected turn/blob/record ids, then drop
  `evidence_blobs` rows whose sha is no longer referenced from any
  `evidence_captures` or `parsed_record_spans` row in the same transaction, and
  unlink the corresponding `evidence/blobs/<sha>` files outside the transaction
  with error containment (file unlink failures must not roll back the DB
  transaction).
- Extend `retireStorageBoundaryV2Sources` to do the same when a source is
  retired.
- Add a maintenance command `gcEvidenceOrphans` that scans `evidence_blobs` for
  rows with no remaining references and unlinks them, for backfilling stores
  that already accumulated orphans before this fix landed.

Acceptance:

- After GC, no `evidence_blobs` row exists that is not referenced from
  `evidence_captures` or `parsed_record_spans`.
- After GC, no `evidence/blobs/<sha>` file exists for a sha no longer in
  `evidence_blobs`.
- GC is transactional on the DB side; file unlinks are best-effort.

### A.3 Drop redundant indexes

Five table pairs have a session-only index that is a strict prefix-duplicate of
the source+session compound index:

- `raw_records`: `idx_raw_records_session` vs `idx_raw_records_source_session`
- `source_fragments`: `idx_source_fragments_session` vs `idx_source_fragments_source_session`
- `conversation_atoms`: `idx_conversation_atoms_session` vs `idx_conversation_atoms_source_session_order`
- `atom_edges`: `idx_atom_edges_session` vs `idx_atom_edges_source_session`
- `derived_candidates`: `idx_derived_candidates_session` vs `idx_derived_candidates_source_session`

On `user_turns` the pattern is three-way: `idx_user_turns_source`,
`idx_user_turns_session`, `idx_user_turns_source_session`. The compound index
plus one single-column (`source_id`) covers all three use cases.
`user_turns_v2` repeats the same three-way pattern.

Plan:

- Drop the prefix-duplicate session-only indexes in a new additive schema
  migration (`2026-06-XX.1/storage-index-dedup` or similar).
- For `user_turns` and `user_turns_v2`, keep `idx_*_source_session` and
  `idx_*_source`; drop `idx_*_session`.
- Run `ANALYZE` after the migration so the query planner picks the surviving
  compound index for session-only lookups.

Acceptance:

- No `EXPLAIN QUERY PLAN` regression on session-scoped queries after the drop.
- All existing tests pass.

### A.4 SQLite pragma tuning

`storage.ts:149-151` sets only `busy_timeout`, `journal_mode=WAL`,
`foreign_keys=ON`. At 5 GB the default 4 KiB page size produces deep B-trees
and the WAL is never checkpointed explicitly.

Plan:

- Set `PRAGMA page_size = 16384` on connection init (effective only after the
  next VACUUM; document this in the migration release notes).
- Set `PRAGMA mmap_size = 268435456` (256 MB) on connection init.
- Set `PRAGMA synchronous = NORMAL` (safe under WAL).
- Add an explicit `PRAGMA wal_checkpoint(TRUNCATE)` call on store close and an
  optional maintenance command `checkpointStore` for periodic use.

Acceptance:

- New stores created after this change have 16 KiB pages.
- Existing stores still work; a maintenance command exists to VACUUM into the
  new page size on demand.
- WAL file size stays bounded under continuous write load with periodic
  `wal_checkpoint(TRUNCATE)`.

## Phase B: Phase 6 Migration

### B.1 Sub-stages

Seven sub-stages, sequenced. Each is independently testable; each writes a
`migration_state` marker row at start, commit, and (on failure) at abort.

```
B.1  inventory + preview
     Read-only. Reports four numbers: bytes moved to evidence store, bytes
     removable from V1 payload_json columns, count of affected
     sources/sessions/turns, required free disk space (>= current DB size,
     because VACUUM needs the temporary second copy).

B.2  marker schema
     New table migration_state(phase, scope_kind, scope_id, status, cursor_json,
     started_at, completed_at, last_error). status in {running, completed,
     aborted}. scope_kind in {store, source}.

B.3  write migration
     Per-source batches. Each source is one logical transaction that may be
     chunked across N row batches. For each source: confirm V2 sidecar rows
     exist for every V1 row, backfill any missing V2 row from the V1 payload,
     write the marker with status=completed for that source. V1 payloads are
     NOT touched in this stage.

B.4  validation
     Three independent validators:
       (a) bundle export/import byte-diff between pre-migration snapshot and
           post-B.3 snapshot.
       (b) inventory diff: same table row counts and same total payload bytes
           across the V1+V2 boundary.
       (c) read-path parity: run the same set of CLI/TUI/API queries against
           V1 and V2 readers, diff the results.

B.5  read cutover
     Switch the six V1 read paths to V2:
       (1) search scan path         (packages/storage/src/queries/search.ts:211,235)
       (2) detail/list reads        (packages/storage/src/internal/queries.ts:146-329)
       (3) linker input             (packages/storage/src/linker.ts)
       (4) stats + TUI browser      (internal/stats.ts, tui-browser.ts, read-overview.ts)
       (5) bundle/export shape      (buildSourcePayload* in storage.ts)
       (6) getTurnContext fallback  (storage.ts:653-662 — drop the V1 fallback)
     V1 reads are removed, not made conditional.

B.6  compact
     Two-step, defaults to running both:
       (6a) drop V1 payload_json columns (or drop entire V1-only tables once
            nothing reads them).
       (6b) VACUUM to reclaim pages.
     The two steps are independently runnable so an operator who cannot afford
     the VACUUM lock can stop at 6a and reclaim pages later.

B.7  rollback path
     Until B.6 completes, V1 payloads remain intact and readable. Any failure
     in B.1-B.5 leaves the store in its pre-migration state; the marker can
     be cleared and the migration re-run. After B.6 there is no rollback path
     short of restoring from backup; this is called out in the B.1 preview
     output.
```

### B.2 Decisions on the audit's open questions

The audit doc leaves six items undefined. Decisions below; each is binding
unless revisited before B.1 starts.

| Open question | Decision | Rationale |
| --- | --- | --- |
| Marker scope granularity | per-source | `source_instances` is the natural shard; transactions stay small; failures retry a single source. |
| compact vs vacuum separation | Two distinct sub-stages (B.6a, B.6b), defaulting to consecutive execution | Operators with limited maintenance windows can stop after 6a; the column drop is the actual byte reduction. |
| Vacuum trigger | Explicit maintenance command, never on the sync path | A 5 GB VACUUM takes minutes and locks the DB. |
| Validation algorithm | Three independent validators: bundle byte-diff, inventory diff, read-path parity | Single-validator is too weak; bundle parity alone misses read-path regressions. |
| Partial-migration store read strategy | V1 remains the fallback read path through B.5 | No read-only window for partially migrated stores. |
| Free-disk threshold | >= current DB size at B.1 preview | VACUUM requires a temporary second copy. |

### B.3 Workload estimate

Three to five person-weeks for B.1-B.6.7 end-to-end. The expensive pieces:

- B.3 (write migration) — 1-1.5 weeks. Per-source batched transaction, resume
  protocol, backfill from V1 when V2 sidecar is missing.
- B.4 (validation) — 1 week. Three validators, snapshot management, diff
  tooling.
- B.5 (read cutover) — 1-1.5 weeks. Six independent read paths, each must be
  validated against V1 output before the V1 read is removed.

B.1, B.2, B.6 are each 1-2 days.

### B.4 Risks

- **B.5 read regressions.** V2 read paths were exercised only by `getTurnContext`
  in production. The other five paths have no production traffic. Each cut-over
  must be validated against V1 output on a real-sized store, not unit tests.
  Mitigation: B.4c (read-path parity) runs on a production snapshot before
  B.5 starts.
- **VACUUM lock window.** B.6b blocks writes for the duration. Mitigation:
  `PRAGMA wal_checkpoint(TRUNCATE)` first, then `VACUUM INTO` a new file
  (atomic swap) instead of in-place VACUUM.
- **Backfill from V1 when V2 sidecar missing.** If a V2 sidecar is absent for
  a row that does have V1 payload, B.3 must reconstruct the V2 row from V1
  before marking the source complete. If reconstruction fails, the source is
  marked `aborted` and the migration halts at that source (does not proceed
  to B.4 for the store).
- **Long-running sources.** A source with millions of records may not finish
  one transaction. Mitigation: per-source batches are chunked by row count
  (suggested 5000 rows); each chunk is its own transaction; the marker stores
  the last completed chunk id.
- **No rollback after B.6.** Pre-B.6 backup is mandatory. The B.1 preview
  output prints the recommended backup command.

## Phase C: Phase 7 Scale Validation

The audit explicitly defers Phase 7 thresholds (line 521-522: "once the new
design is implemented enough to measure honestly"). Split into two passes.

### C.1 Pre-migration baseline (ships with Phase A)

Run the existing `scripts/verify-scale-recall.mjs` verifier (currently 2400
turns / 24 sessions per R41 line 414) against a V1+V2 store and commit the
numbers to `docs/design/STORAGE_BOUNDARY_SCALE_BASELINE.md` as the reference
baseline. Axes to record:

- per-table row counts (V1 and V2)
- payload_json bytes per V1 table
- evidence_blobs bytes and on-disk `evidence/blobs/` bytes
- WAL peak size
- first-sync time, unchanged-sync time, append-sync time
- context-detail reconstruction time
- search time

Acceptance: baseline file committed with all axes populated. Without this,
Phase C.2 cannot prove non-regression.

### C.2 Post-migration rebaseline (ships after Phase B)

Extend `verify-scale-recall.mjs` with the new axes the audit names at lines
498-516:

- table row counts (V2 only after B.6)
- payload bytes (V2 + on-disk evidence)
- evidence-store bytes
- WAL peak size
- the existing time axes

Scenario coverage per audit lines 502-512:

- many small JSONL files
- a few very large JSONL files
- large tool output
- appended records
- truncated or rewritten files
- evidence-only companions

Acceptance thresholds:

- Hard constraint: every metric <= C.1 baseline x 1.1 (no regression beyond
  10%).
- Soft target: total store size <= C.1 baseline x 0.5 (the expected 5 GB -> 1.5
  - 2.0 GB reduction).

Failure of the hard constraint blocks Phase 6 closure. Failure of the soft
target triggers a follow-up optimization ticket but does not block closure.

## Execution Order

```
Week 1   A.1 (stop FTS5) + A.2 (evidence GC)         <- biggest on-going savings
Week 2   A.3 (drop indexes) + A.4 (pragma tuning)    <- independent of migration
Week 2   C.1 (baseline numbers committed)            <- ships in parallel with A
----
Weeks    Phase B (B.1 -> B.6)                        <- 3-5 weeks, the bulk
3-7
----
Weeks    Phase C.2 (rebaseline + thresholds)         <- validation gate
8-9
```

A and C.1 are the unlock. Phase B is the bulk of the work. Phase C.2 is the
gate that closes the storage boundary effort.

## Out of Scope

The following are intentionally not part of this plan:

- **Per-layer retention rules during the transition.** `HIGH_LEVEL_DESIGN_FREEZE.md`
  lifecycle axes (`keep_raw_and_derived`, `keep_raw_only`, `purged`, etc.) apply
  as-is. This plan does not change when a layer is eligible for purge.
- **V2 evidence blob compression.** V2_CONTRACT line 38 specifies
  `compression: none` for the first implementation. Compression is a follow-on
  optimization after Phase C.2 measures the uncompressed baseline.
- **V1 read-path removal before B.5.** The dual-write is intentional until B.5.
- **Migration of pre-V2 stores created before the Phase 1-5 schema migration.**
  Those stores already went through an additive migration to gain the V2
  tables; Phase B applies on top of that state.
- **Multi-store federation.** Phase B operates on a single store at a time.

## References

- `docs/design/STORAGE_BOUNDARY_AUDIT.md` lines 469-522 — Phase 6 and Phase 7
  definitions this plan implements.
- `docs/design/STORAGE_BOUNDARY_V2_CONTRACT.md` lines 170-178 — rollout and
  purge rules this plan must obey.
- `HIGH_LEVEL_DESIGN_FREEZE.md#11-lifecycle-model` — retention semantics that
  govern when V1 evidence can be released.
- `BACKLOG.md` lines 51-108 — R41 (Phase 1-5) closure record.
