---
doc_type: evidence
status: historical
authority: evidence
last_reconciled: 2026-10-11
subject: bounded-full-storage
---

# Bounded Full storage independent system review

## Scope and independence

- Contract/design revision: `docs/contracts/bounded-full-storage.md`, SHA-256
  `e6694d7422d7af11730e901622e741ef41b4a8f94bcd05a4ce858b5b9b31f77e`;
  `docs/plans/bounded-full-storage.md`, SHA-256
  `cb76981384740dd8c1cddb91ea5f7ed5b65c51300f4eb08ffe414bba5938002f`.
  These are the revised drafts read after the author reconciled early review
  findings; implementation remains `not_started` in the reviewed contract.
- Reviewer/context identity: independent agent `/root/storage_system_review`,
  reviewing workspace HEAD `36d209ec878020d80861884a07dfc8217be4461a` plus the
  explicitly identified uncommitted proposal and evidence.
- Assigned lens: system consistency, frozen semantics and storage/canonical
  ownership, especially the first delivery's recall, reuse, index validity and
  original-capture integrity.
- Independence basis: this context did not author the proposal or implementation,
  did not inspect the author's conversation history or other review proposals,
  and independently read the authorities, relevant source paths and supplied
  measurements. Author follow-ups identified proposed corrections; this review
  checked those corrections against source and ran its own negative probes.
- Required and achieved: **yes** for this Phase 3 system-consistency lens under
  `PIPELINE.md`. This is one lens, not the required three-lens synthesis or a
  post-implementation Phase 7 evaluation.

## Inputs

- Frozen semantics and architecture: `HIGH_LEVEL_DESIGN_FREEZE.md` §§4.1,
  6.3, 9.3, 9.5, 10.4, 11, 12, 16 and 17; `ARCHITECTURE.md` dependency
  direction, ownership matrix and evidence-preserving boundary;
  `docs/README.md`; `PIPELINE.md` Phase 3; current
  `docs/contracts/source-absence-retention.md`.
- Shared domain summary and fixtures:
  `docs/evidence/2026-10-11-storage-cost-assessment.md`,
  `docs/evidence/2026-10-11-storage-cost-results.json`,
  `docs/evidence/2026-10-11-storage-longuser-reproduction.json`, existing
  `mock_data/` (51 files at inspection), and
  `scripts/oneoff/measure-storage-cost.mjs`'s six generated profiles. The harness
  has sequential workers, isolated generated roots, retained-input hash checks
  and `finally` cleanup; its measurements do not establish production capacity.
- Proposal and verification evidence: the contract/plan above; canonical
  search/linker/fallback code; Full SQL readers/schema/mutation boundaries;
  CLI orchestration; adapter stat/checksum/profile/append gates; evidence
  materialization, liveness and bundle export paths; relevant existing test
  categories. Two additional isolated negative probes are recorded below.
- Shared original measurements remain the baseline. Concurrent routine repair
  of `packages/canonical/src/search.ts`, Full search SQL and associated guards
  was visible during review; this report does not certify that repair's tests
  or report pre-change measurements as post-change results.

## Findings

| Finding | Severity | Evidence | Required action |
|---|---|---|---|
| The staged architecture preserves frozen product meaning. User input and exact parser bytes remain retained; canonical owns linking/search; storage owns derived durable indexes; the current absence contract stays authoritative. | Design pass | Reviewed contract's scope, ownership, migration and later-delivery gates; freeze §§4.1, 9.3, 9.5, 11, 17; architecture ownership matrix. | Keep the first delivery additive. No eviction, compression, chunk manifests, append checkpoints or semantic Lite cutover can be reported implemented by this design approval. |
| Complete canonical recall must be repaired at both the SQL reader and shared candidate materialization boundary. Changing the SQL column alone leaves the shared search candidate truncated. | High, existing correctness defect | Baseline long-user JSON: full text retained but tail search has zero matches globally and by project. `packages/storage/src/queries/search.ts:205`; `packages/canonical/src/search.ts:120`. During review both paths were being repaired by the author. | Keep complete canonical text in search candidates, reserve `boundSearchCanonicalText` for scan hints, never fall back to raw-only masked text, and run category guards for long Unicode tails, empty canonical text, literal punctuation, paths, ranking/highlights and global/project/Full/Lite parity. No search-speed claim follows merely from restoring correctness. |
| An upfront metadata write can discard a genuine parser-profile rebuild for a stat-stable old Codex file. | High, independently reproduced | `apps/cli/src/commands/sync.ts:1324` selects thin metadata from stat; `:1339` fixes the write kind; `:1410` and `:1433` retain that classification. Adapter `packages/source-adapters/src/core/probe.ts:1018` rejects old profile reuse and parses, but metadata update in `packages/storage/src/ingest/source-payload.ts:524` writes no derived rows. Probe A below observed a metadata write containing three records and one rebuilt turn. | The revised contract correctly adds profile agreement and actual-output validation to the first delivery. Implement that guard before broadening stable-stat reuse; a rebuilt/evidence/error-bearing payload must merge normally. Combine stable-old stat identity and obsolete profile in one regression, rather than relying on separate parser and stat tests. |
| Thin reuse needs explicit per-origin behavior and an intact authoritative lifecycle path. | High implementation gate | `sync.ts:638` currently hydrates all selected non-Codex history below a global threshold; `probe.ts:1125` determines metadata-only state for the entire payload. `sync.ts:751` deliberately avoids pure metadata writes when a complete inventory needs reconciliation. `evidence-store.ts:1745` computes ledger/session/turn axes, including cross-file sessions. `updateSourceSyncMetadata` alone does not reconcile presence. | Partition or mark thin/full reuse per origin; stat-stable files avoid heavy preload while changed origins keep append inputs under existing policy. Independently validate mixed stable/new/appended paths, complete absence, unchanged reappearance, partial/error/root-missing scans, source health and shared-session contributors. Keep the high-file-count fallback. Check projection-change reporting and zero retained-row/cache/context churn on true unchanged sync. Preserved-origin safeguards mean mixed thin/full is a risk to test, not an independently demonstrated history-deletion defect. |
| A durable resolved index requires comprehensive, semantic invalidation and a versioned validity identity. | High implementation gate | `internal/storage.ts:2183` currently trusts a process-local snapshot; `:2416` depends on sessions, turns, candidates, overrides and canonical fallback. `canonical/fallback-projects.ts:13` additionally consumes source `base_dir`, turn lineage and captured-blob origins. SQL lifecycle writes, import/backfill, purge and direct migration paths bypass ordinary in-memory invalidation. | Store only complete resolved decorations and deterministic ordinal, not copied turn bodies/context/lineage. Pin index/linker version plus mutation generation, publish rows and validity atomically, and observe external changes in all retained linker caches. Cover source linker fields, captured origins, session/candidate/override/turn/lineage and persisted project mutation. Health-only source UPSERT must avoid INSERT OR REPLACE invalidation churn. Test direct SQLite writes, two open readers/writers, restart, failed preparation, version changes, imports, overrides, source absence/reactivation and purge. This detail implements the revised contract; an arbitrary JavaScript callback list does not satisfy it. |
| Page/detail reads must preserve one coherent canonical result and the exact current order. | High implementation gate | `listResolvedTurnsPage` and `getResolvedTurn` currently use the same whole canonical snapshot (`internal/storage.ts:910`, `:1006`). `internal/queries.ts:468` orders turns by `submission_started_at DESC, created_at DESC, turn_id ASC`; `canonical/project-linker.ts:130` maps that order rather than sorting it again. Current `refreshDerivedState` derives before taking its writer reservation (`storage.ts:2439`), which cannot simply be copied for index publication. | The revised contract correctly requires reservation before preparation and a single database snapshot for validity/count/order/link fields/body hydration. Equality tests must include all resolved fields, candidate references, confidence, path text, lineage, total and ties. Do not silently add active-only filtering to these existing unrestricted methods. Preserve or explicitly validate existing offset/limit edge semantics: SQL negative offsets/limits differ from Array.slice. Test reads concurrent with mutation so a ready check cannot precede a different-generation body fetch. |
| Verified archive reuse must cover every raw materialization consumer, including bundle export. | High, independently reproduced | `evidence-store.ts:1871` consults native paths and otherwise creates a record snapshot; original captures already exist by `(source_id, blob_id)` in `evidence_captures`. `apps/cli/src/bundle.ts:151` and `:843` copy native paths without checking the old checksum or accessing the archive. Probe B exported 796 bytes for an old 460-byte blob, then failed with ENOENT after native deletion. Streaming materialization at `evidence-store.ts:887` and V1 sidecar backfill are also raw-byte consumers. | The revised contract correctly brings verified archive-fed export and all materialization paths into the first delivery. Use one storage-owned lookup constrained to the intended source/blob and `capture_kind=source_blob`; verify retained SHA-256, expected size and source checksum before accepting bytes. A record snapshot never becomes original raw input. Keep original refs/capture identity alive, and fail/report corruption rather than silently blessing it. Require append/delete export-import exact-byte/hash checks, corrupt/missing archive and changed-path guards, forced GC and both prune-site liveness checks. No new evidence-ref column is needed for this delivery. |
| V2 completeness and binary compatibility are separate from index availability. | High implementation gate, reconciled in reviewed draft | The V2 reader uses full sidecar fields, while this workspace's assessed V1 store has no V2 rows. `db/schema.ts:209` already rejects a future schema version. The initial draft's “old code ignores additive state” could leave old writers and index rebuilds ambiguous; the reviewed revision advances schema and names compatible-backup rollback. | Add an actionable V1 migration-required guard and prove it on a generated legacy store before index schema preparation. Test incomplete V2 coverage rather than only an empty fresh store. Advance schema identity; test older fresh connections rejecting upgraded stores and pre-existing writers firing installed invalidation triggers. Rollback must use a compatible backup; do not execute the operator V1 migration as part of this first delivery. |

The final reviewed revision also explicitly pins index format/linker identity
and refuses `ready` when required retained lineage is missing or corrupt. This
is necessary because `internal/queries.ts:364` currently substitutes empty
lineage arrays after a failed blob read, while fallback project derivation uses
`turn.lineage.blob_refs`. Index preparation must distinguish an optional absent
legacy sidecar from required missing evidence, preserve a dirty marker on
failure, and succeed after that evidence is repaired. The contract also now
states full canonical scan cost in text bytes and count/deep-offset/cold-index
cost in index size; it makes no constant-time search promise.

### Probe A: stable file plus obsolete parser identity

An inline Node ESM probe ran with
`node --import ./scripts/install-node-sqlite-warning-filter.mjs --input-type=module`.
It imported the existing compiled CLI, storage and adapter outputs; no build or
service was started. The fixture used three sanitized Codex JSONL records
(session metadata, one user message, one assistant message), mtime
`2026-01-01`, and an isolated generated store.

Reproduction procedure:

1. Use `mkdtemp("cchistory-system-review-")`, override only worker-local
   `os.homedir`, and assert the selected Codex root is under that directory.
   Seed `.codex/sessions/old-stable.jsonl` and run
   `runCli(["sync", "--store", generatedStore, "--source", "codex", "--json"])`.
2. Open only the generated SQLite store and change all retained stage-run
   `parser_version` values to `obsolete-independent-review-profile`. Do not
   touch the source file or its stat identity.
3. Wrap `CCHistoryStorage.prototype.updateSourceSyncMetadata` to observe the
   incoming payload, delegate to its real implementation, and repeat sync.
4. Assert that the metadata writer received a nonempty rebuilt payload. Restore
   the prototype and `os.homedir`, and recursively remove the fixture root in
   `finally`.

Observed output, exit code 0:

```json
{
  "metadata_payloads": [{
    "records": 3,
    "fragments": 4,
    "turns": 1,
    "parser_versions": ["codex-parser@2026-07-19.1"]
  }],
  "turns": [1]
}
```

The negative observation is the writer receiving full new derivation and
discarding its rows, not a dropped turn count: identical fixture content keeps
the old count at one. Existing `commands-diagnostics.test.ts:552` tests stale
parser identity using recent native files; `:692` separately tests stable old
metadata reuse. Their combination is the uncovered category.

### Probe B: retained old capture versus native-path bundle copy

A second inline Node ESM probe used the same warning-filter invocation and
isolated root pattern, plus compiled `exportBundle`. It seeded one 460-byte
Codex capture, recorded its old blob ID, appended another user/assistant pair,
and synced to a 796-byte native file. It exported with `includeRawBlobs: true`
and compared the exported old blob to the original bytes. It then deleted only
the generated native fixture and attempted another export. Storage closed,
`os.homedir` restored and every generated source/store/bundle removed in
`finally`.

Observed output, exit code 0 (the probe asserted the current defects):

```json
{
  "old_input_bytes": 460,
  "old_blob_export_bytes": 796,
  "old_input_sha256": "182d988e10c872de27f83c4de29a7985c8603492a4ce9eb9ed7f19e93e5e4ff4",
  "old_export_sha256": "292199891b4b327087128429d928c0b14b570a99b26334f82a111ca1b322a8f7",
  "exact_old_input_preserved_in_bundle": false,
  "after_native_delete_export_error": "ENOENT"
}
```

This is a bundle-boundary defect independently confirmed from executable
behavior. It does not imply the retained content-addressed original was lost.
The supplied six-profile evidence separately verifies original hashes surviving
append and end-of-sync GC. First-delivery archive reuse must carry those exact
bytes to export instead of continuing to copy a changed native path.

## Trade-offs and residual risk

- Recommended approach: first repair complete canonical recall; make stable
  unchanged sync metadata/lifecycle work; add a canonical-derived durable
  decoration/order index with SQLite invalidation and coherent targeted
  hydration; reuse verified original captures through a shared storage boundary
  that also serves raw export. The revised scope is implementable with existing
  ownership and DTOs and requires no frozen-design redesign.
- Rejected alternative and reason: permanently retain the entire resolved
  history in JavaScript to make warm pages cheap. Fresh CLI readers still pay
  whole-history cost, and cross-process mutations invalidate that assumption.
- Rejected alternative and reason: trim canonical user input, fall back to raw
  masked text, delete old captures or label parser/context rows evictable merely
  because they are derived. These choices violate recall, masking or current
  preservation/lifecycle authority.
- Rejected alternative and reason: optimize metadata writes without a complete
  inventory and profile/actual-output guard. That can miss absence/reactivation
  and discard reinterpretation output.
- Residual risk: first index preparation still derives the whole history; fixed
  page bounds hydration afterward, not the cold rebuild. OFFSET work may still
  grow for deep pages. Full-text literal scans and very large single user/session
  inputs remain costs to measure, and changed-file append still uses current
  full previous inputs. A correctness repair is not a capacity/SLO claim.
- Residual risk: corruption outside SQLite can remove lineage/archive files
  independently of a durable row's generation. SQL validity cannot replace
  physical evidence integrity checks and explicit recovery diagnostics.
- Cache eviction, deduplication policy, archive compression/chunks, validated
  append checkpoints and Lite semantic convergence are **not implemented or
  approved for cutover by this evidence**. Later deliveries need their own
  contract details and independent validation, including reference inventory,
  byte reconstruction, export/import, faults/resume, disk headroom and rollback.

## Limitations

- This is design review and two focused pre-change negative probes, not the
  first delivery's passing integration/regression evidence. The six-profile
  benchmark was inspected rather than rerun, and no post-change speed claim is
  made.
- No access to the operator V1 store, native user capture roots or persistent
  services occurred. No package build, root install, heavy parallel process or
  large temporary artifact was run. Each tiny generated probe owned cleanup.
- Existing fixture categories were inspected; their full suite was not executed
  by this reviewer. Direct-write/concurrent-read/failed-index and archive
  round-trip guards remain Phase 4–6 implementation obligations.
- `pnpm run verify:doc-governance` passed after this report was written:
  27 governed documents and 10 templates. This verifies documentation structure,
  not implementation correctness.
- Proposal files were revised during review. The SHA-256 identities above name
  the last reviewed revision; later revisions need separate reconciliation.
- This reviewer wrote only this evidence file and preserved the unrelated
  working-tree changes. This lens cannot close existing R43/R44/R45 review
  blockers, the R46 end state, or the mandatory separate synthesis and final
  fresh-context evaluation.

## Verdict

`PASS` for the **revised first-delivery functional design and frozen-semantics
alignment**, with the category-level requirements above carried into Phase 4
tests and Phase 5 implementation. The initial profile-discard, incoherent-index,
incomplete-producer, legacy-store and raw-export concerns are reconciled in the
reviewed contract's required behavior; the current executable defects remain to
be fixed. This is not an implementation, migration, performance or release pass.

Same-context analysis cannot satisfy mandatory independent-review work; this
evidence supplies only the independently executed system-consistency lens.
