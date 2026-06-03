import type { DatabaseSync } from "node:sqlite";
import type { CapturedBlob, SourceStatus, SourceSyncPayload } from "@cchistory/domain";
import path from "node:path";
import {
  hydrateSourceStatus,
  matchesReplaceableSourceIdentity,
  normalizeSourcePayload,
  normalizeSourceStatus,
} from "../internal/source-identity.js";
import { dedupeByKey, fromJson, toJson } from "../internal/utils.js";

export interface SourcePayloadWriteProgressEvent {
  stage: "write_store_done";
  source_id: string;
  projection_changed: boolean;
}

export function replaceSourcePayload(db: DatabaseSync, payload: SourceSyncPayload): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  return replaceSourcePayloadWithOptions(db, payload, { allow_host_rekey: false });
}

export function replaceSourcePayloadWithOptions(
  db: DatabaseSync,
  payload: SourceSyncPayload,
  options: {
    allow_host_rekey: boolean;
    on_progress?: (event: SourcePayloadWriteProgressEvent) => void;
  },
): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  const normalizedPayload = normalizeSourcePayload(payload);
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const sourceId of resolveReplaceSourceIds(db, normalizedPayload.source, options)) {
      deleteBySource(db, sourceId);
    }

    db
      .prepare("INSERT INTO source_instances (id, payload_json) VALUES (?, ?)")
      .run(normalizedPayload.source.id, toJson(normalizedPayload.source));

    const insertStageRun = db.prepare("INSERT INTO stage_runs (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const stageRun of normalizedPayload.stage_runs) {
      insertStageRun.run(stageRun.id, normalizedPayload.source.id, toJson(stageRun));
    }

    const insertLossAudit = db.prepare(`
      INSERT INTO loss_audits (
        id,
        source_id,
        stage_kind,
        diagnostic_code,
        severity,
        session_ref,
        blob_ref,
        record_ref,
        fragment_ref,
        atom_ref,
        candidate_ref,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const lossAudit of dedupeByKey(normalizedPayload.loss_audits, (entry) => entry.id)) {
      insertLossAudit.run(
        lossAudit.id,
        normalizedPayload.source.id,
        lossAudit.stage_kind,
        lossAudit.diagnostic_code,
        lossAudit.severity,
        lossAudit.session_ref ?? "",
        lossAudit.blob_ref ?? "",
        lossAudit.record_ref ?? "",
        lossAudit.fragment_ref ?? "",
        lossAudit.atom_ref ?? "",
        lossAudit.candidate_ref ?? "",
        toJson(lossAudit),
      );
    }

    const insertBlob = db.prepare("INSERT INTO captured_blobs (id, source_id, origin_path, payload_json) VALUES (?, ?, ?, ?)");
    for (const blob of dedupeByKey(normalizedPayload.blobs, (entry) => entry.id)) {
      insertBlob.run(blob.id, normalizedPayload.source.id, normalizeOriginPath(blob.origin_path), toJson(blob));
    }

    const insertRecord = db.prepare(
      "INSERT INTO raw_records (id, source_id, session_ref, blob_id, ordinal, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const record of normalizedPayload.records) {
      insertRecord.run(record.id, normalizedPayload.source.id, record.session_ref, record.blob_id, record.ordinal, toJson(record));
    }

    const insertFragment = db.prepare(
      "INSERT INTO source_fragments (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
    );
    for (const fragment of normalizedPayload.fragments) {
      insertFragment.run(fragment.id, normalizedPayload.source.id, fragment.session_ref, toJson(fragment));
    }

    const insertAtom = db.prepare(
      "INSERT INTO conversation_atoms (id, source_id, session_ref, time_key, seq_no, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const atom of normalizedPayload.atoms) {
      insertAtom.run(atom.id, normalizedPayload.source.id, atom.session_ref, atom.time_key, atom.seq_no, toJson(atom));
    }

    const insertEdge = db.prepare("INSERT INTO atom_edges (id, source_id, session_ref, from_atom_id, to_atom_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const edge of dedupeByKey(normalizedPayload.edges, (entry) => entry.id)) {
      insertEdge.run(edge.id, normalizedPayload.source.id, edge.session_ref, edge.from_atom_id, edge.to_atom_id, toJson(edge));
    }

    const insertCandidate = db.prepare(
      "INSERT INTO derived_candidates (id, source_id, session_ref, candidate_kind, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const candidate of normalizedPayload.candidates) {
      insertCandidate.run(
        candidate.id,
        normalizedPayload.source.id,
        candidate.session_ref,
        candidate.candidate_kind,
        toJson(candidate),
      );
    }

    const insertSession = db.prepare(
      "INSERT INTO sessions (id, source_id, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const session of normalizedPayload.sessions) {
      insertSession.run(session.id, normalizedPayload.source.id, session.created_at, session.updated_at, toJson(session));
    }

    const insertTurn = db.prepare(
      "INSERT INTO user_turns (id, source_id, session_id, created_at, submission_started_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const turn of normalizedPayload.turns) {
      insertTurn.run(
        turn.id,
        normalizedPayload.source.id,
        turn.session_id,
        turn.created_at,
        turn.submission_started_at,
        toJson(turn),
      );
    }

    const insertContext = db.prepare("INSERT INTO turn_contexts (turn_id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const context of normalizedPayload.contexts) {
      insertContext.run(context.turn_id, normalizedPayload.source.id, toJson(context));
    }

    db.exec("COMMIT;");
    options.on_progress?.({ stage: "write_store_done", source_id: normalizedPayload.source.id, projection_changed: true });

    return {
      sessions: normalizedPayload.sessions.length,
      turns: normalizedPayload.turns.length,
      records: normalizedPayload.records.length,
      fragments: normalizedPayload.fragments.length,
      atoms: normalizedPayload.atoms.length,
      blobs: normalizedPayload.blobs.length,
    };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function mergeSourcePayloadByOriginPath(
  db: DatabaseSync,
  payload: SourceSyncPayload,
  options: {
    preserve_origin_paths?: readonly string[];
    observed_origin_paths?: readonly string[];
    on_progress?: (event: SourcePayloadWriteProgressEvent) => void;
  } = {},
): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  const normalizedPayload = normalizeSourcePayload(payload);
  const sourceId = normalizedPayload.source.id;
  const preserveOriginPaths = new Set((options.preserve_origin_paths ?? []).map((entry) => path.normalize(entry)));
  const observedOriginPaths = options.observed_origin_paths
    ? new Set(options.observed_origin_paths.map((entry) => path.normalize(entry)))
    : undefined;
  const incomingBlobs = dedupeByKey(normalizedPayload.blobs, (entry) => entry.id);
  const incomingBlobOriginById = new Map(incomingBlobs.map((blob) => [blob.id, path.normalize(blob.origin_path)] as const));
  const incomingBlobOriginPaths = new Set<string>();
  const replaceOriginPaths = new Set<string>();

  for (const blob of incomingBlobs) {
    const originPath = path.normalize(blob.origin_path);
    incomingBlobOriginPaths.add(originPath);
    if (!preserveOriginPaths.has(originPath)) {
      replaceOriginPaths.add(originPath);
    }
  }
  if (observedOriginPaths) {
    for (const originPath of observedOriginPaths) {
      if (!preserveOriginPaths.has(originPath) && !incomingBlobOriginPaths.has(originPath)) {
        replaceOriginPaths.add(originPath);
      }
    }
    for (const originPath of selectSourceOriginPaths(db, sourceId)) {
      if (!observedOriginPaths.has(originPath)) {
        replaceOriginPaths.add(originPath);
      }
    }
  }

  const existingBlobIdsForReplace = selectBlobIdsByOriginPath(db, sourceId, replaceOriginPaths);
  const replacedSessionRefs = selectSessionRefsByBlobIds(db, sourceId, existingBlobIdsForReplace);
  const changedIncomingSessionRefs = new Set<string>(replacedSessionRefs);
  for (const record of normalizedPayload.records) {
    const originPath = incomingBlobOriginById.get(record.blob_id);
    if (!originPath || !preserveOriginPaths.has(originPath)) {
      changedIncomingSessionRefs.add(record.session_ref);
    }
  }

  const includeRecord = (record: SourceSyncPayload["records"][number]): boolean => {
    const originPath = incomingBlobOriginById.get(record.blob_id);
    return !originPath || !preserveOriginPaths.has(originPath) || changedIncomingSessionRefs.has(record.session_ref);
  };
  const recordsForWrite = normalizedPayload.records.filter(includeRecord);
  const recordIdsForWrite = new Set(recordsForWrite.map((record) => record.id));
  const blobIdsForWrite = new Set(recordsForWrite.map((record) => record.blob_id));
  const blobsForWrite = incomingBlobs.filter((blob) => {
    const originPath = path.normalize(blob.origin_path);
    return !preserveOriginPaths.has(originPath) || blobIdsForWrite.has(blob.id);
  });
  for (const blob of blobsForWrite) {
    blobIdsForWrite.add(blob.id);
  }
  const blobIdsAlreadyForWrite = new Set(blobsForWrite.map((blob) => blob.id));
  for (const blob of incomingBlobs) {
    const originPath = path.normalize(blob.origin_path);
    if (
      preserveOriginPaths.has(originPath) &&
      !blobIdsAlreadyForWrite.has(blob.id) &&
      shouldBackfillPreservedBlobIdentity(db, sourceId, blob)
    ) {
      blobsForWrite.push(blob);
      blobIdsAlreadyForWrite.add(blob.id);
    }
  }
  const fragmentsForWrite = normalizedPayload.fragments.filter((fragment) =>
    recordIdsForWrite.has(fragment.record_id) || changedIncomingSessionRefs.has(fragment.session_ref),
  );
  const fragmentIdsForWrite = new Set(fragmentsForWrite.map((fragment) => fragment.id));
  const atomsForWrite = normalizedPayload.atoms.filter((atom) => changedIncomingSessionRefs.has(atom.session_ref));
  const atomIdsForWrite = new Set(atomsForWrite.map((atom) => atom.id));
  const edgesForWrite = dedupeByKey(
    normalizedPayload.edges.filter((edge) => changedIncomingSessionRefs.has(edge.session_ref)),
    (entry) => entry.id,
  );
  const candidatesForWrite = normalizedPayload.candidates.filter((candidate) =>
    changedIncomingSessionRefs.has(candidate.session_ref),
  );
  const candidateIdsForWrite = new Set(candidatesForWrite.map((candidate) => candidate.id));
  const sessionsForWrite = normalizedPayload.sessions.filter((session) => changedIncomingSessionRefs.has(session.id));
  const turnsForWrite = normalizedPayload.turns.filter((turn) => changedIncomingSessionRefs.has(turn.session_id));
  const turnIdsForWrite = new Set(turnsForWrite.map((turn) => turn.id));
  const contextsForWrite = normalizedPayload.contexts.filter((context) => turnIdsForWrite.has(context.turn_id));
  const lossAuditsForWrite = dedupeByKey(normalizedPayload.loss_audits, (entry) => entry.id).filter((lossAudit) => {
    const refs = [
      lossAudit.blob_ref,
      lossAudit.record_ref,
      lossAudit.fragment_ref,
      lossAudit.atom_ref,
      lossAudit.candidate_ref,
      lossAudit.session_ref,
    ];
    if (refs.every((ref) => !ref)) {
      return true;
    }
    return (
      (lossAudit.blob_ref !== undefined && blobIdsForWrite.has(lossAudit.blob_ref)) ||
      (lossAudit.record_ref !== undefined && recordIdsForWrite.has(lossAudit.record_ref)) ||
      (lossAudit.fragment_ref !== undefined && fragmentIdsForWrite.has(lossAudit.fragment_ref)) ||
      (lossAudit.atom_ref !== undefined && atomIdsForWrite.has(lossAudit.atom_ref)) ||
      (lossAudit.candidate_ref !== undefined && candidateIdsForWrite.has(lossAudit.candidate_ref)) ||
      (lossAudit.session_ref !== undefined && changedIncomingSessionRefs.has(lossAudit.session_ref))
    );
  });

  const affectedSessionRefs = new Set<string>([
    ...recordsForWrite.map((record) => record.session_ref),
    ...sessionsForWrite.map((session) => session.id),
    ...turnsForWrite.map((turn) => turn.session_id),
    ...replacedSessionRefs,
  ]);
  const projectionChanged = affectedSessionRefs.size > 0;
  const incomingSessionRefs = new Set(recordsForWrite.map((record) => record.session_ref));

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("DELETE FROM stage_runs WHERE source_id = ?").run(sourceId);

    for (const sessionRef of affectedSessionRefs) {
      deleteSessionScopedRows(db, sourceId, sessionRef);
    }

    for (const blobId of existingBlobIdsForReplace) {
      deleteBlobScopedRows(db, sourceId, blobId);
    }

    const insertStageRun = db.prepare("INSERT OR REPLACE INTO stage_runs (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const stageRun of normalizedPayload.stage_runs) {
      insertStageRun.run(stageRun.id, sourceId, toJson(stageRun));
    }

    const insertLossAudit = db.prepare(`
      INSERT OR REPLACE INTO loss_audits (
        id,
        source_id,
        stage_kind,
        diagnostic_code,
        severity,
        session_ref,
        blob_ref,
        record_ref,
        fragment_ref,
        atom_ref,
        candidate_ref,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const lossAudit of lossAuditsForWrite) {
      insertLossAudit.run(
        lossAudit.id,
        sourceId,
        lossAudit.stage_kind,
        lossAudit.diagnostic_code,
        lossAudit.severity,
        lossAudit.session_ref ?? "",
        lossAudit.blob_ref ?? "",
        lossAudit.record_ref ?? "",
        lossAudit.fragment_ref ?? "",
        lossAudit.atom_ref ?? "",
        lossAudit.candidate_ref ?? "",
        toJson(lossAudit),
      );
    }

    const insertBlob = db.prepare("INSERT OR REPLACE INTO captured_blobs (id, source_id, origin_path, payload_json) VALUES (?, ?, ?, ?)");
    for (const blob of blobsForWrite) {
      insertBlob.run(blob.id, sourceId, normalizeOriginPath(blob.origin_path), toJson(blob));
    }

    const insertRecord = db.prepare(
      "INSERT OR REPLACE INTO raw_records (id, source_id, session_ref, blob_id, ordinal, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const record of recordsForWrite) {
      insertRecord.run(record.id, sourceId, record.session_ref, record.blob_id, record.ordinal, toJson(record));
    }

    const insertFragment = db.prepare(
      "INSERT OR REPLACE INTO source_fragments (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
    );
    for (const fragment of fragmentsForWrite) {
      insertFragment.run(fragment.id, sourceId, fragment.session_ref, toJson(fragment));
    }

    const insertAtom = db.prepare(
      "INSERT OR REPLACE INTO conversation_atoms (id, source_id, session_ref, time_key, seq_no, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const atom of atomsForWrite) {
      insertAtom.run(atom.id, sourceId, atom.session_ref, atom.time_key, atom.seq_no, toJson(atom));
    }

    const insertEdge = db.prepare("INSERT OR REPLACE INTO atom_edges (id, source_id, session_ref, from_atom_id, to_atom_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const edge of edgesForWrite) {
      insertEdge.run(edge.id, sourceId, edge.session_ref, edge.from_atom_id, edge.to_atom_id, toJson(edge));
    }

    const insertCandidate = db.prepare(
      "INSERT OR REPLACE INTO derived_candidates (id, source_id, session_ref, candidate_kind, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const candidate of candidatesForWrite) {
      insertCandidate.run(
        candidate.id,
        sourceId,
        candidate.session_ref,
        candidate.candidate_kind,
        toJson(candidate),
      );
    }

    const insertSession = db.prepare(
      "INSERT OR REPLACE INTO sessions (id, source_id, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const session of sessionsForWrite) {
      insertSession.run(session.id, sourceId, session.created_at, session.updated_at, toJson(session));
    }

    const insertTurn = db.prepare(
      "INSERT OR REPLACE INTO user_turns (id, source_id, session_id, created_at, submission_started_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const turn of turnsForWrite) {
      insertTurn.run(
        turn.id,
        sourceId,
        turn.session_id,
        turn.created_at,
        turn.submission_started_at,
        toJson(turn),
      );
    }

    const insertContext = db.prepare("INSERT OR REPLACE INTO turn_contexts (turn_id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const context of contextsForWrite) {
      insertContext.run(context.turn_id, sourceId, toJson(context));
    }

    const counts = countStoredSourcePayload(db, sourceId);
    const mergedSource: SourceStatus = {
      ...normalizedPayload.source,
      total_blobs: counts.blobs,
      total_records: counts.records,
      total_fragments: counts.fragments,
      total_atoms: counts.atoms,
      total_sessions: counts.sessions,
      total_turns: counts.turns,
      sync_status:
        normalizedPayload.source.sync_status === "error"
          ? "error"
          : counts.sessions > 0 || counts.turns > 0 || incomingSessionRefs.size > 0
            ? "healthy"
            : normalizedPayload.source.sync_status,
      error_message: normalizedPayload.source.sync_status === "error" ? normalizedPayload.source.error_message : undefined,
    };
    db.prepare("INSERT OR REPLACE INTO source_instances (id, payload_json) VALUES (?, ?)").run(sourceId, toJson(mergedSource));

    db.exec("COMMIT;");
    options.on_progress?.({ stage: "write_store_done", source_id: sourceId, projection_changed: projectionChanged });
    return counts;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function updateSourceSyncMetadata(
  db: DatabaseSync,
  payload: SourceSyncPayload,
  options: {
    on_progress?: (event: SourcePayloadWriteProgressEvent) => void;
  } = {},
): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  const normalizedPayload = normalizeSourcePayload(payload);
  const sourceId = normalizedPayload.source.id;

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare("DELETE FROM stage_runs WHERE source_id = ?").run(sourceId);

    const insertStageRun = db.prepare("INSERT OR REPLACE INTO stage_runs (id, source_id, payload_json) VALUES (?, ?, ?)");
    for (const stageRun of normalizedPayload.stage_runs) {
      insertStageRun.run(stageRun.id, sourceId, toJson(stageRun));
    }

    const counts = countStoredSourcePayload(db, sourceId);
    const nextSource: SourceStatus = {
      ...normalizedPayload.source,
      total_blobs: counts.blobs,
      total_records: counts.records,
      total_fragments: counts.fragments,
      total_atoms: counts.atoms,
      total_sessions: counts.sessions,
      total_turns: counts.turns,
      sync_status:
        normalizedPayload.source.sync_status === "error"
          ? "error"
          : counts.sessions > 0 || counts.turns > 0
            ? "healthy"
            : normalizedPayload.source.sync_status,
      error_message: normalizedPayload.source.sync_status === "error" ? normalizedPayload.source.error_message : undefined,
    };
    db.prepare("INSERT OR REPLACE INTO source_instances (id, payload_json) VALUES (?, ?)").run(sourceId, toJson(nextSource));

    db.exec("COMMIT;");
    options.on_progress?.({ stage: "write_store_done", source_id: sourceId, projection_changed: false });
    return counts;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function pruneSourcePayloadByObservedOriginPaths(
  db: DatabaseSync,
  sourceId: string,
  observedOriginPaths: readonly string[],
  options: {
    on_progress?: (event: SourcePayloadWriteProgressEvent) => void;
  } = {},
): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  const observed = new Set(observedOriginPaths.map((entry) => path.normalize(entry)));
  const staleOriginPaths = new Set(
    selectSourceOriginPaths(db, sourceId).filter((originPath) => !observed.has(originPath)),
  );
  const staleBlobIds = selectBlobIdsByOriginPath(db, sourceId, staleOriginPaths);
  const affectedSessionRefs = selectSessionRefsByBlobIds(db, sourceId, staleBlobIds);
  const projectionChanged = affectedSessionRefs.length > 0;

  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const sessionRef of affectedSessionRefs) {
      deleteSessionScopedRows(db, sourceId, sessionRef);
    }
    for (const blobId of staleBlobIds) {
      deleteBlobScopedRows(db, sourceId, blobId);
    }

    const counts = countStoredSourcePayload(db, sourceId);
    const row = db.prepare("SELECT payload_json FROM source_instances WHERE id = ?").get(sourceId) as
      | { payload_json: string }
      | undefined;
    if (row) {
      const source = hydrateSourceStatus(fromJson<SourceStatus>(row.payload_json));
      const nextSource: SourceStatus = {
        ...source,
        total_blobs: counts.blobs,
        total_records: counts.records,
        total_fragments: counts.fragments,
        total_atoms: counts.atoms,
        total_sessions: counts.sessions,
        total_turns: counts.turns,
        sync_status:
          source.sync_status === "error"
            ? "error"
            : counts.sessions > 0 || counts.turns > 0
              ? "healthy"
              : "stale",
      };
      db.prepare("UPDATE source_instances SET payload_json = ? WHERE id = ?").run(toJson(nextSource), sourceId);
    }

    db.exec("COMMIT;");
    options.on_progress?.({ stage: "write_store_done", source_id: sourceId, projection_changed: projectionChanged });
    return counts;
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function resolveReplaceSourceIds(
  db: DatabaseSync,
  incomingSource: SourceStatus,
  options: { allow_host_rekey: boolean },
): string[] {
  const normalizedIncoming = normalizeSourceStatus(incomingSource);
  const rows = db.prepare("SELECT payload_json FROM source_instances").all() as Array<{ payload_json: string }>;
  const matchingIds = rows
    .map((row) => hydrateSourceStatus(fromJson<SourceStatus>(row.payload_json)))
    .filter(
      (source) =>
        source.id === normalizedIncoming.id ||
        matchesReplaceableSourceIdentity(source, normalizedIncoming, {
          allowHostRekey: options.allow_host_rekey,
        }),
    )
    .map((source) => source.id);
  return [...new Set([normalizedIncoming.id, ...matchingIds])];
}

function selectBlobIdsByOriginPath(db: DatabaseSync, sourceId: string, originPaths: ReadonlySet<string>): string[] {
  if (originPaths.size === 0) {
    return [];
  }
  const ids: string[] = [];
  const select = db.prepare("SELECT id FROM captured_blobs WHERE source_id = ? AND origin_path = ?");
  for (const originPath of originPaths) {
    for (const row of select.all(sourceId, normalizeOriginPath(originPath)) as Array<{ id: string }>) {
      ids.push(row.id);
    }
  }
  return ids;
}

function selectSourceOriginPaths(db: DatabaseSync, sourceId: string): string[] {
  const originPaths = new Set<string>();
  for (const row of db.prepare("SELECT origin_path FROM captured_blobs WHERE source_id = ?").iterate(sourceId)) {
    const originPath = (row as { origin_path: string }).origin_path;
    if (originPath) {
      originPaths.add(normalizeOriginPath(originPath));
    }
  }
  return [...originPaths];
}

function selectSessionRefsByBlobIds(db: DatabaseSync, sourceId: string, blobIds: readonly string[]): string[] {
  const refs = new Set<string>();
  const select = db.prepare(
    "SELECT session_ref FROM raw_records WHERE source_id = ? AND blob_id = ?",
  );
  for (const blobId of blobIds) {
    for (const row of select.all(sourceId, blobId) as Array<{ session_ref: string }>) {
      refs.add(row.session_ref);
    }
  }
  return [...refs];
}

function shouldBackfillPreservedBlobIdentity(db: DatabaseSync, sourceId: string, incomingBlob: CapturedBlob): boolean {
  if (
    incomingBlob.file_identity_stable !== true ||
    incomingBlob.file_changed_at === undefined ||
    incomingBlob.file_modified_at === undefined
  ) {
    return false;
  }

  const row = db.prepare("SELECT payload_json FROM captured_blobs WHERE source_id = ? AND id = ?").get(sourceId, incomingBlob.id) as
    | { payload_json: string }
    | undefined;
  if (!row) {
    return false;
  }

  const existingBlob = fromJson<CapturedBlob>(row.payload_json);
  return (
    existingBlob.file_identity_stable !== true ||
    existingBlob.file_changed_at === undefined ||
    existingBlob.file_modified_at === undefined
  );
}

function deleteSessionScopedRows(db: DatabaseSync, sourceId: string, sessionRef: string): void {
  db.prepare(
    "DELETE FROM turn_contexts WHERE source_id = ? AND turn_id IN (SELECT id FROM user_turns WHERE source_id = ? AND session_id = ?)",
  ).run(sourceId, sourceId, sessionRef);
  db.prepare("DELETE FROM user_turns WHERE source_id = ? AND session_id = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM sessions WHERE source_id = ? AND id = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM derived_candidates WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM atom_edges WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM conversation_atoms WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM source_fragments WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM raw_records WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
  db.prepare("DELETE FROM loss_audits WHERE source_id = ? AND session_ref = ?").run(sourceId, sessionRef);
}

function deleteBlobScopedRows(db: DatabaseSync, sourceId: string, blobId: string): void {
  db.prepare("DELETE FROM captured_blobs WHERE source_id = ? AND id = ?").run(sourceId, blobId);
  db.prepare("DELETE FROM loss_audits WHERE source_id = ? AND blob_ref = ?").run(sourceId, blobId);
}

function countStoredSourcePayload(
  db: DatabaseSync,
  sourceId: string,
): {
  sessions: number;
  turns: number;
  records: number;
  fragments: number;
  atoms: number;
  blobs: number;
} {
  return {
    sessions: countRowsBySource(db, "sessions", sourceId),
    turns: countRowsBySource(db, "user_turns", sourceId),
    records: countRowsBySource(db, "raw_records", sourceId),
    fragments: countRowsBySource(db, "source_fragments", sourceId),
    atoms: countRowsBySource(db, "conversation_atoms", sourceId),
    blobs: countRowsBySource(db, "captured_blobs", sourceId),
  };
}

function countRowsBySource(db: DatabaseSync, tableName: string, sourceId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`).get(sourceId) as {
    count: number;
  };
  return row.count;
}

function deleteBySource(db: DatabaseSync, sourceId: string): void {
  const statements = [
    "DELETE FROM source_instances WHERE id = ?",
    "DELETE FROM stage_runs WHERE source_id = ?",
    "DELETE FROM loss_audits WHERE source_id = ?",
    "DELETE FROM captured_blobs WHERE source_id = ?",
    "DELETE FROM raw_records WHERE source_id = ?",
    "DELETE FROM source_fragments WHERE source_id = ?",
    "DELETE FROM conversation_atoms WHERE source_id = ?",
    "DELETE FROM atom_edges WHERE source_id = ?",
    "DELETE FROM derived_candidates WHERE source_id = ?",
    "DELETE FROM sessions WHERE source_id = ?",
    "DELETE FROM user_turns WHERE source_id = ?",
    "DELETE FROM turn_contexts WHERE source_id = ?",
  ];

  for (const statement of statements) {
    db.prepare(statement).run(sourceId);
  }
}

function normalizeOriginPath(originPath: string): string {
  return path.normalize(originPath);
}
