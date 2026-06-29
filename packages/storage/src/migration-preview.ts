import { stat, statfs } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/**
 * B.1 read-only migration preview. Reports the four numbers the migration
 * plan calls for:
 *
 *   1. Backfill gap — V1 rows without a corresponding V2 sidecar row that
 *      B.3 (write migration) will need to reconstruct.
 *   2. Removable bytes — payload_json bytes from V1-only tables that B.6a
 *      (compact) will be able to drop once B.5 switches reads to V2.
 *   3. Affected counts — sources/sessions/turns that the migration touches.
 *   4. Required free disk — VACUUM (B.6b) needs a temporary second copy of
 *      the main DB file.
 *
 * This module NEVER writes. The CLI command (`cchistory migration preview`)
 * opens the store read-only and prints the result.
 */

export interface StorageBoundaryMigrationPreview {
  generated_at: string;
  db_path: string;
  schema_version?: string;
  v1_to_v2_mapping: V1ToV2Mapping;
  backfill: BackfillGap;
  removable: RemovableBytes;
  affected: AffectedCounts;
  vacuum: VacuumDiskRequirement;
  recommended_backup_command: string;
}

export interface V1ToV2Mapping {
  user_turns: RowMapping;
  turn_contexts: RowMapping;
  raw_records: RowMapping;
  captured_blobs: RowMapping;
}

export interface RowMapping {
  v1_rows: number;
  v2_rows: number;
  missing: number;
}

export interface BackfillGap {
  missing_user_turns_v2: number;
  missing_turn_context_refs_v2: number;
  missing_parsed_record_spans: number;
  missing_evidence_captures: number;
  total_missing: number;
}

export interface RemovableBytes {
  raw_records_payload_bytes: number;
  source_fragments_payload_bytes: number;
  conversation_atoms_payload_bytes: number;
  atom_edges_payload_bytes: number;
  derived_candidates_payload_bytes: number;
  user_turns_payload_bytes: number;
  turn_contexts_payload_bytes: number;
  captured_blobs_payload_bytes: number;
  sessions_payload_bytes: number;
  total_bytes: number;
}

export interface AffectedCounts {
  sources: number;
  sessions: number;
  turns: number;
}

export interface VacuumDiskRequirement {
  current_db_bytes: number;
  required_free_bytes: number;
  available_free_bytes: number;
  available_total_bytes: number;
  sufficient: boolean;
}

const V1_PAYLOAD_TABLES = [
  "raw_records",
  "source_fragments",
  "conversation_atoms",
  "atom_edges",
  "derived_candidates",
  "user_turns",
  "turn_contexts",
  "captured_blobs",
  "sessions",
] as const;

export async function readStorageBoundaryMigrationPreview(input: {
  dbPath: string;
}): Promise<StorageBoundaryMigrationPreview> {
  const db = new DatabaseSync(input.dbPath, { readOnly: true });
  try {
    const schemaVersion = readSchemaVersion(db);
    const v1ToV2 = readV1ToV2Mapping(db);
    const backfill = readBackfillGap(db);
    const removable = readRemovableBytes(db);
    const affected = readAffectedCounts(db);
    const vacuum = await readVacuumRequirement(input.dbPath);

    return {
      generated_at: new Date().toISOString(),
      db_path: input.dbPath,
      schema_version: schemaVersion,
      v1_to_v2_mapping: v1ToV2,
      backfill,
      removable,
      affected,
      vacuum,
      recommended_backup_command: buildBackupCommand(input.dbPath),
    };
  } finally {
    db.close();
  }
}

function readSchemaVersion(db: DatabaseSync): string | undefined {
  try {
    const row = db.prepare("SELECT value_text FROM schema_meta WHERE key = 'schema_version'").get() as
      | { value_text: string }
      | undefined;
    return row?.value_text;
  } catch {
    return undefined;
  }
}

function readV1ToV2Mapping(db: DatabaseSync): V1ToV2Mapping {
  const userTurns = readRowMapping(db, "user_turns", "id", "user_turns_v2", "turn_id");
  const turnContexts = readRowMapping(db, "turn_contexts", "turn_id", "turn_context_refs_v2", "turn_id");
  const rawRecords = readRowMapping(db, "raw_records", "id", "parsed_record_spans", "record_id");
  const capturedBlobs = readCapturedBlobMapping(db);
  return { user_turns: userTurns, turn_contexts: turnContexts, raw_records: rawRecords, captured_blobs: capturedBlobs };
}

function readRowMapping(
  db: DatabaseSync,
  v1Table: string,
  v1Key: string,
  v2Table: string,
  v2Key: string,
): RowMapping {
  const v1Rows = countRows(db, v1Table);
  const v2Rows = countRows(db, v2Table);
  if (v1Rows === 0) {
    return { v1_rows: 0, v2_rows: v2Rows, missing: 0 };
  }
  // V1 rows whose key is NOT present in the V2 sidecar.
  const missingRow = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM ${v1Table} v1
        WHERE NOT EXISTS (
          SELECT 1 FROM ${v2Table} v2 WHERE v2.${v2Key} = v1.${v1Key}
        )`,
    )
    .get() as { n: number };
  return { v1_rows: v1Rows, v2_rows: v2Rows, missing: missingRow.n };
}

function readCapturedBlobMapping(db: DatabaseSync): RowMapping {
  // captured_blobs is keyed by (id) where id encodes source_id + blob_id;
  // evidence_captures stores (source_id, blob_id) as separate columns. The
  // V2 sidecar may have multiple captures per V1 row (multiple sources
  // share content) or fewer — but the missing count must be zero for B.3 to
  // proceed safely.
  const v1Rows = countRows(db, "captured_blobs");
  const v2Rows = countRows(db, "evidence_captures");
  if (v1Rows === 0) {
    return { v1_rows: 0, v2_rows: v2Rows, missing: 0 };
  }
  // V1 captured_blobs whose (source_id, id) pair has no matching
  // evidence_captures row.
  const missingRow = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM captured_blobs cb
        WHERE NOT EXISTS (
          SELECT 1 FROM evidence_captures ec
           WHERE ec.source_id = cb.source_id
             AND ec.blob_id = cb.id
        )`,
    )
    .get() as { n: number };
  return { v1_rows: v1Rows, v2_rows: v2Rows, missing: missingRow.n };
}

function countRows(db: DatabaseSync, table: string): number {
  // B.6: V1 user_turns / turn_contexts may not exist (operator hasn't run
  // compact, or this is a fresh install post-B.6). COUNT(*) on a missing
  // table throws — return 0 instead of breaking the preview.
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

function readBackfillGap(db: DatabaseSync): BackfillGap {
  const userTurns = readRowMapping(db, "user_turns", "id", "user_turns_v2", "turn_id");
  const turnContexts = readRowMapping(db, "turn_contexts", "turn_id", "turn_context_refs_v2", "turn_id");
  const rawRecords = readRowMapping(db, "raw_records", "id", "parsed_record_spans", "record_id");
  const capturedBlobs = readCapturedBlobMapping(db);
  return {
    missing_user_turns_v2: userTurns.missing,
    missing_turn_context_refs_v2: turnContexts.missing,
    missing_parsed_record_spans: rawRecords.missing,
    missing_evidence_captures: capturedBlobs.missing,
    total_missing: userTurns.missing + turnContexts.missing + rawRecords.missing + capturedBlobs.missing,
  };
}

function readRemovableBytes(db: DatabaseSync): RemovableBytes {
  const out: Record<string, number> = {};
  let total = 0;
  for (const table of V1_PAYLOAD_TABLES) {
    const bytes = sumPayloadBytes(db, table);
    out[`${table}_payload_bytes`] = bytes;
    total += bytes;
  }
  return {
    raw_records_payload_bytes: out.raw_records_payload_bytes!,
    source_fragments_payload_bytes: out.source_fragments_payload_bytes!,
    conversation_atoms_payload_bytes: out.conversation_atoms_payload_bytes!,
    atom_edges_payload_bytes: out.atom_edges_payload_bytes!,
    derived_candidates_payload_bytes: out.derived_candidates_payload_bytes!,
    user_turns_payload_bytes: out.user_turns_payload_bytes!,
    turn_contexts_payload_bytes: out.turn_contexts_payload_bytes!,
    captured_blobs_payload_bytes: out.captured_blobs_payload_bytes!,
    sessions_payload_bytes: out.sessions_payload_bytes!,
    total_bytes: total,
  };
}

function sumPayloadBytes(db: DatabaseSync, table: string): number {
  try {
    const row = db.prepare(`SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS s FROM ${table}`).get() as { s: number };
    return row.s;
  } catch {
    return 0;
  }
}

function readAffectedCounts(db: DatabaseSync): AffectedCounts {
  return {
    sources: countRows(db, "source_instances"),
    sessions: countRows(db, "sessions"),
    turns: countRows(db, "user_turns"),
  };
}

async function readVacuumRequirement(dbPath: string): Promise<VacuumDiskRequirement> {
  const dbStat = await stat(dbPath);
  const currentDbBytes = dbStat.size;
  // VACUUM holds a temporary second copy. Required free space equals the
  // current main DB size. (B.6b will later switch to VACUUM INTO which
  // requires the same headroom but produces an atomic swap.)
  const requiredFreeBytes = currentDbBytes;
  let availableFreeBytes = 0;
  let availableTotalBytes = 0;
  try {
    const fs = await statfs(path.dirname(dbPath));
    availableFreeBytes = fs.bavail * fs.bsize;
    availableTotalBytes = fs.blocks * fs.bsize;
  } catch {
    availableFreeBytes = 0;
    availableTotalBytes = 0;
  }
  return {
    current_db_bytes: currentDbBytes,
    required_free_bytes: requiredFreeBytes,
    available_free_bytes: availableFreeBytes,
    available_total_bytes: availableTotalBytes,
    sufficient: availableFreeBytes >= requiredFreeBytes,
  };
}

function buildBackupCommand(dbPath: string): string {
  // Per migration plan § B.7 risk: pre-B.6 backup is mandatory. Print the
  // recommended command using `cp` plus sqlite3's online backup API through
  // the existing `cchistory backup` workflow.
  const dir = path.dirname(dbPath);
  return `cchistory backup --out ${dir}/migration-backup --write`;
}
