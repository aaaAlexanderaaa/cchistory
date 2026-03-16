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

  ensureAtomEdgeEndpointColumns(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_atom_edges_from ON atom_edges (from_atom_id);
    CREATE INDEX IF NOT EXISTS idx_atom_edges_to ON atom_edges (to_atom_id);

    CREATE INDEX IF NOT EXISTS idx_user_turns_source ON user_turns (source_id);
    CREATE INDEX IF NOT EXISTS idx_user_turns_session ON user_turns (session_id);
    CREATE INDEX IF NOT EXISTS idx_user_turns_submission ON user_turns (submission_started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions (source_id);
    CREATE INDEX IF NOT EXISTS idx_turn_contexts_source ON turn_contexts (source_id);
    CREATE INDEX IF NOT EXISTS idx_project_link_revisions_project ON project_link_revisions (project_id);
    CREATE INDEX IF NOT EXISTS idx_project_lineage_events_project ON project_lineage_events (project_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_coverage_artifact ON artifact_coverage (artifact_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_coverage_turn ON artifact_coverage (turn_id);
    CREATE INDEX IF NOT EXISTS idx_derived_candidates_source ON derived_candidates (source_id);
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
  } catch (error) {
    console.warn(
      "[cchistory/storage] FTS5 unavailable — using fallback substring search.",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
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

  const rows = db.prepare("SELECT id, payload_json, from_atom_id, to_atom_id FROM atom_edges").all() as Array<{
    id: string;
    payload_json: string;
    from_atom_id: string;
    to_atom_id: string;
  }>;
  const update = db.prepare("UPDATE atom_edges SET from_atom_id = ?, to_atom_id = ? WHERE id = ?");

  for (const row of rows) {
    if (row.from_atom_id && row.to_atom_id) {
      continue;
    }

    let payload: { from_atom_id?: unknown; to_atom_id?: unknown } | undefined;
    try {
      payload = JSON.parse(row.payload_json) as { from_atom_id?: unknown; to_atom_id?: unknown };
    } catch {
      continue;
    }

    const fromAtomId = typeof payload.from_atom_id === "string" ? payload.from_atom_id : row.from_atom_id;
    const toAtomId = typeof payload.to_atom_id === "string" ? payload.to_atom_id : row.to_atom_id;
    if (fromAtomId === row.from_atom_id && toAtomId === row.to_atom_id) {
      continue;
    }

    update.run(fromAtomId, toAtomId, row.id);
  }
}
