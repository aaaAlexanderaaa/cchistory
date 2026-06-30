import process from "node:process";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "@cchistory/domain";

export const STORAGE_SCHEMA_VERSION = "2026-06-30.1";

export interface StorageSchemaMigration {
  id: string;
  to_version: string;
  summary: string;
  applied_at: string;
}

export interface StorageSchemaInfo {
  schema_version: string;
  migrations: StorageSchemaMigration[];
}

export interface StorageSchemaInitialization {
  searchIndexReady: boolean;
  searchIndexNeedsRebuild: boolean;
}

const STORAGE_SCHEMA_MIGRATIONS: ReadonlyArray<{
  id: string;
  to_version: string;
  summary: string;
}> = [
  {
    id: "2026-03-20.1/base-schema",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "Create canonical storage tables and indexes for the self-host v1 store.",
  },
  {
    id: "2026-03-20.1/atom-edge-endpoints",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "Backfill atom_edges endpoint columns from persisted payload_json lineage.",
  },
  {
    id: "2026-06-02.1/evidence-query-columns",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "Add indexed evidence columns for source-scoped incremental sync and delete paths.",
  },
  {
    id: "2026-06-03.1/loss-audit-severity-column",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "Add indexed loss audit severity for failure-count aggregation without info diagnostics.",
  },
  {
    id: "2026-06-08.1/storage-boundary-v2-sidecar",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "Add side-by-side content-addressed evidence, ledger, bounded read, and cache reference tables.",
  },
  {
    id: "2026-06-17.1/storage-index-dedup",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "A.3: drop prefix-duplicate session-only indexes whose lookups are served by the (source_id, session_ref) compound indexes via SQLite skip-scan after ANALYZE.",
  },
  {
    id: "2026-06-17.2/migration-state-table",
    to_version: STORAGE_SCHEMA_VERSION,
    summary: "B.2: add migration_state table so Phase B write-migration, validation, and cutover can resume per-source after a crash.",
  },
  {
    id: "2026-06-18.1/user-turns-v2-full-columns",
    to_version: STORAGE_SCHEMA_VERSION,
    summary:
      "B.5.0a: extend user_turns_v2 with the full-content columns (user_messages, raw_text_full, project_id, project_ref, project_link_state, last_context_activity_at, path_text) so V2 can serve read paths that V1 served.",
  },
  {
    id: "2026-06-18.2/user-turns-v2-canonical-text-full",
    to_version: STORAGE_SCHEMA_VERSION,
    summary:
      "B.5.0e: add canonical_text_full to user_turns_v2. Without it, B.5.5 (bundle export) cutover would produce different bundle bytes for the 4.3% of turns whose canonical_text exceeds the 16 KiB scan-hint bound.",
  },
  {
    id: "2026-06-22.1/user-turns-v2-lineage-blob",
    to_version: STORAGE_SCHEMA_VERSION,
    summary:
      "B.5.0g: replace over-bounded lineage_refs_json with full-content lineage via content-addressed blob (lineage_blob_sha256) plus 5 INT count columns. The bounded 8 KiB subset truncates 46% of operator turns (worst-case 1.9 MiB loss, 381K atom_refs dropped). Counts drive list-view density; the blob is fetched lazily when refs are needed. Mirrors turn_context_refs_v2 pattern.",
  },
  {
    id: "2026-06-24.1/b6-drop-v1-turn-tables",
    to_version: STORAGE_SCHEMA_VERSION,
    summary:
      "B.6: drop the V1 user_turns and turn_contexts tables. Both have full V2 replacements (user_turns_v2, turn_context_refs_v2) that became production read sources in B.5.2; capture/archive/replace paths no longer write to V1. Other V1 payload tables (raw_records, captured_blobs, source_fragments, conversation_atoms, atom_edges, derived_candidates, sessions, source_instances, stage_runs, loss_audits) are NOT migrated yet — bundle export and inventory reads still consume their payload_json. The drop is invoked explicitly via `cchistory migration compact --step drop-v1-tables`, not at schema-apply time; this record documents the resulting schema version after the operator runs compact.",
  },
  {
    id: "2026-06-30.1/source-file-ledger-content-watermark",
    to_version: STORAGE_SCHEMA_VERSION,
    summary:
      "Add source_file_ledger.content_max_timestamp (nullable TEXT). Authoritative content watermark from the last JSONL record's .timestamp on codex/claude_code/factory_droid; lets the skip path ignore bulk-external mtime bumps. NULL on legacy rows falls back to L0 mtime gate; lazy backfill on next re-encounter. Pure metadata column — adds no evidence blob ref, so prune sites in gc.ts and retireStorageBoundaryV2Sources are unaffected.",
  },
];

const STORAGE_INDEXES: ReadonlyArray<{
  name: string;
  sql: string;
}> = [
  { name: "idx_stage_runs_source", sql: "CREATE INDEX IF NOT EXISTS idx_stage_runs_source ON stage_runs (source_id)" },

  { name: "idx_loss_audits_source", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source ON loss_audits (source_id)" },
  { name: "idx_loss_audits_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_session ON loss_audits (source_id, session_ref)" },
  { name: "idx_loss_audits_source_blob", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_blob ON loss_audits (source_id, blob_ref)" },
  { name: "idx_loss_audits_source_record", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_record ON loss_audits (source_id, record_ref)" },
  { name: "idx_loss_audits_source_fragment", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_fragment ON loss_audits (source_id, fragment_ref)" },
  { name: "idx_loss_audits_source_atom", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_atom ON loss_audits (source_id, atom_ref)" },
  { name: "idx_loss_audits_source_candidate", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_candidate ON loss_audits (source_id, candidate_ref)" },
  { name: "idx_loss_audits_source_stage", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_stage ON loss_audits (source_id, stage_kind)" },
  { name: "idx_loss_audits_source_diagnostic", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_diagnostic ON loss_audits (source_id, diagnostic_code)" },
  { name: "idx_loss_audits_source_severity_stage", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_severity_stage ON loss_audits (source_id, severity, stage_kind)" },
  { name: "idx_loss_audits_source_failure_stage", sql: "CREATE INDEX IF NOT EXISTS idx_loss_audits_source_failure_stage ON loss_audits (source_id, stage_kind) WHERE severity IN ('warning', 'error')" },

  { name: "idx_captured_blobs_source", sql: "CREATE INDEX IF NOT EXISTS idx_captured_blobs_source ON captured_blobs (source_id)" },
  { name: "idx_captured_blobs_source_origin", sql: "CREATE INDEX IF NOT EXISTS idx_captured_blobs_source_origin ON captured_blobs (source_id, origin_path)" },

  { name: "idx_raw_records_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_raw_records_source_session ON raw_records (source_id, session_ref)" },
  { name: "idx_raw_records_source_blob_ordinal", sql: "CREATE INDEX IF NOT EXISTS idx_raw_records_source_blob_ordinal ON raw_records (source_id, blob_id, ordinal)" },
  { name: "idx_raw_records_blob", sql: "CREATE INDEX IF NOT EXISTS idx_raw_records_blob ON raw_records (blob_id)" },

  { name: "idx_source_fragments_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_source_fragments_source_session ON source_fragments (source_id, session_ref)" },

  { name: "idx_conversation_atoms_source_session_order", sql: "CREATE INDEX IF NOT EXISTS idx_conversation_atoms_source_session_order ON conversation_atoms (source_id, session_ref, time_key, seq_no)" },

  { name: "idx_atom_edges_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_atom_edges_source_session ON atom_edges (source_id, session_ref)" },
  { name: "idx_atom_edges_from", sql: "CREATE INDEX IF NOT EXISTS idx_atom_edges_from ON atom_edges (from_atom_id)" },
  { name: "idx_atom_edges_to", sql: "CREATE INDEX IF NOT EXISTS idx_atom_edges_to ON atom_edges (to_atom_id)" },

  // B.6: idx_user_turns_* and idx_turn_contexts_* referenced the V1 tables
  // that are no longer created at schema-apply time. Removed to keep
  // ensureStorageIndexes from failing on fresh installs. Legacy stores that
  // still have these indexes are unaffected — the IF NOT EXISTS guard means
  // they were already created once and won't be re-attempted.
  { name: "idx_sessions_source", sql: "CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions (source_id)" },
  { name: "idx_project_link_revisions_project", sql: "CREATE INDEX IF NOT EXISTS idx_project_link_revisions_project ON project_link_revisions (project_id)" },
  { name: "idx_project_lineage_events_project", sql: "CREATE INDEX IF NOT EXISTS idx_project_lineage_events_project ON project_lineage_events (project_id)" },
  { name: "idx_artifact_coverage_artifact", sql: "CREATE INDEX IF NOT EXISTS idx_artifact_coverage_artifact ON artifact_coverage (artifact_id)" },
  { name: "idx_artifact_coverage_turn", sql: "CREATE INDEX IF NOT EXISTS idx_artifact_coverage_turn ON artifact_coverage (turn_id)" },
  { name: "idx_derived_candidates_source", sql: "CREATE INDEX IF NOT EXISTS idx_derived_candidates_source ON derived_candidates (source_id)" },
  { name: "idx_derived_candidates_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_derived_candidates_source_session ON derived_candidates (source_id, session_ref)" },

  // A.3: the session-only indexes below were strict prefix duplicates of the
  // source_session compound indexes above. Removed from STORAGE_INDEXES so
  // new stores do not create them; existing stores get them dropped by
  // `dropRedundantSessionIndexes` on the next open. The compound index
  // satisfies both session-only and source-scoped lookups.
  // Dropped: idx_raw_records_session, idx_source_fragments_session,
  //          idx_conversation_atoms_session, idx_atom_edges_session,
  //          idx_derived_candidates_session.

  { name: "idx_evidence_captures_source_origin", sql: "CREATE INDEX IF NOT EXISTS idx_evidence_captures_source_origin ON evidence_captures (source_id, origin_path)" },
  { name: "idx_evidence_captures_source_blob", sql: "CREATE INDEX IF NOT EXISTS idx_evidence_captures_source_blob ON evidence_captures (source_id, blob_id)" },
  { name: "idx_evidence_captures_sha", sql: "CREATE INDEX IF NOT EXISTS idx_evidence_captures_sha ON evidence_captures (evidence_sha256)" },
  { name: "idx_source_file_ledger_source_origin", sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_source_file_ledger_source_origin ON source_file_ledger (source_id, origin_path)" },
  { name: "idx_source_file_ledger_source_checksum", sql: "CREATE INDEX IF NOT EXISTS idx_source_file_ledger_source_checksum ON source_file_ledger (source_id, source_checksum)" },
  { name: "idx_source_file_ledger_parser_profile", sql: "CREATE INDEX IF NOT EXISTS idx_source_file_ledger_parser_profile ON source_file_ledger (parser_profile_id)" },
  { name: "idx_parsed_record_spans_source_blob", sql: "CREATE INDEX IF NOT EXISTS idx_parsed_record_spans_source_blob ON parsed_record_spans (source_id, blob_id)" },
  { name: "idx_parsed_record_spans_session", sql: "CREATE INDEX IF NOT EXISTS idx_parsed_record_spans_session ON parsed_record_spans (session_ref)" },
  { name: "idx_parsed_record_spans_parser_profile", sql: "CREATE INDEX IF NOT EXISTS idx_parsed_record_spans_parser_profile ON parsed_record_spans (parser_profile_id)" },
  { name: "idx_parsed_record_spans_sha", sql: "CREATE INDEX IF NOT EXISTS idx_parsed_record_spans_sha ON parsed_record_spans (evidence_sha256)" },
  // A.3: dropped idx_user_turns_v2_session — idx_user_turns_v2_source_session
  // covers both source-scoped and session-scoped lookups on user_turns_v2.
  { name: "idx_user_turns_v2_source_session", sql: "CREATE INDEX IF NOT EXISTS idx_user_turns_v2_source_session ON user_turns_v2 (source_id, session_id)" },
  { name: "idx_user_turns_v2_submission", sql: "CREATE INDEX IF NOT EXISTS idx_user_turns_v2_submission ON user_turns_v2 (submission_started_at)" },
  // Prune queries LEFT JOIN evidence_blobs against lineage_blob_sha256;
  // without this index every prune is a full table scan of user_turns_v2.
  { name: "idx_user_turns_v2_lineage_sha", sql: "CREATE INDEX IF NOT EXISTS idx_user_turns_v2_lineage_sha ON user_turns_v2 (lineage_blob_sha256) WHERE lineage_blob_sha256 != ''" },
  { name: "idx_turn_context_refs_v2_source", sql: "CREATE INDEX IF NOT EXISTS idx_turn_context_refs_v2_source ON turn_context_refs_v2 (source_id)" },
  { name: "idx_turn_context_refs_v2_sha", sql: "CREATE INDEX IF NOT EXISTS idx_turn_context_refs_v2_sha ON turn_context_refs_v2 (context_evidence_sha256) WHERE context_evidence_sha256 != ''" },
  { name: "idx_derived_cache_refs_scope", sql: "CREATE INDEX IF NOT EXISTS idx_derived_cache_refs_scope ON derived_cache_refs (source_id, scope_kind, scope_ref)" },
  { name: "idx_derived_cache_refs_kind_scope", sql: "CREATE INDEX IF NOT EXISTS idx_derived_cache_refs_kind_scope ON derived_cache_refs (scope_kind, scope_ref)" },
  { name: "idx_derived_cache_refs_parser_profile", sql: "CREATE INDEX IF NOT EXISTS idx_derived_cache_refs_parser_profile ON derived_cache_refs (parser_profile_id)" },

  // B.5.0h: pruneUnreferencedEvidenceBlobsInTransaction LEFT JOINs evidence_blobs
  // against 6 ref tables. The partial indexes above (with `WHERE col != ''`)
  // are not usable by the LEFT JOIN planner — it must consider all rows of the
  // right table, so it falls back to building automatic indexes per query
  // execution. On operator-scale stores (9k+ evidence_blobs × 15k+
  // derived_cache_refs / 380k+ parsed_record_spans), each prune ended up
  // rebuilding 4 automatic indexes per call inside the merge transaction,
  // adding 60-90+ seconds per slow batch. These non-partial indexes give the
  // planner a persistent index to use instead. Idempotent via IF NOT EXISTS.
  { name: "idx_user_turns_v2_lineage_sha_full", sql: "CREATE INDEX IF NOT EXISTS idx_user_turns_v2_lineage_sha_full ON user_turns_v2 (lineage_blob_sha256)" },
  { name: "idx_turn_context_refs_v2_sha_full", sql: "CREATE INDEX IF NOT EXISTS idx_turn_context_refs_v2_sha_full ON turn_context_refs_v2 (context_evidence_sha256)" },
  { name: "idx_source_file_ledger_current_evidence", sql: "CREATE INDEX IF NOT EXISTS idx_source_file_ledger_current_evidence ON source_file_ledger (current_evidence_sha256, sync_axis)" },
  { name: "idx_derived_cache_refs_evidence_sha", sql: "CREATE INDEX IF NOT EXISTS idx_derived_cache_refs_evidence_sha ON derived_cache_refs (evidence_sha256)" },
];

// A.3: indexes that were prefix-duplicates of compound (source_id, ...)
// indexes. They are no longer in STORAGE_INDEXES, but existing stores still
// carry them from before the dedup. Drop them idempotently on next open.
const REDUNDANT_SESSION_INDEXES: readonly string[] = [
  "idx_raw_records_session",
  "idx_source_fragments_session",
  "idx_conversation_atoms_session",
  "idx_atom_edges_session",
  "idx_derived_candidates_session",
  "idx_user_turns_session",
  "idx_user_turns_v2_session",
];

export function initializeStorageSchema(db: DatabaseSync): StorageSchemaInitialization {
  const existingSchemaVersion = readExistingSchemaVersion(db);
  if (existingSchemaVersion && compareStorageSchemaVersions(existingSchemaVersion, STORAGE_SCHEMA_VERSION) > 0) {
    throw new Error(
      `Store schema version ${existingSchemaVersion} is newer than this CCHistory build supports (${STORAGE_SCHEMA_VERSION}). Upgrade CCHistory before writing to this store.`,
    );
  }

  ensureSchemaMetadataTables(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS source_instances (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stage_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loss_audits (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      stage_kind TEXT NOT NULL DEFAULT '',
      diagnostic_code TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT '',
      session_ref TEXT NOT NULL DEFAULT '',
      blob_ref TEXT NOT NULL DEFAULT '',
      record_ref TEXT NOT NULL DEFAULT '',
      fragment_ref TEXT NOT NULL DEFAULT '',
      atom_ref TEXT NOT NULL DEFAULT '',
      candidate_ref TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS captured_blobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin_path TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_records (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      blob_id TEXT NOT NULL DEFAULT '',
      ordinal INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_fragments (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_atoms (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      time_key TEXT NOT NULL,
      seq_no INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS atom_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      from_atom_id TEXT NOT NULL DEFAULT '',
      to_atom_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS derived_candidates (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
      candidate_kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    -- B.6: user_turns and turn_contexts are no longer created at schema-apply
    -- time. Both have full V2 replacements (user_turns_v2, turn_context_refs_v2)
    -- that production reads and writes exclusively. Legacy stores that still
    -- have these tables continue to work — CREATE TABLE IF NOT EXISTS was
    -- idempotent and its removal doesn't drop existing tables. The operator
    -- drops them explicitly via 'cchistory migration compact --step drop-v1-tables'.

    CREATE TABLE IF NOT EXISTS project_current (
      project_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_link_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_lineage_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_manual_overrides (
      id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tombstones (
      logical_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_artifacts (
      artifact_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_coverage (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_bundles (
      bundle_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_blobs (
      sha256 TEXT PRIMARY KEY,
      storage_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      encoding TEXT NOT NULL,
      compression TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_captures (
      id TEXT PRIMARY KEY,
      evidence_sha256 TEXT NOT NULL,
      source_id TEXT NOT NULL,
      blob_id TEXT NOT NULL,
      origin_path TEXT NOT NULL DEFAULT '',
      source_checksum TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL,
      capture_run_id TEXT NOT NULL DEFAULT '',
      host_id TEXT NOT NULL DEFAULT '',
      captured_path TEXT,
      file_modified_at TEXT,
      file_changed_at TEXT,
      file_identity_stable INTEGER NOT NULL DEFAULT 0,
      capture_kind TEXT NOT NULL DEFAULT 'source_blob',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_file_ledger (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      origin_path TEXT NOT NULL DEFAULT '',
      current_blob_id TEXT NOT NULL DEFAULT '',
      current_evidence_sha256 TEXT NOT NULL DEFAULT '',
      source_checksum TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      file_modified_at TEXT,
      file_changed_at TEXT,
      file_identity_stable INTEGER NOT NULL DEFAULT 0,
      parser_profile_id TEXT NOT NULL DEFAULT '',
      parsed_byte_offset INTEGER,
      last_valid_jsonl_boundary INTEGER,
      last_record_ordinal INTEGER,
      content_max_timestamp TEXT,
      last_derived_session_refs TEXT NOT NULL DEFAULT '[]',
      sync_axis TEXT NOT NULL DEFAULT 'current',
      observed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parsed_record_spans (
      record_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      blob_id TEXT NOT NULL DEFAULT '',
      session_ref TEXT NOT NULL DEFAULT '',
      ordinal INTEGER NOT NULL DEFAULT 0,
      evidence_sha256 TEXT NOT NULL DEFAULT '',
      span_kind TEXT NOT NULL DEFAULT 'logical_record',
      start_byte INTEGER,
      end_byte INTEGER,
      span_label TEXT NOT NULL DEFAULT '',
      parser_profile_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_turns_v2 (
      turn_id TEXT PRIMARY KEY,
      turn_revision_id TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      submission_started_at TEXT NOT NULL,
      canonical_text TEXT NOT NULL DEFAULT '',
      raw_text_preview TEXT NOT NULL DEFAULT '',
      raw_text_bytes INTEGER NOT NULL DEFAULT 0,
      display_segments_json TEXT NOT NULL DEFAULT '[]',
      context_ref TEXT NOT NULL DEFAULT '',
      context_summary_json TEXT NOT NULL DEFAULT '{}',
      lineage_refs_json TEXT NOT NULL DEFAULT '{}',
      link_state TEXT NOT NULL DEFAULT '',
      sync_axis TEXT NOT NULL DEFAULT '',
      value_axis TEXT NOT NULL DEFAULT '',
      retention_axis TEXT NOT NULL DEFAULT '',
      payload_bytes INTEGER NOT NULL DEFAULT 0,
      bounded_at TEXT NOT NULL,
      user_messages_json TEXT NOT NULL DEFAULT '[]',
      raw_text_full TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      project_ref TEXT NOT NULL DEFAULT '',
      project_link_state TEXT NOT NULL DEFAULT '',
      last_context_activity_at TEXT NOT NULL DEFAULT '',
      path_text TEXT NOT NULL DEFAULT '',
      canonical_text_full TEXT NOT NULL DEFAULT '',
      lineage_blob_sha256 TEXT NOT NULL DEFAULT '',
      lineage_atom_count INTEGER NOT NULL DEFAULT 0,
      lineage_fragment_count INTEGER NOT NULL DEFAULT 0,
      lineage_record_count INTEGER NOT NULL DEFAULT 0,
      lineage_blob_count INTEGER NOT NULL DEFAULT 0,
      lineage_candidate_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS turn_context_refs_v2 (
      turn_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      context_evidence_sha256 TEXT NOT NULL DEFAULT '',
      cache_storage_path TEXT NOT NULL DEFAULT '',
      assistant_reply_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      system_message_count INTEGER NOT NULL DEFAULT 0,
      preview_json TEXT NOT NULL DEFAULT '{}',
      raw_event_refs_json TEXT NOT NULL DEFAULT '[]',
      full_context_bytes INTEGER NOT NULL DEFAULT 0,
      inline_budget_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS derived_cache_refs (
      id TEXT PRIMARY KEY,
      cache_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      scope_ref TEXT NOT NULL,
      parser_profile_id TEXT NOT NULL DEFAULT '',
      evidence_sha256 TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      payload_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migration_state (
      phase TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      status TEXT NOT NULL,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (phase, scope_kind, scope_id)
    );

    CREATE INDEX IF NOT EXISTS idx_migration_state_phase_status
      ON migration_state (phase, status);
  `);

  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[0]!);
  ensureAtomEdgeEndpointColumns(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[1]!);
  ensureEvidenceQueryColumns(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[2]!);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[3]!);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[4]!);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[5]!);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[6]!);
  ensureUserTurnsV2FullColumns(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[7]!);
  ensureUserTurnsV2CanonicalTextFull(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[8]!);
  ensureUserTurnsV2LineageBlob(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[9]!);
  ensureSourceFileLedgerContentMaxTimestamp(db);
  recordSchemaMigration(db, STORAGE_SCHEMA_MIGRATIONS[11]!);
  setSchemaMeta(db, "schema_version", STORAGE_SCHEMA_VERSION);

  ensureStorageIndexes(db);
  dropRedundantSessionIndexes(db);

  try {
    const searchIndexNeedsRebuild = ensureSearchIndex(db);
    return { searchIndexReady: true, searchIndexNeedsRebuild };
  } catch (error) {
    if (process.env.CCHISTORY_SHOW_RUNTIME_WARNINGS === "1") {
      console.warn(
        "[cchistory/storage] FTS5 unavailable — using fallback substring search.",
        error instanceof Error ? error.message : error,
      );
    }
    return { searchIndexReady: false, searchIndexNeedsRebuild: false };
  }
}

function ensureSearchIndex(db: DatabaseSync): boolean {
  const existingColumns = listTableColumns(db, "search_index");
  const missingIndex = existingColumns.length === 0;
  const schemaNeedsRebuild = existingColumns.length > 0 && !existingColumns.includes("path_text");
  // A prior open that crashed between dropping the old FTS table and finishing
  // the rebuild leaves a current-schema table with zero rows. Schema inspection
  // alone will not detect that — the path_text column is already present, so
  // we also consult a durable marker written before the drop and cleared only
  // after a successful rebuild.
  const crashMarkerNeedsRebuild = readSearchIndexStatus(db) === "needs_rebuild";
  const searchIndexNeedsRebuild = missingIndex || schemaNeedsRebuild || crashMarkerNeedsRebuild;
  if (searchIndexNeedsRebuild) {
    // Set the marker *before* the drop so a crash here is recoverable on next open.
    setSearchIndexStatus(db, "needs_rebuild");
    db.exec(`
      DROP TABLE IF EXISTS search_index;
      DROP TABLE IF EXISTS search_index_config;
      DROP TABLE IF EXISTS search_index_content;
      DROP TABLE IF EXISTS search_index_data;
      DROP TABLE IF EXISTS search_index_docsize;
      DROP TABLE IF EXISTS search_index_idx;
      DROP TABLE IF EXISTS search_index_hashes;
    `);
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      turn_id UNINDEXED,
      project_id UNINDEXED,
      source_id UNINDEXED,
      link_state UNINDEXED,
      value_axis UNINDEXED,
      canonical_text,
      path_text,
      raw_text,
      tokenize = 'unicode61 porter'
    );
  `);
  return searchIndexNeedsRebuild;
}

function listTableColumns(db: DatabaseSync, tableName: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((row) => row.name);
  } catch {
    return [];
  }
}

export type SearchIndexStatus = "ready" | "needs_rebuild" | "unavailable";

const SEARCH_INDEX_STATUS_KEY = "search_index_status";

export function readSearchIndexStatus(db: DatabaseSync): SearchIndexStatus | undefined {
  try {
    const row = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(SEARCH_INDEX_STATUS_KEY) as
      | { value_text: string }
      | undefined;
    const value = row?.value_text;
    if (value === "ready" || value === "needs_rebuild" || value === "unavailable") {
      return value;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function setSearchIndexStatus(db: DatabaseSync, status: SearchIndexStatus): void {
  setSchemaMeta(db, SEARCH_INDEX_STATUS_KEY, status);
}

export function isFutureStorageSchemaVersion(version: string): boolean {
  return compareStorageSchemaVersions(version, STORAGE_SCHEMA_VERSION) > 0;
}

export function readStorageSchemaInfo(db: DatabaseSync): StorageSchemaInfo {
  const versionRow = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get("schema_version") as
    | { value_text: string }
    | undefined;
  const migrations = db
    .prepare("SELECT id, to_version, summary, applied_at FROM schema_migrations ORDER BY applied_at ASC, rowid ASC")
    .all()
    .map((row) => ({
      id: (row as { id: string }).id,
      to_version: (row as { to_version: string }).to_version,
      summary: (row as { summary: string }).summary,
      applied_at: (row as { applied_at: string }).applied_at,
    }));

  return {
    schema_version: versionRow?.value_text ?? STORAGE_SCHEMA_VERSION,
    migrations,
  };
}

function ensureSchemaMetadataTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      to_version TEXT NOT NULL,
      summary TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function readExistingSchemaVersion(db: DatabaseSync): string | undefined {
  const hasSchemaMeta = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("schema_meta") as { 1: number } | undefined;
  if (!hasSchemaMeta) {
    return undefined;
  }

  const row = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get("schema_version") as
    | { value_text: string }
    | undefined;
  return row?.value_text;
}

function compareStorageSchemaVersions(left: string, right: string): number {
  const leftParts = left.split(/[^0-9]+/u).filter(Boolean).map(Number);
  const rightParts = right.split(/[^0-9]+/u).filter(Boolean).map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return left.localeCompare(right);
}

function recordSchemaMigration(
  db: DatabaseSync,
  migration: {
    id: string;
    to_version: string;
    summary: string;
  },
): void {
  const existing = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(migration.id) as
    | { 1: number }
    | undefined;
  if (existing) {
    return;
  }

  db.prepare("INSERT INTO schema_migrations (id, to_version, summary, applied_at) VALUES (?, ?, ?, ?)")
    .run(migration.id, migration.to_version, migration.summary, nowIso());
}

function setSchemaMeta(db: DatabaseSync, key: string, value: string): void {
  const existing = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(key) as
    | { value_text: string }
    | undefined;
  if (existing?.value_text === value) {
    return;
  }

  if (existing) {
    db.prepare("UPDATE schema_meta SET value_text = ?, updated_at = ? WHERE key = ?").run(value, nowIso(), key);
    return;
  }

  db.prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)").run(key, value, nowIso());
}

function ensureStorageIndexes(db: DatabaseSync): void {
  const selectMeta = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?");
  const selectIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");

  for (const index of STORAGE_INDEXES) {
    const migrationKey = `storage_index:${index.name}`;
    const done = selectMeta.get(migrationKey) as { value_text: string } | undefined;
    if (done?.value_text === "done") {
      continue;
    }

    const existing = selectIndex.get(index.name) as { 1: number } | undefined;
    if (!existing) {
      db.exec(index.sql);
    }
    setSchemaMeta(db, migrationKey, "done");
  }
}

/**
 * A.3: drop the session-only indexes that are no longer in STORAGE_INDEXES.
 * Idempotent via a schema_meta marker so we only run the DROP + ANALYZE once
 * per store. ANALYZE is critical here — without current stats the query
 * planner will not consider skip-scan over the surviving compound
 * (source_id, session_ref) indexes, and session-only DELETE/SELECT queries
 * would regress to full table scans.
 */
function dropRedundantSessionIndexes(db: DatabaseSync): void {
  const markerKey = "redundant_session_indexes_dropped";
  const done = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(markerKey) as
    | { value_text: string }
    | undefined;
  if (done?.value_text === "done") {
    return;
  }

  const selectIndex = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?");
  const allowedNames = new Set(REDUNDANT_SESSION_INDEXES);
  let droppedAny = false;
  for (const name of REDUNDANT_SESSION_INDEXES) {
    if (!allowedNames.has(name)) {
      // defense-in-depth: never DROP a name we didn't whitelist
      continue;
    }
    const existing = selectIndex.get(name) as { 1: number } | undefined;
    if (existing) {
      db.exec(`DROP INDEX IF EXISTS ${name};`);
      droppedAny = true;
    }
  }

  if (droppedAny) {
    // Refresh planner statistics so the surviving compound indexes are picked
    // for session-only lookups via skip-scan.
    db.exec("ANALYZE;");
  }
  setSchemaMeta(db, markerKey, "done");
}

function ensureAtomEdgeEndpointColumns(db: DatabaseSync): void {
  const columnNames = new Set(
    (
      db.prepare("PRAGMA table_info(atom_edges)").all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );

  if (!columnNames.has("from_atom_id")) {
    db.exec("ALTER TABLE atom_edges ADD COLUMN from_atom_id TEXT NOT NULL DEFAULT ''");
  }

  if (!columnNames.has("to_atom_id")) {
    db.exec("ALTER TABLE atom_edges ADD COLUMN to_atom_id TEXT NOT NULL DEFAULT ''");
  }

  // Skip the expensive full-table backfill scan if already completed.
  const migrationKey = "atom_edge_endpoint_backfill";
  const done = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(migrationKey) as
    | { value_text: string }
    | undefined;
  if (done?.value_text === "done") {
    return;
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      UPDATE atom_edges
         SET from_atom_id = CASE
               WHEN from_atom_id <> '' THEN from_atom_id
               WHEN json_type(payload_json, '$.from_atom_id') = 'text' THEN COALESCE(json_extract(payload_json, '$.from_atom_id'), '')
               ELSE from_atom_id
             END,
             to_atom_id = CASE
               WHEN to_atom_id <> '' THEN to_atom_id
               WHEN json_type(payload_json, '$.to_atom_id') = 'text' THEN COALESCE(json_extract(payload_json, '$.to_atom_id'), '')
               ELSE to_atom_id
             END
       WHERE json_valid(payload_json)
         AND (from_atom_id = '' OR to_atom_id = '');
    `);
    setSchemaMeta(db, migrationKey, "done");
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function ensureEvidenceQueryColumns(db: DatabaseSync): void {
  ensureTableColumns(db, "loss_audits", [
    "stage_kind TEXT NOT NULL DEFAULT ''",
    "diagnostic_code TEXT NOT NULL DEFAULT ''",
    "severity TEXT NOT NULL DEFAULT ''",
    "session_ref TEXT NOT NULL DEFAULT ''",
    "blob_ref TEXT NOT NULL DEFAULT ''",
    "record_ref TEXT NOT NULL DEFAULT ''",
    "fragment_ref TEXT NOT NULL DEFAULT ''",
    "atom_ref TEXT NOT NULL DEFAULT ''",
    "candidate_ref TEXT NOT NULL DEFAULT ''",
  ]);
  ensureTableColumns(db, "captured_blobs", [
    "origin_path TEXT NOT NULL DEFAULT ''",
  ]);
  ensureTableColumns(db, "raw_records", [
    "blob_id TEXT NOT NULL DEFAULT ''",
    "ordinal INTEGER NOT NULL DEFAULT 0",
  ]);

  const migrationKey = "evidence_query_columns_backfill";
  const done = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(migrationKey) as
    | { value_text: string }
    | undefined;
  if (done?.value_text !== "done") {
    runEvidenceQueryColumnBackfill(db, "captured_blobs", backfillCapturedBlobQueryColumns);
    runEvidenceQueryColumnBackfill(db, "raw_records", backfillRawRecordQueryColumns);
    runEvidenceQueryColumnBackfill(db, "loss_audits", backfillLossAuditQueryColumns);
    setSchemaMeta(db, migrationKey, "done");
  }

  backfillLossAuditSeverityColumn(db);
}

function ensureUserTurnsV2FullColumns(db: DatabaseSync): void {
  ensureTableColumns(db, "user_turns_v2", [
    "user_messages_json TEXT NOT NULL DEFAULT '[]'",
    "raw_text_full TEXT NOT NULL DEFAULT ''",
    "project_id TEXT NOT NULL DEFAULT ''",
    "project_ref TEXT NOT NULL DEFAULT ''",
    "project_link_state TEXT NOT NULL DEFAULT ''",
    "last_context_activity_at TEXT NOT NULL DEFAULT ''",
    "path_text TEXT NOT NULL DEFAULT ''",
  ]);
}

function ensureUserTurnsV2CanonicalTextFull(db: DatabaseSync): void {
  ensureTableColumns(db, "user_turns_v2", [
    "canonical_text_full TEXT NOT NULL DEFAULT ''",
  ]);
}

function ensureUserTurnsV2LineageBlob(db: DatabaseSync): void {
  ensureTableColumns(db, "user_turns_v2", [
    "lineage_blob_sha256 TEXT NOT NULL DEFAULT ''",
    "lineage_atom_count INTEGER NOT NULL DEFAULT 0",
    "lineage_fragment_count INTEGER NOT NULL DEFAULT 0",
    "lineage_record_count INTEGER NOT NULL DEFAULT 0",
    "lineage_blob_count INTEGER NOT NULL DEFAULT 0",
    "lineage_candidate_count INTEGER NOT NULL DEFAULT 0",
  ]);
}

function ensureSourceFileLedgerContentMaxTimestamp(db: DatabaseSync): void {
  ensureTableColumns(db, "source_file_ledger", [
    "content_max_timestamp TEXT",
  ]);
}

function runEvidenceQueryColumnBackfill(db: DatabaseSync, tableName: string, backfill: (db: DatabaseSync) => void): void {
  const migrationKey = `evidence_query_columns_backfill:${tableName}`;
  const done = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(migrationKey) as
    | { value_text: string }
    | undefined;
  if (done?.value_text === "done") {
    return;
  }

  backfill(db);
  setSchemaMeta(db, migrationKey, "done");
}

function ensureTableColumns(db: DatabaseSync, tableName: string, columnDefinitions: readonly string[]): void {
  const columnNames = new Set(listTableColumns(db, tableName));
  for (const columnDefinition of columnDefinitions) {
    const [columnName] = columnDefinition.split(/\s+/u);
    if (!columnName || columnNames.has(columnName)) {
      continue;
    }
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

function backfillCapturedBlobQueryColumns(db: DatabaseSync): void {
  const select = db.prepare(
    "SELECT rowid AS rowid, id, payload_json, origin_path FROM captured_blobs WHERE rowid > ? ORDER BY rowid LIMIT ?",
  );
  const update = db.prepare("UPDATE captured_blobs SET origin_path = ? WHERE id = ?");

  forEachBackfillRow<{
    id: string;
    payload_json: string;
    origin_path: string;
  }>(db, select, (row) => {
    if (row.origin_path) {
      return;
    }
    let payload: { origin_path?: unknown } | undefined;
    try {
      payload = JSON.parse(row.payload_json) as { origin_path?: unknown };
    } catch {
      return;
    }
    const originPath = typeof payload.origin_path === "string" ? normalizeStoredOriginPath(payload.origin_path) : "";
    if (originPath) {
      update.run(originPath, row.id);
    }
  });
}

function backfillRawRecordQueryColumns(db: DatabaseSync): void {
  const progressKey = "evidence_query_columns_backfill:raw_records:rowid";
  const progress = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(progressKey) as
    | { value_text: string }
    | undefined;
  let afterRowId = Number.parseInt(progress?.value_text ?? "0", 10);
  if (!Number.isFinite(afterRowId) || afterRowId < 0) {
    afterRowId = 0;
  }

  const selectBatch = db.prepare(
    "SELECT rowid AS rowid FROM raw_records WHERE rowid > ? ORDER BY rowid LIMIT ?",
  );
  const batchSize = 10_000;
  while (true) {
    const rows = selectBatch.all(afterRowId, batchSize) as Array<{ rowid: number }>;
    if (rows.length === 0) {
      return;
    }

    const batchEndRowId = rows[rows.length - 1]!.rowid;
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(`
        UPDATE raw_records
           SET blob_id = CASE
                 WHEN blob_id <> '' THEN blob_id
                 WHEN json_type(payload_json, '$.blob_id') = 'text' THEN COALESCE(json_extract(payload_json, '$.blob_id'), '')
                 ELSE blob_id
               END,
               ordinal = CASE
                 WHEN ordinal <> 0 THEN ordinal
                 WHEN json_type(payload_json, '$.ordinal') IN ('integer', 'real') THEN CAST(json_extract(payload_json, '$.ordinal') AS INTEGER)
                 ELSE ordinal
               END
         WHERE rowid > ?
           AND rowid <= ?
           AND json_valid(payload_json)
           AND (blob_id = '' OR ordinal = 0)
      `).run(afterRowId, batchEndRowId);
      setSchemaMeta(db, progressKey, String(batchEndRowId));
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
    afterRowId = batchEndRowId;
  }
}

function backfillLossAuditQueryColumns(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      UPDATE loss_audits
         SET stage_kind = CASE
               WHEN json_type(payload_json, '$.stage_kind') = 'text' THEN COALESCE(json_extract(payload_json, '$.stage_kind'), '')
               ELSE stage_kind
             END,
             diagnostic_code = CASE
               WHEN json_type(payload_json, '$.diagnostic_code') = 'text' THEN COALESCE(json_extract(payload_json, '$.diagnostic_code'), '')
               ELSE diagnostic_code
             END,
             severity = CASE
               WHEN json_type(payload_json, '$.severity') = 'text' THEN COALESCE(json_extract(payload_json, '$.severity'), '')
               ELSE severity
             END,
             session_ref = CASE
               WHEN json_type(payload_json, '$.session_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.session_ref'), '')
               ELSE session_ref
             END,
             blob_ref = CASE
               WHEN json_type(payload_json, '$.blob_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.blob_ref'), '')
               ELSE blob_ref
             END,
             record_ref = CASE
               WHEN json_type(payload_json, '$.record_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.record_ref'), '')
               ELSE record_ref
             END,
             fragment_ref = CASE
               WHEN json_type(payload_json, '$.fragment_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.fragment_ref'), '')
               ELSE fragment_ref
             END,
             atom_ref = CASE
               WHEN json_type(payload_json, '$.atom_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.atom_ref'), '')
               ELSE atom_ref
             END,
             candidate_ref = CASE
               WHEN json_type(payload_json, '$.candidate_ref') = 'text' THEN COALESCE(json_extract(payload_json, '$.candidate_ref'), '')
               ELSE candidate_ref
             END
       WHERE json_valid(payload_json);
    `);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function backfillLossAuditSeverityColumn(db: DatabaseSync): void {
  const migrationKey = "loss_audit_severity_column_backfill";
  const done = db.prepare("SELECT value_text FROM schema_meta WHERE key = ?").get(migrationKey) as
    | { value_text: string }
    | undefined;
  if (done?.value_text === "done") {
    return;
  }

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
      UPDATE loss_audits
         SET severity = CASE
               WHEN json_valid(payload_json)
                AND json_type(payload_json, '$.severity') = 'text'
                AND COALESCE(json_extract(payload_json, '$.severity'), '') IN ('info', 'warning', 'error')
                 THEN COALESCE(json_extract(payload_json, '$.severity'), 'warning')
               ELSE 'warning'
             END
       WHERE severity NOT IN ('info', 'warning', 'error');
    `);
    setSchemaMeta(db, migrationKey, "done");
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function forEachBackfillRow<T>(
  db: DatabaseSync,
  select: { all: (afterRowId: number, limit: number) => unknown[] },
  callback: (row: T) => void,
): void {
  const batchSize = 5_000;
  let afterRowId = 0;
  while (true) {
    const rows = select.all(afterRowId, batchSize) as Array<T & { rowid: number }>;
    if (rows.length === 0) {
      return;
    }

    dbBackfillTransaction(db, rows, callback, (row) => {
      afterRowId = row.rowid;
    });
  }
}

function dbBackfillTransaction<T>(
  db: DatabaseSync,
  rows: Array<T & { rowid: number }>,
  callback: (row: T) => void,
  onRow: (row: T & { rowid: number }) => void,
): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const row of rows) {
      onRow(row);
      callback(row);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function normalizeStoredOriginPath(value: string): string {
  return value ? path.normalize(value) : "";
}
