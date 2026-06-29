import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type {
  CapturedBlob,
  RawRecord,
  SourceSyncPayload,
  TurnContextProjection,
  UserTurnProjection,
} from "@cchistory/domain";
import type { DatabaseSync } from "node:sqlite";
import { normalizeSourcePayload } from "./internal/source-identity.js";
import { compositeKey, fromJson, nowIso } from "./internal/utils.js";
import { pruneUnreferencedEvidenceBlobsInTransaction } from "./internal/gc.js";

export const TURN_CONTEXT_INLINE_BUDGET_BYTES = 16 * 1024;
export const USER_TURN_V2_INLINE_BUDGET_BYTES = 32 * 1024;

interface EvidenceMaterialization {
  sha256: string;
  storagePath: string;
  sizeBytes: number;
  bytes: Buffer;
  mediaType: string;
  captureKind: "source_blob" | "record_snapshot" | "context_cache" | "turn_lineage";
  createdAt: string;
}

interface JsonlLineSpan {
  ordinal: number;
  startByte: number;
  endByte: number;
}

export function writeStorageBoundaryV2Sidecars(input: {
  db: DatabaseSync;
  payload: SourceSyncPayload;
  assetDir?: string;
  writeMode: "replace" | "merge";
  preserveOriginPaths?: readonly string[];
  observedOriginPaths?: readonly string[];
}): { pruned_evidence_shas: string[] } {
  const normalizedPayload = normalizeSourcePayload(input.payload);
  const now = nowIso();
  const parserProfileId = deriveParserProfileId(normalizedPayload);
  const itemByteSize = createItemByteSizeCache();
  const recordsByBlobId = groupBy(normalizedPayload.records, (record) => record.blob_id);
  const materializedByBlobId = new Map<string, EvidenceMaterialization>();
  const lineSpansByBlobId = new Map<string, Map<number, JsonlLineSpan>>();
  const incomingOriginPaths = dedupeByKey(normalizedPayload.blobs, (entry) => entry.id)
    .map((blob) => normalizeOriginPath(blob.origin_path));

  let prunedShas: string[] = [];
  dbTransaction(input.db, () => {
    if (input.writeMode === "replace") {
      prepareReplaceCurrentState(input.db, normalizedPayload.source.id, incomingOriginPaths, now);
    } else {
      prepareMergeCurrentState(input.db, {
        payload: normalizedPayload,
        incomingOriginPaths,
        preserveOriginPaths: input.preserveOriginPaths,
        observedOriginPaths: input.observedOriginPaths,
        now,
      });
    }

    for (const blob of dedupeByKey(normalizedPayload.blobs, (entry) => entry.id)) {
      const records = recordsByBlobId.get(blob.id) ?? [];
      const materialized = materializeBlobEvidence({
        assetDir: input.assetDir,
        blob,
        records,
        createdAt: now,
      });
      materializedByBlobId.set(blob.id, materialized);
      if (materialized.captureKind === "source_blob") {
        lineSpansByBlobId.set(blob.id, indexJsonlLineSpans(materialized.bytes));
      }
      upsertEvidenceBlob(input.db, materialized);
      upsertEvidenceCapture(input.db, normalizedPayload.source.id, blob, materialized, now);
      upsertSourceFileLedger(input.db, {
        sourceId: normalizedPayload.source.id,
        blob,
        materialized,
        records,
        parserProfileId,
        observedAt: now,
      });
    }

    for (const record of normalizedPayload.records) {
      const materialized = materializedByBlobId.get(record.blob_id);
      upsertParsedRecordSpan(input.db, {
        record,
        materialized,
        lineSpan: lineSpansByBlobId.get(record.blob_id)?.get(record.ordinal),
        parserProfileId,
        createdAt: now,
      });
    }

    for (const turn of normalizedPayload.turns) {
      upsertBoundedUserTurn({ db: input.db, turn, boundedAt: now, assetDir: input.assetDir });
    }

    for (const context of normalizedPayload.contexts) {
      const materialized = materializeContextCache({
        assetDir: input.assetDir,
        context,
        createdAt: now,
      });
      upsertEvidenceBlob(input.db, materialized);
      upsertTurnContextRef(input.db, context, normalizedPayload.source.id, materialized, now);
    }

    upsertDerivedCacheRefs(input.db, normalizedPayload, parserProfileId, now, itemByteSize);

    // Prune evidence blobs whose refs were dropped by prepareReplace/Merge
    // (e.g. an upserted turn whose lineage mutated drops the previous lineage
    // blob; a merge that drops session-scoped turns drops their lineage +
    // context-cache blobs). Without this call the same blob-leak shape as
    // B.5.0g accumulates on every merge/replace. Done inside the same
    // transaction so DB rows and file unlinks stay consistent.
    prunedShas = pruneUnreferencedEvidenceBlobsInTransaction(input.db);
  });
  return { pruned_evidence_shas: prunedShas };
}

export function markStorageBoundaryV2SourceAbsentByObservedOrigins(input: {
  db: DatabaseSync;
  sourceId: string;
  observedOriginPaths: readonly string[];
}): void {
  const now = nowIso();
  dbTransaction(input.db, () => {
    markUnobservedLedgersSourceAbsent(input.db, input.sourceId, input.observedOriginPaths, now);
  });
}

/**
 * B.3 streaming variant: backfill V2 sidecars for one source by streaming from
 * V1 directly, without materializing the full `SourceSyncPayload` in memory.
 *
 * The non-streaming path (`writeStorageBoundaryV2Sidecars` fed by
 * `getSourcePayload`) loads every record/fragment/atom/candidate for the source
 * into JS memory at once. For sources with >100k records (e.g. a busy codex
 * source with 265k records / 304k fragments), this blows past the Node heap
 * before B.3 can complete.
 *
 * This variant streams blob-by-blob: for each blob, load just that blob's
 * records, materialize evidence, write the blob's V2 rows (evidence_blob,
 * evidence_capture, source_file_ledger) and the blob's parsed_record_spans,
 * then release the materialized bytes and move on. Memory at any point holds
 * one blob's worth of data, not the whole source.
 *
 * Turns and contexts are streamed directly from their V1 tables; they are
 * bounded by turn count (small per source — at most a few thousand).
 *
 * derived_cache_refs is computed via SQL aggregation at the end (COUNT and
 * LENGTH(payload_json) SUM per scope), avoiding the need to load fragments /
 * atoms / candidates into memory at all.
 *
 * B5 invariant: this function is the only path that backfills V2 sidecars
 * from V1 payload_json. Post-B.6 (when V1 user_turns / turn_contexts are
 * dropped) the V1 reads at lines ~255 and ~264 return zero rows and this
 * function becomes a natural no-op for the turns + contexts sections — but
 * the operator CANNOT recover a missing V2 sidecar post-B.6 because the V1
 * source is gone. B.3 must reach `migration_state.status = completed` for
 * every source BEFORE B.6 lands. The C6 v1-payload-digest validator is the
 * audit gate; the operator workflow is: B.3 → C6 baseline → C6 compare → B.6.
 */
export function streamV2SidecarsFromV1(input: {
  db: DatabaseSync;
  sourceId: string;
  assetDir?: string;
}): {
  records: number;
  fragments: number;
  atoms: number;
  candidates: number;
  turns: number;
  contexts: number;
  blobs: number;
  sessions: number;
} {
  const db = input.db;
  const sourceId = input.sourceId;
  const now = nowIso();

  const sourceRow = db.prepare("SELECT payload_json FROM source_instances WHERE id = ?").get(sourceId) as
    | { payload_json: string }
    | undefined;
  if (!sourceRow) {
    throw new Error(`Cannot backfill source ${sourceId}: source not found in V1 store.`);
  }
  const source = fromJson<SourceSyncPayload["source"]>(sourceRow.payload_json);
  const parserProfileId = deriveParserProfileIdFromStageRuns(db, sourceId);

  const counts = {
    blobs: tableCount(db, "captured_blobs", sourceId),
    records: tableCount(db, "raw_records", sourceId),
    fragments: tableCount(db, "source_fragments", sourceId),
    atoms: tableCount(db, "conversation_atoms", sourceId),
    candidates: tableCount(db, "derived_candidates", sourceId),
    turns: tableCount(db, "user_turns", sourceId),
    contexts: tableCount(db, "turn_contexts", sourceId),
    sessions: tableCount(db, "sessions", sourceId),
  };

  dbTransaction(db, () => {
    // Replace mode: drop existing V2 rows for this source. Same clear set as
    // `prepareReplaceCurrentState`, minus the origin-path ledger work (B.3
    // doesn't change sync state — it rebuilds sidecars from existing V1).
    db.prepare("DELETE FROM parsed_record_spans WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM turn_context_refs_v2 WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM user_turns_v2 WHERE source_id = ?").run(sourceId);
    db.prepare("DELETE FROM derived_cache_refs WHERE source_id = ?").run(sourceId);

    // 1. Blob-by-blob: materialize evidence + write blob-scoped V2 rows +
    //    parsed_record_spans for this blob's records. Memory peak = one blob.
    const blobsStmt = db.prepare(
      "SELECT payload_json FROM captured_blobs WHERE source_id = ? ORDER BY origin_path, id",
    );
    const recordsByBlobStmt = db.prepare(
      "SELECT payload_json FROM raw_records WHERE source_id = ? AND blob_id = ? ORDER BY ordinal",
    );
    for (const row of blobsStmt.iterate(sourceId) as Iterable<{ payload_json: string }>) {
      const blob = fromJson<CapturedBlob>(row.payload_json);
      const trustedBytes = readTrustedBlobBytes(blob);
      if (trustedBytes) {
        const materialized = materializeBytes({
          assetDir: input.assetDir,
          bytes: trustedBytes,
          mediaType: "application/octet-stream",
          captureKind: "source_blob",
          createdAt: now,
        });
        upsertEvidenceBlob(db, materialized);
        upsertEvidenceCapture(db, sourceId, blob, materialized, now);
        const summary = readRawRecordSummaryByBlob(db, sourceId, blob.id);
        upsertSourceFileLedger(db, {
          sourceId,
          blob,
          materialized,
          sessionRefs: summary.sessionRefs,
          lastRecordOrdinal: summary.lastRecordOrdinal,
          parserProfileId,
          observedAt: now,
        });
        const lineSpanIterator = iterateJsonlLineSpans(materialized.bytes)[Symbol.iterator]();
        let nextLineSpan = lineSpanIterator.next();
        for (const r of recordsByBlobStmt.iterate(sourceId, blob.id) as Iterable<{ payload_json: string }>) {
          const record = fromJson<RawRecord>(r.payload_json);
          while (!nextLineSpan.done && nextLineSpan.value.ordinal < record.ordinal) {
            nextLineSpan = lineSpanIterator.next();
          }
          const lineSpan = !nextLineSpan.done && nextLineSpan.value.ordinal === record.ordinal
            ? nextLineSpan.value
            : undefined;
          upsertParsedRecordSpan(db, {
            record,
            materialized,
            lineSpan,
            parserProfileId,
            createdAt: now,
          });
        }
        continue;
      }

      const records: RawRecord[] = [];
      for (const r of recordsByBlobStmt.iterate(sourceId, blob.id) as Iterable<{ payload_json: string }>) {
        records.push(fromJson<RawRecord>(r.payload_json));
      }
      const materialized = materializeBlobEvidence({
        assetDir: input.assetDir,
        blob,
        records,
        createdAt: now,
      });
      const lineSpans =
        materialized.captureKind === "source_blob" ? indexJsonlLineSpans(materialized.bytes) : undefined;
      upsertEvidenceBlob(db, materialized);
      upsertEvidenceCapture(db, sourceId, blob, materialized, now);
      upsertSourceFileLedger(db, {
        sourceId,
        blob,
        materialized,
        records,
        parserProfileId,
        observedAt: now,
      });
      for (const record of records) {
        upsertParsedRecordSpan(db, {
          record,
          materialized,
          lineSpan: lineSpans?.get(record.ordinal),
          parserProfileId,
          createdAt: now,
        });
      }
    }

    // 2. Turns (bounded by turn count per source).
    const turnsStmt = db.prepare(
      "SELECT payload_json FROM user_turns WHERE source_id = ? ORDER BY submission_started_at DESC, created_at DESC",
    );
    for (const row of turnsStmt.iterate(sourceId) as Iterable<{ payload_json: string }>) {
      const turn = fromJson<UserTurnProjection>(row.payload_json);
      upsertBoundedUserTurn({ db, turn, boundedAt: now, assetDir: input.assetDir });
    }

    // 3. Contexts (one per turn).
    const contextsStmt = db.prepare(
      "SELECT payload_json FROM turn_contexts WHERE source_id = ? ORDER BY turn_id",
    );
    for (const row of contextsStmt.iterate(sourceId) as Iterable<{ payload_json: string }>) {
      const context = fromJson<TurnContextProjection>(row.payload_json);
      const materialized = materializeContextCache({ assetDir: input.assetDir, context, createdAt: now });
      upsertEvidenceBlob(db, materialized);
      upsertTurnContextRef(db, context, sourceId, materialized, now);
    }

    // 4. derived_cache_refs via SQL aggregation. No in-memory lists needed.
    upsertDerivedCacheRefsStreaming(db, sourceId, parserProfileId, now);
  });

  return counts;
}

function tableCount(db: DatabaseSync, tableName: string, sourceId: string): number {
  // B.6: V1 user_turns / turn_contexts may be absent (post-compact or fresh
  // install). COUNT(*) on a missing table throws — return 0 so the backfill
  // summary doesn't break the B.3 path on stores that are past B.6.
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${tableName} WHERE source_id = ?`).get(sourceId) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

function readRawRecordSummaryByBlob(
  db: DatabaseSync,
  sourceId: string,
  blobId: string,
): { sessionRefs: string[]; lastRecordOrdinal: number | null } {
  const ordinalRow = db
    .prepare(
      `SELECT MAX(ordinal) AS last_record_ordinal
         FROM raw_records
        WHERE source_id = ?
          AND blob_id = ?`,
    )
    .get(sourceId, blobId) as { last_record_ordinal: number | null } | undefined;
  const sessionRows = db
    .prepare(
      `SELECT DISTINCT session_ref
         FROM raw_records
        WHERE source_id = ?
          AND blob_id = ?
          AND session_ref <> ''
        ORDER BY session_ref`,
    )
    .all(sourceId, blobId) as Array<{ session_ref: string }>;
  return {
    sessionRefs: sessionRows.map((row) => row.session_ref),
    lastRecordOrdinal: ordinalRow?.last_record_ordinal ?? null,
  };
}

function deriveParserProfileIdFromStageRuns(db: DatabaseSync, sourceId: string): string {
  const rows = db
    .prepare("SELECT payload_json FROM stage_runs WHERE source_id = ?")
    .all(sourceId) as Array<{ payload_json: string }>;
  for (const row of rows) {
    try {
      const stageRun = fromJson<{ source_format_profile_ids?: string[]; parser_version?: string }>(
        row.payload_json,
      );
      const profileId = stageRun.source_format_profile_ids?.find((entry) => entry.trim().length > 0);
      if (profileId) return profileId;
    } catch {
      continue;
    }
  }
  for (const row of rows) {
    try {
      const stageRun = fromJson<{ parser_version?: string }>(row.payload_json);
      if (stageRun.parser_version) return stageRun.parser_version;
    } catch {
      continue;
    }
  }
  return "";
}

/**
 * Streaming variant of `upsertDerivedCacheRefs`. Computes item_count and
 * payload_bytes per (cache_kind, scope) via SQL aggregation against the V1
 * tables, avoiding the need to load fragments/atoms/candidates into memory.
 *
 * Scope kinds produced (mirrors the non-streaming path):
 *   - source:      scope_ref = sourceId
 *   - parser_profile: scope_ref = parserProfileId
 *   - origin_path: scope_ref = blob.origin_path (from captured_blobs, joined via raw_records.blob_id)
 *   - session:     scope_ref = session_ref (every distinct session_ref in raw_records)
 *
 * The non-streaming path also walks origin_path scopes via per-blob records
 * and groups by session_refs that appear in those records. That gives the same
 * per-session numbers as joining raw_records to sessions directly, because
 * every session_ref that appears in any record is by definition "in scope" for
 * that session — so the GROUP BY session_ref result is equivalent.
 */
function upsertDerivedCacheRefsStreaming(
  db: DatabaseSync,
  sourceId: string,
  parserProfileId: string,
  now: string,
): void {
  const cacheTables: ReadonlyArray<DerivedCacheKind> = [
    "raw_records",
    "source_fragments",
    "conversation_atoms",
    "derived_candidates",
  ];

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO derived_cache_refs (
      id, cache_kind, source_id, scope_kind, scope_ref, parser_profile_id,
      evidence_sha256, item_count, payload_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
  `);
  const ref = (scopeKind: string, scopeRef: string) =>
    compositeKey("derived-cache", sourceId, scopeKind, scopeRef, parserProfileId);

  for (const cacheKind of cacheTables) {
    // Source-scoped
    const sourceStats = tablePayloadStats(db, cacheKind, "WHERE source_id = ?", [sourceId]);
    upsert.run(
      ref("source", sourceId),
      cacheKind,
      sourceId,
      "source",
      sourceId,
      parserProfileId,
      sourceStats.itemCount,
      sourceStats.payloadBytes,
      now,
      now,
    );

    // Parser-profile-scoped
    upsert.run(
      ref("parser_profile", parserProfileId),
      cacheKind,
      sourceId,
      "parser_profile",
      parserProfileId,
      parserProfileId,
      sourceStats.itemCount,
      sourceStats.payloadBytes,
      now,
      now,
    );

    // Session-scoped (via raw_records.session_ref or column on the table)
    const sessionColumn = sessionRefColumnFor(cacheKind);
    if (sessionColumn) {
      const sessionRows = db
        .prepare(
          `SELECT ${sessionColumn} AS session_ref,
                  COUNT(*) AS item_count,
                  COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) AS payload_bytes
             FROM ${cacheKind}
            WHERE source_id = ?
            GROUP BY ${sessionColumn}`,
        )
        .all(sourceId) as Array<{ session_ref: string; item_count: number; payload_bytes: number }>;
      for (const r of sessionRows) {
        if (!r.session_ref) continue;
        upsert.run(
          ref("session", r.session_ref),
          cacheKind,
          sourceId,
          "session",
          r.session_ref,
          parserProfileId,
          Number(r.item_count),
          Number(r.payload_bytes),
          now,
          now,
        );
      }
    }

    // Origin-path-scoped (only for cache kinds that have a blob_id column
    // joinable to captured_blobs: raw_records, parsed_record_spans). For
    // tables without blob_id, origin_path scope is left empty — the
    // non-streaming path also derives origin_path scope from records, so
    // fragments/atoms/candidates are grouped by session_refs seen in those
    // records. Doing that join in SQL is possible but adds complexity for
    // a derived stats table no current read path consumes.
    if (cacheKind === "raw_records") {
      const originRows = db
        .prepare(
          `SELECT cb.origin_path AS origin_path,
                  COUNT(*) AS item_count,
                  COALESCE(SUM(LENGTH(CAST(rr.payload_json AS BLOB))), 0) AS payload_bytes
             FROM raw_records rr
             JOIN captured_blobs cb ON cb.id = rr.blob_id
            WHERE rr.source_id = ?
            GROUP BY cb.origin_path`,
        )
        .all(sourceId) as Array<{ origin_path: string; item_count: number; payload_bytes: number }>;
      for (const r of originRows) {
        if (!r.origin_path) continue;
        const normalized = normalizeOriginPath(r.origin_path);
        upsert.run(
          ref("origin_path", normalized),
          cacheKind,
          sourceId,
          "origin_path",
          normalized,
          parserProfileId,
          Number(r.item_count),
          Number(r.payload_bytes),
          now,
          now,
        );
      }
    }
  }
}

function sessionRefColumnFor(cacheKind: DerivedCacheKind): string | undefined {
  switch (cacheKind) {
    case "raw_records":
      return "session_ref";
    case "source_fragments":
      return "session_ref";
    case "conversation_atoms":
      return "session_ref";
    case "derived_candidates":
      return "session_ref";
    default:
      return undefined;
  }
}

function tablePayloadStats(
  db: DatabaseSync,
  tableName: string,
  whereClause: string,
  params: readonly (string | number | null)[],
): { itemCount: number; payloadBytes: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS item_count,
              COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) AS payload_bytes
         FROM ${tableName}
         ${whereClause}`,
    )
    .get(...params) as { item_count: number; payload_bytes: number };
  return { itemCount: Number(row.item_count), payloadBytes: Number(row.payload_bytes) };
}

export function retireStorageBoundaryV2Sources(input: {
  db: DatabaseSync;
  sourceIds: readonly string[];
}): {
  /**
   * A.2: evidence blob shas whose evidence_blobs rows were dropped because
   * they are no longer referenced from any of the six live ref sources
   * (evidence_captures, parsed_record_spans, current source_file_ledger,
   * turn_context_refs_v2, derived_cache_refs, user_turns_v2.lineage_blob_sha256)
   * after this retirement. Caller unlinks the content-addressed files
   * outside the DB transaction.
   */
  pruned_evidence_shas: string[];
} {
  if (input.sourceIds.length === 0) {
    return { pruned_evidence_shas: [] };
  }
  const now = nowIso();
  const prunedShas: string[] = [];
  dbTransaction(input.db, () => {
    for (const sourceId of new Set(input.sourceIds)) {
      input.db.prepare("DELETE FROM parsed_record_spans WHERE source_id = ?").run(sourceId);
      input.db.prepare("DELETE FROM turn_context_refs_v2 WHERE source_id = ?").run(sourceId);
      input.db.prepare("DELETE FROM user_turns_v2 WHERE source_id = ?").run(sourceId);
      input.db.prepare("DELETE FROM derived_cache_refs WHERE source_id = ?").run(sourceId);
      // A.2: also drop evidence_captures rows for this source so their shas
      // become candidates for pruning. source_file_ledger is left in place
      // because its `sync_axis = 'source_absent'` marker is the audit trail
      // for "this source was here once"; the operator can purge the ledger
      // rows separately if audit retention permits.
      input.db.prepare("DELETE FROM evidence_captures WHERE source_id = ?").run(sourceId);
      input.db.prepare(`
        UPDATE source_file_ledger
           SET sync_axis = 'source_absent',
               updated_at = ?
         WHERE source_id = ?
           AND sync_axis <> 'source_absent'
      `).run(now, sourceId);
    }
    // A.2: prune evidence_blobs rows whose sha is no longer referenced. Done
    // once for the whole batch because the shared prune scans evidence_blobs
    // end-to-end.
    prunedShas.push(...pruneUnreferencedEvidenceBlobsInTransaction(input.db));
  });
  return { pruned_evidence_shas: prunedShas };
}

export function readTurnContextFromV2Cache(input: {
  db: DatabaseSync;
  assetDir?: string;
  turnId: string;
}): TurnContextProjection | undefined {
  if (!input.assetDir) {
    return undefined;
  }
  const row = input.db.prepare(`
    SELECT context_evidence_sha256,
           cache_storage_path
      FROM turn_context_refs_v2 tcr
     WHERE tcr.turn_id = ?
  `).get(input.turnId) as
    | {
        context_evidence_sha256: string;
        cache_storage_path: string;
      }
    | undefined;
  if (!row?.cache_storage_path) {
    return undefined;
  }

  const cachePath = path.resolve(input.assetDir, row.cache_storage_path);
  if (!isPathWithinDirectory(cachePath, input.assetDir) || !existsSync(cachePath)) {
    return undefined;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(cachePath);
  } catch (err) {
    emitEvidenceBlobWarning(
      `turn context cache read failed (turn=${input.turnId}, path=${row.cache_storage_path}): ${(err as Error).message}`,
    );
    return undefined;
  }

  if (row.context_evidence_sha256 && hashBytes("sha256", bytes) !== row.context_evidence_sha256) {
    // H1: integrity violation. The DB row claims this sha but the file content
    // hashes differently — corrupted blob, partial write, or tampering. Silent
    // failure here masks the bug; the turn's lineage_atom_count etc. would
    // disagree with the now-empty lineage the caller reconstructs.
    emitEvidenceBlobWarning(
      `turn context cache sha256 mismatch (turn=${input.turnId}, path=${row.cache_storage_path}) — expected ${row.context_evidence_sha256.slice(0, 12)}, content does not match. Treating as missing.`,
    );
    return undefined;
  }

  let context: TurnContextProjection;
  try {
    context = fromJson<TurnContextProjection>(bytes.toString("utf8"), `turn context cache ${input.turnId}`);
  } catch (err) {
    emitEvidenceBlobWarning(
      `turn context cache JSON parse failed (turn=${input.turnId}, path=${row.cache_storage_path}): ${(err as Error).message}`,
    );
    return undefined;
  }
  return context.turn_id === input.turnId ? context : undefined;
}

/**
 * B.5.0g: read the full lineage blob for a V2 user turn. Returns undefined if
 * the sidecar hasn't been backfilled with lineage_blob_sha256 yet (older
 * stores) or the blob content fails sha256 verification. Callers that only
 * need counts should read user_turns_v2.lineage_*_count directly — this
 * helper is for callers that need the actual refs array.
 *
 * Performance note (C1 fix): list callers should prefer `loadLineageBlobsBySha`
 * — it dedupes identical shas in a single batch and avoids the per-turn
 * `SELECT lineage_blob_sha256` round-trip (the sha is already in the parent
 * row's columns). This function is kept for single-turn readers where the
 * overhead is negligible.
 */
export function readTurnLineageFromV2Blob(input: {
  db: DatabaseSync;
  assetDir?: string;
  turnId: string;
}): UserTurnProjection["lineage"] | undefined {
  if (!input.assetDir) {
    return undefined;
  }
  const row = input.db
    .prepare(
      `SELECT lineage_blob_sha256 AS sha
         FROM user_turns_v2
        WHERE turn_id = ?`,
    )
    .get(input.turnId) as { sha: string } | undefined;
  if (!row?.sha) {
    return undefined;
  }
  return readTurnLineageBlobBySha({ assetDir: input.assetDir, sha: row.sha });
}

/**
 * B.5.0g + C1 fix: read lineage blobs in batch, keyed by sha. Returns a map
 * sha → lineage object. Identical shas (common when many turns share the same
 * lineage) are read once. Missing files, sha256 mismatches, and JSON parse
 * failures are silently dropped from the map — the caller's per-row fallback
 * (empty refs arrays) covers the legitimate "not yet backfilled" case. The
 * illegitimate case (corrupted blob) is a separate concern (see H1).
 */
export function loadLineageBlobsBySha(input: {
  assetDir: string;
  shas: readonly string[];
}): Map<string, UserTurnProjection["lineage"]> {
  const result = new Map<string, UserTurnProjection["lineage"]>();
  for (const sha of new Set(input.shas)) {
    if (!sha) continue;
    const lineage = readTurnLineageBlobBySha({ assetDir: input.assetDir, sha });
    if (lineage) {
      result.set(sha, lineage);
    }
  }
  return result;
}

function readTurnLineageBlobBySha(input: {
  assetDir: string;
  sha: string;
}): UserTurnProjection["lineage"] | undefined {
  const storagePath = path.join("evidence", "blobs", input.sha.slice(0, 2), input.sha);
  const absolutePath = path.resolve(input.assetDir, storagePath);
  if (!isPathWithinDirectory(absolutePath, input.assetDir) || !existsSync(absolutePath)) {
    return undefined;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(absolutePath);
  } catch (err) {
    emitEvidenceBlobWarning(
      `turn lineage blob read failed (sha=${input.sha.slice(0, 12)}, path=${storagePath}): ${(err as Error).message}`,
    );
    return undefined;
  }

  if (hashBytes("sha256", bytes) !== input.sha) {
    // H1: integrity violation. The sidecar claims this sha but the file content
    // hashes differently. Silent failure here masks corrupted/tampered blobs —
    // the turn's lineage_*_count columns would disagree with the empty refs
    // arrays the caller reconstructs. The right operator action is to re-run
    // B.3 to re-materialize the blob.
    emitEvidenceBlobWarning(
      `turn lineage blob sha256 mismatch (sha=${input.sha.slice(0, 12)}, path=${storagePath}) — content does not match the claimed sha. Treating as missing.`,
    );
    return undefined;
  }

  try {
    return fromJson<UserTurnProjection["lineage"]>(
      bytes.toString("utf8"),
      `turn lineage blob sha=${input.sha.slice(0, 12)}`,
    );
  } catch (err) {
    emitEvidenceBlobWarning(
      `turn lineage blob JSON parse failed (sha=${input.sha.slice(0, 12)}, path=${storagePath}): ${(err as Error).message}`,
    );
    return undefined;
  }
}

/**
 * H1: surface evidence-blob integrity violations via process.emitWarning so
 * they appear in operator logs without forcing a throw on the read path. The
 * read still returns undefined (callers reconstruct counts-only lineage) so
 * the migration validator's parity check continues to function; the warning
 * makes the latent corruption visible. Set CCHISTORY_SHOW_RUNTIME_WARNINGS=1
 * is not required — these are not Node.js runtime warnings.
 */
function emitEvidenceBlobWarning(message: string): void {
  process.emitWarning(message, {
    type: "CCHistoryEvidenceBlobIntegrity",
    code: "CCHISTORY_EVIDENCE_BLOB_INTEGRITY",
  });
}

function prepareReplaceCurrentState(
  db: DatabaseSync,
  sourceId: string,
  incomingOriginPaths: readonly string[],
  now: string,
): void {
  db.prepare("DELETE FROM parsed_record_spans WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM turn_context_refs_v2 WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM user_turns_v2 WHERE source_id = ?").run(sourceId);
  db.prepare("DELETE FROM derived_cache_refs WHERE source_id = ?").run(sourceId);
  markUnobservedLedgersSourceAbsent(db, sourceId, incomingOriginPaths, now);
}

function prepareMergeCurrentState(
  db: DatabaseSync,
  input: {
    payload: SourceSyncPayload;
    incomingOriginPaths: readonly string[];
    preserveOriginPaths?: readonly string[];
    observedOriginPaths?: readonly string[];
    now: string;
  },
): void {
  const sourceId = input.payload.source.id;
  const preserveOriginPaths = new Set((input.preserveOriginPaths ?? []).map(normalizeOriginPath));
  const incomingOriginPaths = new Set(input.incomingOriginPaths.map(normalizeOriginPath));
  const replaceOriginPaths = new Set<string>();
  for (const originPath of incomingOriginPaths) {
    if (!preserveOriginPaths.has(originPath)) {
      replaceOriginPaths.add(originPath);
    }
  }
  if (input.observedOriginPaths) {
    const observedOriginPaths = new Set(input.observedOriginPaths.map(normalizeOriginPath));
    for (const originPath of observedOriginPaths) {
      if (!preserveOriginPaths.has(originPath) && !incomingOriginPaths.has(originPath)) {
        replaceOriginPaths.add(originPath);
      }
    }
    for (const originPath of selectCurrentLedgerOriginPaths(db, sourceId)) {
      if (!observedOriginPaths.has(originPath)) {
        replaceOriginPaths.add(originPath);
      }
    }
  }

  const sessionRefs = new Set<string>();
  for (const record of input.payload.records) {
    sessionRefs.add(record.session_ref);
  }
  for (const session of input.payload.sessions) {
    sessionRefs.add(session.id);
  }
  for (const turn of input.payload.turns) {
    sessionRefs.add(turn.session_id);
  }
  for (const blobId of selectCurrentLedgerBlobIds(db, sourceId, replaceOriginPaths)) {
    for (const sessionRef of selectParsedSpanSessionRefsByBlobId(db, sourceId, blobId)) {
      sessionRefs.add(sessionRef);
    }
  }

  const selectTurnIds = db.prepare("SELECT turn_id FROM user_turns_v2 WHERE source_id = ? AND session_id = ?");
  const deleteContext = db.prepare("DELETE FROM turn_context_refs_v2 WHERE source_id = ? AND turn_id = ?");
  const deleteTurns = db.prepare("DELETE FROM user_turns_v2 WHERE source_id = ? AND session_id = ?");
  const deleteSpans = db.prepare("DELETE FROM parsed_record_spans WHERE source_id = ? AND session_ref = ?");
  const deleteCacheRef = db.prepare("DELETE FROM derived_cache_refs WHERE source_id = ? AND scope_kind = ? AND scope_ref = ?");
  for (const sessionRef of sessionRefs) {
    for (const row of selectTurnIds.all(sourceId, sessionRef) as Array<{ turn_id: string }>) {
      deleteContext.run(sourceId, row.turn_id);
    }
    deleteTurns.run(sourceId, sessionRef);
    deleteSpans.run(sourceId, sessionRef);
    deleteCacheRef.run(sourceId, "session", sessionRef);
  }
  db.prepare("DELETE FROM derived_cache_refs WHERE source_id = ? AND scope_kind IN ('source', 'parser_profile')").run(sourceId);
  for (const originPath of replaceOriginPaths) {
    deleteCacheRef.run(sourceId, "origin_path", originPath);
  }

  const markAbsent = db.prepare(`
    UPDATE source_file_ledger
       SET sync_axis = 'source_absent',
           updated_at = ?
     WHERE source_id = ?
       AND origin_path = ?
       AND sync_axis <> 'source_absent'
  `);
  for (const originPath of replaceOriginPaths) {
    if (!incomingOriginPaths.has(originPath)) {
      markAbsent.run(input.now, sourceId, originPath);
    }
  }

  if (input.observedOriginPaths) {
    markUnobservedLedgersSourceAbsent(db, sourceId, input.observedOriginPaths.map(normalizeOriginPath), input.now);
  }
}

function selectCurrentLedgerOriginPaths(db: DatabaseSync, sourceId: string): string[] {
  return (db.prepare("SELECT origin_path FROM source_file_ledger WHERE source_id = ?").all(sourceId) as Array<{
    origin_path: string;
  }>).map((row) => normalizeOriginPath(row.origin_path));
}

function selectCurrentLedgerBlobIds(
  db: DatabaseSync,
  sourceId: string,
  originPaths: ReadonlySet<string>,
): string[] {
  if (originPaths.size === 0) {
    return [];
  }
  const ids: string[] = [];
  const select = db.prepare("SELECT current_blob_id FROM source_file_ledger WHERE source_id = ? AND origin_path = ?");
  for (const originPath of originPaths) {
    for (const row of select.all(sourceId, originPath) as Array<{ current_blob_id: string }>) {
      if (row.current_blob_id) {
        ids.push(row.current_blob_id);
      }
    }
  }
  return [...new Set(ids)];
}

function selectParsedSpanSessionRefsByBlobId(db: DatabaseSync, sourceId: string, blobId: string): string[] {
  return [
    ...new Set(
      (db.prepare("SELECT session_ref FROM parsed_record_spans WHERE source_id = ? AND blob_id = ?").all(sourceId, blobId) as Array<{
        session_ref: string;
      }>).map((row) => row.session_ref).filter(Boolean),
    ),
  ];
}

function markUnobservedLedgersSourceAbsent(
  db: DatabaseSync,
  sourceId: string,
  observedOriginPaths: readonly string[],
  now: string,
): void {
  const observed = new Set(observedOriginPaths.map(normalizeOriginPath));
  const update = db.prepare(`
    UPDATE source_file_ledger
       SET sync_axis = 'source_absent',
           updated_at = ?
     WHERE source_id = ?
       AND origin_path = ?
       AND sync_axis <> 'source_absent'
  `);
  const rows = db.prepare("SELECT origin_path FROM source_file_ledger WHERE source_id = ?").all(sourceId) as Array<{
    origin_path: string;
  }>;
  for (const row of rows) {
    const originPath = normalizeOriginPath(row.origin_path);
    if (!observed.has(originPath)) {
      update.run(now, sourceId, originPath);
    }
  }
}

function materializeBlobEvidence(input: {
  assetDir?: string;
  blob: CapturedBlob;
  records: readonly RawRecord[];
  createdAt: string;
}): EvidenceMaterialization {
  const trustedBytes = readTrustedBlobBytes(input.blob);
  if (trustedBytes) {
    return materializeBytes({
      assetDir: input.assetDir,
      bytes: trustedBytes,
      mediaType: "application/octet-stream",
      captureKind: "source_blob",
      createdAt: input.createdAt,
    });
  }

  const snapshot = Buffer.from(
    `${JSON.stringify(
      {
        blob: {
          ...input.blob,
          captured_path: undefined,
        },
        records: [...input.records].sort((left, right) => left.ordinal - right.ordinal),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return materializeBytes({
    assetDir: input.assetDir,
    bytes: snapshot,
    mediaType: "application/vnd.cchistory.records-snapshot+json",
    captureKind: "record_snapshot",
    createdAt: input.createdAt,
  });
}

function materializeContextCache(input: {
  assetDir?: string;
  context: TurnContextProjection;
  createdAt: string;
}): EvidenceMaterialization {
  return materializeBytes({
    assetDir: input.assetDir,
    bytes: Buffer.from(`${JSON.stringify(input.context)}\n`, "utf8"),
    mediaType: "application/vnd.cchistory.turn-context+json",
    captureKind: "context_cache",
    createdAt: input.createdAt,
  });
}

function materializeTurnLineage(input: {
  assetDir?: string;
  lineage: UserTurnProjection["lineage"];
  createdAt: string;
}): EvidenceMaterialization {
  return materializeBytes({
    assetDir: input.assetDir,
    bytes: Buffer.from(`${JSON.stringify(input.lineage)}\n`, "utf8"),
    mediaType: "application/vnd.cchistory.turn-lineage+json",
    captureKind: "turn_lineage",
    createdAt: input.createdAt,
  });
}

function materializeBytes(input: {
  assetDir?: string;
  bytes: Buffer;
  mediaType: string;
  captureKind: EvidenceMaterialization["captureKind"];
  createdAt: string;
}): EvidenceMaterialization {
  const sha256 = hashBytes("sha256", input.bytes);
  const storagePath = path.join("evidence", "blobs", sha256.slice(0, 2), sha256);
  if (input.assetDir) {
    const absolutePath = path.join(input.assetDir, storagePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    try {
      writeFileSync(absolutePath, input.bytes, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }
  return {
    sha256,
    storagePath,
    sizeBytes: input.bytes.byteLength,
    bytes: input.bytes,
    mediaType: input.mediaType,
    captureKind: input.captureKind,
    createdAt: input.createdAt,
  };
}

function readTrustedBlobBytes(blob: CapturedBlob): Buffer | undefined {
  for (const candidatePath of [blob.captured_path, blob.origin_path]) {
    if (!candidatePath || isVirtualBlobPath(candidatePath) || !existsSync(candidatePath)) {
      continue;
    }
    let stats;
    try {
      stats = statSync(candidatePath);
    } catch {
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }
    const bytes = readFileSync(candidatePath);
    if (blob.size_bytes > 0 && bytes.byteLength !== blob.size_bytes) {
      continue;
    }
    if (!sourceChecksumMatches(bytes, blob.checksum)) {
      continue;
    }
    return bytes;
  }
  return undefined;
}

function sourceChecksumMatches(bytes: Buffer, checksum: string): boolean {
  const normalized = checksum.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (/^[a-f0-9]{40}$/u.test(normalized)) {
    return hashBytes("sha1", bytes) === normalized;
  }
  if (/^[a-f0-9]{64}$/u.test(normalized)) {
    return hashBytes("sha256", bytes) === normalized;
  }
  return false;
}

function upsertEvidenceBlob(db: DatabaseSync, materialized: EvidenceMaterialization): void {
  db.prepare(`
    INSERT OR IGNORE INTO evidence_blobs (
      sha256,
      storage_path,
      size_bytes,
      media_type,
      encoding,
      compression,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    materialized.sha256,
    materialized.storagePath,
    materialized.sizeBytes,
    materialized.mediaType,
    "binary",
    "none",
    materialized.createdAt,
  );
}

function upsertEvidenceCapture(
  db: DatabaseSync,
  sourceId: string,
  blob: CapturedBlob,
  materialized: EvidenceMaterialization,
  createdAt: string,
): void {
  db.prepare(`
    INSERT OR REPLACE INTO evidence_captures (
      id,
      evidence_sha256,
      source_id,
      blob_id,
      origin_path,
      source_checksum,
      size_bytes,
      captured_at,
      capture_run_id,
      host_id,
      captured_path,
      file_modified_at,
      file_changed_at,
      file_identity_stable,
      capture_kind,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    compositeKey("evidence-capture", sourceId, blob.id, materialized.sha256),
    materialized.sha256,
    sourceId,
    blob.id,
    normalizeOriginPath(blob.origin_path),
    blob.checksum,
    blob.size_bytes,
    blob.captured_at,
    blob.capture_run_id,
    blob.host_id,
    blob.captured_path ?? null,
    blob.file_modified_at ?? null,
    blob.file_changed_at ?? null,
    blob.file_identity_stable === true ? 1 : 0,
    materialized.captureKind,
    createdAt,
  );
}

function upsertSourceFileLedger(
  db: DatabaseSync,
  input: {
    sourceId: string;
    blob: CapturedBlob;
    materialized: EvidenceMaterialization;
    records?: readonly RawRecord[];
    sessionRefs?: readonly string[];
    lastRecordOrdinal?: number | null;
    parserProfileId: string;
    observedAt: string;
  },
): void {
  const sortedRecords = input.records ? [...input.records].sort((left, right) => left.ordinal - right.ordinal) : [];
  const lastRecordOrdinal = input.records ? sortedRecords.at(-1)?.ordinal ?? null : input.lastRecordOrdinal ?? null;
  const sessionRefs = input.records
    ? [...new Set(sortedRecords.map((record) => record.session_ref).filter(Boolean))].sort()
    : [...new Set((input.sessionRefs ?? []).filter(Boolean))].sort();
  db.prepare(`
    INSERT OR REPLACE INTO source_file_ledger (
      id,
      source_id,
      origin_path,
      current_blob_id,
      current_evidence_sha256,
      source_checksum,
      size_bytes,
      file_modified_at,
      file_changed_at,
      file_identity_stable,
      parser_profile_id,
      parsed_byte_offset,
      last_valid_jsonl_boundary,
      last_record_ordinal,
      last_derived_session_refs,
      sync_axis,
      observed_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourceFileLedgerId(input.sourceId, normalizeOriginPath(input.blob.origin_path)),
    input.sourceId,
    normalizeOriginPath(input.blob.origin_path),
    input.blob.id,
    input.materialized.sha256,
    input.blob.checksum,
    input.blob.size_bytes,
    input.blob.file_modified_at ?? null,
    input.blob.file_changed_at ?? null,
    input.blob.file_identity_stable === true ? 1 : 0,
    input.parserProfileId,
    input.materialized.captureKind === "source_blob" ? input.materialized.sizeBytes : null,
    input.materialized.captureKind === "source_blob" ? findLastJsonlBoundary(input.materialized.bytes) : null,
    lastRecordOrdinal,
    JSON.stringify(sessionRefs),
    "current",
    input.observedAt,
    input.observedAt,
  );
}

function upsertParsedRecordSpan(
  db: DatabaseSync,
  input: {
    record: RawRecord;
    materialized?: EvidenceMaterialization;
    lineSpan?: JsonlLineSpan;
    parserProfileId: string;
    createdAt: string;
  },
): void {
  const spanKind = input.lineSpan ? "line" : "logical_record";
  db.prepare(`
    INSERT OR REPLACE INTO parsed_record_spans (
      record_id,
      source_id,
      blob_id,
      session_ref,
      ordinal,
      evidence_sha256,
      span_kind,
      start_byte,
      end_byte,
      span_label,
      parser_profile_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.record.id,
    input.record.source_id,
    input.record.blob_id,
    input.record.session_ref,
    input.record.ordinal,
    input.materialized?.sha256 ?? "",
    spanKind,
    input.lineSpan?.startByte ?? null,
    input.lineSpan?.endByte ?? null,
    input.record.record_path_or_offset,
    input.parserProfileId,
    input.createdAt,
  );
}

function upsertBoundedUserTurn(input: {
  db: DatabaseSync;
  turn: UserTurnProjection;
  boundedAt: string;
  assetDir?: string;
}): void {
  const { db, turn, boundedAt } = input;
  const rawTextBytes = Buffer.byteLength(turn.raw_text ?? "", "utf8");
  const displaySegmentsJson = boundedJson(turn.display_segments, 8 * 1024);
  const contextSummaryJson = boundedJson(turn.context_summary ?? {}, 8 * 1024);
  const lineageRefsJson = boundedJson(turn.lineage ?? {}, 8 * 1024);
  const canonicalText = boundedString(turn.canonical_text ?? "", 16 * 1024);
  const rawTextPreview = boundedString(turn.raw_text ?? "", 4 * 1024);
  const payloadBytes =
    Buffer.byteLength(canonicalText, "utf8") +
    Buffer.byteLength(rawTextPreview, "utf8") +
    Buffer.byteLength(displaySegmentsJson, "utf8") +
    Buffer.byteLength(contextSummaryJson, "utf8") +
    Buffer.byteLength(lineageRefsJson, "utf8");
  const userMessagesJson = JSON.stringify(turn.user_messages ?? []);
  const rawTextFull = turn.raw_text ?? "";
  const canonicalTextFull = turn.canonical_text ?? "";
  const projectId = turn.project_id ?? "";
  const projectRef = turn.project_ref ?? "";
  const projectLinkState = turn.project_link_state ?? "";
  const lastContextActivityAt = turn.last_context_activity_at ?? "";
  const pathText = turn.path_text ?? "";

  // B.5.0g: full lineage lives in a content-addressed blob; sidecar keeps
  // counts for fast list-view density and a sha256 for lazy fetch. Mirrors
  // turn_context_refs_v2 (sha in sidecar, content in evidence_blobs).
  const lineage = turn.lineage ?? {
    atom_refs: [],
    candidate_refs: [],
    fragment_refs: [],
    record_refs: [],
    blob_refs: [],
  };
  const lineageMaterialized = materializeTurnLineage({
    assetDir: input.assetDir,
    lineage,
    createdAt: boundedAt,
  });
  upsertEvidenceBlob(db, lineageMaterialized);

  db.prepare(`
    INSERT OR REPLACE INTO user_turns_v2 (
      turn_id,
      turn_revision_id,
      source_id,
      session_id,
      created_at,
      submission_started_at,
      canonical_text,
      raw_text_preview,
      raw_text_bytes,
      display_segments_json,
      context_ref,
      context_summary_json,
      lineage_refs_json,
      link_state,
      sync_axis,
      value_axis,
      retention_axis,
      payload_bytes,
      bounded_at,
      user_messages_json,
      raw_text_full,
      project_id,
      project_ref,
      project_link_state,
      last_context_activity_at,
      path_text,
      canonical_text_full,
      lineage_blob_sha256,
      lineage_atom_count,
      lineage_fragment_count,
      lineage_record_count,
      lineage_blob_count,
      lineage_candidate_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    turn.turn_id,
    turn.turn_revision_id,
    turn.source_id,
    turn.session_id,
    turn.created_at,
    turn.submission_started_at,
    canonicalText,
    rawTextPreview,
    rawTextBytes,
    displaySegmentsJson,
    turn.context_ref ?? "",
    contextSummaryJson,
    lineageRefsJson,
    turn.link_state,
    turn.sync_axis,
    turn.value_axis,
    turn.retention_axis,
    Math.min(payloadBytes, USER_TURN_V2_INLINE_BUDGET_BYTES),
    boundedAt,
    userMessagesJson,
    rawTextFull,
    projectId,
    projectRef,
    projectLinkState,
    lastContextActivityAt,
    pathText,
    canonicalTextFull,
    lineageMaterialized.sha256,
    lineage.atom_refs.length,
    lineage.fragment_refs.length,
    lineage.record_refs.length,
    lineage.blob_refs.length,
    lineage.candidate_refs.length,
  );
}

function upsertTurnContextRef(
  db: DatabaseSync,
  context: TurnContextProjection,
  sourceId: string,
  materialized: EvidenceMaterialization,
  now: string,
): void {
  const preview = {
    assistant_replies: context.assistant_replies.map((reply) => ({
      id: reply.id,
      content_preview: boundedString(reply.content_preview || reply.content || "", 512),
      model: reply.model,
      created_at: reply.created_at,
      tool_call_ids: reply.tool_call_ids,
      stop_reason: reply.stop_reason,
    })),
    tool_calls: context.tool_calls.map((toolCall) => ({
      id: toolCall.id,
      tool_name: toolCall.tool_name,
      input_summary: boundedString(toolCall.input_summary, 512),
      output_preview: boundedString(toolCall.output_preview ?? "", 512),
      status: toolCall.status,
      reply_id: toolCall.reply_id,
      sequence: toolCall.sequence,
      created_at: toolCall.created_at,
    })),
  };
  db.prepare(`
    INSERT OR REPLACE INTO turn_context_refs_v2 (
      turn_id,
      source_id,
      context_evidence_sha256,
      cache_storage_path,
      assistant_reply_count,
      tool_call_count,
      system_message_count,
      preview_json,
      raw_event_refs_json,
      full_context_bytes,
      inline_budget_bytes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    context.turn_id,
    sourceId,
    materialized.sha256,
    materialized.storagePath,
    context.assistant_replies.length,
    context.tool_calls.length,
    context.system_messages.length,
    boundedJson(preview, TURN_CONTEXT_INLINE_BUDGET_BYTES),
    boundedJson(context.raw_event_refs, 4 * 1024),
    materialized.sizeBytes,
    TURN_CONTEXT_INLINE_BUDGET_BYTES,
    now,
    now,
  );
}

type DerivedCacheKind = "raw_records" | "source_fragments" | "conversation_atoms" | "derived_candidates";

function upsertDerivedCacheRefs(
  db: DatabaseSync,
  payload: SourceSyncPayload,
  parserProfileId: string,
  now: string,
  itemByteSize: (item: object) => number,
): void {
  const sourceId = payload.source.id;
  const cacheKinds: readonly DerivedCacheKind[] = [
    "raw_records",
    "source_fragments",
    "conversation_atoms",
    "derived_candidates",
  ];

  upsertDerivedCacheRef(db, {
    sourceId,
    cacheKind: "raw_records",
    scopeKind: "source",
    scopeRef: sourceId,
    parserProfileId,
    ...readCurrentCacheStats(db, "raw_records", sourceId),
    now,
  });
  upsertDerivedCacheRef(db, {
    sourceId,
    cacheKind: "source_fragments",
    scopeKind: "source",
    scopeRef: sourceId,
    parserProfileId,
    ...readCurrentCacheStats(db, "source_fragments", sourceId),
    now,
  });
  upsertDerivedCacheRef(db, {
    sourceId,
    cacheKind: "conversation_atoms",
    scopeKind: "source",
    scopeRef: sourceId,
    parserProfileId,
    ...readCurrentCacheStats(db, "conversation_atoms", sourceId),
    now,
  });
  upsertDerivedCacheRef(db, {
    sourceId,
    cacheKind: "derived_candidates",
    scopeKind: "source",
    scopeRef: sourceId,
    parserProfileId,
    ...readCurrentCacheStats(db, "derived_candidates", sourceId),
    now,
  });

  for (const cacheKind of cacheKinds) {
    upsertDerivedCacheRef(db, {
      sourceId,
      cacheKind,
      scopeKind: "parser_profile",
      scopeRef: parserProfileId,
      parserProfileId,
      ...readCurrentCacheStats(db, cacheKind, sourceId),
      now,
    });
  }

  const recordsByBlobId = groupBy(payload.records, (record) => record.blob_id);
  const recordsBySession = groupBy(payload.records, (record) => record.session_ref);
  const fragmentsBySession = groupBy(payload.fragments, (fragment) => fragment.session_ref);
  const atomsBySession = groupBy(payload.atoms, (atom) => atom.session_ref);
  const candidatesBySession = groupBy(payload.candidates, (candidate) => candidate.session_ref);
  const sessionRefs = new Set<string>();

  for (const blob of dedupeByKey(payload.blobs, (entry) => entry.id)) {
    const originPath = normalizeOriginPath(blob.origin_path);
    const records = recordsByBlobId.get(blob.id) ?? [];
    const originSessionRefs = new Set(records.map((record) => record.session_ref).filter(Boolean));
    for (const sessionRef of originSessionRefs) {
      sessionRefs.add(sessionRef);
    }
    upsertScopedDerivedCacheRefs(db, {
      sourceId,
      scopeKind: "origin_path",
      scopeRef: originPath,
      parserProfileId,
      records,
      fragments: selectItemsBySessions(fragmentsBySession, originSessionRefs),
      atoms: selectItemsBySessions(atomsBySession, originSessionRefs),
      candidates: selectItemsBySessions(candidatesBySession, originSessionRefs),
      now,
      itemByteSize,
    });
  }

  for (const sessionRef of sessionRefs) {
    upsertScopedDerivedCacheRefs(db, {
      sourceId,
      scopeKind: "session",
      scopeRef: sessionRef,
      parserProfileId,
      records: recordsBySession.get(sessionRef) ?? [],
      fragments: fragmentsBySession.get(sessionRef) ?? [],
      atoms: atomsBySession.get(sessionRef) ?? [],
      candidates: candidatesBySession.get(sessionRef) ?? [],
      now,
      itemByteSize,
    });
  }
}

function readCurrentCacheStats(
  db: DatabaseSync,
  tableName: "raw_records" | "source_fragments" | "conversation_atoms" | "derived_candidates",
  sourceId: string,
): { itemCount: number; payloadBytes: number } {
  const row = db.prepare(`
    SELECT COUNT(*) AS item_count,
           COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) AS payload_bytes
      FROM ${tableName}
     WHERE source_id = ?
  `).get(sourceId) as { item_count: number; payload_bytes: number };
  return {
    itemCount: Number(row.item_count) || 0,
    payloadBytes: Number(row.payload_bytes) || 0,
  };
}

function upsertDerivedCacheRef(
  db: DatabaseSync,
  input: {
    sourceId: string;
    cacheKind: DerivedCacheKind;
    scopeKind: string;
    scopeRef: string;
    parserProfileId: string;
    itemCount: number;
    payloadBytes: number;
    now: string;
  },
): void {
  db.prepare(`
    INSERT OR REPLACE INTO derived_cache_refs (
      id,
      cache_kind,
      source_id,
      scope_kind,
      scope_ref,
      parser_profile_id,
      evidence_sha256,
      item_count,
      payload_bytes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    compositeKey("derived-cache", input.sourceId, input.cacheKind, input.scopeKind, input.scopeRef, input.parserProfileId),
    input.cacheKind,
    input.sourceId,
    input.scopeKind,
    input.scopeRef,
    input.parserProfileId,
    "",
    input.itemCount,
    input.payloadBytes,
    input.now,
    input.now,
  );
}

function upsertScopedDerivedCacheRefs(
  db: DatabaseSync,
  input: {
    sourceId: string;
    scopeKind: string;
    scopeRef: string;
    parserProfileId: string;
    records: readonly RawRecord[];
    fragments: readonly SourceSyncPayload["fragments"][number][];
    atoms: readonly SourceSyncPayload["atoms"][number][];
    candidates: readonly SourceSyncPayload["candidates"][number][];
    now: string;
    itemByteSize: (item: object) => number;
  },
): void {
  upsertDerivedCacheRef(db, {
    sourceId: input.sourceId,
    cacheKind: "raw_records",
    scopeKind: input.scopeKind,
    scopeRef: input.scopeRef,
    parserProfileId: input.parserProfileId,
    ...payloadCacheStats(input.records, input.itemByteSize),
    now: input.now,
  });
  upsertDerivedCacheRef(db, {
    sourceId: input.sourceId,
    cacheKind: "source_fragments",
    scopeKind: input.scopeKind,
    scopeRef: input.scopeRef,
    parserProfileId: input.parserProfileId,
    ...payloadCacheStats(input.fragments, input.itemByteSize),
    now: input.now,
  });
  upsertDerivedCacheRef(db, {
    sourceId: input.sourceId,
    cacheKind: "conversation_atoms",
    scopeKind: input.scopeKind,
    scopeRef: input.scopeRef,
    parserProfileId: input.parserProfileId,
    ...payloadCacheStats(input.atoms, input.itemByteSize),
    now: input.now,
  });
  upsertDerivedCacheRef(db, {
    sourceId: input.sourceId,
    cacheKind: "derived_candidates",
    scopeKind: input.scopeKind,
    scopeRef: input.scopeRef,
    parserProfileId: input.parserProfileId,
    ...payloadCacheStats(input.candidates, input.itemByteSize),
    now: input.now,
  });
}

function selectItemsBySessions<T extends { session_ref: string }>(
  groups: Map<string, T[]>,
  sessionRefs: ReadonlySet<string>,
): T[] {
  const items: T[] = [];
  for (const sessionRef of sessionRefs) {
    items.push(...(groups.get(sessionRef) ?? []));
  }
  return items;
}

function payloadCacheStats(items: readonly object[], itemByteSize: (item: object) => number): { itemCount: number; payloadBytes: number } {
  let payloadBytes = 0;
  for (const item of items) {
    payloadBytes += itemByteSize(item);
  }
  return {
    itemCount: items.length,
    payloadBytes,
  };
}

// Per-write cache of JSON byte sizes. The same record/fragment/atom/candidate
// objects are referenced from multiple scopes (origin_path + session), so
// serializing them once per write avoids repeated JSON.stringify cost on large
// payloads. WeakMap + function scope lets GC reclaim entries after the write.
function createItemByteSizeCache(): (item: object) => number {
  const cache = new WeakMap<object, number>();
  return (item) => {
    const cached = cache.get(item);
    if (cached !== undefined) {
      return cached;
    }
    const size = Buffer.byteLength(JSON.stringify(item), "utf8");
    cache.set(item, size);
    return size;
  };
}

function deriveParserProfileId(payload: SourceSyncPayload): string {
  for (const stageRun of payload.stage_runs) {
    const profileId = stageRun.source_format_profile_ids?.find((entry) => entry.trim().length > 0);
    if (profileId) {
      return profileId;
    }
  }
  for (const stageRun of payload.stage_runs) {
    if (stageRun.parser_version) {
      return stageRun.parser_version;
    }
  }
  return "";
}

function indexJsonlLineSpans(bytes: Buffer): Map<number, JsonlLineSpan> {
  const spans = new Map<number, JsonlLineSpan>();
  for (const span of iterateJsonlLineSpans(bytes)) {
    spans.set(span.ordinal, span);
  }
  return spans;
}

function* iterateJsonlLineSpans(bytes: Buffer): Iterable<JsonlLineSpan> {
  let lineStart = 0;
  let ordinal = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    const isEnd = index === bytes.length;
    const value = isEnd ? -1 : bytes[index];
    if (!isEnd && value !== 10 && value !== 13) {
      continue;
    }

    let contentStart = lineStart;
    let contentEnd = index;
    while (contentStart < contentEnd && isAsciiWhitespace(bytes[contentStart]!)) {
      contentStart += 1;
    }
    while (contentEnd > contentStart && isAsciiWhitespace(bytes[contentEnd - 1]!)) {
      contentEnd -= 1;
    }
    if (contentEnd > contentStart) {
      yield {
        ordinal,
        startByte: contentStart,
        endByte: contentEnd,
      };
      ordinal += 1;
    }

    if (value === 13 && index + 1 < bytes.length && bytes[index + 1] === 10) {
      index += 1;
    }
    lineStart = index + 1;
  }
}

function findLastJsonlBoundary(bytes: Buffer): number | null {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const value = bytes[index];
    if (value === 10 || value === 13) {
      return index + 1;
    }
  }
  return bytes.length > 0 ? bytes.length : null;
}

function boundedString(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  const TRUNCATOR = "...[truncated]";
  // Reserve room for the truncation marker. The previous code hard-coded 20;
  // computing from the actual marker means the bound is honored exactly.
  const reserve = Buffer.byteLength(TRUNCATOR, "utf8");
  const cut = Math.max(0, maxBytes - reserve);
  const sliced = bytes.subarray(0, cut);
  const decoded = sliced.toString("utf8");
  // Only strip a trailing U+FFFD if it's a truncation artifact \u2014 i.e., the
  // cut landed inside a multi-byte character. Detect via byte-length
  // round-trip: a clean cut re-encodes to the same byte length; a partial-
  // multi-byte cut yields a 3-byte U+FFFD that's larger than the orphan
  // bytes it replaced, so re-encoded length > sliced length. Stripping
  // unconditionally (the old behavior) corrupts values that legitimately
  // end with U+FFFD when the cut happens to land cleanly after one.
  if (Buffer.from(decoded, "utf8").byteLength === sliced.byteLength) {
    return decoded + TRUNCATOR;
  }
  return decoded.replace(/\uFFFD$/u, "") + TRUNCATOR;
}

function boundedJson(value: unknown, maxBytes: number): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return serialized;
  }
  return JSON.stringify(shrinkJsonToBudget(value, maxBytes));
}

/**
 * Structural truncation for bounded JSON columns. The naive approach —
 * `boundedString(JSON.stringify(value), maxBytes)` — produces invalid JSON
 * because it cuts the serialized form mid-string and appends "...[truncated]".
 * `fromJson` on read then throws, so any turn whose payload exceeds the bound
 * becomes unreadable via V2 (validator aborts; hot-path reads would too).
 *
 * This version drops data structurally: arrays shrink from the tail (binary
 * search for the largest prefix that fits), objects shrink each value first
 * and then drop keys (last-first) if still over budget. The result is always
 * valid JSON of the same top-level type. Readers see a subset of the original
 * — acceptable for the bounded fields this is used on (display_segments,
 * context_summary, lineage, context preview, raw_event_refs), which are all
 * derived/index material per the V2 contract.
 *
 * Exported for direct unit testing — the integration path requires multi-KB
 * fixtures to trigger the bounded branch, which is expensive for a pure
 * function with obvious correctness invariants.
 */
export function shrinkJsonToBudget(value: unknown, maxBytes: number): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2);
      if (Buffer.byteLength(JSON.stringify(value.slice(0, mid)), "utf8") <= maxBytes) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    if (lo > 0) {
      return value.slice(0, lo);
    }
    // I8: even one element exceeds maxBytes. Previously this returned `[]`,
    // silently zeroing the whole field — same shape as the H5 bug for
    // single-string object values. Fall back to shrinking the first element
    // so the field survives with truncated content. display_segments is the
    // field most likely to hit this (single oversized paste).
    //
    // Reserve 4 bytes for the wrapper: `[` + `]` (always) plus `"` + `"` when
    // the element is a string. Using 4 unconditionally is at worst 2 bytes of
    // unused headroom for non-string elements — the candidate check below
    // catches the rare case where shrink overshoots.
    const shrunkFirst = shrinkJsonToBudget(value[0], Math.max(0, maxBytes - 4));
    const candidate = [shrunkFirst];
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= maxBytes) {
      return candidate;
    }
    return [];
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return value;
    // Reserve bytes for the outer braces + key separators. Per-key budget is
    // even share of what's left; we don't favor any key. If the per-key budget
    // is tiny, shrink will still return whatever fits (possibly empty arrays/objects).
    const overhead = 2 + entries.length * 4;
    const perKeyBudget = Math.max(32, Math.floor((maxBytes - overhead) / entries.length));
    const shrunk: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      shrunk[key] = shrinkJsonToBudget(child, perKeyBudget);
    }
    if (Buffer.byteLength(JSON.stringify(shrunk), "utf8") <= maxBytes) {
      return shrunk;
    }
    // Still over budget after shrinking each value. Drop keys from the tail
    // (preserves the most-relevant keys at the head — the contract orders
    // lineage/summary fields by importance, see UserTurnProjection).
    const keys = Object.keys(shrunk);
    while (keys.length > 0) {
      const dropped = keys.pop() as string;
      delete shrunk[dropped];
      if (Buffer.byteLength(JSON.stringify(shrunk), "utf8") <= maxBytes) {
        return shrunk;
      }
    }
    return {};
  }
  // Primitives: numbers / booleans / null pass through unchanged (can't shrink
  // to a smaller valid JSON of the same type). Strings get the boundedString
  // treatment so an object whose only value is one giant string keeps the key
  // with a truncated value, instead of falling through to the tail-key drop
  // loop and returning {} (silent total loss of the field).
  if (typeof value === "string") {
    return boundedString(value, maxBytes);
  }
  return value;
}

function groupBy<T>(items: readonly T[], getKey: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function dedupeByKey<T>(items: readonly T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeOriginPath(value: string): string {
  return path.normalize(value);
}

function sourceFileLedgerId(sourceId: string, originPath: string): string {
  const keyBytes = Buffer.from(JSON.stringify([sourceId, originPath]), "utf8");
  return `source-file-ledger-${hashBytes("sha256", keyBytes)}`;
}

function isVirtualBlobPath(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}

function isPathWithinDirectory(candidatePath: string, directory: string): boolean {
  const normalizedDirectory = path.resolve(directory);
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedDirectory ||
    normalizedCandidate.startsWith(normalizedDirectory + path.sep)
  );
}

function isAsciiWhitespace(value: number): boolean {
  return value === 9 || value === 10 || value === 11 || value === 12 || value === 13 || value === 32;
}

function hashBytes(algorithm: "sha1" | "sha256", bytes: Buffer): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function dbTransaction(db: DatabaseSync, run: () => void): void {
  db.exec("BEGIN IMMEDIATE;");
  try {
    run();
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
