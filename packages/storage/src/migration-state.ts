import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "@cchistory/domain";

/**
 * B.2: durable markers for the Phase B storage-boundary migration.
 *
 * The marker row at `migration_state(phase, scope_kind, scope_id)` records
 * the state of one shard of one phase so the migration can resume per-source
 * after a crash. Status lifecycle:
 *
 *   absent → running → completed
 *                   ↘ aborted (operator must clear before re-running)
 *
 * The composite primary key guarantees one row per (phase, scope_kind,
 * scope_id). `cursor_json` is opaque to this module — the caller serializes
 * its own resume cursor (last-processed chunk id, byte offset, etc.).
 *
 * All functions are safe to call inside or outside an existing transaction;
 * they do not open their own.
 */

export type MigrationPhase =
  // B.3: write V2 sidecars from V1 payloads per source, never touch V1.
  | "storage-boundary.write"
  // B.4: validators write a marker per scope they have signed off on.
  | "storage-boundary.validate"
  // B.5: read cutover writes a single store-scope marker once reads point at V2.
  | "storage-boundary.cutover"
  // B.6a: drop V1 payload_json columns / tables.
  | "storage-boundary.compact"
  // B.6b: VACUUM into the new page size.
  | "storage-boundary.vacuum";

export type MigrationScopeKind = "store" | "source";

export type MigrationStatus = "running" | "completed" | "aborted";

export interface MigrationStateRow {
  phase: MigrationPhase;
  scope_kind: MigrationScopeKind;
  scope_id: string;
  status: MigrationStatus;
  cursor_json: string;
  started_at: string;
  completed_at: string | null;
  last_error: string;
}

export interface MigrationScope {
  phase: MigrationPhase;
  scopeKind: MigrationScopeKind;
  scopeId: string;
}

export function readMigrationState(
  db: DatabaseSync,
  scope: MigrationScope,
): MigrationStateRow | undefined {
  const row = db
    .prepare(
      `SELECT phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error
         FROM migration_state
        WHERE phase = ? AND scope_kind = ? AND scope_id = ?`,
    )
    .get(scope.phase, scope.scopeKind, scope.scopeId) as Omit<MigrationStateRow, "completed_at"> & {
    completed_at: string | null;
  } | undefined;
  if (!row) return undefined;
  return {
    phase: row.phase as MigrationPhase,
    scope_kind: row.scope_kind as MigrationScopeKind,
    scope_id: row.scope_id,
    status: row.status as MigrationStatus,
    cursor_json: row.cursor_json,
    started_at: row.started_at,
    completed_at: row.completed_at,
    last_error: row.last_error,
  };
}

export function listMigrationStates(
  db: DatabaseSync,
  phase?: MigrationPhase,
): MigrationStateRow[] {
  const rows = phase === undefined
    ? (db
        .prepare(
          `SELECT phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error
             FROM migration_state
            ORDER BY phase ASC, started_at ASC`,
        )
        .all() as Array<Omit<MigrationStateRow, "completed_at"> & { completed_at: string | null }>)
    : (db
        .prepare(
          `SELECT phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error
             FROM migration_state
            WHERE phase = ?
            ORDER BY started_at ASC`,
        )
        .all(phase) as Array<Omit<MigrationStateRow, "completed_at"> & { completed_at: string | null }>);
  return rows.map((row) => ({
    phase: row.phase as MigrationPhase,
    scope_kind: row.scope_kind as MigrationScopeKind,
    scope_id: row.scope_id,
    status: row.status as MigrationStatus,
    cursor_json: row.cursor_json,
    started_at: row.started_at,
    completed_at: row.completed_at,
    last_error: row.last_error,
  }));
}

/**
 * Mark a scope as running. Idempotent for re-resume: if a row already exists
 * with status=aborted, the caller must clear it explicitly via
 * `clearMigrationState` first — this function refuses to silently resurrect
 * an aborted scope so an operator can audit the abort reason.
 *
 * Returns the previous row if one existed (so the caller can decide whether
 * to resume from `cursor_json` or start over).
 */
export function recordMigrationStart(
  db: DatabaseSync,
  scope: MigrationScope,
  options: { cursorJson?: string } = {},
): { previous: MigrationStateRow | undefined } {
  const previous = readMigrationState(db, scope);
  if (previous?.status === "aborted") {
    throw new Error(
      `Refusing to start migration ${scope.phase}/${scope.scopeKind}/${scope.scopeId}: ` +
        `previous run aborted with last_error=${previous.last_error || "(empty)"}. ` +
        `Clear with \`cchistory migration reset\` after auditing the failure.`,
    );
  }
  const cursorJson = options.cursorJson ?? previous?.cursor_json ?? "{}";
  const startedAt = previous?.started_at ?? nowIso();
  db.prepare(
    `INSERT INTO migration_state (phase, scope_kind, scope_id, status, cursor_json, started_at, completed_at, last_error)
     VALUES (?, ?, ?, 'running', ?, ?, NULL, '')
     ON CONFLICT(phase, scope_kind, scope_id) DO UPDATE SET
       status = 'running',
       cursor_json = excluded.cursor_json,
       completed_at = NULL,
       last_error = ''`,
  ).run(scope.phase, scope.scopeKind, scope.scopeId, cursorJson, startedAt);
  return { previous };
}

/**
 * Update the resume cursor without changing status. Use between chunks of
 * a long-running source so a crash mid-batch restarts from the last ack.
 */
export function recordMigrationProgress(
  db: DatabaseSync,
  scope: MigrationScope,
  cursorJson: string,
): void {
  db.prepare(
    `UPDATE migration_state
        SET cursor_json = ?
      WHERE phase = ? AND scope_kind = ? AND scope_id = ?`,
  ).run(cursorJson, scope.phase, scope.scopeKind, scope.scopeId);
}

export function recordMigrationComplete(
  db: DatabaseSync,
  scope: MigrationScope,
  options: { cursorJson?: string } = {},
): void {
  const cursorJson = options.cursorJson ?? "{}";
  db.prepare(
    `UPDATE migration_state
        SET status = 'completed',
            cursor_json = ?,
            completed_at = ?,
            last_error = ''
      WHERE phase = ? AND scope_kind = ? AND scope_id = ?`,
  ).run(cursorJson, nowIso(), scope.phase, scope.scopeKind, scope.scopeId);
}

export function recordMigrationAbort(
  db: DatabaseSync,
  scope: MigrationScope,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(
    `UPDATE migration_state
        SET status = 'aborted',
            completed_at = ?,
            last_error = ?
      WHERE phase = ? AND scope_kind = ? AND scope_id = ?`,
  ).run(nowIso(), message, scope.phase, scope.scopeKind, scope.scopeId);
}

/**
 * Drop a marker row entirely. The only legitimate caller is the operator
 * (via `cchistory migration reset`) after auditing an aborted run.
 */
export function clearMigrationState(db: DatabaseSync, scope: MigrationScope): void {
  db.prepare(
    `DELETE FROM migration_state
      WHERE phase = ? AND scope_kind = ? AND scope_id = ?`,
  ).run(scope.phase, scope.scopeKind, scope.scopeId);
}

/**
 * Convenience predicate for B.3/B.4/B.5 orchestration: has this scope been
 * marked completed for this phase?
 */
export function isMigrationScopeCompleted(
  db: DatabaseSync,
  scope: MigrationScope,
): boolean {
  const row = readMigrationState(db, scope);
  return row?.status === "completed";
}
