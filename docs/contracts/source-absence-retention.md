---
doc_type: contract
status: current
authority: normative
implementation: implemented
verification_status: partial
last_reconciled: 2026-07-26
supersedes: []
---

# Source absence retention evidence-preservation contract

## Scope and value hierarchy

- Boundary: Full source inventory, capture, merge, lifecycle reconciliation,
  read projection, and evidence GC. Lite is out of scope because it owns no
  durable store. Whole-source identity retirement/host rekey is a separate
  lifecycle boundary and is not changed by this source-origin absence repair.
- Tier 1 user/source input: every successfully captured native source byte and
  its integrity/capture metadata. Upstream absence, scan limits, probe errors,
  and parser failures have no authority to delete it.
- Tier 2 interaction/process evidence: raw records, fragments, atoms, edges,
  candidates, sessions, `UserTurn` rows, turn contexts, loss audits, and their
  lineage. These remain durable when the source file becomes absent.
- Tier 3 derived optimizations: global/source/session cache summaries, search
  indexes, and project-link snapshots. They may be refreshed or rebuilt but
  must project the retained lifecycle state rather than destroy its inputs.

## Authoritative input and derived output

- Authoritative bytes/records: the content-addressed source evidence identified
  by `evidence_blobs.sha256`, its `evidence_captures` row, and the source-file
  ledger identity `(source_id, origin_path)`.
- Integrity mechanism: capture checksum plus SHA-256 content addressing under
  `evidence/blobs/<prefix>/<sha256>`.
- Derived representations: parser rows, `SessionProjection`, `UserTurn`, turn
  context, project-link projection, search candidates, and cache refs.
- Rebuild inputs and version identity: retained source evidence plus the parser
  profile/version recorded by the source-file ledger and stage runs. This
  repair is prospective; reconstructing projections already deleted by an old
  sync requires a separately verified replay/rebuild operation.

## Preservation invariants

- A successful complete inventory that proves a previously current origin path
  is missing performs `current -> source_absent`; it does not add that path to a
  destructive replacement set.
- Inventory is complete only when every source root declared by the adapter,
  including supplemental roots, is available and was traversed without error.
  A missing root makes the whole source inventory non-authoritative for absence.
- The transition retains the source evidence file, `evidence_blobs`,
  `evidence_captures`, source-file ledger identity/current evidence identity,
  captured/raw parser rows, session rows, turn rows, contexts, and lineage.
- The affected ledger, sessions, and turns expose `sync_axis = source_absent`.
  A session remains `current` when any authoritative current origin still
  contributes to it.
- `source_absent` objects remain explicitly browsable and addressable. Default
  active recall/search accepts only `current` and `import_snapshot` unless a
  caller explicitly requests another sync axis.
- Reappearance transitions retained ledgers, sessions, and turns back to
  `current`. An unchanged file may reactivate without destructive reparse; a
  successfully captured changed file follows normal replacement/supersession
  behavior.
- A limited/partial scan, missing source root, probe exception, capture error,
  or parse error is not authoritative proof of disappearance. It preserves the
  last known evidence and projections and reports the operational failure.
- A source-selected probe inventories only the requested source instances; it
  does not traverse unrelated configured roots as a completeness prepass.
- Lifecycle-only reconciliation reports a projection change even when no file
  was reparsed, so global derived projections and operator progress remain
  consistent with the durable lifecycle axes.
- Source health reflects the current probe/inventory result. Retained absent
  sessions and turns contribute historical totals but cannot promote a `stale`
  current source back to `healthy`.
- Within source-origin absence reconciliation, physical purge remains an
  explicit admin-visible operation. End-of-sync GC must not prune evidence
  retained by a `source_absent` capture.

## Evidence reference inventory

| Reference owner/field | Target | Create/update | Export/import | Prune/retire | Guard |
|---|---|---|---|---|---|
| `evidence_captures.evidence_sha256` | `evidence_blobs.sha256` | storage evidence materialization | bundle export/import | both evidence GC sites and source retirement | absence + forced-prune test |
| `parsed_record_spans.evidence_sha256` | `evidence_blobs.sha256` | parser sidecar write | bundle export/import | both evidence GC sites | retained-span test |
| `source_file_ledger.current_evidence_sha256` | `evidence_blobs.sha256` | ledger upsert/reconcile | bundle export/import | GC considers current ledgers; absent liveness is owned by retained capture | absent-ledger/capture test |
| `turn_context_refs_v2.context_evidence_sha256` | `evidence_blobs.sha256` | context materialization | bundle export/import | both evidence GC sites | retained-context test |
| `derived_cache_refs.evidence_sha256` | `evidence_blobs.sha256` | cache refresh | rebuildable | both evidence GC sites | cache refresh regression |
| `user_turns_v2.lineage_blob_sha256` | `evidence_blobs.sha256` | bounded turn upsert | bundle export/import | both evidence GC sites | retained-lineage test |

## Migration, capacity, and cleanup

- Disk/headroom preflight: no whole-store rewrite, evidence duplication, or
  schema migration is required. Retaining rows can increase long-term store
  size relative to destructive behavior; explicit purge remains the capacity
  release mechanism.
- Snapshot/backup and integrity comparison: tests use isolated stores and
  compare database refs plus physical evidence-file existence before/after
  reconciliation and forced prune.
- Idempotency/resume/rollback: repeating the same complete inventory leaves
  already-absent rows unchanged; reappearance is reversible; each storage
  reconcile is transactional.
- Point of no return and human authority: source-origin absence reconciliation
  never crosses to `purged`; only an explicit purge may delete the retained
  evidence and projection governed by this contract.
- Temporary artifact cleanup in `finally`: the test/reproducer that creates the
  isolated store owns recursive cleanup after assertions.

## Acceptance evidence

| Preservation claim | Category-level guard | Fault/round-trip check | Durable evidence |
|---|---|---|---|
| Codex absence retains raw evidence | streaming merge + forced GC test | remove one controlled source file | verification report |
| All merge paths retain derived history | streaming and non-streaming parity tests | complete inventory omits one old path | verification report |
| Partial/error scans cannot infer absence | limited inventory and probe/capture failure tests | omit paths without completeness authority | verification report |
| Lifecycle is reversible | source-absent then reappearance test | unchanged and changed reappearance | verification report |
| Default recall excludes but detail preserves absent turns | storage search/read and API contract tests | default versus explicit sync-axis request | verification report |

## Reconciliation log

- **2026-07-26:** Created the target contract after controlled reproduction
  proved that Codex streaming sync physically deletes source evidence and that
  non-streaming merge deletes retained projections when an upstream path
  disappears.
- **2026-07-26:** Implemented storage-owned lifecycle reconciliation across
  streaming and non-streaming sync, protected failed/partial observations from
  replacement authority, added default/explicit sync-axis search, and verified
  physical evidence survival through forced GC. Verification remains partial
  only because the required independent review is deferred under the user's
  no-subagent instruction for this session.
