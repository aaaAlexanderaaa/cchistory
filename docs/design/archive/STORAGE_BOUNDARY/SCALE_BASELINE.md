# Storage Boundary Scale Baseline (C.1)

Reference baseline for the storage-boundary migration defined in
[MIGRATION_PLAN.md](./MIGRATION_PLAN.md) § C.1.

Captured with `scripts/collect-scale-baseline.mjs` against the same fixture
used by `scripts/verify-scale-recall.mjs` (12 sessions × 100 turns × 2 sources
= 2400 turns across 24 sessions).

Generated: 2026-06-23T17:08:15.487Z

## Timing (ms)

| Phase | Milliseconds |
| --- | ---: |
| first sync (initial population) | 2455 |
| unchanged sync (everything reused) | 1707 |
| append sync (+5 turns) | 1783 |
| search (fallback substring — A.1 leaves FTS5 inert until rebuild) | 1433 |
| context-detail reconstruction | 405 |

## Disk Footprint (bytes)

| Resource | Bytes |
| --- | ---: |
| WAL peak (sampled during first sync) | 28,664,808 |
| WAL final (after all syncs) | 0 |
| main SQLite file | 47,955,968 |
| evidence_blobs.total_bytes (DB sum) | 4,294,565 |
| evidence/blobs/ on-disk | 4,294,565 |

## Peak RSS (bytes, sampled via /proc/<pid>/status)

The V1→V2 migration's purpose is to solve OOM and rate issues, so memory
is a first-class axis. 0 means /proc was unavailable (non-Linux host);
treat as "not available" rather than "0 bytes."

| Phase | Peak RSS |
| --- | ---: |
| first sync (initial population) | 260,677,632 |
| unchanged sync (everything reused) | 246,988,800 |
| append sync (+5 turns) | 254,775,296 |
| search | 110,424,064 |
| context-detail reconstruction | 141,918,208 |

## Per-table Row Counts and payload_json Bytes

| Table | Rows | payload_json bytes |
| --- | ---: | ---: |
| artifact_coverage | 0 | — |
| atom_edges | 2 | 557 |
| captured_blobs | 25 | 12,983 |
| conversation_atoms | 8,460 | 4,642,092 |
| derived_cache_refs | 208 | — |
| derived_candidates | 7,239 | 3,532,130 |
| evidence_blobs | 4,836 | — |
| evidence_captures | 26 | — |
| import_bundles | 0 | — |
| knowledge_artifacts | 0 | 0 |
| loss_audits | 0 | 0 |
| migration_state | 0 | — |
| parsed_record_spans | 4,836 | — |
| project_current | 8 | 4,724 |
| project_lineage_events | 10 | — |
| project_link_revisions | 9 | — |
| project_manual_overrides | 0 | — |
| raw_records | 4,836 | 2,871,568 |
| schema_meta | 57 | — |
| schema_migrations | 10 | — |
| sessions | 24 | 16,140 |
| source_file_ledger | 24 | — |
| source_fragments | 8,472 | 4,489,758 |
| source_instances | 2 | — |
| stage_runs | 16 | 11,868 |
| tombstones | 0 | — |
| turn_context_refs_v2 | 2,405 | — |
| turn_contexts | 2,405 | — |
| user_turns | 2,405 | 5,607,229 |
| user_turns_v2 | 2,405 | — |

## Acceptance

Phase C.2 was skipped; see `MIGRATION_PLAN.md` § Phase C.2.
The operator-store observation below is the closing evidence.

## Operator Store Post-Compact Observation

Captured 2026-07-02 against `/root/.cchistory/cchistory.sqlite`. V1 turn
tables (`user_turns`, `turn_contexts`) are absent from `sqlite_master`;
`v1TurnTablesExist()` returns `false`.

### Migration markers (all `completed`)

| Marker | Completed |
| --- | --- |
| `storage-boundary.write` (6 sources) | 2026-06-22 |
| `storage-boundary.validate` (bundle-byte-diff) | 2026-06-23 |
| `storage-boundary.validate` (v1-payload-digest) | 2026-06-24 |
| `storage-boundary.compact` | 2026-06-24 (40.6s) |
| `storage-boundary.vacuum` | 2026-06-24 (5m44s) |

### Disk footprint

| Resource | Size |
| --- | ---: |
| Main SQLite file | 5.4 GiB |
| Evidence blobs on-disk | 3.1 GiB |
| WAL / SHM | 0 / 32 KiB |

### Row counts (V2 only)

| Table | Rows |
| --- | ---: |
| `user_turns_v2` | 3,879 |
| `turn_context_refs_v2` | 3,879 |
| `raw_records` | 461,504 |
| `source_fragments` | 829,604 |
| `conversation_atoms` | 828,832 |
| `evidence_blobs` | 10,022 |
| `captured_blobs` | 2,111 |

### Schema

`schema_version = 2026-06-30.1`. `schema_migrations` contains
`2026-06-24.1/b6-drop-v1-turn-tables` (recorded at compact time, not
schema-apply time — see migration plan B.6 for why).

