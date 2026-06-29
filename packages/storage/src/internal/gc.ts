import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactCoverageRecord,
  CapturedBlob,
  DerivedCandidate,
  KnowledgeArtifact,
  LossAuditRecord,
  ProjectIdentity,
  SessionProjection,
  TombstoneProjection,
  UserTurnProjection,
} from "@cchistory/domain";
import {
  fromJson,
  incrementArtifactRevisionId,
  nowIso,
  compositeKey,
  toJson,
  uniqueStrings,
} from "./utils.js";

export function insertTombstoneInTransaction(db: DatabaseSync, tombstone: TombstoneProjection): void {
  db.prepare("INSERT OR REPLACE INTO tombstones (logical_id, payload_json) VALUES (?, ?)")
    .run(tombstone.logical_id, toJson(tombstone));
}

export function purgeArtifactInTransaction(
  db: DatabaseSync,
  artifact: KnowledgeArtifact,
  reason: string,
): TombstoneProjection {
  const tombstone: TombstoneProjection = {
    object_kind: "artifact",
    logical_id: artifact.artifact_id,
    last_revision_id: artifact.artifact_revision_id,
    sync_axis: artifact.sync_axis,
    value_axis: artifact.value_axis,
    retention_axis: "purged",
    purged_at: nowIso(),
    purge_reason: reason,
    replaced_by_logical_ids: [],
  };
  insertTombstoneInTransaction(db, tombstone);
  db.prepare("DELETE FROM knowledge_artifacts WHERE artifact_id = ?").run(artifact.artifact_id);
  db.prepare("DELETE FROM artifact_coverage WHERE artifact_id = ?").run(artifact.artifact_id);
  return tombstone;
}

export function purgeTurnInTransaction(
  db: DatabaseSync,
  turn: UserTurnProjection,
  reason: string,
): TombstoneProjection {
  const turnIds = uniqueStrings([turn.id, turn.turn_id].filter((value): value is string => Boolean(value)));
  const tombstone: TombstoneProjection = {
    object_kind: "turn",
    logical_id: turn.turn_id ?? turn.id,
    last_revision_id: turn.turn_revision_id ?? turn.revision_id,
    sync_axis: turn.sync_axis,
    value_axis: turn.value_axis,
    retention_axis: "purged",
    purged_at: nowIso(),
    purge_reason: reason,
    replaced_by_logical_ids: [],
    lineage_event_refs: turn.lineage.candidate_refs,
  };

  db.prepare("INSERT OR REPLACE INTO tombstones (logical_id, payload_json) VALUES (?, ?)")
    .run(tombstone.logical_id, toJson(tombstone));
  // B.6: V1 user_turns / turn_contexts are dropped. Only V2 DELETEs remain.
  const deleteV2Turn = db.prepare("DELETE FROM user_turns_v2 WHERE turn_id = ?");
  const deleteV2Context = db.prepare("DELETE FROM turn_context_refs_v2 WHERE turn_id = ?");
  const deleteCoverage = db.prepare("DELETE FROM artifact_coverage WHERE turn_id = ?");
  // I13 (retained post-B.6): if id !== turn_id the loop above issues 0-row
  // V2 deletes for the id iteration. Sum changes across both iterations:
  // must be exactly 1 (V2 row existed and was unique). 0 means the V2
  // sidecar is missing; >1 means turn_id uniqueness is broken. Either way,
  // surface loudly so the operator doesn't silently accumulate V2 orphans.
  let v2TurnDeletes = 0;
  for (const turnId of turnIds) {
    const result = deleteV2Turn.run(turnId);
    v2TurnDeletes += Number(result.changes ?? 0);
    deleteV2Context.run(turnId);
    deleteCoverage.run(turnId);
  }
  const canonicalTurnId = turn.turn_id ?? turn.id;
  if (v2TurnDeletes === 0) {
    throw new Error(
      `purgeTurnInTransaction: V2 sidecar missing for turn_id=${canonicalTurnId}. ` +
        `user_turns_v2 had no matching row. Audit with \`cchistory migration validate --only read-paths\` and re-run B.3 if needed.`,
    );
  }
  if (v2TurnDeletes > 1) {
    throw new Error(
      `purgeTurnInTransaction: V2 delete affected ${v2TurnDeletes} user_turns_v2 rows for turn_id=${canonicalTurnId}. ` +
        `Expected exactly 1 (turn_id should be unique). Indicates schema corruption.`,
    );
  }
  return tombstone;
}

/**
 * B1: returns the subset of `candidateBlobIds` not present in
 * `referencedBlobIds`. Pure set difference — no DB access. The caller is
 * responsible for computing `referencedBlobIds`, typically by loading the V2
 * lineage blobs for every turn in the source and unioning their `blob_refs`
 * (see `CCHistoryStorage.loadReferencedBlobIdsBySource`).
 *
 * Pre-B.6 this function read V1 `user_turns.payload_json` via `json_each` over
 * `$.lineage.blob_refs`. Post-B.6 that table is gone and the V1 query
 * silently returned zero rows, marking every candidate as orphaned —
 * `cascadeEvidenceCleanupForOrphanedBlobsInTransaction` would then delete
 * live evidence blobs. Moving the data dependency to the caller (who reads
 * V2 lineage blobs) keeps gc.ts free of evidence-store imports (would be a
 * circular dep) and makes this function unit-testable without a DB.
 */
export function selectOrphanedBlobIds(
  candidateBlobIds: readonly string[],
  referencedBlobIds: ReadonlySet<string>,
): string[] {
  if (candidateBlobIds.length === 0) return [];
  return uniqueStrings(candidateBlobIds.filter((blobId) => !referencedBlobIds.has(blobId)));
}

/**
 * A.2: cascade evidence cleanup for blobs that no remaining user_turn references.
 *
 * For each blob id in `blobIds`:
 *   - DELETE FROM evidence_captures WHERE source_id = ? AND blob_id = ?
 *   - DELETE FROM parsed_record_spans WHERE source_id = ? AND blob_id = ?
 *   - Optionally DELETE FROM captured_blobs WHERE source_id = ? AND id = ?
 *     (skip when the caller already deleted the captured_blobs row, e.g.
 *     performDeleteProject does its own captured_blobs sweep).
 *
 * Then drop evidence_blobs rows whose sha is no longer referenced from any
 * evidence_captures or parsed_record_spans row, and return the deleted shas
 * so the caller can unlink the content-addressed files outside the DB
 * transaction (file unlink failures must not roll back the DB transaction).
 *
 * Must be called inside the caller's transaction; this function does not open
 * its own.
 */
export function cascadeEvidenceCleanupForOrphanedBlobsInTransaction(
  db: DatabaseSync,
  options: {
    sourceId: string;
    blobIds: readonly string[];
    deleteCapturedBlobs?: boolean;
  },
): string[] {
  if (options.blobIds.length === 0) return [];
  const deleteCaptures = db.prepare(
    "DELETE FROM evidence_captures WHERE source_id = ? AND blob_id = ?",
  );
  const deleteSpans = db.prepare(
    "DELETE FROM parsed_record_spans WHERE source_id = ? AND blob_id = ?",
  );
  const deleteCapturedBlobs = db.prepare(
    "DELETE FROM captured_blobs WHERE source_id = ? AND id = ?",
  );
  const shouldDeleteCapturedBlobs = options.deleteCapturedBlobs !== false;
  for (const blobId of options.blobIds) {
    deleteCaptures.run(options.sourceId, blobId);
    deleteSpans.run(options.sourceId, blobId);
    if (shouldDeleteCapturedBlobs) {
      deleteCapturedBlobs.run(options.sourceId, blobId);
    }
  }
  return pruneUnreferencedEvidenceBlobsInTransaction(db);
}

/**
 * A.2: drop evidence_blobs rows whose sha is no longer referenced from any
 * of the six ref sources that point at evidence_blobs.sha256:
 *   - evidence_captures.evidence_sha256
 *   - parsed_record_spans.evidence_sha256
 *   - current source_file_ledger.current_evidence_sha256
 *   - turn_context_refs_v2.context_evidence_sha256
 *   - derived_cache_refs.evidence_sha256
 *   - user_turns_v2.lineage_blob_sha256  (added by B.5.0g; lineage blobs have
 *     no evidence_captures row, so omitting this ref source pruned live blobs)
 *
 * Returns the deleted shas. Must be called inside the caller's transaction.
 */
export function pruneUnreferencedEvidenceBlobsInTransaction(db: DatabaseSync): string[] {
  const orphaned = db
    .prepare(
      `SELECT eb.sha256 AS sha
         FROM evidence_blobs eb
         LEFT JOIN evidence_captures ec ON ec.evidence_sha256 = eb.sha256
         LEFT JOIN parsed_record_spans prs ON prs.evidence_sha256 = eb.sha256
         LEFT JOIN source_file_ledger sfl
           ON sfl.current_evidence_sha256 = eb.sha256
          AND sfl.sync_axis = 'current'
         LEFT JOIN turn_context_refs_v2 tcr ON tcr.context_evidence_sha256 = eb.sha256
         LEFT JOIN derived_cache_refs dcr ON dcr.evidence_sha256 = eb.sha256
         LEFT JOIN user_turns_v2 utv ON utv.lineage_blob_sha256 = eb.sha256
        WHERE ec.evidence_sha256 IS NULL
          AND prs.evidence_sha256 IS NULL
          AND sfl.current_evidence_sha256 IS NULL
          AND tcr.context_evidence_sha256 IS NULL
          AND dcr.evidence_sha256 IS NULL
          AND utv.lineage_blob_sha256 IS NULL`,
    )
    .all() as Array<{ sha: string }>;
  if (orphaned.length === 0) return [];
  const shas = uniqueStrings(orphaned.map((row) => row.sha));
  const deleteStmt = db.prepare("DELETE FROM evidence_blobs WHERE sha256 = ?");
  for (const sha of shas) {
    deleteStmt.run(sha);
  }
  return shas;
}

export function performDeleteProject(params: {
  db: DatabaseSync;
  project: ProjectIdentity;
  projectTurns: UserTurnProjection[];
  projectObservations: { id: string; project_id?: string; session_ref: string }[];
  allTurns: UserTurnProjection[];
  allSessions: SessionProjection[];
  allCandidates: DerivedCandidate[];
  allOverrides: { id: string; project_id: string; target_ref: string }[];
  allLossAudits: LossAuditRecord[];
  allKnowledgeArtifacts: KnowledgeArtifact[];
  lineageEventIds: string[];
  reason: string;
  refreshSourceStatusCountsInTransaction: (sourceIds: string[]) => void;
}): {
  project_id: string;
  deleted_session_ids: string[];
  deleted_turn_ids: string[];
  deleted_candidate_ids: string[];
  deleted_blob_ids: string[];
  deleted_artifact_ids: string[];
  updated_artifact_ids: string[];
  tombstones: TombstoneProjection[];
  /**
   * A.2: evidence blob shas whose rows were dropped from evidence_blobs in the
   * same transaction. Caller unlinks the content-addressed files outside the
   * transaction (file unlink failures must not roll back the DB transaction).
   */
  pruned_evidence_shas: string[];
} {
  const {
    db,
    project,
    projectTurns,
    projectObservations,
    allTurns,
    allSessions,
    allCandidates,
    allOverrides,
    allLossAudits,
    allKnowledgeArtifacts,
    lineageEventIds,
    reason,
    refreshSourceStatusCountsInTransaction,
  } = params;

  const projectId = project.project_id;
  const deletedTurnIds = uniqueStrings(projectTurns.map((turn) => turn.id));
  const deletedTurnIdSet = new Set(deletedTurnIds);
  const projectObservationIds = uniqueStrings(
    projectObservations.filter((observation) => observation.project_id === projectId).map((observation) => observation.id),
  );
  const projectObservationIdSet = new Set(projectObservationIds);

  const deletedTurns = allTurns.filter((turn) => deletedTurnIdSet.has(turn.id));
  const remainingTurns = allTurns.filter((turn) => !deletedTurnIdSet.has(turn.id));
  const remainingSessionIdSet = new Set(remainingTurns.map((turn) => turn.session_id));
  const sessionsById = new Map(allSessions.map((session) => [session.id, session]));

  const deletedSessionIds = uniqueStrings(
    deletedTurns.map((turn) => turn.session_id).filter((sessionId) => !remainingSessionIdSet.has(sessionId)),
  );
  const deletedSessionIdSet = new Set(deletedSessionIds);

  const retainedSessionIds = uniqueStrings(
    deletedTurns.map((turn) => turn.session_id).filter((sessionId) => remainingSessionIdSet.has(sessionId)),
  );

  const deletedTurnCandidateIds = uniqueStrings(deletedTurns.flatMap((turn) => turn.lineage.candidate_refs));
  const deletedTurnCandidateIdSet = new Set(deletedTurnCandidateIds);

  const remainingBlobIdSet = new Set(remainingTurns.flatMap((turn) => turn.lineage.blob_refs));
  const deletedBlobIds = uniqueStrings(
    deletedTurns.flatMap((turn) => turn.lineage.blob_refs).filter((blobId) => !remainingBlobIdSet.has(blobId)),
  );
  const deletedBlobIdSet = new Set(deletedBlobIds);

  const deletedCandidateIds = uniqueStrings(
    allCandidates
      .filter(
        (candidate) =>
          deletedSessionIdSet.has(candidate.session_ref) ||
          projectObservationIdSet.has(candidate.id) ||
          deletedTurnCandidateIdSet.has(candidate.id),
      )
      .map((candidate) => candidate.id),
  );
  const deletedCandidateIdSet = new Set(deletedCandidateIds);

  const deletedObservationIds = uniqueStrings(
    projectObservations
      .filter((observation) => deletedSessionIdSet.has(observation.session_ref) || projectObservationIdSet.has(observation.id))
      .map((observation) => observation.id),
  );
  const deletedObservationIdSet = new Set(deletedObservationIds);

  const deletedOverrideIds = uniqueStrings(
    allOverrides
      .filter(
        (override) =>
          override.project_id === projectId ||
          deletedTurnIdSet.has(override.target_ref) ||
          deletedSessionIdSet.has(override.target_ref) ||
          deletedObservationIdSet.has(override.target_ref),
      )
      .map((override) => override.id),
  );

  const deletedLossAuditIds = uniqueStrings(
    allLossAudits
      .filter(
        (audit) =>
          (audit.session_ref ? deletedSessionIdSet.has(audit.session_ref) : false) ||
          (audit.candidate_ref ? deletedCandidateIdSet.has(audit.candidate_ref) : false) ||
          (audit.blob_ref ? deletedBlobIdSet.has(audit.blob_ref) : false),
      )
      .map((audit) => audit.id),
  );

  const affectedSourceIds = uniqueStrings(deletedTurns.map((turn) => turn.source_id));

  const projectTombstone: TombstoneProjection = {
    object_kind: "project",
    logical_id: project.project_id,
    last_revision_id: project.project_revision_id,
    sync_axis: "current",
    value_axis: "active",
    retention_axis: "purged",
    purged_at: nowIso(),
    purge_reason: reason,
    replaced_by_logical_ids: [],
    lineage_event_refs: lineageEventIds,
  };

  const tombstones: TombstoneProjection[] = [projectTombstone];
  const deletedArtifactIds: string[] = [];
  const updatedArtifactIds: string[] = [];
  const prunedEvidenceShas: string[] = [];
  const impactedArtifacts = allKnowledgeArtifacts.filter(
    (artifact) => artifact.project_id === projectId || artifact.source_turn_refs.some((turnId) => deletedTurnIdSet.has(turnId)),
  );

  db.exec("BEGIN IMMEDIATE;");
  try {
    insertTombstoneInTransaction(db, projectTombstone);

    for (const artifact of impactedArtifacts) {
      const remainingTurnRefs = uniqueStrings(artifact.source_turn_refs.filter((turnId) => !deletedTurnIdSet.has(turnId)));
      if (artifact.project_id === projectId || remainingTurnRefs.length === 0) {
        const tombstone = purgeArtifactInTransaction(db, artifact, reason);
        tombstones.push(tombstone);
        deletedArtifactIds.push(artifact.artifact_id);
        continue;
      }

      const nextArtifact: KnowledgeArtifact = {
        ...artifact,
        artifact_revision_id: incrementArtifactRevisionId(artifact.artifact_revision_id),
        source_turn_refs: remainingTurnRefs,
        updated_at: nowIso(),
      };
      db.prepare("INSERT OR REPLACE INTO knowledge_artifacts (artifact_id, payload_json) VALUES (?, ?)")
        .run(nextArtifact.artifact_id, toJson(nextArtifact));
      db.prepare("DELETE FROM artifact_coverage WHERE artifact_id = ?").run(nextArtifact.artifact_id);
      const insertCoverage = db.prepare("INSERT INTO artifact_coverage (id, artifact_id, turn_id, payload_json) VALUES (?, ?, ?, ?)");
      for (const turnId of nextArtifact.source_turn_refs) {
        const coverage: ArtifactCoverageRecord = {
          id: compositeKey("artifact-coverage", nextArtifact.artifact_id, turnId),
          artifact_id: nextArtifact.artifact_id,
          artifact_revision_id: nextArtifact.artifact_revision_id,
          turn_id: turnId,
          created_at: nextArtifact.updated_at,
        };
        insertCoverage.run(coverage.id, coverage.artifact_id, coverage.turn_id, toJson(coverage));
      }
      updatedArtifactIds.push(nextArtifact.artifact_id);
    }

    const turnsById = new Map(allTurns.map((turn) => [turn.id, turn]));
    for (const turnId of deletedTurnIds) {
      const turn = turnsById.get(turnId);
      if (turn) {
        const tombstone = purgeTurnInTransaction(db, turn, reason);
        tombstones.push(tombstone);
      }
    }

    const updateSession = db.prepare("UPDATE sessions SET updated_at = ?, payload_json = ? WHERE id = ?");
    for (const sessionId of retainedSessionIds) {
      const session = sessionsById.get(sessionId);
      if (!session) {
        continue;
      }
      const remainingSessionTurns = remainingTurns.filter((turn) => turn.session_id === sessionId);
      const latestTurnActivity = remainingSessionTurns.reduce<string | undefined>(
        (latest, turn) => (!latest || turn.last_context_activity_at > latest ? turn.last_context_activity_at : latest),
        undefined,
      );
      const nextSession: SessionProjection = {
        ...session,
        turn_count: remainingSessionTurns.length,
        updated_at: latestTurnActivity ?? session.updated_at,
      };
      updateSession.run(nextSession.updated_at, toJson(nextSession), nextSession.id);
    }

    const deleteBySessionRef = {
      rawRecords: db.prepare("DELETE FROM raw_records WHERE session_ref = ?"),
      fragments: db.prepare("DELETE FROM source_fragments WHERE session_ref = ?"),
      atoms: db.prepare("DELETE FROM conversation_atoms WHERE session_ref = ?"),
      edges: db.prepare("DELETE FROM atom_edges WHERE session_ref = ?"),
      candidates: db.prepare("DELETE FROM derived_candidates WHERE session_ref = ?"),
      sessions: db.prepare("DELETE FROM sessions WHERE id = ?"),
    };
    for (const sessionId of deletedSessionIds) {
      deleteBySessionRef.rawRecords.run(sessionId);
      deleteBySessionRef.fragments.run(sessionId);
      deleteBySessionRef.atoms.run(sessionId);
      deleteBySessionRef.edges.run(sessionId);
      deleteBySessionRef.candidates.run(sessionId);
      deleteBySessionRef.sessions.run(sessionId);
    }

    const deleteCandidate = db.prepare("DELETE FROM derived_candidates WHERE id = ?");
    for (const candidateId of deletedCandidateIds) {
      deleteCandidate.run(candidateId);
    }

    const deleteBlob = db.prepare("DELETE FROM captured_blobs WHERE id = ?");
    for (const blobId of deletedBlobIds) {
      deleteBlob.run(blobId);
    }

    // A.2: cascade V2 evidence cleanup. captured_blobs rows are already gone
    // for deletedBlobIds (above), so we pass deleteCapturedBlobs=false here.
    // Group by source so the (source_id, blob_id) index hits cleanly.
    const blobsBySource = new Map<string, string[]>();
    for (const turn of deletedTurns) {
      const entry = blobsBySource.get(turn.source_id) ?? [];
      for (const blobId of turn.lineage.blob_refs) {
        if (deletedBlobIdSet.has(blobId)) {
          entry.push(blobId);
        }
      }
      if (entry.length > 0) {
        blobsBySource.set(turn.source_id, uniqueStrings(entry));
      }
    }
    for (const [sourceId, blobIds] of blobsBySource) {
      prunedEvidenceShas.push(
        ...cascadeEvidenceCleanupForOrphanedBlobsInTransaction(db, {
          sourceId,
          blobIds,
          deleteCapturedBlobs: false,
        }),
      );
    }

    const deleteOverride = db.prepare("DELETE FROM project_manual_overrides WHERE id = ?");
    for (const overrideId of deletedOverrideIds) {
      deleteOverride.run(overrideId);
    }

    const deleteLossAudit = db.prepare("DELETE FROM loss_audits WHERE id = ?");
    for (const lossAuditId of deletedLossAuditIds) {
      deleteLossAudit.run(lossAuditId);
    }

    db.prepare("DELETE FROM project_link_revisions WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project_lineage_events WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM project_current WHERE project_id = ?").run(projectId);

    refreshSourceStatusCountsInTransaction(affectedSourceIds);

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }

  return {
    project_id: projectId,
    deleted_session_ids: deletedSessionIds,
    deleted_turn_ids: deletedTurnIds,
    deleted_candidate_ids: deletedCandidateIds,
    deleted_blob_ids: deletedBlobIds,
    deleted_artifact_ids: deletedArtifactIds,
    updated_artifact_ids: updatedArtifactIds,
    tombstones,
    pruned_evidence_shas: uniqueStrings(prunedEvidenceShas),
  };
}
