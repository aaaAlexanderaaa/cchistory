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
  replaceSourcePayload as replacePersistedSourcePayload,
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
    this.refreshDerivedState();
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
      result = replacePersistedSourcePayloadWithOptions(this.db, payload, { allow_host_rekey: true });
    } else {
      result = replacePersistedSourcePayload(this.db, payload);
    }

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
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
    const fragments = Queries.selectPayloadsBySession<SourceFragment>(this.db, "source_fragments", sessionId, "ORDER BY id ASC");
    return buildSessionRelatedWork(session, fragments);
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

  private sessionMatchesSearchQuery(session: SessionProjection | undefined, query: string): boolean {
    if (!session) {
      return false;
    }
    const searchableText = [session.title, session.working_directory]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    if (!searchableText) {
      return false;
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }
    const loweredSearchableText = searchableText.toLowerCase();
    return normalizedQuery.split(/\s+/u).every((segment) => loweredSearchableText.includes(segment));
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
  } = {}): TurnSearchResult[] {
    const limit = options.limit ?? 50;
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
        limit: limit * 3,
        listResolvedTurns: () => this.listResolvedTurns(),
      });
    }

    const projectsById = this.getProjectsById();
    const sessionsById = this.getSessionsById();
    if (query.length > 0) {
      const candidateTurnIdSet = new Set(candidateTurnIds);
      for (const turn of turnsById.values()) {
        if (candidateTurnIdSet.has(turn.id)) {
          continue;
        }
        const session = sessionsById.get(turn.session_id);
        if (!this.sessionMatchesSearchQuery(session, query)) {
          continue;
        }
        candidateTurnIds.push(turn.id);
        candidateTurnIdSet.add(turn.id);
      }
    }
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

      const highlights = query.length > 0 ? findHighlights(turn.canonical_text, query) : [];
      results.push({
        turn,
        session: sessionsById.get(turn.session_id),
        project: turn.project_id ? projectsById.get(turn.project_id) : undefined,
        highlights,
        relevance_score: computeRelevanceScore(turn, highlights),
      });
    }

    return results
      .sort((left, right) => {
        if (left.relevance_score !== right.relevance_score) {
          return right.relevance_score - left.relevance_score;
        }
        return right.turn.submission_started_at.localeCompare(left.turn.submission_started_at);
      })
      .slice(0, limit);
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

function buildSessionRelatedWork(
  session: SessionProjection,
  fragments: SourceFragment[],
): SessionRelatedWorkProjection[] {
  const grouped = new Map<string, SessionRelatedWorkProjection>();
  for (const fragment of fragments) {
    if (fragment.fragment_kind !== "session_relation") {
      continue;
    }
    const payload = fragment.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const relationKind = normalizeRelatedWorkKind(payload);
    if (!relationKind) {
      continue;
    }
    const parentUuid =
      asOptionalString(payload.parent_uuid) ??
      asOptionalString(payload.callingSessionId) ??
      asOptionalString(payload.calling_session_id) ??
      asOptionalString(payload.parentId) ??
      asOptionalString(payload.parent_id);
    const parentToolRef =
      asOptionalString(payload.parent_tool_ref) ??
      asOptionalString(payload.callingToolUseId) ??
      asOptionalString(payload.calling_tool_use_id);
    const sessionKey = asOptionalString(payload.session_key);
    const jobId = asOptionalString(payload.job_id);
    const childAgentKey =
      asOptionalString(payload.agent_id) ??
      asOptionalString(payload.agentId) ??
      asOptionalString(payload.child_agent_key);
    const key =
      relationKind === "automation_run"
        ? `automation:${session.id}:${jobId ?? ""}:${sessionKey ?? ""}:${parentUuid ?? fragment.id}`
        : `delegated:${session.id}:${parentUuid ?? session.id}:${childAgentKey ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.created_at = existing.created_at <= fragment.time_key ? existing.created_at : fragment.time_key;
      existing.updated_at = existing.updated_at >= fragment.time_key ? existing.updated_at : fragment.time_key;
      existing.fragment_refs = uniqueStrings([...existing.fragment_refs, fragment.id]);
      existing.parent_tool_ref = existing.parent_tool_ref ?? parentToolRef;
      existing.child_agent_key = existing.child_agent_key ?? childAgentKey;
      existing.status = asOptionalString(payload.status) ?? existing.status;
      existing.raw_detail = { ...existing.raw_detail, ...payload };
      continue;
    }
    grouped.set(key, {
      id: compositeKey("session-related-work", session.id, key),
      source_id: session.source_id,
      source_platform: session.source_platform,
      source_session_ref: session.id,
      relation_kind: relationKind,
      target_kind: relationKind === "automation_run" ? "automation_run" : "session",
      target_session_ref: relationKind === "automation_run" ? parentUuid : parentUuid ?? session.id,
      target_run_ref:
        relationKind === "automation_run"
          ? compositeKey("automation-run", session.source_id, session.id, jobId ?? "", sessionKey ?? fragment.id)
          : undefined,
      transcript_primary: relationKind === "delegated_session",
      evidence_confidence: relationKind === "automation_run" ? 0.95 : isStrictlyTrue(payload.is_sidechain) ? 0.95 : 0.8,
      parent_event_ref: relationKind === "delegated_session" ? parentUuid : undefined,
      parent_tool_ref: parentToolRef,
      child_agent_key: childAgentKey,
      automation_job_ref: relationKind === "automation_run" ? jobId : undefined,
      automation_run_key: relationKind === "automation_run" ? sessionKey : undefined,
      title: session.title,
      status: asOptionalString(payload.status),
      created_at: fragment.time_key,
      updated_at: fragment.time_key,
      fragment_refs: [fragment.id],
      raw_detail: { ...payload },
    });
  }
  return [...grouped.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
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
