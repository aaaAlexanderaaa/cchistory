import type { DatabaseSync } from "node:sqlite";
import type { SessionProjection, UserTurnProjection } from "@cchistory/domain";

// Advance when the canonical linker/fallback rules or decoration format change.
export const RESOLVED_READ_INDEX_VERSION = "canonical-links@2026-10-11.1";
type TurnDecoration = Pick<UserTurnProjection, "project_id" | "project_ref" | "link_state" |
  "project_link_state" | "project_confidence" | "candidate_project_ids" | "path_text">;

export function initializeResolvedReadIndex(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolved_read_index_state (
      id INTEGER PRIMARY KEY CHECK(id = 1), version TEXT NOT NULL,
      ready INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      legacy_generation INTEGER NOT NULL DEFAULT 0,
      validated_legacy_generation INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS resolved_turn_links (
      turn_id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, decoration_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resolved_session_links (
      session_id TEXT PRIMARY KEY, primary_project_id TEXT
    );
    INSERT OR IGNORE INTO resolved_read_index_state (id, version) VALUES (1, '');
  `);
  // SQLite triggers also cover backfill/import/direct SQL and older connections
  // opened before upgrade. Dirty once per interval, not once per inserted row.
  const conditions: Record<string, string> = {
    user_turns_v2: "",
    sessions: "WHEN OLD.payload_json IS NOT NEW.payload_json OR OLD.id IS NOT NEW.id",
    derived_candidates: "WHEN OLD.candidate_kind = 'project_observation' OR NEW.candidate_kind = 'project_observation'",
    project_manual_overrides: "",
    captured_blobs: "WHEN OLD.origin_path IS NOT NEW.origin_path OR OLD.payload_json IS NOT NEW.payload_json",
    source_instances: `WHEN OLD.id IS NOT NEW.id OR
      json_extract(OLD.payload_json, '$.base_dir') IS NOT json_extract(NEW.payload_json, '$.base_dir') OR
      json_extract(OLD.payload_json, '$.host_id') IS NOT json_extract(NEW.payload_json, '$.host_id') OR
      json_extract(OLD.payload_json, '$.platform') IS NOT json_extract(NEW.payload_json, '$.platform')`,
  };
  for (const [table, updateCondition] of Object.entries(conditions)) {
    for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
      const condition = event === "UPDATE" ? updateCondition : table === "derived_candidates"
        ? `WHEN ${event === "INSERT" ? "NEW" : "OLD"}.candidate_kind = 'project_observation'` : "";
      db.exec(`CREATE TRIGGER IF NOT EXISTS invalidate_resolved_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} ${condition} BEGIN
          UPDATE resolved_read_index_state SET ready = 0, generation = generation + 1 WHERE id = 1 AND ready = 1;
        END`);
    }
  }
  // project_current is a derived presentation input, not a linker dependency.
  // Invalidate JS maps while keeping the canonical link index ready.
  for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS invalidate_project_presentation_${event.toLowerCase()}
      AFTER ${event} ON project_current BEGIN
        UPDATE resolved_read_index_state SET generation = generation + 1 WHERE id = 1 AND ready = 1;
      END`);
  }
}

export function ensureLegacyTurnInvalidation(db: DatabaseSync): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_turns'").get()) return false;
  const installed = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'invalidate_resolved_legacy_turns_%'").get() as { n: number };
  if (installed.n === 3) return true;
  for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS invalidate_resolved_legacy_turns_${event.toLowerCase()}
      AFTER ${event} ON user_turns BEGIN
        UPDATE resolved_read_index_state SET ready = 0, generation = generation + 1,
          legacy_generation = legacy_generation + 1 WHERE id = 1;
      END`);
  }
  db.exec("UPDATE resolved_read_index_state SET ready = 0, generation = generation + 1, legacy_generation = legacy_generation + 1 WHERE id = 1");
  return true;
}

export function readResolvedIndexState(db: DatabaseSync): { version: string; ready: number; generation: number; total: number; legacy_generation: number; validated_legacy_generation: number } | undefined {
  return db.prepare("SELECT version, ready, generation, total, legacy_generation, validated_legacy_generation FROM resolved_read_index_state WHERE id = 1").get() as
    { version: string; ready: number; generation: number; total: number; legacy_generation: number; validated_legacy_generation: number } | undefined;
}

export function writeResolvedReadIndex(db: DatabaseSync, snapshot: {
  turns: readonly UserTurnProjection[]; sessions: readonly SessionProjection[];
}): void {
  db.exec("DELETE FROM resolved_turn_links; DELETE FROM resolved_session_links;");
  const insert = db.prepare("INSERT INTO resolved_turn_links VALUES (?, ?, ?)");
  for (const [ordinal, turn] of snapshot.turns.entries()) {
    const decoration: TurnDecoration = {
      project_id: turn.project_id, project_ref: turn.project_ref, link_state: turn.link_state,
      project_link_state: turn.project_link_state, project_confidence: turn.project_confidence,
      candidate_project_ids: turn.candidate_project_ids, path_text: turn.path_text,
    };
    insert.run(turn.id, ordinal, JSON.stringify(decoration));
  }
  const insertSession = db.prepare("INSERT INTO resolved_session_links VALUES (?, ?)");
  for (const session of snapshot.sessions) insertSession.run(session.id, session.primary_project_id ?? null);
  db.prepare(`INSERT INTO resolved_read_index_state (id, version, ready, total) VALUES (1, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, ready = 1, total = excluded.total`)
    .run(RESOLVED_READ_INDEX_VERSION, snapshot.turns.length);
}

export function applyTurnDecoration(turn: UserTurnProjection, json: string): UserTurnProjection {
  const fields = JSON.parse(json) as TurnDecoration;
  return { ...turn, project_id: fields.project_id, project_ref: fields.project_ref,
    link_state: fields.link_state, project_link_state: fields.project_link_state,
    project_confidence: fields.project_confidence, candidate_project_ids: fields.candidate_project_ids,
    path_text: fields.path_text };
}

export function normalizeSliceIndex(value: number, total: number): number {
  const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
  return integer < 0 ? Math.max(total + integer, 0) : Math.min(integer, total);
}
