CREATE TABLE IF NOT EXISTS sources (
    source_id TEXT PRIMARY KEY,
    connector_type TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    metadata TEXT NOT NULL DEFAULT '{}',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
    entry_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(source_id),
    origin_primary_key TEXT NOT NULL,
    origin_payload_ref TEXT,
    schema_version TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    project TEXT,
    timestamp TEXT NOT NULL,
    end_timestamp TEXT,
    duration_seconds INTEGER,
    content TEXT,
    snippet TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    tags_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(source_id, origin_primary_key)
);

CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(entry_id),
    position INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT,
    tool_name TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    UNIQUE(entry_id, position)
);

CREATE TABLE IF NOT EXISTS entry_chunks (
    chunk_id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(entry_id),
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    UNIQUE(entry_id, position)
);

CREATE TABLE IF NOT EXISTS distill_artifacts (
    artifact_id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    entry_id TEXT,
    artifact_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connector_state (
    source_id TEXT PRIMARY KEY REFERENCES sources(source_id),
    cursor TEXT,
    last_run_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error_message TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ingest_runs (
    run_id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(source_id),
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    written_count INTEGER NOT NULL DEFAULT 0,
    next_cursor TEXT,
    error_message TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
);
