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
  DriftTimelinePoint,
  LinkState,
  LossAuditRecord,
  PipelineLineage,
  ProjectIdentity,
  ProjectLineageEvent,
  ProjectLinkRevision,
  ProjectManualOverride,
  RawRecord,
  SearchHighlight,
  SessionProjection,
  SourceFragment,
  SourceStatus,
  SourceSyncPayload,
  StageRun,
  TombstoneProjection,
  TurnContextProjection,
  TurnSearchResult,
  UserTurnProjection,
  ValueAxis,
  KnowledgeArtifact,
} from "@cchistory/domain";
import {
  buildLinkingReview,
  deriveProjectLinkSnapshot,
  type LinkingReview,
  type LinkedProjectObservation,
} from "./linker.js";

export class CCHistoryStorage {
  private readonly db: DatabaseSync;
  private readonly searchIndexReady: boolean;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "cchistory.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.searchIndexReady = this.initialize();
    this.refreshDerivedState();
  }

  close(): void {
    this.db.close();
  }

  private initialize(): boolean {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_instances (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS loss_audits (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS captured_blobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS raw_records (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS source_fragments (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_atoms (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        time_key TEXT NOT NULL,
        seq_no INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS atom_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS derived_candidates (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_ref TEXT NOT NULL,
        candidate_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_turns (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        submission_started_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turn_contexts (
        turn_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_current (
        project_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_link_revisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_lineage_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_manual_overrides (
        id TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tombstones (
        logical_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_artifacts (
        artifact_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifact_coverage (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
          turn_id UNINDEXED,
          project_id UNINDEXED,
          source_id UNINDEXED,
          link_state UNINDEXED,
          value_axis UNINDEXED,
          canonical_text,
          raw_text,
          tokenize = 'unicode61 porter'
        );
      `);
      return true;
    } catch {
      return false;
    }
  }

  replaceSourcePayload(payload: SourceSyncPayload): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.deleteBySource(payload.source.id);

      this.db
        .prepare("INSERT INTO source_instances (id, payload_json) VALUES (?, ?)")
        .run(payload.source.id, toJson(payload.source));

      const insertStageRun = this.db.prepare("INSERT INTO stage_runs (id, source_id, payload_json) VALUES (?, ?, ?)");
      for (const stageRun of payload.stage_runs) {
        insertStageRun.run(stageRun.id, payload.source.id, toJson(stageRun));
      }

      const insertLossAudit = this.db.prepare("INSERT INTO loss_audits (id, source_id, payload_json) VALUES (?, ?, ?)");
      for (const lossAudit of payload.loss_audits) {
        insertLossAudit.run(lossAudit.id, payload.source.id, toJson(lossAudit));
      }

      const insertBlob = this.db.prepare("INSERT INTO captured_blobs (id, source_id, payload_json) VALUES (?, ?, ?)");
      for (const blob of payload.blobs) {
        insertBlob.run(blob.id, payload.source.id, toJson(blob));
      }

      const insertRecord = this.db.prepare(
        "INSERT INTO raw_records (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
      );
      for (const record of payload.records) {
        insertRecord.run(record.id, payload.source.id, record.session_ref, toJson(record));
      }

      const insertFragment = this.db.prepare(
        "INSERT INTO source_fragments (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)",
      );
      for (const fragment of payload.fragments) {
        insertFragment.run(fragment.id, payload.source.id, fragment.session_ref, toJson(fragment));
      }

      const insertAtom = this.db.prepare(
        "INSERT INTO conversation_atoms (id, source_id, session_ref, time_key, seq_no, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const atom of payload.atoms) {
        insertAtom.run(atom.id, payload.source.id, atom.session_ref, atom.time_key, atom.seq_no, toJson(atom));
      }

      const insertEdge = this.db.prepare("INSERT INTO atom_edges (id, source_id, session_ref, payload_json) VALUES (?, ?, ?, ?)");
      for (const edge of payload.edges) {
        insertEdge.run(edge.id, payload.source.id, edge.session_ref, toJson(edge));
      }

      const insertCandidate = this.db.prepare(
        "INSERT INTO derived_candidates (id, source_id, session_ref, candidate_kind, payload_json) VALUES (?, ?, ?, ?, ?)",
      );
      for (const candidate of payload.candidates) {
        insertCandidate.run(
          candidate.id,
          payload.source.id,
          candidate.session_ref,
          candidate.candidate_kind,
          toJson(candidate),
        );
      }

      const insertSession = this.db.prepare(
        "INSERT INTO sessions (id, source_id, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?)",
      );
      for (const session of payload.sessions) {
        insertSession.run(session.id, payload.source.id, session.created_at, session.updated_at, toJson(session));
      }

      const insertTurn = this.db.prepare(
        "INSERT INTO user_turns (id, source_id, session_id, created_at, submission_started_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const turn of payload.turns) {
        insertTurn.run(
          turn.id,
          payload.source.id,
          turn.session_id,
          turn.created_at,
          turn.submission_started_at,
          toJson(turn),
        );
      }

      const insertContext = this.db.prepare("INSERT INTO turn_contexts (turn_id, source_id, payload_json) VALUES (?, ?, ?)");
      for (const context of payload.contexts) {
        insertContext.run(context.turn_id, payload.source.id, toJson(context));
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

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
      .map((row) => fromJson<SourceStatus>((row as { payload_json: string }).payload_json));
  }

  listSourcePayloads(): SourceSyncPayload[] {
    return this.listSources().map((source) => this.buildSourcePayload(source.id));
  }

  getSourcePayload(sourceId: string): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourcePayload(source.id) : undefined;
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
    } else if (this.searchIndexReady) {
      candidateTurnIds = this.querySearchIndex(query, limit * 3);
    } else {
      const loweredQuery = query.toLowerCase();
      candidateTurnIds = [...turnsById.values()]
        .filter((turn) => turn.canonical_text.toLowerCase().includes(loweredQuery))
        .map((turn) => turn.id);
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
    const timeline = this.buildDriftTimeline(turns, consistencyScore, globalDriftIndex);

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
    return deriveProjectLinkSnapshot({
      sessions: this.listSessions(),
      turns: this.listTurns(),
      candidates: this.listCandidates(),
      overrides: this.listProjectOverrides(),
    });
  }

  private refreshDerivedState(): void {
    const existingProjects = this.listCurrentProjects();
    const snapshot = this.buildProjectLinkSnapshot();
    const persistedProjects = this.assignProjectRevisions(snapshot.projects, existingProjects);

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

      this.replaceSearchIndex(snapshot.turns);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private assignProjectRevisions(
    nextProjects: ProjectIdentity[],
    existingProjects: ProjectIdentity[],
  ): {
    projects: ProjectIdentity[];
    revisions: ProjectLinkRevision[];
    lineageEvents: ProjectLineageEvent[];
  } {
    const existingById = new Map(existingProjects.map((project) => [project.project_id, project]));
    const revisions: ProjectLinkRevision[] = [];
    const lineageEvents: ProjectLineageEvent[] = [];
    const projects = nextProjects.map((project) => {
      const existing = existingById.get(project.project_id);
      const changed = !existing || projectSignature(existing) !== projectSignature(project);
      if (!existing) {
        const initialProject = {
          ...project,
          project_revision_id: `${project.project_id}:r1`,
        };
        revisions.push(projectToRevision(initialProject));
        lineageEvents.push({
          id: stableId("project-lineage", initialProject.project_id, initialProject.project_revision_id, "created"),
          project_id: initialProject.project_id,
          project_revision_id: initialProject.project_revision_id,
          event_kind: "created",
          created_at: initialProject.updated_at,
          detail: {
            link_reason: initialProject.link_reason,
            manual_override_status: initialProject.manual_override_status,
          },
        });
        return initialProject;
      }

      if (!changed) {
        return {
          ...project,
          project_revision_id: existing.project_revision_id,
          created_at: existing.created_at,
        };
      }

      const nextRevisionId = incrementProjectRevisionId(existing.project_revision_id);
      const revisedProject = {
        ...project,
        project_revision_id: nextRevisionId,
        created_at: existing.created_at,
      };
      revisions.push(projectToRevision(revisedProject, existing.project_revision_id));
      lineageEvents.push({
        id: stableId("project-lineage", revisedProject.project_id, nextRevisionId, "revised"),
        project_id: revisedProject.project_id,
        project_revision_id: nextRevisionId,
        previous_project_revision_id: existing.project_revision_id,
        event_kind: revisedProject.link_reason === "manual_override" ? "manual_override" : "revised",
        created_at: revisedProject.updated_at,
        detail: {
          previous_link_reason: existing.link_reason,
          next_link_reason: revisedProject.link_reason,
          previous_manual_override_status: existing.manual_override_status,
          next_manual_override_status: revisedProject.manual_override_status,
        },
      });
      lineageEvents.push({
        id: stableId("project-lineage", revisedProject.project_id, existing.project_revision_id, "superseded"),
        project_id: revisedProject.project_id,
        project_revision_id: existing.project_revision_id,
        previous_project_revision_id: nextRevisionId,
        event_kind: "superseded",
        created_at: revisedProject.updated_at,
        detail: {
          superseded_by_project_revision_id: nextRevisionId,
        },
      });
      return revisedProject;
    });

    return { projects, revisions, lineageEvents };
  }

  private replaceSearchIndex(turns: UserTurnProjection[]): void {
    if (!this.searchIndexReady) {
      return;
    }
    this.db.exec("DELETE FROM search_index");
    const insert = this.db.prepare(
      "INSERT INTO search_index (turn_id, project_id, source_id, link_state, value_axis, canonical_text, raw_text) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const turn of turns) {
      insert.run(
        turn.id,
        turn.project_id ?? "",
        turn.source_id,
        turn.link_state,
        turn.value_axis,
        turn.canonical_text,
        turn.raw_text,
      );
    }
  }

  private querySearchIndex(query: string, limit: number): string[] {
    try {
      const rows = this.db
        .prepare("SELECT turn_id FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT ?")
        .all(query, limit) as Array<{ turn_id: string }>;
      return rows.map((row) => row.turn_id);
    } catch {
      const loweredQuery = query.toLowerCase();
      return this.listResolvedTurns()
        .filter((turn) => turn.canonical_text.toLowerCase().includes(loweredQuery))
        .map((turn) => turn.id)
        .slice(0, limit);
    }
  }

  private countRowsBySource(tableName: string, sourceId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE source_id = ?`).get(sourceId) as {
      count: number;
    };
    return row.count;
  }

  private buildDriftTimeline(
    turns: UserTurnProjection[],
    consistencyScore: number,
    globalDriftIndex: number,
  ): DriftTimelinePoint[] {
    const turnsByDay = new Map<string, number>();
    for (const turn of turns) {
      const day = turn.submission_started_at.slice(0, 10);
      turnsByDay.set(day, (turnsByDay.get(day) ?? 0) + 1);
    }

    const today = new Date();
    const timeline: DriftTimelinePoint[] = [];
    let runningTotal = 0;
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - offset);
      const day = date.toISOString().slice(0, 10);
      runningTotal += turnsByDay.get(day) ?? 0;
      timeline.push({
        date: day,
        global_drift_index: globalDriftIndex,
        consistency_score: consistencyScore,
        total_turns: runningTotal,
      });
    }
    return timeline;
  }

  private deleteBySource(sourceId: string): void {
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
      this.db.prepare(statement).run(sourceId);
    }
  }
}

function projectToRevision(project: ProjectIdentity, previousRevisionId?: string): ProjectLinkRevision {
  return {
    id: project.project_revision_id,
    project_id: project.project_id,
    project_revision_id: project.project_revision_id,
    linkage_state: project.linkage_state,
    confidence: project.confidence,
    link_reason: project.link_reason,
    manual_override_status: project.manual_override_status,
    observation_refs: [],
    supersedes_project_revision_id: previousRevisionId,
    created_at: project.updated_at,
  };
}

function projectSignature(project: ProjectIdentity): string {
  return JSON.stringify({
    ...project,
    project_revision_id: undefined,
    created_at: undefined,
  });
}

function incrementProjectRevisionId(currentRevisionId: string): string {
  const match = currentRevisionId.match(/^(.*):r(\d+)$/);
  if (!match) {
    return `${currentRevisionId}:r2`;
  }
  return `${match[1]}:r${Number(match[2]) + 1}`;
}

function incrementArtifactRevisionId(currentRevisionId: string): string {
  const match = currentRevisionId.match(/^(.*):r(\d+)$/);
  if (!match) {
    return `${currentRevisionId}:r2`;
  }
  return `${match[1]}:r${Number(match[2]) + 1}`;
}

function computeRelevanceScore(turn: UserTurnProjection, highlights: SearchHighlight[]): number {
  return highlights.length * 10 + Math.max(0, 1_000_000_000 - Date.parse(turn.submission_started_at)) / 1_000_000_000;
}

function findHighlights(text: string, loweredQuery: string): SearchHighlight[] {
  if (loweredQuery.length === 0) {
    return [];
  }
  const loweredText = text.toLowerCase();
  const highlights: SearchHighlight[] = [];
  let cursor = 0;
  while (cursor < loweredText.length) {
    const foundAt = loweredText.indexOf(loweredQuery, cursor);
    if (foundAt < 0) {
      break;
    }
    highlights.push({ start: foundAt, end: foundAt + loweredQuery.length });
    cursor = foundAt + loweredQuery.length;
  }
  return highlights;
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toJson(value: object): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${parts.join("-").replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
