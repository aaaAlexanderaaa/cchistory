import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
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

export const TURN_CONTEXT_INLINE_BUDGET_BYTES = 16 * 1024;
export const USER_TURN_V2_INLINE_BUDGET_BYTES = 32 * 1024;

interface EvidenceMaterialization {
  sha256: string;
  storagePath: string;
  sizeBytes: number;
  bytes: Buffer;
  mediaType: string;
  captureKind: "source_blob" | "record_snapshot" | "context_cache";
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
}): void {
  const normalizedPayload = normalizeSourcePayload(input.payload);
  const now = nowIso();
  const parserProfileId = deriveParserProfileId(normalizedPayload);
  const itemByteSize = createItemByteSizeCache();
  const recordsByBlobId = groupBy(normalizedPayload.records, (record) => record.blob_id);
  const materializedByBlobId = new Map<string, EvidenceMaterialization>();
  const lineSpansByBlobId = new Map<string, Map<number, JsonlLineSpan>>();
  const incomingOriginPaths = dedupeByKey(normalizedPayload.blobs, (entry) => entry.id)
    .map((blob) => normalizeOriginPath(blob.origin_path));

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
      upsertBoundedUserTurn(input.db, turn, now);
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
  });
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

export function retireStorageBoundaryV2Sources(input: {
  db: DatabaseSync;
  sourceIds: readonly string[];
}): {
  /**
   * A.2: evidence blob shas whose evidence_blobs rows were dropped because
   * they are no longer referenced from any evidence_captures or
   * parsed_record_spans row after this retirement. Caller unlinks the
   * content-addressed files outside the DB transaction.
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
    // once for the whole batch — the LEFT JOINs scan evidence_blobs end-to-end
    // so per-source iteration would be wasteful. The five reference points are
    // evidence_captures, parsed_record_spans, source_file_ledger,
    // turn_context_refs_v2, and derived_cache_refs.
    const orphaned = input.db
      .prepare(
        `SELECT eb.sha256 AS sha
           FROM evidence_blobs eb
           LEFT JOIN evidence_captures ec ON ec.evidence_sha256 = eb.sha256
           LEFT JOIN parsed_record_spans prs ON prs.evidence_sha256 = eb.sha256
           LEFT JOIN source_file_ledger sfl ON sfl.current_evidence_sha256 = eb.sha256
           LEFT JOIN turn_context_refs_v2 tcr ON tcr.context_evidence_sha256 = eb.sha256
           LEFT JOIN derived_cache_refs dcr ON dcr.evidence_sha256 = eb.sha256
          WHERE ec.evidence_sha256 IS NULL
            AND prs.evidence_sha256 IS NULL
            AND sfl.current_evidence_sha256 IS NULL
            AND tcr.context_evidence_sha256 IS NULL
            AND dcr.evidence_sha256 IS NULL`,
      )
      .all() as Array<{ sha: string }>;
    if (orphaned.length > 0) {
      const shas = Array.from(new Set(orphaned.map((row) => row.sha)));
      const deleteStmt = input.db.prepare("DELETE FROM evidence_blobs WHERE sha256 = ?");
      for (const sha of shas) {
        deleteStmt.run(sha);
      }
      prunedShas.push(...shas);
    }
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
      JOIN user_turns ut ON ut.id = tcr.turn_id
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
  } catch {
    return undefined;
  }

  if (row.context_evidence_sha256 && hashBytes("sha256", bytes) !== row.context_evidence_sha256) {
    return undefined;
  }

  let context: TurnContextProjection;
  try {
    context = fromJson<TurnContextProjection>(bytes.toString("utf8"), `turn context cache ${input.turnId}`);
  } catch {
    return undefined;
  }
  return context.turn_id === input.turnId ? context : undefined;
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
    records: readonly RawRecord[];
    parserProfileId: string;
    observedAt: string;
  },
): void {
  const sortedRecords = [...input.records].sort((left, right) => left.ordinal - right.ordinal);
  const lastRecord = sortedRecords.at(-1);
  const sessionRefs = [...new Set(sortedRecords.map((record) => record.session_ref).filter(Boolean))].sort();
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
    lastRecord?.ordinal ?? null,
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

function upsertBoundedUserTurn(db: DatabaseSync, turn: UserTurnProjection, boundedAt: string): void {
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
      canonical_text_full
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      spans.set(ordinal, {
        ordinal,
        startByte: contentStart,
        endByte: contentEnd,
      });
      ordinal += 1;
    }

    if (value === 13 && index + 1 < bytes.length && bytes[index + 1] === 10) {
      index += 1;
    }
    lineStart = index + 1;
  }
  return spans;
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
  return bytes.subarray(0, Math.max(0, maxBytes - 20)).toString("utf8").replace(/\uFFFD$/u, "") + "...[truncated]";
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
 */
function shrinkJsonToBudget(value: unknown, maxBytes: number): unknown {
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
    return value.slice(0, lo);
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
  // primitives can't be structurally shrunk to a smaller valid JSON of the
  // same type; return as-is. The serialized primitive will exceed budget only
  // by its own length, which is acceptable (we never silently corrupt values).
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
