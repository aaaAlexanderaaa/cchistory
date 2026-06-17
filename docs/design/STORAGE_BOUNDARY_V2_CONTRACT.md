# Storage Boundary V2 Contract

Status: side-by-side implementation contract for the Phase 1-5 storage boundary
work described in `docs/design/STORAGE_BOUNDARY_AUDIT.md`.

`HIGH_LEVEL_DESIGN_FREEZE.md` remains the product source of truth. This contract
does not change product semantics: evidence is preserved, `UserTurn` remains the
primary recall object, and UI/API/TUI/CLI reads remain projections of the same
canonical model.

## Boundary Goals

V2 separates five storage responsibilities that V1 currently stores together as
large `payload_json` rows:

1. evidence content storage
2. source-file ingestion ledger
3. bounded canonical read models
4. rebuildable derived/debug caches
5. lifecycle and admin metadata

During the side-by-side rollout, V1 tables remain populated. V2 rows and files
are additive and must not require destructive migration or compaction.

## Core Objects

### EvidenceBlob

Content-addressed raw or derived evidence bytes.

Required fields:

- `sha256`: content key and logical blob id
- `storage_path`: path relative to the store asset directory
- `size_bytes`
- `media_type`
- `encoding`
- `compression`: `none` for the first implementation
- `created_at`

The first implementation stores plain files under
`evidence/blobs/<sha-prefix>/<sha256>`.

### EvidenceSpan

A reference to a byte or logical range within an `EvidenceBlob`.

Required fields:

- `evidence_sha256`
- `span_kind`: `bytes`, `line`, `json_pointer`, or `logical_record`
- `start_byte` and `end_byte` when byte offsets are proven
- `span_label` for source-native offsets, JSON pointers, or logical record ids
- `source_id`, `blob_id`, and optional `record_id`

Byte offsets are written only when the parser can prove them. Unknown or
source-native offsets remain traceable as labels rather than being guessed.

### SourceFileLedger

Current observed state for one source file or virtual source object.

Required fields:

- `source_id`
- `origin_path`
- `current_blob_id`
- `current_evidence_sha256`
- `source_checksum`
- `size_bytes`
- `file_modified_at`
- `file_changed_at`
- `file_identity_stable`
- `parser_profile_id`
- `parsed_byte_offset`
- `last_valid_jsonl_boundary`
- `last_record_ordinal`
- `last_derived_session_refs`
- `sync_axis`
- `observed_at`

Append-only reuse is allowed only when file identity, parser profile, prefix
checksum or equivalent source proof, and JSONL line boundary checks prove that
the previous prefix is unchanged. Truncated, rewritten, virtual/live,
database-backed, or parser-profile-changed inputs fall back to scoped reparse.

### ParsedRecordSpan

Compact traceability from a `RawRecord` to source evidence.

Required fields:

- `record_id`
- `source_id`
- `blob_id`
- `session_ref`
- `ordinal`
- `evidence_sha256`
- `span_kind`
- `start_byte`
- `end_byte`
- `span_label`
- `parser_profile_id`

V1 `raw_records.payload_json` remains populated during rollout. V2 spans are the
future hot traceability path.

### Bounded UserTurn Read Model

Default CLI/TUI/Web/API read paths require bounded turn rows containing:

- stable turn and revision ids
- source/session/project references
- `canonical_text`
- bounded `raw_text` or raw text refs
- bounded display segments
- source/evidence refs
- path text
- lifecycle axes
- context summary
- lineage refs

The hot budget for serialized V2 turn material is 32 KiB per turn. Material above
that budget belongs in evidence spans or disposable caches. V1 `user_turns` rows
remain populated until a later migration and compact step.

### Reference-First TurnContext

`TurnContext` is logical context, not a requirement to inline all assistant/tool
bytes in hot storage.

Hot V2 context rows may contain:

- counts
- previews
- ordering fields
- raw event refs
- cache/evidence refs
- token and model summaries

Full assistant replies, full tool input, and full tool output are stored in a
content-addressed context cache for on-demand reconstruction. The first
side-by-side implementation uses a 16 KiB inline preview budget per turn context
and leaves V1 `turn_contexts.payload_json` unchanged for compatibility.

### Disposable Derived Caches

Records, fragments, atoms, candidates, and full contexts may have cache entries
when useful for debug, lineage drill-down, or rebuild speed. Caches must be
scoped by source, origin path, session, turn, project, parser profile, or
revision. Cache removal must not remove raw evidence.

## SourceSyncPayload Field Mapping

| Field | V2 destination | Default read required | Notes |
| --- | --- | --- | --- |
| `source` | lifecycle/admin metadata and source-file ledger ownership | yes | Remains in `source_instances` during rollout. |
| `stage_runs` | lifecycle/admin metadata | admin only | Timing and parser profile data also seeds ledger metadata. |
| `loss_audits` | lifecycle/admin metadata | admin only | Kept queryable for source health. |
| `blobs` | evidence store and source-file ledger | lineage only by default | Blob bytes are content-addressed; capture metadata records origin and checksum. |
| `records` | parsed record spans and derived/debug cache | lineage/debug | `raw_json` is V1 compatibility during rollout; spans become the compact V2 trace path. |
| `fragments` | derived/debug cache | lineage/debug | Large text should move to evidence refs or cache before V1 compaction. |
| `atoms` | derived/debug cache and bounded ordering fields | lineage/debug | Keep only enough hot structure for lineage, session ordering, and scoped rebuild selection. |
| `edges` | derived/debug cache | lineage/debug | Small relation rows may remain structured. |
| `candidates` | derived/debug cache and linking inputs | linking and admin | Current project linking still consumes candidates; obsolete details are cacheable. |
| `sessions` | canonical read model | yes | Session rows are default browse/detail references. |
| `turns` | bounded canonical read model | yes | `UserTurn` remains the primary recall/search object. |
| `contexts` | reference-first hot context plus context cache | detail only | Full context is reconstructed from cache/evidence refs during rollout. |

## Rollout Rules

- V2 tables and evidence files are additive.
- Existing V1 rows stay populated through Phase 1-5.
- `raw/` remains a compatibility snapshot area.
- `evidence/` is the V2 content-addressed evidence store.
- No migration may purge old payloads without the later Phase 6 preview,
  validation, and explicit compact step.
- Inventory and diagnostics may report V1 and V2 bytes side by side.
