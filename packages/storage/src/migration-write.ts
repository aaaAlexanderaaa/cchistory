import type { DatabaseSync } from "node:sqlite";
import {
  isMigrationScopeCompleted,
  recordMigrationAbort,
  recordMigrationComplete,
  recordMigrationStart,
  type MigrationScope,
} from "./migration-state.js";
import type { CCHistoryStorage } from "./internal/storage.js";

/**
 * B.3: per-source V1→V2 backfill orchestrator.
 *
 * For each source:
 *   1. Skip if migration_state already shows status=completed.
 *   2. recordMigrationStart (own txn) — refuses to resurrect an aborted
 *      scope without an explicit `cchistory migration reset`.
 *   3. Call `storage.backfillSourceV2Sidecars(sourceId)`. This is the
 *      canonical V2 write path against the V1-derived payload; V1 is
 *      never touched.
 *   4. recordMigrationComplete (own txn).
 *
 * On error: recordMigrationAbort and HALT. The plan is explicit: "the
 * source is marked `aborted` and the migration halts at that source
 * (does not proceed to B.4 for the store)." Operators clear the abort
 * via `cchistory migration reset` after auditing.
 */

const PHASE = "storage-boundary.write" as const;

export interface BackfillSourceResult {
  source_id: string;
  skipped: boolean;
  aborted: boolean;
  error?: string;
  counts?: {
    records: number;
    fragments: number;
    atoms: number;
    candidates: number;
    turns: number;
    contexts: number;
    blobs: number;
    sessions: number;
  };
}

export interface BackfillStoreResult {
  sources_total: number;
  sources_processed: number;
  sources_skipped: number;
  sources_aborted: number;
  halted_at_source_id?: string;
  results: BackfillSourceResult[];
}

export interface BackfillProgressEvent {
  kind: "source_start" | "source_complete" | "source_skip" | "source_abort" | "store_halt";
  source_id?: string;
  error?: string;
}

export function backfillStorageBoundaryV2ForStore(input: {
  storage: CCHistoryStorage;
  sourceIds?: readonly string[];
  onProgress?: (event: BackfillProgressEvent) => void;
}): BackfillStoreResult {
  const db = input.storage.getDatabaseForMigration();
  const requestedIds = input.sourceIds ?? input.storage.listSources().map((source) => source.id);
  const results: BackfillSourceResult[] = [];
  let processed = 0;
  let skipped = 0;
  let aborted = 0;
  let haltedAtSourceId: string | undefined;

  for (const sourceId of requestedIds) {
    const scope: MigrationScope = { phase: PHASE, scopeKind: "source", scopeId: sourceId };

    if (isMigrationScopeCompleted(db, scope)) {
      skipped += 1;
      results.push({ source_id: sourceId, skipped: true, aborted: false });
      input.onProgress?.({ kind: "source_skip", source_id: sourceId });
      continue;
    }

    input.onProgress?.({ kind: "source_start", source_id: sourceId });
    try {
      // recordMigrationStart opens its own transaction; the abort-resurrect
      // guard fires here if a prior run aborted and the operator hasn't
      // cleared it yet.
      recordMigrationStart(db, scope);
    } catch (error) {
      // Operator-visible abort: surface but do not auto-clear.
      aborted += 1;
      haltedAtSourceId = sourceId;
      results.push({
        source_id: sourceId,
        skipped: false,
        aborted: true,
        error: error instanceof Error ? error.message : String(error),
      });
      input.onProgress?.({
        kind: "source_abort",
        source_id: sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      input.onProgress?.({ kind: "store_halt", source_id: sourceId });
      break;
    }

    try {
      const counts = input.storage.backfillSourceV2Sidecars(sourceId);
      recordMigrationComplete(db, scope);
      processed += 1;
      results.push({
        source_id: sourceId,
        skipped: false,
        aborted: false,
        counts: {
          records: counts.records,
          fragments: counts.fragments,
          atoms: counts.atoms,
          candidates: counts.candidates,
          turns: counts.turns,
          contexts: counts.contexts,
          blobs: counts.blobs,
          sessions: counts.sessions,
        },
      });
      input.onProgress?.({ kind: "source_complete", source_id: sourceId });
    } catch (error) {
      recordMigrationAbort(db, scope, error);
      aborted += 1;
      haltedAtSourceId = sourceId;
      results.push({
        source_id: sourceId,
        skipped: false,
        aborted: true,
        error: error instanceof Error ? error.message : String(error),
      });
      input.onProgress?.({
        kind: "source_abort",
        source_id: sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      input.onProgress?.({ kind: "store_halt", source_id: sourceId });
      break;
    }
  }

  return {
    sources_total: requestedIds.length,
    sources_processed: processed,
    sources_skipped: skipped,
    sources_aborted: aborted,
    halted_at_source_id: haltedAtSourceId,
    results,
  };
}
