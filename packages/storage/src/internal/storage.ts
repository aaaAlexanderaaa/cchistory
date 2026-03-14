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
  UsageStatsRollupRow,
  UserTurnProjection,
  ValueAxis,
  KnowledgeArtifact,
  ImportedBundleRecord,
} from "@cchistory/domain";
import { initializeStorageSchema } from "../db/schema.js";
import {
  replaceSourcePayload as replacePersistedSourcePayload,
  replaceSourcePayloadWithOptions as replacePersistedSourcePayloadWithOptions,
} from "../ingest/source-payload.js";
import { buildFallbackProjectObservationCandidates } from "../linking/fallback.js";
import { assignProjectRevisions } from "../linking/revisions.js";
import { clamp01, buildDriftTimeline } from "../queries/drift.js";
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
import { hydrateSourceStatus } from "./source-identity.js";
import {
  fromJson,
  incrementArtifactRevisionId,
  nowIso,
  stableId,
  toJson,
  uniqueStrings,
} from "./utils.js";

export class CCHistoryStorage {
  private readonly db: DatabaseSync;
  private readonly searchIndexReady: boolean;
  private cachedProjectLinkSnapshot?: ReturnType<typeof deriveProjectLinkSnapshot>;
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
    this.searchIndexReady = this.initialize();
    this.refreshDerivedState();
  }

  close(): void {
    this.db.close();
  }

  private initialize(): boolean {
    return initializeStorageSchema(this.db);
  }

  replaceSourcePayload(
    payload: SourceSyncPayload,
    options: {
      allow_host_rekey?: boolean;
    } = {},
  ): void {
    if (options.allow_host_rekey) {
      replacePersistedSourcePayloadWithOptions(this.db, payload, { allow_host_rekey: true });
    } else {
      replacePersistedSourcePayload(this.db, payload);
    }

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
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
      id: existing?.id ?? stableId("project-override", input.target_kind, input.target_ref),
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
    return this.db
      .prepare("SELECT payload_json FROM source_instances ORDER BY id")
      .all()
      .map((row) => hydrateSourceStatus(fromJson<SourceStatus>((row as { payload_json: string }).payload_json)));
  }

  listSourcePayloads(): SourceSyncPayload[] {
    return this.listSources().map((source) => this.buildSourcePayload(source.id));
  }

  getSourcePayload(sourceId: string): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourcePayload(source.id) : undefined;
  }

  listImportedBundles(): ImportedBundleRecord[] {
    return this.db
      .prepare("SELECT payload_json FROM import_bundles ORDER BY bundle_id")
      .all()
      .map((row) => fromJson<ImportedBundleRecord>((row as { payload_json: string }).payload_json));
  }

  getImportedBundle(bundleId: string): ImportedBundleRecord | undefined {
    const row = this.db.prepare("SELECT payload_json FROM import_bundles WHERE bundle_id = ?").get(bundleId) as
      | { payload_json: string }
      | undefined;
    return row ? fromJson<ImportedBundleRecord>(row.payload_json) : undefined;
  }

  upsertImportedBundle(record: ImportedBundleRecord): ImportedBundleRecord {
    this.db
      .prepare("INSERT OR REPLACE INTO import_bundles (bundle_id, payload_json) VALUES (?, ?)")
      .run(record.bundle_id, toJson(record));
    return record;
  }

  listTurns(): UserTurnProjection[] {
    return this.db
      .prepare("SELECT payload_json FROM user_turns ORDER BY submission_started_at DESC, created_at DESC")
      .all()
      .map((row) => fromJson<UserTurnProjection>((row as { payload_json: string }).payload_json));
  }

  listResolvedTurns(): UserTurnProjection[] {
    return this.buildProjectLinkSnapshot().turns;
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
    const row = this.db.prepare("SELECT payload_json FROM user_turns WHERE id = ?").get(turnId) as
      | { payload_json: string }
      | undefined;
    return row ? fromJson<UserTurnProjection>(row.payload_json) : undefined;
  }

  getResolvedTurn(turnId: string): UserTurnProjection | undefined {
    return this.buildProjectLinkSnapshot().turns.find((turn) => turn.id === turnId);
  }

  getTurnContext(turnId: string): TurnContextProjection | undefined {
    const row = this.db.prepare("SELECT payload_json FROM turn_contexts WHERE turn_id = ?").get(turnId) as
      | { payload_json: string }
      | undefined;
    return row ? fromJson<TurnContextProjection>(row.payload_json) : undefined;
  }

  getSession(sessionId: string): SessionProjection | undefined {
    const row = this.db.prepare("SELECT payload_json FROM sessions WHERE id = ?").get(sessionId) as
      | { payload_json: string }
      | undefined;
    return row ? fromJson<SessionProjection>(row.payload_json) : undefined;
  }

  getResolvedSession(sessionId: string): SessionProjection | undefined {
    return this.buildProjectLinkSnapshot().sessions.find((session) => session.id === sessionId);
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
    return this.db
      .prepare("SELECT payload_json FROM project_manual_overrides ORDER BY target_kind, target_ref")
      .all()
      .map((row) => fromJson<ProjectManualOverride>((row as { payload_json: string }).payload_json));
  }

  listProjectRevisions(projectId?: string): ProjectLinkRevision[] {
    const rows =
      projectId
        ? this.db.prepare("SELECT payload_json FROM project_link_revisions WHERE project_id = ? ORDER BY id DESC").all(projectId)
        : this.db.prepare("SELECT payload_json FROM project_link_revisions ORDER BY id DESC").all();
    return rows.map((row) => fromJson<ProjectLinkRevision>((row as { payload_json: string }).payload_json));
  }

  listProjectLineageEvents(projectId?: string): ProjectLineageEvent[] {
    const rows =
      projectId
        ? this.db.prepare("SELECT payload_json FROM project_lineage_events WHERE project_id = ? ORDER BY id DESC").all(projectId)
        : this.db.prepare("SELECT payload_json FROM project_lineage_events ORDER BY id DESC").all();
    return rows.map((row) => fromJson<ProjectLineageEvent>((row as { payload_json: string }).payload_json));
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
      id: stableId("project-lineage", input.project_id, input.project_revision_id ?? project?.project_revision_id ?? "unknown", input.event_kind, nowIso()),
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
    const row = this.db.prepare("SELECT payload_json FROM tombstones WHERE logical_id = ?").get(logicalId) as
      | { payload_json: string }
      | undefined;
    return row ? fromJson<TombstoneProjection>(row.payload_json) : undefined;
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

    for (const turn of candidates) {
      if (mode === "archive") {
        this.rewriteStoredTurn(turn.id, (storedTurn) => ({
          ...storedTurn,
          value_axis: "archived",
          retention_axis: "keep_raw_only",
        }));
        continue;
      }
      const tombstone = this.purgeTurn(turn.id, "candidate_gc");
      if (tombstone) {
        tombstones.push(tombstone);
      }
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

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO tombstones (logical_id, payload_json) VALUES (?, ?)")
        .run(tombstone.logical_id, toJson(tombstone));
      this.db.prepare("DELETE FROM user_turns WHERE id = ?").run(turnId);
      this.db.prepare("DELETE FROM turn_contexts WHERE turn_id = ?").run(turnId);
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
    const artifacts = this.db
      .prepare("SELECT payload_json FROM knowledge_artifacts ORDER BY artifact_id")
      .all()
      .map((row) => fromJson<KnowledgeArtifact>((row as { payload_json: string }).payload_json));
    return projectId ? artifacts.filter((artifact) => artifact.project_id === projectId) : artifacts;
  }

  listArtifactCoverage(artifactId?: string): ArtifactCoverageRecord[] {
    const rows =
      artifactId
        ? this.db.prepare("SELECT payload_json FROM artifact_coverage WHERE artifact_id = ? ORDER BY id").all(artifactId)
        : this.db.prepare("SELECT payload_json FROM artifact_coverage ORDER BY id").all();
    return rows.map((row) => fromJson<ArtifactCoverageRecord>((row as { payload_json: string }).payload_json));
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
    const artifactId = input.artifact_id ?? stableId("artifact", input.title.toLowerCase());
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
          id: stableId("artifact-coverage", artifact.artifact_id, turnId),
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
    return this.db
      .prepare("SELECT payload_json FROM stage_runs ORDER BY id DESC")
      .all()
      .map((row) => fromJson<StageRun>((row as { payload_json: string }).payload_json));
  }

  listBlobs(limit = 200): CapturedBlob[] {
    return this.selectPayloads<CapturedBlob>("captured_blobs", limit);
  }

  listRecords(limit = 500): RawRecord[] {
    return this.selectPayloads<RawRecord>("raw_records", limit);
  }

  listFragments(limit = 500): SourceFragment[] {
    return this.selectPayloads<SourceFragment>("source_fragments", limit);
  }

  listAtoms(limit = 500): ConversationAtom[] {
    return this.selectPayloads<ConversationAtom>("conversation_atoms", limit, "ORDER BY time_key DESC, seq_no DESC");
  }

  listEdges(limit = 500): AtomEdge[] {
    return this.selectPayloads<AtomEdge>("atom_edges", limit);
  }

  listCandidates(limit = 500): DerivedCandidate[] {
    return this.selectPayloads<DerivedCandidate>("derived_candidates", limit);
  }

  listLossAudits(limit = 500): LossAuditRecord[] {
    return this.selectPayloads<LossAuditRecord>("loss_audits", limit);
  }

  getTurnLineage(turnId: string): PipelineLineage | undefined {
    const turn = this.getResolvedTurn(turnId) ?? this.getTurn(turnId);
    if (!turn) {
      return undefined;
    }

    const session = this.getResolvedSession(turn.session_id) ?? this.getSession(turn.session_id);
    const candidateChain = this.selectJsonByIds<DerivedCandidate>("derived_candidates", turn.lineage.candidate_refs);
    const atoms = this.selectJsonByIds<ConversationAtom>("conversation_atoms", turn.lineage.atom_refs);
    const atomIdSet = new Set(atoms.map((atom) => atom.id));
    const edges = this.listAtomsEdgesForAtomIds(atomIdSet);
    const fragments = this.selectJsonByIds<SourceFragment>("source_fragments", turn.lineage.fragment_refs);
    const records = this.selectJsonByIds<RawRecord>("raw_records", turn.lineage.record_refs);
    const blobs = this.selectJsonByIds<CapturedBlob>("captured_blobs", turn.lineage.blob_refs);

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
    const turnsById = new Map(this.listResolvedTurns().map((turn) => [turn.id, turn]));
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

    const projectsById = new Map(this.listProjects().map((project) => [project.project_id, project]));
    const sessionsById = new Map(this.listSessions().map((session) => [session.id, session]));
    const loweredQuery = query.toLowerCase();
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

      const highlights = query.length > 0 ? findHighlights(turn.canonical_text, loweredQuery) : [];
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

  getUsageOverview(filters: UsageFilters = {}): UsageStatsOverview {
    const rows = this.buildUsageRows(filters);
    const turnCount = rows.length;
    const turnsWithTokenUsage = rows.filter((row) => row.has_token_usage).length;
    const turnsWithPrimaryModel = rows.filter((row) => row.model !== "unknown").length;

    return {
      generated_at: nowIso(),
      total_turns: turnCount,
      turns_with_token_usage: turnsWithTokenUsage,
      turn_coverage_ratio: turnCount === 0 ? 0 : turnsWithTokenUsage / turnCount,
      turns_with_primary_model: turnsWithPrimaryModel,
      total_input_tokens: sumUsageRows(rows, "input_tokens"),
      total_cached_input_tokens: sumUsageRows(rows, "cached_input_tokens"),
      total_output_tokens: sumUsageRows(rows, "output_tokens"),
      total_reasoning_output_tokens: sumUsageRows(rows, "reasoning_output_tokens"),
      total_tokens: sumUsageRows(rows, "total_tokens"),
    };
  }

  listUsageRollup(dimension: UsageStatsDimension, filters: UsageFilters = {}): UsageStatsRollup {
    const rows = this.buildUsageRows(filters);
    const groups = new Map<string, UsageStatsRollupRow>();

    for (const row of rows) {
      const key = usageDimensionKey(row, dimension);
      const label = usageDimensionLabel(row, dimension);
      const current = groups.get(key) ?? {
        key,
        label,
        dimension,
        turn_count: 0,
        turns_with_token_usage: 0,
        turn_coverage_ratio: 0,
        turns_with_primary_model: 0,
        total_input_tokens: 0,
        total_cached_input_tokens: 0,
        total_output_tokens: 0,
        total_reasoning_output_tokens: 0,
        total_tokens: 0,
      };
      current.turn_count += 1;
      current.turns_with_token_usage += row.has_token_usage ? 1 : 0;
      current.turns_with_primary_model += row.model !== "unknown" ? 1 : 0;
      current.total_input_tokens += row.input_tokens;
      current.total_cached_input_tokens += row.cached_input_tokens;
      current.total_output_tokens += row.output_tokens;
      current.total_reasoning_output_tokens += row.reasoning_output_tokens;
      current.total_tokens += row.total_tokens;
      groups.set(key, current);
    }

    const rollupRows = [...groups.values()]
      .map((row) => ({
        ...row,
        turn_coverage_ratio: row.turn_count === 0 ? 0 : row.turns_with_token_usage / row.turn_count,
      }))
      .sort((left, right) => compareUsageRollupRows(dimension, left, right));

    return {
      generated_at: nowIso(),
      dimension,
      rows: rollupRows,
    };
  }

  getDriftReport(): DriftReport {
    const turns = this.listResolvedTurns();
    const sources = this.listSources();
    const unlinkedTurns = turns.filter((turn) => turn.link_state === "unlinked").length;
    const candidateTurns = turns.filter((turn) => turn.link_state === "candidate").length;
    const staleOrErrorSources = sources.filter((source) => source.sync_status !== "healthy").length;
    const orphanedTurns = turns.filter((turn) => !turn.project_id).length;
    const activeSources = sources.filter((source) => source.sync_status === "healthy").length;
    const totalTurns = Math.max(turns.length, 1);
    const consistencyPenalty = unlinkedTurns / totalTurns + staleOrErrorSources / Math.max(sources.length || 1, 1) / 2;
    const consistencyScore = clamp01(1 - consistencyPenalty);
    const globalDriftIndex = clamp01(
      candidateTurns / totalTurns / 2 + orphanedTurns / totalTurns / 2 + staleOrErrorSources / Math.max(sources.length || 1, 1) / 2,
    );
    const timeline = buildDriftTimeline(turns, consistencyScore, globalDriftIndex);

    return {
      generated_at: nowIso(),
      global_drift_index: globalDriftIndex,
      active_sources: activeSources,
      sources_awaiting_sync: staleOrErrorSources,
      orphaned_turns: orphanedTurns,
      unlinked_turns: unlinkedTurns,
      candidate_turns: candidateTurns,
      consistency_score: consistencyScore,
      timeline,
    };
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
        blobs: this.countRowsBySource("captured_blobs", sourceId),
        records: this.countRowsBySource("raw_records", sourceId),
        fragments: this.countRowsBySource("source_fragments", sourceId),
        atoms: this.countRowsBySource("conversation_atoms", sourceId),
        candidates: this.countRowsBySource("derived_candidates", sourceId),
        sessions: this.countRowsBySource("sessions", sourceId),
        turns: turns.length,
      },
      turn_text_by_id: Object.fromEntries(turns.map((turn) => [turn.id, turn.canonical_text])),
      project_ids: sourceProjects,
      latest_stage_run_ids: stageRuns.slice(0, 8).map((stageRun) => stageRun.id),
    };
  }

  private buildUsageRows(filters: UsageFilters): UsageAggregationRow[] {
    const turns = this.listResolvedTurns();
    const sessionsById = new Map(this.listResolvedSessions().map((session) => [session.id, session]));
    const sourcesById = new Map(this.listSources().map((source) => [source.id, source]));
    const projectsById = new Map(this.listProjects().map((project) => [project.project_id, project]));

    return turns
      .filter((turn) => (filters.project_id ? turn.project_id === filters.project_id : true))
      .filter((turn) => (filters.source_ids && filters.source_ids.length > 0 ? filters.source_ids.includes(turn.source_id) : true))
      .map((turn) => {
        const session = sessionsById.get(turn.session_id);
        const source = sourcesById.get(turn.source_id);
        const project = turn.project_id ? projectsById.get(turn.project_id) : undefined;
        return {
          turn_id: turn.id,
          source_id: turn.source_id,
          source_label: source ? `${source.display_name} (${source.slot_id})` : turn.source_id,
          host_id: session?.host_id ?? source?.host_id ?? "unknown",
          project_id: turn.project_id,
          project_label: project?.display_name ?? "Unassigned",
          model: turn.context_summary.primary_model ?? session?.model ?? "unknown",
          day: turn.submission_started_at.slice(0, 10),
          month: turn.submission_started_at.slice(0, 7),
          has_token_usage: hasAnyTokenUsage(turn),
          input_tokens: turn.context_summary.token_usage?.input_tokens ?? 0,
          cached_input_tokens:
            turn.context_summary.token_usage?.cached_input_tokens ??
            (turn.context_summary.token_usage?.cache_read_input_tokens ?? 0) +
              (turn.context_summary.token_usage?.cache_creation_input_tokens ?? 0),
          output_tokens: turn.context_summary.token_usage?.output_tokens ?? 0,
          reasoning_output_tokens: turn.context_summary.token_usage?.reasoning_output_tokens ?? 0,
          total_tokens: turn.context_summary.token_usage?.total_tokens ?? turn.context_summary.total_tokens ?? 0,
        };
      })
      .filter((row) => (filters.host_ids && filters.host_ids.length > 0 ? filters.host_ids.includes(row.host_id) : true));
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

  private listAtomsEdgesForAtomIds(atomIds: Set<string>): AtomEdge[] {
    return this.db
      .prepare("SELECT payload_json FROM atom_edges")
      .all()
      .map((row) => fromJson<AtomEdge>((row as { payload_json: string }).payload_json))
      .filter((edge) => atomIds.has(edge.from_atom_id) || atomIds.has(edge.to_atom_id));
  }

  private selectJsonByIds<T>(tableName: string, ids: string[]): T[] {
    if (ids.length === 0) {
      return [];
    }
    const select = this.db.prepare(`SELECT payload_json FROM ${tableName} WHERE id = ?`);
    return ids
      .map((id) => select.get(id) as { payload_json: string } | undefined)
      .filter((row): row is { payload_json: string } => Boolean(row))
      .map((row) => fromJson<T>(row.payload_json));
  }

  private selectPayloads<T>(tableName: string, limit: number, orderBy = "ORDER BY id DESC"): T[] {
    return this.db
      .prepare(`SELECT payload_json FROM ${tableName} ${orderBy} LIMIT ?`)
      .all(limit)
      .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
  }

  private selectAllPayloads<T>(tableName: string, orderBy = "ORDER BY id DESC"): T[] {
    return this.db
      .prepare(`SELECT payload_json FROM ${tableName} ${orderBy}`)
      .all()
      .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
  }

  private selectPayloadsBySource<T>(tableName: string, sourceId: string, orderBy = "ORDER BY id"): T[] {
    return this.db
      .prepare(`SELECT payload_json FROM ${tableName} WHERE source_id = ? ${orderBy}`)
      .all(sourceId)
      .map((row) => fromJson<T>((row as { payload_json: string }).payload_json));
  }

  private listSessions(): SessionProjection[] {
    return this.db
      .prepare("SELECT payload_json FROM sessions ORDER BY updated_at DESC, created_at DESC")
      .all()
      .map((row) => fromJson<SessionProjection>((row as { payload_json: string }).payload_json));
  }

  private buildSourcePayload(sourceId: string): SourceSyncPayload {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }

    return {
      source,
      stage_runs: this.selectPayloadsBySource<StageRun>("stage_runs", sourceId),
      loss_audits: this.selectPayloadsBySource<LossAuditRecord>("loss_audits", sourceId),
      blobs: this.selectPayloadsBySource<CapturedBlob>("captured_blobs", sourceId),
      records: this.selectPayloadsBySource<RawRecord>("raw_records", sourceId),
      fragments: this.selectPayloadsBySource<SourceFragment>("source_fragments", sourceId),
      atoms: this.selectPayloadsBySource<ConversationAtom>("conversation_atoms", sourceId, "ORDER BY time_key ASC, seq_no ASC"),
      edges: this.selectPayloadsBySource<AtomEdge>("atom_edges", sourceId),
      candidates: this.selectPayloadsBySource<DerivedCandidate>("derived_candidates", sourceId),
      sessions: this.selectPayloadsBySource<SessionProjection>("sessions", sourceId, "ORDER BY created_at ASC, updated_at ASC"),
      turns: this.selectPayloadsBySource<UserTurnProjection>(
        "user_turns",
        sourceId,
        "ORDER BY submission_started_at DESC, created_at DESC",
      ),
      contexts: this.selectPayloadsBySource<TurnContextProjection>("turn_contexts", sourceId, "ORDER BY turn_id"),
    };
  }

  private listCurrentProjects(): ProjectIdentity[] {
    return this.db
      .prepare("SELECT payload_json FROM project_current ORDER BY project_id")
      .all()
      .map((row) => fromJson<ProjectIdentity>((row as { payload_json: string }).payload_json));
  }

  private buildProjectLinkSnapshot() {
    if (!this.cachedProjectLinkSnapshot) {
      this.cachedProjectLinkSnapshot = this.computeProjectLinkSnapshot();
    }
    return this.cachedProjectLinkSnapshot;
  }

  private invalidateProjectLinkSnapshot(): void {
    this.cachedProjectLinkSnapshot = undefined;
  }

  private computeProjectLinkSnapshot() {
    const sessions = this.listSessions();
    const turns = this.listTurns();
    const candidates = this.selectAllPayloads<DerivedCandidate>("derived_candidates");
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
          selectBlobsByIds: (ids) => this.selectJsonByIds<CapturedBlob>("captured_blobs", ids),
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

  private countRowsBySource(tableName: string, sourceId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`).get(sourceId) as {
      count: number;
    };
    return row.count;
  }
}

interface UsageFilters {
  project_id?: string;
  source_ids?: string[];
  host_ids?: string[];
}

function compareUsageRollupRows(
  dimension: UsageStatsDimension,
  left: UsageStatsRollupRow,
  right: UsageStatsRollupRow,
): number {
  if (dimension === "day" || dimension === "month") {
    return left.key.localeCompare(right.key);
  }
  if (left.total_tokens !== right.total_tokens) {
    return right.total_tokens - left.total_tokens;
  }
  if (left.turn_count !== right.turn_count) {
    return right.turn_count - left.turn_count;
  }
  return left.label.localeCompare(right.label);
}

interface UsageAggregationRow {
  turn_id: string;
  source_id: string;
  source_label: string;
  host_id: string;
  project_id?: string;
  project_label: string;
  model: string;
  day: string;
  month: string;
  has_token_usage: boolean;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

function hasAnyTokenUsage(turn: UserTurnProjection): boolean {
  const usage = turn.context_summary.token_usage;
  if (!usage) {
    return typeof turn.context_summary.total_tokens === "number";
  }
  return [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cached_input_tokens,
    usage.output_tokens,
    usage.reasoning_output_tokens,
    usage.total_tokens,
  ].some((value) => typeof value === "number");
}

function sumUsageRows(rows: UsageAggregationRow[], key: keyof Pick<
  UsageAggregationRow,
  "input_tokens" | "cached_input_tokens" | "output_tokens" | "reasoning_output_tokens" | "total_tokens"
>): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

function usageDimensionKey(row: UsageAggregationRow, dimension: UsageStatsDimension): string {
  switch (dimension) {
    case "model":
      return row.model;
    case "project":
      return row.project_id ?? "unassigned";
    case "source":
      return row.source_id;
    case "host":
      return row.host_id;
    case "day":
      return row.day;
    case "month":
      return row.month;
  }
}

function usageDimensionLabel(row: UsageAggregationRow, dimension: UsageStatsDimension): string {
  switch (dimension) {
    case "model":
      return row.model;
    case "project":
      return row.project_label;
    case "source":
      return row.source_label;
    case "host":
      return row.host_id;
    case "day":
      return row.day;
    case "month":
      return row.month;
  }
}
