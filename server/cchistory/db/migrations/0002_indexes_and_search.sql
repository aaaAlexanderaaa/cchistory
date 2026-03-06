CREATE INDEX IF NOT EXISTS idx_entries_timestamp_entry_id
ON entries(timestamp DESC, entry_id DESC);

CREATE INDEX IF NOT EXISTS idx_entries_source_timestamp_entry_id
ON entries(source_id, timestamp DESC, entry_id DESC);

CREATE INDEX IF NOT EXISTS idx_entries_project_timestamp_entry_id
ON entries(project, timestamp DESC, entry_id DESC);

CREATE INDEX IF NOT EXISTS idx_entries_type_timestamp_entry_id
ON entries(type, timestamp DESC, entry_id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_entry_position
ON messages(entry_id, position);

CREATE INDEX IF NOT EXISTS idx_connector_state_status
ON connector_state(status);

CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts
USING fts5(
    entry_id UNINDEXED,
    title,
    content,
    chunks,
    tokenize = 'unicode61'
);
