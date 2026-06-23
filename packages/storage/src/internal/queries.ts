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
import { joinDisplaySegments } from "@cchistory/domain";
import { hydrateSourceStatus } from "./source-identity.js";
import { readTurnLineageFromV2Blob, loadLineageBlobsBySha } from "../evidence-store.js";
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

export function selectPayloadsBySourceAndSession<T>(
  db: DatabaseSync,
  tableName: string,
  sourceId: string,
  sessionId: string,
  orderBy = "ORDER BY id",
): T[] {
  assertTableName(tableName);
  return db
    .prepare(`SELECT payload_json FROM ${tableName} WHERE source_id = ? AND session_ref = ? ${orderBy}`)
    .all(sourceId, sessionId)
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

export function selectBlobsByOriginPaths(
  db: DatabaseSync,
  sourceId: string,
  originPaths: readonly string[],
): CapturedBlob[] {
  if (originPaths.length === 0) {
    return [];
  }

  const select = db.prepare("SELECT payload_json FROM captured_blobs WHERE source_id = ? AND origin_path = ?");
  const blobs: CapturedBlob[] = [];
  const seen = new Set<string>();
  for (const originPath of originPaths) {
    for (const row of select.all(sourceId, originPath) as Array<{ payload_json: string }>) {
      const blob = fromJson<CapturedBlob>(row.payload_json);
      if (seen.has(blob.id)) {
        continue;
      }
      seen.add(blob.id);
      blobs.push(blob);
    }
  }
  return blobs;
}

export function selectRecordsByBlobId(db: DatabaseSync, blobId: string): RawRecord[] {
  return db
    .prepare("SELECT payload_json FROM raw_records WHERE blob_id = ? ORDER BY ordinal")
    .all(blobId)
    .map((row) => fromJson<RawRecord>((row as { payload_json: string }).payload_json));
}

export function selectRecordsBySourceAndBlobId(db: DatabaseSync, sourceId: string, blobId: string): RawRecord[] {
  return db
    .prepare("SELECT payload_json FROM raw_records WHERE source_id = ? AND blob_id = ? ORDER BY ordinal")
    .all(sourceId, blobId)
    .map((row) => fromJson<RawRecord>((row as { payload_json: string }).payload_json));
}

export function selectReusableLossAuditsByRefs(
  db: DatabaseSync,
  sourceId: string,
  refs: {
    blobIds: ReadonlySet<string>;
    recordIds: ReadonlySet<string>;
    fragmentIds: ReadonlySet<string>;
    atomIds: ReadonlySet<string>;
    sessionRefs: ReadonlySet<string>;
  },
): LossAuditRecord[] {
  const rowsById = new Map<string, LossAuditRecord>();
  const collect = (statement: string, values: Iterable<string>) => {
    const select = db.prepare(statement);
    for (const value of values) {
      if (!value) {
        continue;
      }
      for (const row of select.all(sourceId, value) as Array<{ payload_json: string }>) {
        const audit = fromJson<LossAuditRecord>(row.payload_json);
        rowsById.set(audit.id, audit);
      }
    }
  };

  collect("SELECT payload_json FROM loss_audits WHERE source_id = ? AND blob_ref = ?", refs.blobIds);
  collect("SELECT payload_json FROM loss_audits WHERE source_id = ? AND record_ref = ?", refs.recordIds);
  collect("SELECT payload_json FROM loss_audits WHERE source_id = ? AND fragment_ref = ?", refs.fragmentIds);
  collect("SELECT payload_json FROM loss_audits WHERE source_id = ? AND atom_ref = ?", refs.atomIds);
  collect("SELECT payload_json FROM loss_audits WHERE source_id = ? AND session_ref = ?", refs.sessionRefs);
  return [...rowsById.values()];
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

interface UserTurnV2Row {
  turn_id: string;
  turn_revision_id: string;
  source_id: string;
  session_id: string;
  created_at: string;
  submission_started_at: string;
  canonical_text: string;
  canonical_text_full: string;
  raw_text_full: string;
  raw_text_bytes: number;
  display_segments_json: string;
  context_ref: string;
  context_summary_json: string;
  lineage_refs_json: string;
  link_state: string;
  sync_axis: string;
  value_axis: string;
  retention_axis: string;
  user_messages_json: string;
  project_id: string;
  project_ref: string;
  project_link_state: string;
  last_context_activity_at: string;
  path_text: string;
  lineage_blob_sha256: string;
  lineage_atom_count: number;
  lineage_fragment_count: number;
  lineage_record_count: number;
  lineage_blob_count: number;
  lineage_candidate_count: number;
}

function userTurnFromV2Row(input: {
  row: UserTurnV2Row;
  lineage?: UserTurnProjection["lineage"];
}): UserTurnProjection {
  const { row, lineage } = input;
  const userMessages = fromJson<UserTurnProjection["user_messages"]>(row.user_messages_json || "[]");
  // display_segments is derivable from user_messages[].display_segments via
  // joinDisplaySegments (the same way the parser produces it). The bounded
  // display_segments_json column is kept only as a scan-hint preview for
  // future list views; the authoritative field is reconstructed on read so
  // it is always byte-identical to V1.
  //
  // The parser's fallback for a message with no display_segments is to
  // synthesize a single segment ({type: is_injected ? "injected" : "text",
  // content: raw_text}) — see packages/source-adapters/src/core/projections.ts.
  // The V2 read path MUST mirror that fallback; using `?? []` here produces
  // a different array shape (zero segments + a stray "\n\n" separator from
  // joinDisplaySegments) and silently breaks byte-parity against V1.
  const displaySegments = joinDisplaySegments(
    userMessages.map((message) =>
      message.display_segments ?? [
        {
          type: message.is_injected ? "injected" : "text",
          content: message.raw_text,
        },
      ],
    ),
  );
  const contextSummary = fromJson<UserTurnProjection["context_summary"]>(row.context_summary_json || "{}");
  // B.5.0g: full lineage is in a content-addressed blob (fetched by the caller
  // via readTurnLineageFromV2Blob). If the caller didn't fetch it (e.g. list
  // views that only need counts), fall back to counts + empty refs arrays so
  // the projection shape is preserved.
  const resolvedLineage: UserTurnProjection["lineage"] = lineage ?? {
    atom_refs: [],
    candidate_refs: [],
    fragment_refs: [],
    record_refs: [],
    blob_refs: [],
  };
  return {
    turn_id: row.turn_id,
    turn_revision_id: row.turn_revision_id,
    id: row.turn_id,
    revision_id: row.turn_revision_id,
    source_id: row.source_id,
    session_id: row.session_id,
    created_at: row.created_at,
    submission_started_at: row.submission_started_at,
    last_context_activity_at: row.last_context_activity_at,
    canonical_text: row.canonical_text_full || row.canonical_text,
    raw_text: row.raw_text_full,
    display_segments: displaySegments,
    user_messages: userMessages,
    context_ref: row.context_ref,
    context_summary: contextSummary,
    lineage: resolvedLineage,
    link_state: row.link_state as UserTurnProjection["link_state"],
    sync_axis: row.sync_axis as UserTurnProjection["sync_axis"],
    value_axis: row.value_axis as UserTurnProjection["value_axis"],
    retention_axis: row.retention_axis as UserTurnProjection["retention_axis"],
    path_text: row.path_text,
    project_id: row.project_id || undefined,
    project_ref: row.project_ref || undefined,
    project_link_state: (row.project_link_state || undefined) as UserTurnProjection["project_link_state"],
  };
}

const USER_TURN_V2_COLUMNS = `
  turn_id,
  turn_revision_id,
  source_id,
  session_id,
  created_at,
  submission_started_at,
  canonical_text,
  canonical_text_full,
  raw_text_full,
  raw_text_bytes,
  display_segments_json,
  context_ref,
  context_summary_json,
  lineage_refs_json,
  link_state,
  sync_axis,
  value_axis,
  retention_axis,
  user_messages_json,
  project_id,
  project_ref,
  project_link_state,
  last_context_activity_at,
  path_text,
  lineage_blob_sha256,
  lineage_atom_count,
  lineage_fragment_count,
  lineage_record_count,
  lineage_blob_count,
  lineage_candidate_count
`;

export function readUserTurnFromV2(input: {
  db: DatabaseSync;
  turnId: string;
  assetDir?: string;
  withLineage?: boolean;
}): UserTurnProjection | undefined {
  const row = input.db
    .prepare(`SELECT ${USER_TURN_V2_COLUMNS} FROM user_turns_v2 WHERE turn_id = ?`)
    .get(input.turnId) as unknown as UserTurnV2Row | undefined;
  if (!row) {
    return undefined;
  }
  // B.5.0g: full lineage fetched lazily from content-addressed blob. If the
  // blob is missing (pre-B.5.0g backfill, or assetDir not provided), the row
  // still returns with counts implicit in the lineage_*_count columns; refs
  // default to empty arrays. Operators who want refs must run B.3 to populate
  // lineage_blob_sha256.
  //
  // Single-turn reads default to fetching lineage (detail view consumers
  // historically dereference .lineage). Pass withLineage:false to skip the
  // blob read for callers that only need metadata.
  const withLineage = input.withLineage ?? true;
  const lineage = withLineage
    ? readTurnLineageFromV2Blob({
        db: input.db,
        assetDir: input.assetDir,
        turnId: input.turnId,
      })
    : undefined;
  return userTurnFromV2Row({ row, lineage });
}

export function listUserTurnsFromV2(input: {
  db: DatabaseSync;
  assetDir?: string;
  withLineage?: boolean;
}): UserTurnProjection[] {
  const rows = input.db
    .prepare(`SELECT ${USER_TURN_V2_COLUMNS} FROM user_turns_v2 ORDER BY submission_started_at DESC, created_at DESC`)
    .all() as unknown as UserTurnV2Row[];
  return mapV2TurnRows(rows, { assetDir: input.assetDir, withLineage: input.withLineage });
}

export function listUserTurnsFromV2BySession(input: {
  db: DatabaseSync;
  sessionId: string;
  assetDir?: string;
  withLineage?: boolean;
}): UserTurnProjection[] {
  const rows = input.db
    .prepare(
      `SELECT ${USER_TURN_V2_COLUMNS} FROM user_turns_v2 WHERE session_id = ? ORDER BY submission_started_at ASC, created_at ASC`,
    )
    .all(input.sessionId) as unknown as UserTurnV2Row[];
  return mapV2TurnRows(rows, { assetDir: input.assetDir, withLineage: input.withLineage });
}

export function listUserTurnsFromV2BySource(input: {
  db: DatabaseSync;
  sourceId: string;
  assetDir?: string;
  orderBy?: string;
  withLineage?: boolean;
}): UserTurnProjection[] {
  const orderBy = input.orderBy ?? "ORDER BY submission_started_at DESC, created_at DESC";
  const rows = input.db
    .prepare(`SELECT ${USER_TURN_V2_COLUMNS} FROM user_turns_v2 WHERE source_id = ? ${orderBy}`)
    .all(input.sourceId) as unknown as UserTurnV2Row[];
  return mapV2TurnRows(rows, { assetDir: input.assetDir, withLineage: input.withLineage });
}

/**
 * C1 fix: V2 list reads previously did N+1 SQL queries and N file reads for
 * lineage blobs (one per row). For list views that don't dereference .lineage
 * (UI session/project reads, search scan candidates), default to skipping the
 * blob read entirely — counts stay readable from the lineage_*_count columns.
 *
 * When withLineage is true, batch the blob reads: collect distinct shas from
 * the rows, read each unique blob once (dedupes turns that share lineage),
 * and map rows to lineage. This collapses the N+1 SQL pattern to 1 query +
 * M file reads where M is the number of distinct lineage blobs.
 */
function mapV2TurnRows(
  rows: readonly UserTurnV2Row[],
  input: { assetDir?: string; withLineage?: boolean },
): UserTurnProjection[] {
  if (!input.assetDir || !input.withLineage) {
    return rows.map((row) => userTurnFromV2Row({ row }));
  }
  const shas = rows.map((row) => row.lineage_blob_sha256).filter((sha) => sha.length > 0);
  const lineageBySha = loadLineageBlobsBySha({ assetDir: input.assetDir, shas });
  return rows.map((row) =>
    userTurnFromV2Row({
      row,
      lineage: row.lineage_blob_sha256 ? lineageBySha.get(row.lineage_blob_sha256) : undefined,
    }),
  );
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
