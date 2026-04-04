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
  db.prepare("DELETE FROM user_turns WHERE id = ?").run(turn.id);
  db.prepare("DELETE FROM turn_contexts WHERE turn_id = ?").run(turn.id);
  db.prepare("DELETE FROM artifact_coverage WHERE turn_id = ?").run(turn.id);
  return tombstone;
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
  };
}
