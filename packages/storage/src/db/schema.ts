import type { DatabaseSync } from "node:sqlite";

export function initializeStorageSchema(db: DatabaseSync): boolean {
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
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS captured_blobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_records (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_ref TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS user_turns (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      submission_started_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_contexts (
      turn_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

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
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        turn_id UNINDEXED,
        project_id UNINDEXED,
        source_id UNINDEXED,
        link_state UNINDEXED,
        value_axis UNINDEXED,
        canonical_text,
        raw_text,
        tokenize = 'unicode61 porter'
      );
    `);
    return true;
  } catch {
    return false;
  }
}
