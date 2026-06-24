import process from "node:process";
import type { DatabaseSync } from "node:sqlite";
import { nowIso } from "@cchistory/domain";

/**
 * C2: stale `running` marker reporting.
 *
 * A `running` marker is reported as stale when its `started_at` is older than
 * this threshold. SIGKILL / power loss / OOM-kill bypass the orchestrator's
 * try/catch (which would otherwise write `aborted`), leaving the marker pinned
 * at `running` forever. Any existing `running` marker is now a hard stop; the
 * threshold only makes the refusal message more specific.
 *
 * The threshold is deliberately generous (the B.3 streaming backfill bounds
 * memory by blob, so any single source should finish in seconds to low
 * minutes even at 100K+ records). Override via env for operator-tuned runs:
 *
 *   CCHISTORY_MIGRATION_STALE_RUNNING_MS=600000   // 10 min stale label
 *   CCHISTORY_MIGRATION_STALE_RUNNING_MS=0        // label any prior running
 *                                                 // marker as stale
 *   (unset)                                       // default 30 min
 *
 * Negative or non-numeric values throw at module load — silent fallback to
 * the default would mask operator typos.
 */
const STALE_RUNNING_MARKER_MS = parseStaleRunningThreshold(
  process.env.CCHISTORY_MIGRATION_STALE_RUNNING_MS,
);

/**
 * Parse the CCHISTORY_MIGRATION_STALE_RUNNING_MS env var. Exported so the
 * parse logic (I4) is unit-testable without spawning a subprocess. Pure
 * function — no side effects, no DB access.
 */
export function parseStaleRunningThreshold(env: string | undefined): number {
  const DEFAULT_MS = 30 * 60 * 1000;
  if (env === undefined || env === "") return DEFAULT_MS;
  // Number() accepts whitespace, decimals, and scientific notation; reject
  // NaN, Infinity, and negatives explicitly. parseInt would silently drop
  // the fractional part of "1.5" and accept "10abc" as 10 — both wrong.
  const n = Number(env);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      `CCHISTORY_MIGRATION_STALE_RUNNING_MS=${JSON.stringify(env)} is invalid. ` +
        `Expected a non-negative number of milliseconds. Use 0 to label any ` +
        `prior running marker as stale in the refusal message.`,
    );
  }
  return Math.floor(n);
}

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

/**
 * Every valid MigrationPhase value. Exported so the CLI can validate the
 * `migration reset --phase <name>` argument against this set instead of
 * accepting any string — a typo would otherwise DELETE 0 rows silently and
 * the operator would re-run `migration run` expecting the typo'd phase to
 * be re-populated.
 */
export const MIGRATION_PHASES: readonly MigrationPhase[] = [
  "storage-boundary.write",
  "storage-boundary.validate",
  "storage-boundary.cutover",
  "storage-boundary.compact",
  "storage-boundary.vacuum",
] as const;

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
 * Mark a scope as running. If a row already exists with status=running or
 * status=aborted, the caller must clear it explicitly via `clearMigrationState`
 * first. A direct second start is treated as a concurrent migration attempt,
 * even when the marker is fresh.
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
  // C2/I4: any existing `running` marker is a hard stop. The stale threshold is
  // retained only to make the operator-facing error more specific; it must not
  // permit a second writer while a fresh marker may still be active.
  if (previous?.status === "running") {
    const startedMs = Date.parse(previous.started_at);
    const isStale = !Number.isFinite(startedMs) || Date.now() - startedMs > STALE_RUNNING_MARKER_MS;
    const reason = Number.isFinite(startedMs)
      ? isStale
        ? `started_at=${previous.started_at} is older than ${STALE_RUNNING_MARKER_MS}ms`
        : `started_at=${previous.started_at} is still within ${STALE_RUNNING_MARKER_MS}ms`
      : `started_at=${previous.started_at} is unparseable`;
    throw new Error(
      `Refusing to start migration ${scope.phase}/${scope.scopeKind}/${scope.scopeId}: ` +
        `previous run is already marked 'running' (${reason}). Audit the prior run, then clear ` +
        `with \`cchistory migration reset --phase ${scope.phase}\` after confirming no process is active.`,
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
 * Drop every marker row for a phase (or every phase, when undefined).
 * Returns the number of rows deleted so the CLI can report it.
 */
export function clearMigrationStatesByPhase(db: DatabaseSync, phase?: MigrationPhase): number {
  const stmt = phase === undefined
    ? db.prepare("DELETE FROM migration_state")
    : db.prepare("DELETE FROM migration_state WHERE phase = ?");
  const result = phase === undefined ? stmt.run() : stmt.run(phase);
  return Number(result.changes ?? 0);
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
