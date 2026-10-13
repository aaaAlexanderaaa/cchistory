---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: bounded-full-storage
---

# Bounded Full storage independent engineering-cost review

## Scope and independence

- Contract/design revision: working-tree `docs/contracts/bounded-full-storage.md`,
  SHA-256 `5f403ce79b36d4dabc574bf63785d8044d5c6034171784c961dbce0de788c37e`;
  `docs/plans/bounded-full-storage.md`, SHA-256
  `05fb36a7ab46a1663a98e28ef33a3a833b135254276e8dc98efd0e425e11edef`.
  Repository HEAD was `36d209ec878020d80861884a07dfc8217be4461a`.
- Reviewer/context identity: fresh sub-agent `/root/storage_cost_review`.
- Assigned lens: engineering cost, maintenance burden, and minimum safe
  first-delivery implementation.
- Independence basis: this context did not author the proposal, assessment,
  harness, or implementation. It received shared inputs and inspected source
  directly; it did not read another chat's history or delegate the review.
- Required and achieved: yes, for this Phase 3 lens. Three-lens synthesis and
  post-implementation evaluation remain separate requirements.
- The proposer supplied a design supplement during review: decoration-only
  turn/session indexes plus ordinal; SQL triggers; coherent page/detail reads;
  schema-version upgrade with old-binary write rollback prohibited; changed-only
  heavy preload with per-origin metadata-only probe entries. These are proposed
  mitigations, not verified implementation. The findings below distinguish them
  from the reviewed document revision.
- A final read of the reconciled documents produced contract SHA-256
  `aaf92b91ba09104b7e69dbffbaf8a08c99eb407c6194b954ebc52cd2a92ac7fb`
  and plan SHA-256
  `757614e985be9e2cfbea8b89702867ea9bd6df958a600e849420fcfeb42170b9`.
  Their reconciliation is recorded after the findings; the findings preserve
  what the initial review discovered.

## Inputs

- Frozen semantics and architecture: `HIGH_LEVEL_DESIGN_FREEZE.md` §§ 4.1,
  9.3, 9.5, 10.4, 11, 12, 16, 17; `ARCHITECTURE.md` dependency direction,
  ownership matrix and evidence boundary; `docs/README.md`; `PIPELINE.md`;
  `docs/contracts/repository-governance.md`.
- Current lifecycle authority: `docs/contracts/source-absence-retention.md`.
- Shared assessment and fixtures:
  `docs/evidence/2026-10-11-storage-cost-assessment.md`,
  `docs/evidence/2026-10-11-storage-cost-results.json`,
  `docs/evidence/2026-10-11-storage-longuser-reproduction.json`, existing
  `mock_data`, and the six generated profiles defined by
  `scripts/oneoff/measure-storage-cost.mjs`.
- Source inspected: storage schema, facade, V2 readers, search, evidence
  materialization, ingest and GC; CLI sync; adapter incremental probe; canonical
  linker and fallback observations; API local ingest and remote-agent upload.
- Evidence class: independent design/source review plus read-only consistency
  inspection of existing measurement JSON. No new runtime performance claim.

## Findings

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| C1. Full canonical scanning repairs eligibility but has an explicit byte-cost boundary. | Medium | `queries/search.ts::scanSearchCandidateRows` selects full canonical text. `internal/storage.ts::searchTurnsPaginated` matches before source/lifecycle/project filters and computes exact total across the scan. Project-scoped search additionally builds `cachedSearchLinkedTurnsById` from the entire resolved snapshot. | Keep the correctness repair. State that fallback search remains O(total scanned canonical bytes), with retained text proportional to the page/offset candidate buffer and largest messages. When the resolved index exists, push safe source/lifecycle/project filters into SQL before hydrating text; preserve canonical matcher, ranking and highlights. Do not call this first delivery bounded search. |
| C2. Thin reuse must be per origin, with an independent complete-inventory lifecycle pass. | High | CLI sync currently preloads all selected Claude files below the threshold; Codex's metadata-only fast path requires old mtimes and a wholly stable batch. `core/probe.ts::buildPreviousSourceIndex` uses one global `metadataOnly` flag. `updateSourceSyncMetadata` writes no absence/reactivation state. | Adopt the supplied changed-only heavy preload/per-entry metadata-only supplement. Keep stat identity and parser-profile checks; unstable/changed files retain the current full-parse/append fallback. Reconcile authoritative inventory even when every file is metadata-only; partial/error inventory never establishes absence. |
| C3. An unconditional source INSERT trigger defeats unchanged-sync savings. | High | `ingest/source-payload.ts::updateSourceSyncMetadata`, merge and streaming merge write `source_instances` with `INSERT OR REPLACE`, including health/timing-only updates. The supplied source UPDATE field comparison does not prevent an INSERT trigger from marking the index dirty for these replacements. | Use an UPSERT/update path that compares linker-relevant fields, or an equivalent explicit producer rule. Invalidation should change the marker only while it is ready. Prove repeated unchanged sync leaves index readiness/generation and retained rows unchanged, allowing only small operator metadata writes. |
| C4. Index inputs include fallback evidence outside the obvious turn/session/candidate/override tables. | High | `internal/storage.ts::computeProjectLinkSnapshot` calls `canonical/fallback-projects.ts`, which reads `source.base_dir`, captured blob origin paths, and full turn lineage refs. `backfillSourceV2Sidecars` and `getDatabaseForMigration` bypass the facade's JavaScript invalidation. V2 readers warn and fall back to empty lineage refs on missing/corrupt files. | The supplemented trigger approach is suitable, provided its producer map includes fallback inputs, source retirement/rekey, V2 backfill/direct migration, import/remote upload, lifecycle reconciliation and GC. Pin index/linker format identity so a code-only semantic change cannot reuse an old ready index. Do not persist a transient missing/corrupt fallback-lineage interpretation as ready; retain dirty/error state until required evidence can be read. |
| C5. A durable dirty marker alone does not make current JavaScript caches or snapshot preparation coherent. | High | Current `refreshDerivedState` computes and assigns `cachedProjectLinkSnapshot` before `BEGIN IMMEDIATE`. `buildProjectLinkSnapshot`, `getSearchLinkedTurnsById`, `getProjectsById` and related maps only consult process-local state. | Begin preparation's coherent transaction before deriving the snapshot; publish persisted index and validity together and publish JavaScript caches only after commit. Track a durable publication generation or database change signal for every dependent cached path, including search/list methods. Page ID selection, total and body hydration must share a read snapshot. |
| C6. The additive schema/rollback promise needs one compatibility decision. | Medium | The plan says old code ignores additive state. `db/schema.ts::initializeStorageSchema` rejects a future `schema_version`; triggers/index versioning are new schema behavior. The supplement correctly proposes a schema upgrade and prohibits direct old-binary write rollback. | Reconcile the plan's rollback text before material implementation. Keep old writers out through the existing schema gate, test rejection, and specify generated-store backup/restore or removal of reconstructible state as the rollback boundary. Additive data is reversible; binary compatibility is not automatic. |
| C7. Verified archived reuse must precede all capture paths, including streaming and backfill. | High | `materializeBlobEvidence` tries supplied/native bytes then creates `record_snapshot`; `streamV2SidecarsFromV1` has another native-first branch. Streaming merge separately calls `materializeBytesStream` when `sourceBlobIsStreamable` finds an existing captured path above 64 MiB. That predicate checks neither the old capture's checksum nor size, and the streaming materializer computes new SHA-256 without checking `blob.checksum`. | Centralize lookup of the same retained `source_blob` capture by source/blob identity, checksum and size; verify physical bytes against both archive SHA-256 and source checksum before acceptance. Cover all non-streaming, streaming and backfill callers. A historical blob whose native file has appended must never be assigned current native bytes. Missing/corrupt archive follows guarded native/snapshot/error handling without relabeling parser output as source input. |
| C8. A thin index is the simplest safe read repair, but it must preserve the complete decoration and existing order. | Medium | Canonical `decorateTurn` sets seven fields: project ID/ref, link state, project link state, confidence, candidate IDs and path text. It maps input order rather than independently sorting turns. V2 input order is submission descending, creation descending, ID ascending. | Persist decoration plus snapshot ordinal; hydrate requested turns through the existing full V2 reader, including required lineage, then overlay exact decoration. Store null/undefined/array distinctions losslessly. Preserve unrestricted calls and count/order parity. Do not copy canonical/raw text, user messages, context or lineage into another payload index. |
| C9. The six profiles support mechanism prioritization, not the missing failure/scale guards. | Medium | Recorded data shows 1,005/4,005 total turns after append and 20-row pages; both long-user tail searches return zero against one expected. Tool profiles use about 25 MiB input, below the 64 MiB streaming branch. JSON records absence/GC integrity checks from the original run, not a new independent reproduction. | Add focused guards for mixed stable/changed batches, recent/old files, parser mismatch, reappearance, direct SQL writes, second open connection, rollback, ties, missing/corrupt archive and >64 MiB historical capture. Compare reopened ready-index reads separately from cold preparation; record unchanged SQL churn and long-canonical search costs. |

The reconciled contract now explicitly addresses coherent preparation/cache
publication (C5), mixed per-origin reuse and parser mismatch (C2), health-only
source UPSERT (C3), schema/backup rollback (C6), and streaming/backfill/raw-bundle
capture coverage (C7). These are resolved at proposal level, with implementation
guards still required. C4's complete producer scope is substantially reconciled;
index format/rule identity and rejection of incomplete fallback-lineage
preparation remain explicit items for synthesis/implementation. C1, C8 and C9
remain bounded performance/acceptance requirements, not reasons to change the
selected layering.

## Trade-offs and residual risk

The recommended first delivery keeps SQLite and current retained parser/context
representations. Full canonical scanning is a small repair under the existing
recall contract. Per-origin reuse and a decoration-only SQLite index remove
avoidable hydration without introducing an alternate linker or cache-retention
policy. Verified historical capture reuse removes the record-snapshot fallback
duplication demonstrated by long append, while preserving each original byte
version. These changes have a manageable implementation surface if they share
one validity owner and one archived-capture helper.

The minimum producer inventory for the resolved index is:

| Canonical input / mutation boundary | Safe initial invalidation rule and guard |
|---|---|
| `user_turns_v2` | Insert/delete and actual relevant changes invalidate; includes membership/order, session/source IDs, linkage/lifecycle, activity, path and lineage identity. Guard lifecycle-only update, archive/purge and V2 backfill. |
| `sessions` | Insert/delete and changed canonical input payload invalidate. Guard source metadata, host/workspace, activity and imported sessions. |
| `derived_candidates` | Project-observation insert/delete/update, including kind transitions, invalidate. Conservatively all changed candidates is safe but adds rebuild cost. Guard observation override and removal. |
| `project_manual_overrides` | Insert/update/delete invalidate. Guard turn, session and observation targets. |
| `source_instances` | Identity/base-dir changes and relevant insertion/removal invalidate; health/count/timing-only metadata does not. Guard `INSERT OR REPLACE` semantics explicitly. |
| `captured_blobs` and turn lineage identity | Changes affecting blob-origin fallback invalidate; complete lineage reads remain required during preparation. Guard fallback-only Cursor/Antigravity sessions, retirement and migration. |
| Derived `project_current`, index tables, stage runs and cache refs | These are not independent linker inputs. External project projection writes must invalidate dependent project caches; conservative index invalidation is acceptable. Do not create publication trigger cycles or dirty the index merely when writing operator statistics. |

Triggers provide coverage for direct SQL producers more cheaply than duplicating
manual invalidation across every facade. A single state row should become dirty
once per dirty interval rather than receive a write for every inserted turn.
A publication generation and format/rule version make restart and long-lived
cache behavior inspectable. SQL alone should not reproduce canonical linking.
Test through observable page/detail/search results and row stability; the
producer matrix is the maintenance checklist when later schema inputs change.

Use one `BEGIN IMMEDIATE` for a required rebuild, derive from its snapshot,
write the small projection, and commit validity. Ready reads can use a read
transaction. Failed preparation leaves the previous projection untrusted and
dirty. Avoid holding a whole canonical snapshot merely because an indexed page
was requested. Existing global methods can remain unrestricted, but their
retained JavaScript caches need the same cross-process validity discipline.
`COUNT(*)` and deep `OFFSET` can still cost O(index rows/offset); page hydration
being bounded does not imply constant total query time. A prepared exact count
is a possible small derived-state optimization if measurement warrants it.

Archived reuse should first consult immutable capture identity, not the current
source-file ledger, which now points at the newest version. Reuse only verified
`source_blob` bytes as raw input; a `record_snapshot` has a different evidence
kind. Prefer one shared verifier with containment, regular-file, size, SHA-256
and source-checksum checks. Retaining bytes for span construction is acceptable
for the existing bounded-buffer path; large-file verification needs streaming
hashing or an explicitly measured fallback. No verified-reuse flag may bypass
integrity merely because an `evidence_captures` row exists.

Rejected alternatives are a second full `UserTurn` payload store, SQL-owned
linking logic, blanket heavy preload, and raw capture replacement by current
native bytes. They respectively recreate storage duplication, fork semantics,
preserve the measured memory cost, or break historical integrity. Broad cache
eviction, append checkpoints and chunked/compressed archives remain gated:
current absence authority retains derived history, and bundle/debug/replay
consumers still depend on it. The first delivery cannot authorize their removal.

Residual costs are cold whole-history index preparation, changed-file append
materialization, exact fallback text scanning and immutable whole-file archive
growth. The plan acknowledges these boundaries. The >64 MiB historical capture
branch and cross-process cache behavior need explicit first-delivery guards
because the supplied benchmark does not exercise them.

## Limitations

- No implementation, contract, fixture or user-store changes were made by this
  reviewer. Only this evidence document was written. The local V1 store was not
  opened; no persistent service, install or build was started.
- Measurement JSON and the harness were inspected read-only. Their counts and
  failure records agree with the assessment; the already-cleaned generated
  evidence files were not independently rehashed and the benchmark was not rerun.
- The working tree contained other active changes, including a full-canonical
  search repair. Its presence is not a passing implementation/test claim here.
- This review covers engineering cost and source-derived risks. It does not
  replace the system-consistency/user-operator reviews, their fresh synthesis,
  or Phase 7 evaluation of the implemented revision.
- Document validation: `pnpm run verify:doc-governance` passed, reporting
  26 governed documents and 10 templates. This validates document structure,
  not the storage behavior or proposal's implementation.

## Verdict

`PARTIAL`

The first-delivery direction is implementable at reasonable cost and preserves
the frozen ownership model. The supplied thin-index/per-entry-reuse supplement
is the recommended path. The final document revision resolves most proposal
gaps; C4's index-version and evidence-completeness detail and C2–C7's behavioral
guards remain required before the corresponding cutover. This independent lens
is complete and ready for synthesis; implementation, objective closure and the
later retention/archive gates remain unverified.
