import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactCoverageRecord,
  AtomEdge,
  CapturedBlob,
  ConversationAtom,
  DerivedCandidate,
  DriftReport,
  LinkState,
  LossAuditRecord,
  PipelineLineage,
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectLinkRevision,
  ProjectManualOverride,
  RawRecord,
  SessionProjection,
  SessionRelatedWorkProjection,
  SourceFragment,
  SourceStatus,
  SourceSyncPayload,
  StageRun,
  TombstoneProjection,
  TurnContextProjection,
  TurnSearchResult,
  UsageStatsDimension,
  UsageStatsOverview,
  UsageStatsRollup,
  UserTurnProjection,
  ValueAxis,
  KnowledgeArtifact,
  ImportedBundleRecord,
} from "@cchistory/domain";
import { initializeStorageSchema, readStorageSchemaInfo, type StorageSchemaInfo } from "../db/schema.js";
import {
  replaceSourcePayloadWithOptions as replacePersistedSourcePayloadWithOptions,
} from "../ingest/source-payload.js";
import { buildFallbackProjectObservationCandidates } from "../linking/fallback.js";
import { assignProjectRevisions } from "../linking/revisions.js";
import {
  computeRelevanceScore,
  findHighlights,
  querySearchIndex,
  replaceSearchIndex,
} from "../queries/search.js";
import {
  buildLinkingReview,
  deriveProjectLinkSnapshot,
  type LinkingReview,
  type LinkedProjectObservation,
} from "../linker.js";
import {
  asOptionalString,
  fromJson,
  incrementArtifactRevisionId,
  nowIso,
  compositeKey,
  toJson,
  uniqueStrings,
} from "./utils.js";
import * as Queries from "./queries.js";
import * as Stats from "./stats.js";
import * as Gc from "./gc.js";

export class CCHistoryStorage {
  private readonly db: DatabaseSync;
  private readonly searchIndexReady: boolean;
  private cachedProjectLinkSnapshot?: ReturnType<typeof deriveProjectLinkSnapshot>;
  private cachedTurnsById?: Map<string, UserTurnProjection>;
  private cachedProjectsById?: Map<string, ProjectIdentity>;
  private cachedSessionsById?: Map<string, SessionProjection>;
  private cachedRelatedWorkBySessionId?: Map<string, SessionRelatedWorkProjection[]>;
  readonly dbPath: string;

  constructor(location: string | { dataDir?: string; dbPath?: string }) {
    const dbPath =
      typeof location === "string"
        ? path.join(location, "cchistory.sqlite")
        : location.dbPath ?? path.join(location.dataDir ?? ".", "cchistory.sqlite");
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.searchIndexReady = this.initialize();
  }

  close(): void {
    this.db.close();
  }

  get searchMode(): "fts5" | "fallback" {
    return this.searchIndexReady ? "fts5" : "fallback";
  }

  getSchemaInfo(): StorageSchemaInfo {
    return readStorageSchemaInfo(this.db);
  }

  private initialize(): boolean {
    return initializeStorageSchema(this.db);
  }

  replaceSourcePayload(
    payload: SourceSyncPayload,
    options: {
      allow_host_rekey?: boolean;
      onProgress?: (event: { stage: "write_store_done" | "reindex_start" | "reindex_done"; source_id: string }) => void;
    } = {},
  ): {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  } {
    let result: {
      sessions: number;
      turns: number;
      records: number;
      fragments: number;
      atoms: number;
      blobs: number;
    };
    if (options.allow_host_rekey) {
      result = replacePersistedSourcePayloadWithOptions(this.db, payload, {
        allow_host_rekey: true,
        on_progress: options.onProgress,
      });
    } else {
      result = replacePersistedSourcePayloadWithOptions(this.db, payload, {
        allow_host_rekey: false,
        on_progress: options.onProgress,
      });
    }

    this.invalidateProjectLinkSnapshot();
    options.onProgress?.({ stage: "reindex_start", source_id: payload.source.id });
    this.refreshDerivedState();
    options.onProgress?.({ stage: "reindex_done", source_id: payload.source.id });
    return result;
  }

  upsertProjectOverride(input: {
    target_kind: ProjectManualOverride["target_kind"];
    target_ref: string;
    project_id: string;
    display_name: string;
    note?: string;
  }): ProjectManualOverride {
    const existing = this.listProjectOverrides().find(
      (override) => override.target_kind === input.target_kind && override.target_ref === input.target_ref,
    );
    const now = nowIso();
    const override: ProjectManualOverride = {
      id: existing?.id ?? compositeKey("project-override", input.target_kind, input.target_ref),
      target_kind: input.target_kind,
      target_ref: input.target_ref,
      project_id: input.project_id,
      display_name: input.display_name,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      note: input.note,
    };

    this.db
      .prepare(
        "INSERT OR REPLACE INTO project_manual_overrides (id, target_kind, target_ref, payload_json) VALUES (?, ?, ?, ?)",
      )
      .run(override.id, override.target_kind, override.target_ref, toJson(override));

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return override;
  }

  isEmpty(): boolean {
    const turns = this.db.prepare("SELECT COUNT(*) AS count FROM user_turns").get() as { count: number };
    const sources = this.db.prepare("SELECT COUNT(*) AS count FROM source_instances").get() as { count: number };
    const tombstones = this.db.prepare("SELECT COUNT(*) AS count FROM tombstones").get() as { count: number };
    return turns.count === 0 && sources.count === 0 && tombstones.count === 0;
  }

  listSources(): SourceStatus[] {
    return Queries.listSources(this.db);
  }

  listSourcePayloads(): SourceSyncPayload[] {
    return this.listSources().map((source) => this.buildSourcePayload(source.id));
  }

  getSourcePayload(sourceId: string): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourcePayload(source.id) : undefined;
  }

  /**
   * Stream a source payload as JSON to a writer callback, one row at a time.
   * This avoids loading the entire payload into memory.
   * The `transformBlob` callback, if provided, is called for each blob's parsed JSON
   * to allow mutation (e.g. rewriting `captured_path`) before serialization.
   *
   * Returns lightweight counts for manifest generation.
   */
  streamSourcePayloadJson(
    sourceId: string,
    write: (chunk: string) => void,
    options?: {
      transformBlob?: (blob: CapturedBlob) => CapturedBlob;
    },
  ): { sessions: number; turns: number; blobs: number } | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) return undefined;

    const counts = { sessions: 0, turns: 0, blobs: 0 };

    // Table configs matching buildSourcePayload field order
    const arrayFields: Array<{
      key: string;
      table: string;
      orderBy?: string;
      countKey?: keyof typeof counts;
      transform?: (json: string) => string;
    }> = [
      { key: "stage_runs", table: "stage_runs" },
      { key: "loss_audits", table: "loss_audits" },
      {
        key: "blobs",
        table: "captured_blobs",
        countKey: "blobs",
        transform: options?.transformBlob
          ? (json) => {
              const blob = fromJson<CapturedBlob>(json);
              return JSON.stringify(options.transformBlob!(blob));
            }
          : undefined,
      },
      { key: "records", table: "raw_records" },
      { key: "fragments", table: "source_fragments" },
      { key: "atoms", table: "conversation_atoms", orderBy: "ORDER BY time_key ASC, seq_no ASC" },
      { key: "edges", table: "atom_edges" },
      { key: "candidates", table: "derived_candidates" },
      { key: "sessions", table: "sessions", orderBy: "ORDER BY created_at ASC, updated_at ASC", countKey: "sessions" },
      { key: "turns", table: "user_turns", orderBy: "ORDER BY submission_started_at DESC, created_at DESC", countKey: "turns" },
      { key: "contexts", table: "turn_contexts", orderBy: "ORDER BY turn_id" },
    ];

    write(`{"source":${JSON.stringify(source)}`);

    for (const field of arrayFields) {
      write(`,"${field.key}":[`);
      let first = true;
      for (const rawJson of Queries.iterateRawJsonBySource(this.db, field.table, sourceId, field.orderBy)) {
        if (!first) write(",");
        first = false;
        if (field.transform) {
          write(field.transform(rawJson));
        } else {
          write(rawJson);
        }
        if (field.countKey) counts[field.countKey]++;
      }
      write("]");
    }

    write("}");
    return counts;
  }

  getRecordsByBlobId(blobId: string): RawRecord[] {
    return Queries.selectRecordsByBlobId(this.db, blobId);
  }

  listImportedBundles(): ImportedBundleRecord[] {
    return Queries.listImportedBundles(this.db);
  }

  getImportedBundle(bundleId: string): ImportedBundleRecord | undefined {
    return Queries.getImportedBundle(this.db, bundleId);
  }

  upsertImportedBundle(record: ImportedBundleRecord): ImportedBundleRecord {
    return Queries.upsertImportedBundle(this.db, record);
  }

  listTurns(): UserTurnProjection[] {
    return Queries.listTurns(this.db);
  }

  listResolvedTurns(): UserTurnProjection[] {
    return this.buildProjectLinkSnapshot().turns;
  }

  /**
   * Return a page of resolved turns with a total count, avoiding the need to
   * map/serialize the entire turn list when only a slice is needed.
   */
  listResolvedTurnsPage(offset: number, limit?: number): { turns: UserTurnProjection[]; total: number } {
    const all = this.buildProjectLinkSnapshot().turns;
    const sliced = limit != null ? all.slice(offset, offset + limit) : all.slice(offset);
    return { turns: sliced, total: all.length };
  }

  listResolvedSessions(): SessionProjection[] {
    return this.buildProjectLinkSnapshot().sessions;
  }

  listProjectTurns(projectId: string, linkState: LinkState | "all" = "all"): UserTurnProjection[] {
    return this.buildProjectLinkSnapshot().turns.filter((turn) => {
      if (turn.project_id !== projectId) {
        return false;
      }
      return linkState === "all" ? true : turn.link_state === linkState;
    });
  }

  getTurn(turnId: string): UserTurnProjection | undefined {
    return Queries.getTurn(this.db, turnId);
  }

  getResolvedTurn(turnId: string): UserTurnProjection | undefined {
    return this.buildProjectLinkSnapshot().turns.find((turn) => turn.id === turnId);
  }

  getTurnContext(turnId: string): TurnContextProjection | undefined {
    return Queries.getTurnContext(this.db, turnId);
  }

  getSession(sessionId: string): SessionProjection | undefined {
    return Queries.getSession(this.db, sessionId);
  }

  getResolvedSession(sessionId: string): SessionProjection | undefined {
    return this.buildProjectLinkSnapshot().sessions.find((session) => session.id === sessionId);
  }

  getSessionRelatedWork(sessionId: string): SessionRelatedWorkProjection[] {
    const session = this.getResolvedSession(sessionId) ?? this.getSession(sessionId);
    if (!session) {
      return [];
    }
    return this.buildSessionRelatedWorkIndex().get(session.id) ?? [];
  }

  getTurnSummary(): Record<string, number> {
    const turns = this.listResolvedTurns();
    const counts: Record<string, number> = { total: turns.length };
    for (const turn of turns) {
      const key = turn.link_state ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  listProjects(): ProjectIdentity[] {
    const persisted = this.listCurrentProjects();
    if (persisted.length > 0) {
      return persisted;
    }
    return this.buildProjectLinkSnapshot().projects;
  }

  getProject(projectId: string): ProjectIdentity | undefined {
    return this.listProjects().find((project) => project.project_id === projectId);
  }

  listProjectObservations(): LinkedProjectObservation[] {
    return this.buildProjectLinkSnapshot().observations;
  }

  getLinkingReview(): LinkingReview {
    return buildLinkingReview(this.buildProjectLinkSnapshot());
  }

  listProjectOverrides(): ProjectManualOverride[] {
    return Queries.listProjectOverrides(this.db);
  }

  listProjectRevisions(projectId?: string): ProjectLinkRevision[] {
    return Queries.listProjectRevisions(this.db, projectId);
  }

  listProjectLineageEvents(projectId?: string): ProjectLineageEvent[] {
    return Queries.listProjectLineageEvents(this.db, projectId);
  }

  appendProjectLineageEvent(input: {
    project_id: string;
    project_revision_id?: string;
    previous_project_revision_id?: string;
    event_kind: ProjectLineageEvent["event_kind"];
    detail: Record<string, unknown>;
  }): ProjectLineageEvent {
    const project = this.getProject(input.project_id);
    const event: ProjectLineageEvent = {
      id: compositeKey("project-lineage", input.project_id, input.project_revision_id ?? project?.project_revision_id ?? "unknown", input.event_kind, nowIso()),
      project_id: input.project_id,
      project_revision_id: input.project_revision_id ?? project?.project_revision_id ?? `${input.project_id}:r1`,
      previous_project_revision_id: input.previous_project_revision_id,
      event_kind: input.event_kind,
      created_at: nowIso(),
      detail: input.detail,
    };
    this.db
      .prepare("INSERT OR REPLACE INTO project_lineage_events (id, project_id, payload_json) VALUES (?, ?, ?)")
      .run(event.id, event.project_id, toJson(event));
    return event;
  }

  getTombstone(logicalId: string): TombstoneProjection | undefined {
    return Queries.getTombstone(this.db, logicalId);
  }

  deleteProject(projectId: string, reason = "manual_project_delete"):
    | {
        project_id: string;
        deleted_session_ids: string[];
        deleted_turn_ids: string[];
        deleted_candidate_ids: string[];
        deleted_blob_ids: string[];
        deleted_artifact_ids: string[];
        updated_artifact_ids: string[];
        tombstones: TombstoneProjection[];
      }
    | undefined {
    const project = this.getProject(projectId);
    if (!project) {
      const tombstone = this.getTombstone(projectId);
      if (tombstone?.object_kind !== "project") {
        return undefined;
      }
      return {
        project_id: projectId,
        deleted_session_ids: [],
        deleted_turn_ids: [],
        deleted_candidate_ids: [],
        deleted_blob_ids: [],
        deleted_artifact_ids: [],
        updated_artifact_ids: [],
        tombstones: [tombstone],
      };
    }

    const result = Gc.performDeleteProject({
      db: this.db,
      project,
      projectTurns: this.listProjectTurns(projectId, "all"),
      projectObservations: this.listProjectObservations(),
      allTurns: this.listTurns(),
      allSessions: this.listSessions(),
      allCandidates: Queries.selectAllPayloads<DerivedCandidate>(this.db, "derived_candidates"),
      allOverrides: this.listProjectOverrides(),
      allLossAudits: Queries.selectAllPayloads<LossAuditRecord>(this.db, "loss_audits"),
      allKnowledgeArtifacts: this.listKnowledgeArtifacts(),
      lineageEventIds: this.listProjectLineageEvents(projectId).map((event) => event.id),
      reason,
      refreshSourceStatusCountsInTransaction: (sourceIds) => Queries.refreshSourceStatusCountsInTransaction(this.db, sourceIds),
    });

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return result;
  }

  garbageCollectCandidateTurns(options: {
    before_iso: string;
    mode?: "archive" | "purge";
  }): {
    processed_turn_ids: string[];
    tombstones: TombstoneProjection[];
  } {
    const mode = options.mode ?? "archive";
    const candidates = this.listResolvedTurns().filter(
      (turn) => turn.link_state === "candidate" && turn.submission_started_at < options.before_iso,
    );
    const tombstones: TombstoneProjection[] = [];

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      for (const turn of candidates) {
        if (mode === "archive") {
          this.rewriteStoredTurn(turn.id, (storedTurn) => ({
            ...storedTurn,
            value_axis: "archived",
            retention_axis: "keep_raw_only",
          }));
          continue;
        }
        const tombstone = Gc.purgeTurnInTransaction(this.db, turn, "candidate_gc");
        if (tombstone) {
          tombstones.push(tombstone);
        }
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return {
      processed_turn_ids: candidates.map((turn) => turn.id),
      tombstones,
    };
  }

  purgeTurn(turnId: string, reason = "manual_purge"): TombstoneProjection | undefined {
    const turn = this.getResolvedTurn(turnId) ?? this.getTurn(turnId);
    if (!turn) {
      return this.getTombstone(turnId);
    }

    this.db.exec("BEGIN IMMEDIATE;");
    let tombstone: TombstoneProjection;
    try {
      tombstone = Gc.purgeTurnInTransaction(this.db, turn, reason);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return tombstone;
  }

  listKnowledgeArtifacts(projectId?: string): KnowledgeArtifact[] {
    return Queries.listKnowledgeArtifacts(this.db, projectId);
  }

  listArtifactCoverage(artifactId?: string): ArtifactCoverageRecord[] {
    return Queries.listArtifactCoverage(this.db, artifactId);
  }

  upsertKnowledgeArtifact(input: {
    artifact_id?: string;
    artifact_kind?: KnowledgeArtifact["artifact_kind"];
    title: string;
    summary: string;
    project_id?: string;
    source_turn_refs: string[];
  }): KnowledgeArtifact {
    const now = nowIso();
    const artifactId = input.artifact_id ?? compositeKey("artifact", input.title.toLowerCase());
    const existing = this.listKnowledgeArtifacts().find((artifact) => artifact.artifact_id === artifactId);
    const nextRevisionId = existing ? incrementArtifactRevisionId(existing.artifact_revision_id) : `${artifactId}:r1`;
    const artifact: KnowledgeArtifact = {
      artifact_id: artifactId,
      artifact_revision_id: nextRevisionId,
      artifact_kind: input.artifact_kind ?? "fact",
      title: input.title,
      summary: input.summary,
      project_id: input.project_id,
      source_turn_refs: [...new Set(input.source_turn_refs)].sort(),
      sync_axis: "current",
      value_axis: "active",
      retention_axis: "keep_raw_and_derived",
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO knowledge_artifacts (artifact_id, payload_json) VALUES (?, ?)")
        .run(artifact.artifact_id, toJson(artifact));
      this.db.prepare("DELETE FROM artifact_coverage WHERE artifact_id = ?").run(artifact.artifact_id);
      const insertCoverage = this.db.prepare(
        "INSERT INTO artifact_coverage (id, artifact_id, turn_id, payload_json) VALUES (?, ?, ?, ?)",
      );
      for (const turnId of artifact.source_turn_refs) {
        const coverage: ArtifactCoverageRecord = {
          id: compositeKey("artifact-coverage", artifact.artifact_id, turnId),
          artifact_id: artifact.artifact_id,
          artifact_revision_id: artifact.artifact_revision_id,
          turn_id: turnId,
          created_at: now,
        };
        insertCoverage.run(coverage.id, coverage.artifact_id, coverage.turn_id, toJson(coverage));
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return artifact;
  }

  listStageRuns(): StageRun[] {
    return Queries.listStageRuns(this.db);
  }

  listBlobs(limit = 200): CapturedBlob[] {
    return Queries.selectPayloads<CapturedBlob>(this.db, "captured_blobs", limit);
  }

  listAllBlobs(): CapturedBlob[] {
    return Queries.selectAllPayloads<CapturedBlob>(this.db, "captured_blobs");
  }

  listRecords(limit = 500): RawRecord[] {
    return Queries.selectPayloads<RawRecord>(this.db, "raw_records", limit);
  }

  listFragments(limit = 500): SourceFragment[] {
    return Queries.selectPayloads<SourceFragment>(this.db, "source_fragments", limit);
  }

  listAtoms(limit = 500): ConversationAtom[] {
    return Queries.selectPayloads<ConversationAtom>(this.db, "conversation_atoms", limit, "ORDER BY time_key DESC, seq_no DESC");
  }

  listEdges(limit = 500): AtomEdge[] {
    return Queries.selectPayloads<AtomEdge>(this.db, "atom_edges", limit);
  }

  listCandidates(limit = 500): DerivedCandidate[] {
    return Queries.selectPayloads<DerivedCandidate>(this.db, "derived_candidates", limit);
  }

  listLossAudits(limit = 500): LossAuditRecord[] {
    return Queries.selectPayloads<LossAuditRecord>(this.db, "loss_audits", limit);
  }

  getTurnLineage(turnId: string): PipelineLineage | undefined {
    const turn = this.getResolvedTurn(turnId) ?? this.getTurn(turnId);
    if (!turn) {
      return undefined;
    }

    const session = this.getResolvedSession(turn.session_id) ?? this.getSession(turn.session_id);
    const candidateChain = Queries.selectJsonByIds<DerivedCandidate>(this.db, "derived_candidates", turn.lineage.candidate_refs);
    const atoms = Queries.selectJsonByIds<ConversationAtom>(this.db, "conversation_atoms", turn.lineage.atom_refs);
    const atomIdSet = new Set(atoms.map((atom) => atom.id));
    const edges = Queries.listAtomsEdgesForAtomIds(this.db, atomIdSet);
    const fragments = Queries.selectJsonByIds<SourceFragment>(this.db, "source_fragments", turn.lineage.fragment_refs);
    const records = Queries.selectJsonByIds<RawRecord>(this.db, "raw_records", turn.lineage.record_refs);
    const blobs = Queries.selectJsonByIds<CapturedBlob>(this.db, "captured_blobs", turn.lineage.blob_refs);

    return {
      turn,
      session,
      candidate_chain: candidateChain,
      atoms,
      edges,
      fragments,
      records,
      blobs,
    };
  }

  searchTurns(options: {
    query?: string;
    project_id?: string;
    source_ids?: string[];
    link_states?: LinkState[];
    value_axes?: ValueAxis[];
    limit?: number;
    offset?: number;
  } = {}): TurnSearchResult[] {
    return this.searchTurnsPaginated(options).results;
  }

  searchTurnsPaginated(options: {
    query?: string;
    project_id?: string;
    source_ids?: string[];
    link_states?: LinkState[];
    value_axes?: ValueAxis[];
    limit?: number;
    offset?: number;
  } = {}): { results: TurnSearchResult[]; total: number } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const query = options.query?.trim() ?? "";
    const turnsById = this.getTurnsById();
    let candidateTurnIds: string[];

    if (query.length === 0) {
      candidateTurnIds = [...turnsById.keys()];
    } else {
      candidateTurnIds = querySearchIndex({
        db: this.db,
        searchIndexReady: this.searchIndexReady,
        query,
        limit: (offset + limit) * 5,
        listResolvedTurns: () => this.listResolvedTurns(),
      });
    }

    const projectsById = this.getProjectsById();
    const sessionsById = this.getSessionsById();
    const results: TurnSearchResult[] = [];

    for (const turnId of candidateTurnIds) {
      const turn = turnsById.get(turnId);
      if (!turn) {
        continue;
      }
      if (options.project_id && turn.project_id !== options.project_id) {
        continue;
      }
      if (options.source_ids && options.source_ids.length > 0 && !options.source_ids.includes(turn.source_id)) {
        continue;
      }
      if (options.link_states && options.link_states.length > 0 && !options.link_states.includes(turn.link_state)) {
        continue;
      }
      if (options.value_axes && options.value_axes.length > 0 && !options.value_axes.includes(turn.value_axis)) {
        continue;
      }

      const highlights = query.length > 0 ? findHighlights(turn.canonical_text ?? "", query) : [];
      results.push({
        turn,
        session: sessionsById.get(turn.session_id),
        project: turn.project_id ? projectsById.get(turn.project_id) : undefined,
        highlights,
        relevance_score: computeRelevanceScore(turn, highlights),
      });
    }

    const sorted = results
      .sort((left, right) => {
        if (left.relevance_score !== right.relevance_score) {
          return right.relevance_score - left.relevance_score;
        }
        return right.turn.submission_started_at.localeCompare(left.turn.submission_started_at);
      });

    return {
      results: sorted.slice(offset, offset + limit),
      total: sorted.length,
    };
  }

  getUsageOverview(filters: Stats.UsageFilters = {}): UsageStatsOverview {
    return Stats.computeUsageOverview({
      filters,
      listResolvedTurns: () => this.listResolvedTurns(),
      listResolvedSessions: () => this.listResolvedSessions(),
      listSources: () => this.listSources(),
      listProjects: () => this.listProjects(),
    });
  }

  listUsageRollup(dimension: UsageStatsDimension, filters: Stats.UsageFilters = {}): UsageStatsRollup {
    return Stats.computeUsageRollup({
      dimension,
      filters,
      listResolvedTurns: () => this.listResolvedTurns(),
      listResolvedSessions: () => this.listResolvedSessions(),
      listSources: () => this.listSources(),
      listProjects: () => this.listProjects(),
    });
  }

  getDriftReport(): DriftReport {
    return Stats.computeDriftReport({
      listResolvedTurns: () => this.listResolvedTurns(),
      listSources: () => this.listSources(),
    });
  }

  getSourceReplayBaseline(sourceId: string): {
    source_id: string;
    counts: Record<string, number>;
    turn_text_by_id: Record<string, string>;
    project_ids: string[];
    latest_stage_run_ids: string[];
  } {
    const turns = this.listResolvedTurns().filter((turn) => turn.source_id === sourceId);
    const stageRuns = this.listStageRuns().filter((stageRun) => stageRun.source_id === sourceId);
    const sourceProjects = uniqueStrings(
      turns.map((turn) => turn.project_id).filter((projectId): projectId is string => Boolean(projectId)),
    );

    return {
      source_id: sourceId,
      counts: {
        blobs: Queries.countRowsBySource(this.db, "captured_blobs", sourceId),
        records: Queries.countRowsBySource(this.db, "raw_records", sourceId),
        fragments: Queries.countRowsBySource(this.db, "source_fragments", sourceId),
        atoms: Queries.countRowsBySource(this.db, "conversation_atoms", sourceId),
        candidates: Queries.countRowsBySource(this.db, "derived_candidates", sourceId),
        sessions: Queries.countRowsBySource(this.db, "sessions", sourceId),
        turns: turns.length,
      },
      turn_text_by_id: Object.fromEntries(turns.map((turn) => [turn.id, turn.canonical_text])),
      project_ids: sourceProjects,
      latest_stage_run_ids: stageRuns.slice(0, 8).map((stageRun) => stageRun.id),
    };
  }

  private rewriteStoredTurn(
    turnId: string,
    updater: (turn: UserTurnProjection) => UserTurnProjection,
  ): UserTurnProjection | undefined {
    const turn = this.getTurn(turnId);
    if (!turn) {
      return undefined;
    }
    const nextTurn = updater(turn);
    this.db
      .prepare("UPDATE user_turns SET payload_json = ?, created_at = ?, submission_started_at = ? WHERE id = ?")
      .run(toJson(nextTurn), nextTurn.created_at, nextTurn.submission_started_at, turnId);
    return nextTurn;
  }

  private listSessions(): SessionProjection[] {
    return Queries.listSessions(this.db);
  }

  private buildSourcePayload(sourceId: string): SourceSyncPayload {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }

    return {
      source,
      stage_runs: Queries.selectPayloadsBySource<StageRun>(this.db, "stage_runs", sourceId),
      loss_audits: Queries.selectPayloadsBySource<LossAuditRecord>(this.db, "loss_audits", sourceId),
      blobs: Queries.selectPayloadsBySource<CapturedBlob>(this.db, "captured_blobs", sourceId),
      records: Queries.selectPayloadsBySource<RawRecord>(this.db, "raw_records", sourceId),
      fragments: Queries.selectPayloadsBySource<SourceFragment>(this.db, "source_fragments", sourceId),
      atoms: Queries.selectPayloadsBySource<ConversationAtom>(this.db, "conversation_atoms", sourceId, "ORDER BY time_key ASC, seq_no ASC"),
      edges: Queries.selectPayloadsBySource<AtomEdge>(this.db, "atom_edges", sourceId),
      candidates: Queries.selectPayloadsBySource<DerivedCandidate>(this.db, "derived_candidates", sourceId),
      sessions: Queries.selectPayloadsBySource<SessionProjection>(this.db, "sessions", sourceId, "ORDER BY created_at ASC, updated_at ASC"),
      turns: Queries.selectPayloadsBySource<UserTurnProjection>(
        this.db,
        "user_turns",
        sourceId,
        "ORDER BY submission_started_at DESC, created_at DESC",
      ),
      contexts: Queries.selectPayloadsBySource<TurnContextProjection>(this.db, "turn_contexts", sourceId, "ORDER BY turn_id"),
    };
  }

  private listCurrentProjects(): ProjectIdentity[] {
    return Queries.listCurrentProjects(this.db);
  }

  private buildProjectLinkSnapshot() {
    if (!this.cachedProjectLinkSnapshot) {
      this.cachedProjectLinkSnapshot = this.computeProjectLinkSnapshot();
    }
    return this.cachedProjectLinkSnapshot;
  }

  private invalidateProjectLinkSnapshot(): void {
    this.cachedProjectLinkSnapshot = undefined;
    this.cachedTurnsById = undefined;
    this.cachedProjectsById = undefined;
    this.cachedSessionsById = undefined;
    this.cachedRelatedWorkBySessionId = undefined;
  }

  private getTurnsById(): Map<string, UserTurnProjection> {
    if (!this.cachedTurnsById) {
      this.cachedTurnsById = new Map(this.listResolvedTurns().map((turn) => [turn.id, turn]));
    }
    return this.cachedTurnsById;
  }

  private getProjectsById(): Map<string, ProjectIdentity> {
    if (!this.cachedProjectsById) {
      this.cachedProjectsById = new Map(this.listProjects().map((project) => [project.project_id, project]));
    }
    return this.cachedProjectsById;
  }

  private getSessionsById(): Map<string, SessionProjection> {
    if (!this.cachedSessionsById) {
      this.cachedSessionsById = new Map(this.listSessions().map((session) => [session.id, session]));
    }
    return this.cachedSessionsById;
  }

  private buildSessionRelatedWorkIndex(): Map<string, SessionRelatedWorkProjection[]> {
    if (!this.cachedRelatedWorkBySessionId) {
      const sessions = this.listSessions();
      const fragments = Queries.selectAllPayloads<SourceFragment>(this.db, "source_fragments", "ORDER BY session_ref ASC, id ASC");
      this.cachedRelatedWorkBySessionId = buildSessionRelatedWorkIndex(sessions, fragments);
    }
    return this.cachedRelatedWorkBySessionId;
  }

  private computeProjectLinkSnapshot() {
    const sessions = this.listSessions();
    const turns = this.listTurns();
    const candidates = Queries.selectAllPayloads<DerivedCandidate>(this.db, "derived_candidates");
    return deriveProjectLinkSnapshot({
      sessions,
      turns,
      candidates: [
        ...candidates,
        ...buildFallbackProjectObservationCandidates({
          sessions,
          turns,
          candidates,
          sources: this.listSources(),
          selectBlobsByIds: (ids) => Queries.selectJsonByIds<CapturedBlob>(this.db, "captured_blobs", ids),
        }),
      ],
      overrides: this.listProjectOverrides(),
    });
  }

  private refreshDerivedState(): void {
    const existingProjects = this.listCurrentProjects();
    const snapshot = this.computeProjectLinkSnapshot();
    this.cachedProjectLinkSnapshot = snapshot;
    const persistedProjects = assignProjectRevisions(snapshot.projects, existingProjects);

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.exec("DELETE FROM project_current");
      const insertProject = this.db.prepare("INSERT INTO project_current (project_id, payload_json) VALUES (?, ?)");
      for (const project of persistedProjects.projects) {
        insertProject.run(project.project_id, toJson(project));
      }

      if (persistedProjects.revisions.length > 0) {
        const insertRevision = this.db.prepare(
          "INSERT OR REPLACE INTO project_link_revisions (id, project_id, payload_json) VALUES (?, ?, ?)",
        );
        for (const revision of persistedProjects.revisions) {
          insertRevision.run(revision.id, revision.project_id, toJson(revision));
        }
      }

      if (persistedProjects.lineageEvents.length > 0) {
        const insertEvent = this.db.prepare(
          "INSERT OR REPLACE INTO project_lineage_events (id, project_id, payload_json) VALUES (?, ?, ?)",
        );
        for (const event of persistedProjects.lineageEvents) {
          insertEvent.run(event.id, event.project_id, toJson(event));
        }
      }

      replaceSearchIndex(this.db, this.searchIndexReady, snapshot.turns);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}

interface SessionRelationEdge {
  relationKind: SessionRelatedWorkProjection["relation_kind"];
  evidenceSession: SessionProjection;
  parentSession?: SessionProjection;
  childSession?: SessionProjection;
  parentRef?: string;
  childRef?: string;
  parentToolRef?: string;
  childAgentKey?: string;
  sessionKey?: string;
  jobId?: string;
  fragment: SourceFragment;
  payload: Record<string, unknown>;
}

function buildSessionRelatedWorkIndex(
  sessions: SessionProjection[],
  fragments: SourceFragment[],
): Map<string, SessionRelatedWorkProjection[]> {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsByAlias = buildSessionsByAlias(sessions);
  const groupedBySession = new Map<string, Map<string, SessionRelatedWorkProjection>>();

  for (const fragment of fragments) {
    if (fragment.fragment_kind !== "session_relation") {
      continue;
    }
    const evidenceSession = sessionsById.get(fragment.session_ref);
    if (!evidenceSession) {
      continue;
    }
    const payload = fragment.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const edge = buildSessionRelationEdge(evidenceSession, fragment, payload, sessionsByAlias);
    if (!edge) {
      continue;
    }

    if (edge.relationKind === "delegated_session") {
      if (edge.childSession) {
        mergeSessionRelatedWork(groupedBySession, edge.childSession.id, buildDelegatedRelatedWorkEntry(edge.childSession, edge, "inbound"));
      }
      if (edge.parentSession && (!edge.childSession || edge.parentSession.id !== edge.childSession.id)) {
        mergeSessionRelatedWork(groupedBySession, edge.parentSession.id, buildDelegatedRelatedWorkEntry(edge.parentSession, edge, "outbound"));
      }
      continue;
    }

    mergeSessionRelatedWork(groupedBySession, edge.evidenceSession.id, buildAutomationRelatedWorkEntry(edge.evidenceSession, edge, "self"));
    if (edge.parentSession && edge.parentSession.id !== edge.evidenceSession.id) {
      mergeSessionRelatedWork(groupedBySession, edge.parentSession.id, buildAutomationRelatedWorkEntry(edge.parentSession, edge, "outbound"));
    }
  }

  const index = new Map<string, SessionRelatedWorkProjection[]>();
  for (const [sessionId, grouped] of groupedBySession) {
    index.set(
      sessionId,
      [...grouped.values()].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)),
    );
  }
  return index;
}

function buildSessionRelationEdge(
  evidenceSession: SessionProjection,
  fragment: SourceFragment,
  payload: Record<string, unknown>,
  sessionsByAlias: Map<string, SessionProjection[]>,
): SessionRelationEdge | undefined {
  const relationKind = normalizeRelatedWorkKind(payload);
  if (!relationKind) {
    return undefined;
  }
  const parentRef = relationParentRef(payload);
  const childRef = relationChildRef(payload);
  const parentSession = parentRef ? resolveRelatedSession(parentRef, evidenceSession, sessionsByAlias) : undefined;
  const childSession = childRef
    ? resolveRelatedSession(childRef, evidenceSession, sessionsByAlias) ?? evidenceSession
    : relationKind === "delegated_session"
      ? evidenceSession
      : undefined;

  return {
    relationKind,
    evidenceSession,
    parentSession,
    childSession,
    parentRef,
    childRef: childRef ?? childSession?.id,
    parentToolRef:
      asOptionalString(payload.parent_tool_ref) ??
      asOptionalString(payload.callingToolUseId) ??
      asOptionalString(payload.calling_tool_use_id),
    childAgentKey:
      asOptionalString(payload.agent_id) ??
      asOptionalString(payload.agentId) ??
      asOptionalString(payload.childAgentKey) ??
      asOptionalString(payload.child_agent_key),
    sessionKey: asOptionalString(payload.session_key),
    jobId: asOptionalString(payload.job_id),
    fragment,
    payload,
  };
}

function buildDelegatedRelatedWorkEntry(
  querySession: SessionProjection,
  edge: SessionRelationEdge,
  direction: SessionRelatedWorkProjection["direction"],
): SessionRelatedWorkProjection {
  const parentSessionRef = edge.parentSession?.id ?? edge.parentRef;
  const childSessionRef = edge.childSession?.id ?? edge.childRef ?? edge.evidenceSession.id;
  const targetSession = direction === "outbound" ? edge.childSession : edge.parentSession;
  const targetSessionRef = direction === "outbound" ? childSessionRef : parentSessionRef;
  const key = `delegated:${parentSessionRef ?? "unknown-parent"}:${childSessionRef ?? "unknown-child"}:${edge.childAgentKey ?? ""}:${direction}`;
  return {
    id: compositeKey("session-related-work", querySession.id, key),
    source_id: edge.evidenceSession.source_id,
    source_platform: edge.evidenceSession.source_platform,
    source_session_ref: edge.evidenceSession.id,
    evidence_session_ref: edge.evidenceSession.id,
    parent_session_ref: parentSessionRef,
    child_session_ref: childSessionRef,
    relation_kind: "delegated_session",
    target_kind: "session",
    direction,
    target_session_ref: targetSessionRef,
    transcript_primary: true,
    evidence_confidence: isStrictlyTrue(edge.payload.is_sidechain) ? 0.95 : 0.8,
    parent_event_ref: parentSessionRef,
    parent_tool_ref: edge.parentToolRef,
    child_agent_key: edge.childAgentKey,
    title: targetSession?.title,
    status: asOptionalString(edge.payload.status),
    created_at: edge.fragment.time_key,
    updated_at: edge.fragment.time_key,
    fragment_refs: [edge.fragment.id],
    raw_detail: {
      ...edge.payload,
      direction,
      evidence_session_ref: edge.evidenceSession.id,
      parent_session_ref: parentSessionRef,
      child_session_ref: childSessionRef,
    },
  };
}

function buildAutomationRelatedWorkEntry(
  querySession: SessionProjection,
  edge: SessionRelationEdge,
  direction: SessionRelatedWorkProjection["direction"],
): SessionRelatedWorkProjection {
  const ownerSessionRef = edge.parentSession?.id ?? edge.parentRef ?? edge.evidenceSession.id;
  const targetRunRef = compositeKey("automation-run", edge.evidenceSession.source_id, edge.evidenceSession.id, edge.jobId ?? "", edge.sessionKey ?? edge.fragment.id);
  const key = `automation:${ownerSessionRef}:${edge.evidenceSession.id}:${edge.jobId ?? ""}:${edge.sessionKey ?? edge.fragment.id}:${direction}`;
  return {
    id: compositeKey("session-related-work", querySession.id, key),
    source_id: edge.evidenceSession.source_id,
    source_platform: edge.evidenceSession.source_platform,
    source_session_ref: edge.evidenceSession.id,
    evidence_session_ref: edge.evidenceSession.id,
    automation_session_ref: edge.evidenceSession.id,
    automation_owner_session_ref: ownerSessionRef,
    relation_kind: "automation_run",
    target_kind: "automation_run",
    direction,
    target_session_ref: ownerSessionRef,
    target_run_ref: targetRunRef,
    transcript_primary: false,
    evidence_confidence: 0.95,
    parent_event_ref: ownerSessionRef,
    parent_tool_ref: edge.parentToolRef,
    automation_job_ref: edge.jobId,
    automation_run_key: edge.sessionKey,
    title: edge.evidenceSession.title,
    status: asOptionalString(edge.payload.status),
    created_at: edge.fragment.time_key,
    updated_at: edge.fragment.time_key,
    fragment_refs: [edge.fragment.id],
    raw_detail: {
      ...edge.payload,
      direction,
      evidence_session_ref: edge.evidenceSession.id,
      automation_session_ref: edge.evidenceSession.id,
      automation_owner_session_ref: ownerSessionRef,
    },
  };
}

function mergeSessionRelatedWork(
  groupedBySession: Map<string, Map<string, SessionRelatedWorkProjection>>,
  sessionId: string,
  entry: SessionRelatedWorkProjection,
): void {
  const grouped = groupedBySession.get(sessionId) ?? new Map<string, SessionRelatedWorkProjection>();
  const existing = grouped.get(entry.id);
  if (existing) {
    existing.created_at = existing.created_at <= entry.created_at ? existing.created_at : entry.created_at;
    existing.updated_at = existing.updated_at >= entry.updated_at ? existing.updated_at : entry.updated_at;
    existing.fragment_refs = uniqueStrings([...existing.fragment_refs, ...entry.fragment_refs]);
    existing.parent_tool_ref = existing.parent_tool_ref ?? entry.parent_tool_ref;
    existing.child_agent_key = existing.child_agent_key ?? entry.child_agent_key;
    existing.automation_job_ref = existing.automation_job_ref ?? entry.automation_job_ref;
    existing.automation_run_key = existing.automation_run_key ?? entry.automation_run_key;
    existing.status = entry.status ?? existing.status;
    existing.raw_detail = { ...existing.raw_detail, ...entry.raw_detail };
    return;
  }
  grouped.set(entry.id, entry);
  groupedBySession.set(sessionId, grouped);
}

function relationParentRef(payload: Record<string, unknown>): string | undefined {
  return (
    asOptionalString(payload.parent_uuid) ??
    asOptionalString(payload.callingSessionId) ??
    asOptionalString(payload.calling_session_id) ??
    asOptionalString(payload.parentId) ??
    asOptionalString(payload.parent_id)
  );
}

function relationChildRef(payload: Record<string, unknown>): string | undefined {
  return (
    asOptionalString(payload.child_session_ref) ??
    asOptionalString(payload.childSessionId) ??
    asOptionalString(payload.child_session_id) ??
    asOptionalString(payload.session_uuid) ??
    asOptionalString(payload.session_id)
  );
}

function buildSessionsByAlias(sessions: SessionProjection[]): Map<string, SessionProjection[]> {
  const byAlias = new Map<string, SessionProjection[]>();
  for (const session of sessions) {
    for (const alias of sessionAliases(session)) {
      const matches = byAlias.get(alias) ?? [];
      matches.push(session);
      byAlias.set(alias, matches);
    }
  }
  return byAlias;
}

function resolveRelatedSession(
  sessionRef: string,
  evidenceSession: SessionProjection,
  sessionsByAlias: Map<string, SessionProjection[]>,
): SessionProjection | undefined {
  const matches = sessionsByAlias.get(sessionRef) ?? [];
  if (matches.length === 0) {
    return undefined;
  }
  const sameSource = matches.filter((session) => session.source_id === evidenceSession.source_id);
  if (sameSource.length === 1) {
    return sameSource[0];
  }
  const samePlatform = matches.filter((session) => session.source_platform === evidenceSession.source_platform);
  if (samePlatform.length === 1) {
    return samePlatform[0];
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function sessionAliases(session: SessionProjection): string[] {
  const aliases = [session.id];
  const prefixedMatch = /^sess:[^:]+:(.+)$/u.exec(session.id);
  if (prefixedMatch?.[1]) {
    aliases.push(prefixedMatch[1]);
  }
  return uniqueStrings(aliases);
}

function normalizeRelatedWorkKind(payload: Record<string, unknown>): SessionRelatedWorkProjection["relation_kind"] | undefined {
  const relationKind = asOptionalString(payload.relation_kind);
  if (relationKind === "automation_run") {
    return "automation_run";
  }
  if (
    isStrictlyTrue(payload.is_sidechain) ||
    asOptionalString(payload.parent_uuid) ||
    asOptionalString(payload.callingSessionId) ||
    asOptionalString(payload.calling_session_id) ||
    asOptionalString(payload.parentId) ||
    asOptionalString(payload.parent_id)
  ) {
    return "delegated_session";
  }
  return undefined;
}

function isStrictlyTrue(value: unknown): boolean {
  return value === true;
}
