import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactCoverageRecord,
  AtomEdge,
  CapturedBlob,
  ConversationAtom,
  DerivedCandidate,
  ImportedBundleRecord,
  KnowledgeArtifact,
  LossAuditRecord,
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectLinkRevision,
  ProjectManualOverride,
  RawRecord,
  SessionProjection,
  SourceFragment,
  SourceStatus,
  StageRun,
  TombstoneProjection,
  TurnContextProjection,
  UserTurnProjection,
} from "@cchistory/domain";
import { hydrateSourceStatus } from "./source-identity.js";
import {
  fromJson,
  nowIso,
  compositeKey,
  toJson,
} from "./utils.js";

const ALLOWED_TABLE_NAMES = new Set([
  "captured_blobs",
  "raw_records",
  "source_fragments",
  "conversation_atoms",
  "atom_edges",
  "derived_candidates",
  "sessions",
  "user_turns",
  "turn_contexts",
  "stage_runs",
  "loss_audits",
  "knowledge_artifacts",
  "artifact_coverage",
  "project_link_revisions",
  "project_lineage_events",
  "project_manual_overrides",
  "import_bundles",
  "project_current",
  "source_instances",
  "tombstones",
]);

function assertTableName(name: string): void {
  if (!ALLOWED_TABLE_NAMES.has(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
}

export function selectJsonByIds<T>(db: DatabaseSync, tableName: string, ids: string[]): T[] {
  if (ids.length === 0) {
    return [];
  }
  assertTableName(tableName);
  const select = db.prepare(`SELECT payload_json FROM ${tableName} WHERE id = ?`);
  return ids
    .map((id) => select.get(id) as { payload_json: string } | undefined)
    .filter((row): row is { payload_json: string } => Boolean(row))
    .map((row) => fromJson<T>(row.payload_json));
}

export function selectPayloads<T>(
  db: DatabaseSync,
  tableName: string,
  limit: number,
  orderBy = "ORDER BY id DESC",
): T[] {
  assertTableName(tableName);
  return db
    .prepare(`SELECT payload_json FROM ${tableName} ${orderBy} LIMIT ?`)
    .all(limit)
    .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
}

export function selectAllPayloads<T>(db: DatabaseSync, tableName: string, orderBy = "ORDER BY id DESC"): T[] {
  assertTableName(tableName);
  return db
    .prepare(`SELECT payload_json FROM ${tableName} ${orderBy}`)
    .all()
    .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
}

export function selectPayloadsBySource<T>(
  db: DatabaseSync,
  tableName: string,
  sourceId: string,
  orderBy = "ORDER BY id",
): T[] {
  assertTableName(tableName);
  return db
    .prepare(`SELECT payload_json FROM ${tableName} WHERE source_id = ? ${orderBy}`)
    .all(sourceId)
    .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
}

export function selectPayloadsBySession<T>(
  db: DatabaseSync,
  tableName: string,
  sessionId: string,
  orderBy = "ORDER BY id",
): T[] {
  assertTableName(tableName);
  return db
    .prepare(`SELECT payload_json FROM ${tableName} WHERE session_ref = ? ${orderBy}`)
    .all(sessionId)
    .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
}

export function* iterateRawJsonBySource(
  db: DatabaseSync,
  tableName: string,
  sourceId: string,
  orderBy = "ORDER BY id",
): Generator<string> {
  assertTableName(tableName);
  for (const row of db.prepare(`SELECT payload_json FROM ${tableName} WHERE source_id = ? ${orderBy}`).iterate(sourceId)) {
    yield (row as { payload_json: string }).payload_json;
  }
}

export function countRowsBySource(db: DatabaseSync, tableName: string, sourceId: string): number {
  assertTableName(tableName);
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`).get(sourceId) as {
    count: number;
  };
  return row.count;
}

export function listSources(db: DatabaseSync): SourceStatus[] {
  return db
    .prepare("SELECT payload_json FROM source_instances ORDER BY id")
    .all()
    .map((row) => hydrateSourceStatus(fromJson<SourceStatus>((row as { payload_json: string }).payload_json)));
}

export function listImportedBundles(db: DatabaseSync): ImportedBundleRecord[] {
  return db
    .prepare("SELECT payload_json FROM import_bundles ORDER BY bundle_id")
    .all()
    .map((row) => fromJson<ImportedBundleRecord>((row as { payload_json: string }).payload_json));
}

export function getImportedBundle(db: DatabaseSync, bundleId: string): ImportedBundleRecord | undefined {
  const row = db.prepare("SELECT payload_json FROM import_bundles WHERE bundle_id = ?").get(bundleId) as
    | { payload_json: string }
    | undefined;
  return row ? fromJson<ImportedBundleRecord>(row.payload_json) : undefined;
}

export function upsertImportedBundle(db: DatabaseSync, record: ImportedBundleRecord): ImportedBundleRecord {
  db.prepare("INSERT OR REPLACE INTO import_bundles (bundle_id, payload_json) VALUES (?, ?)")
    .run(record.bundle_id, toJson(record));
  return record;
}

export function listTurns(db: DatabaseSync): UserTurnProjection[] {
  return db
    .prepare("SELECT payload_json FROM user_turns ORDER BY submission_started_at DESC, created_at DESC")
    .all()
    .map((row) => fromJson<UserTurnProjection>((row as { payload_json: string }).payload_json));
}

export function getTurn(db: DatabaseSync, turnId: string): UserTurnProjection | undefined {
  const row = db.prepare("SELECT payload_json FROM user_turns WHERE id = ?").get(turnId) as
    | { payload_json: string }
    | undefined;
  return row ? fromJson<UserTurnProjection>(row.payload_json) : undefined;
}

export function getTurnContext(db: DatabaseSync, turnId: string): TurnContextProjection | undefined {
  const row = db.prepare("SELECT payload_json FROM turn_contexts WHERE turn_id = ?").get(turnId) as
    | { payload_json: string }
    | undefined;
  return row ? fromJson<TurnContextProjection>(row.payload_json) : undefined;
}

export function getSession(db: DatabaseSync, sessionId: string): SessionProjection | undefined {
  const row = db.prepare("SELECT payload_json FROM sessions WHERE id = ?").get(sessionId) as
    | { payload_json: string }
    | undefined;
  return row ? fromJson<SessionProjection>(row.payload_json) : undefined;
}

export function listSessions(db: DatabaseSync): SessionProjection[] {
  return db
    .prepare("SELECT payload_json FROM sessions ORDER BY updated_at DESC, created_at DESC")
    .all()
    .map((row) => fromJson<SessionProjection>((row as { payload_json: string }).payload_json));
}

export function listProjectOverrides(db: DatabaseSync): ProjectManualOverride[] {
  return db
    .prepare("SELECT payload_json FROM project_manual_overrides ORDER BY target_kind, target_ref")
    .all()
    .map((row) => fromJson<ProjectManualOverride>((row as { payload_json: string }).payload_json));
}

export function listProjectRevisions(db: DatabaseSync, projectId?: string): ProjectLinkRevision[] {
  const rows = projectId
    ? db.prepare("SELECT payload_json FROM project_link_revisions WHERE project_id = ? ORDER BY id DESC").all(projectId)
    : db.prepare("SELECT payload_json FROM project_link_revisions ORDER BY id DESC").all();
  return rows.map((row) => fromJson<ProjectLinkRevision>((row as { payload_json: string }).payload_json));
}

export function listProjectLineageEvents(db: DatabaseSync, projectId?: string): ProjectLineageEvent[] {
  const rows = projectId
    ? db.prepare("SELECT payload_json FROM project_lineage_events WHERE project_id = ? ORDER BY id DESC").all(projectId)
    : db.prepare("SELECT payload_json FROM project_lineage_events ORDER BY id DESC").all();
  return rows.map((row) => fromJson<ProjectLineageEvent>((row as { payload_json: string }).payload_json));
}

export function getTombstone(db: DatabaseSync, logicalId: string): TombstoneProjection | undefined {
  const row = db.prepare("SELECT payload_json FROM tombstones WHERE logical_id = ?").get(logicalId) as
    | { payload_json: string }
    | undefined;
  return row ? fromJson<TombstoneProjection>(row.payload_json) : undefined;
}

export function listKnowledgeArtifacts(db: DatabaseSync, projectId?: string): KnowledgeArtifact[] {
  const artifacts = db
    .prepare("SELECT payload_json FROM knowledge_artifacts ORDER BY artifact_id")
    .all()
    .map((row) => fromJson<KnowledgeArtifact>((row as { payload_json: string }).payload_json));
  return projectId ? artifacts.filter((artifact) => artifact.project_id === projectId) : artifacts;
}

export function listArtifactCoverage(db: DatabaseSync, artifactId?: string): ArtifactCoverageRecord[] {
  const rows = artifactId
    ? db.prepare("SELECT payload_json FROM artifact_coverage WHERE artifact_id = ? ORDER BY id").all(artifactId)
    : db.prepare("SELECT payload_json FROM artifact_coverage ORDER BY id").all();
  return rows.map((row) => fromJson<ArtifactCoverageRecord>((row as { payload_json: string }).payload_json));
}

export function listStageRuns(db: DatabaseSync): StageRun[] {
  return db
    .prepare("SELECT payload_json FROM stage_runs ORDER BY id DESC")
    .all()
    .map((row) => fromJson<StageRun>((row as { payload_json: string }).payload_json));
}

export function listCurrentProjects(db: DatabaseSync): ProjectIdentity[] {
  return db
    .prepare("SELECT payload_json FROM project_current ORDER BY project_id")
    .all()
    .map((row) => fromJson<ProjectIdentity>((row as { payload_json: string }).payload_json));
}

export function listAtomsEdgesForAtomIds(db: DatabaseSync, atomIds: Set<string>): AtomEdge[] {
  if (atomIds.size === 0) {
    return [];
  }
  const selectByFrom = db.prepare("SELECT payload_json FROM atom_edges WHERE from_atom_id = ?");
  const selectByTo = db.prepare("SELECT payload_json FROM atom_edges WHERE to_atom_id = ?");
  const seen = new Set<string>();
  const results: AtomEdge[] = [];
  for (const id of atomIds) {
    for (const row of selectByFrom.all(id) as Array<{ payload_json: string }>) {
      const edge = fromJson<AtomEdge>(row.payload_json);
      if (!seen.has(edge.id)) {
        seen.add(edge.id);
        results.push(edge);
      }
    }
    for (const row of selectByTo.all(id) as Array<{ payload_json: string }>) {
      const edge = fromJson<AtomEdge>(row.payload_json);
      if (!seen.has(edge.id)) {
        seen.add(edge.id);
        results.push(edge);
      }
    }
  }
  return results;
}

export function refreshSourceStatusCountsInTransaction(db: DatabaseSync, sourceIds: readonly string[]): void {
  if (sourceIds.length === 0) {
    return;
  }

  const selectSource = db.prepare("SELECT payload_json FROM source_instances WHERE id = ?");
  const updateSource = db.prepare("UPDATE source_instances SET payload_json = ? WHERE id = ?");
  for (const sourceId of sourceIds) {
    const row = selectSource.get(sourceId) as { payload_json: string } | undefined;
    if (!row) {
      continue;
    }
    const source = hydrateSourceStatus(fromJson<SourceStatus>(row.payload_json));
    const nextSource: SourceStatus = {
      ...source,
      total_blobs: countRowsBySource(db, "captured_blobs", sourceId),
      total_records: countRowsBySource(db, "raw_records", sourceId),
      total_fragments: countRowsBySource(db, "source_fragments", sourceId),
      total_atoms: countRowsBySource(db, "conversation_atoms", sourceId),
      total_sessions: countRowsBySource(db, "sessions", sourceId),
      total_turns: countRowsBySource(db, "user_turns", sourceId),
    };
    updateSource.run(toJson(nextSource), sourceId);
  }
}
