import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";
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
import {
  initializeStorageSchema,
  readStorageSchemaInfo,
  type StorageSchemaInfo,
  type StorageSchemaInitialization,
} from "../db/schema.js";
import {
  mergeSourcePayloadByOriginPath as mergePersistedSourcePayloadByOriginPath,
  pruneSourcePayloadByObservedOriginPaths as prunePersistedSourcePayloadByObservedOriginPaths,
  replaceSourcePayloadWithOptions as replacePersistedSourcePayloadWithOptions,
  updateSourceSyncMetadata as updatePersistedSourceSyncMetadata,
  type SourcePayloadWriteProgressEvent,
} from "../ingest/source-payload.js";
import {
  loadLineageBlobsBySha,
  markStorageBoundaryV2SourceAbsentByObservedOrigins,
  readTurnContextFromV2Cache,
  refreshGlobalDerivedCacheRefsForSource,
  retireStorageBoundaryV2Sources,
  streamV2SidecarsFromV1,
  writeStorageBoundaryV2Sidecars,
  mergeSourcePayloadStreaming,
  type SourcePayloadStreamingChunk,
} from "../evidence-store.js";
import { buildFallbackProjectObservationCandidates } from "../linking/fallback.js";
import { assignProjectRevisions } from "../linking/revisions.js";
import {
  computeRelevanceScore,
  findHighlights,
  replaceSearchIndex,
  scanSearchCandidateRows,
  type SearchScanCandidate,
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
  normalizePathKey,
  toJson,
  uniqueStrings,
} from "./utils.js";
import * as Queries from "./queries.js";
import * as Stats from "./stats.js";
import * as Gc from "./gc.js";
import {
  planStorageBoundaryRebuildScope,
  type StorageBoundaryRebuildPlan,
  type StorageBoundaryRebuildScopeSelector,
} from "./rebuild-scope.js";
import { normalizeSourcePayload } from "./source-identity.js";

type StorageProgressEvent = SourcePayloadWriteProgressEvent | {
  stage: "reindex_start" | "reindex_done";
  source_id: string;
};

interface RankedSearchCandidate {
  candidate: SearchScanCandidate;
  resolvedTurn?: UserTurnProjection;
  highlights: TurnSearchResult["highlights"];
  relevance_score: number;
}

interface ReadSurfaceSearchGroup {
  project_id: string;
  project_name: string;
  total: number;
}

interface ReadSurfaceSearchProjectResolver {
  projectsById: Map<string, ProjectIdentity>;
  projectBySessionId: Map<string, ProjectIdentity>;
  projectByTurnId: Map<string, ProjectIdentity>;
}

interface MutableReadSurfaceSearchGroup extends ReadSurfaceSearchGroup {
  latest_activity_at: string;
}

const UNLINKED_SEARCH_PROJECT_ID = "__unlinked__";

export class CCHistoryStorage {
  private readonly db: DatabaseSync;
  private readonly assetDir?: string;
  private readonly searchIndexAvailable: boolean;
  private searchIndexUsable: boolean;
  private cachedProjectLinkSnapshot?: ReturnType<typeof deriveProjectLinkSnapshot>;
  private cachedTurnsById?: Map<string, UserTurnProjection>;
  private cachedProjectsById?: Map<string, ProjectIdentity>;
  private cachedSessionsById?: Map<string, SessionProjection>;
  private cachedRelatedWorkBySessionId?: Map<string, SessionRelatedWorkProjection[]>;
  private cachedSearchLinkedTurnsById?: Map<string, UserTurnProjection>;
  private cachedReadSurfaceSearchProjectResolver?: ReadSurfaceSearchProjectResolver;
  readonly dbPath: string;

  constructor(location: string | { dataDir?: string; dbPath?: string; assetDir?: string }) {
    const dbPath =
      typeof location === "string"
        ? path.join(location, "cchistory.sqlite")
        : location.dbPath ?? path.join(location.dataDir ?? ".", "cchistory.sqlite");
    const assetDir = resolveStorageAssetDir(location, dbPath);
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    if (assetDir) {
      mkdirSync(assetDir, { recursive: true });
    }
    this.assetDir = assetDir;
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000;");
    // A.4: pragma tuning for multi-GB stores. page_size must be set BEFORE
    // journal_mode = WAL — SQLite rejects page_size changes on a WAL-mode
    // database. On an existing DB page_size is silently ignored until VACUUM
    // (see `cchistory maintenance vacuum`); mmap_size + synchronous NORMAL
    // apply immediately.
    this.db.exec("PRAGMA page_size = 16384;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA mmap_size = 268435456;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    const initialization = this.initialize();
    this.searchIndexAvailable = initialization.searchIndexReady;
    // A.1: FTS5 is no longer maintained on the refresh hot path. searchMode
    // defaults to "fallback" until an operator explicitly calls
    // `rebuildSearchIndex()` (exposed as `cchistory maintenance rebuild-search-index`).
    this.searchIndexUsable = false;
  }

  close(): void {
    // A.4: checkpoint the WAL into the main file and truncate the WAL so the
    // on-disk footprint stays bounded. Best-effort: a checkpoint failure must
    // not block close (callers may close on error paths).
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // ignore — close must not throw
    }
    this.db.close();
  }

  /**
   * Rebuild the FTS5 search_index table from current user_turns rows.
   *
   * After A.1 the refreshDerivedState hot path no longer maintains FTS5, so
   * the index drifts as turns are added/removed. This method is the explicit
   * operator hook to repopulate it; once it returns, searchMode reports
   * "fts5" until the next refresh (which does not touch FTS5).
   *
   * Returns the count of turns indexed and whether the FTS5 schema is in use.
   * If FTS5 is unavailable in the current build (searchIndexAvailable = false),
   * the call is a no-op and returns ready=false.
   */
  rebuildSearchIndex(): { rows_indexed: number; ready: boolean } {
    if (!this.searchIndexAvailable) {
      return { rows_indexed: 0, ready: false };
    }
    const turns = this.listResolvedTurns();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      replaceSearchIndex(this.db, this.searchIndexAvailable, turns);
      this.searchIndexUsable = this.searchIndexAvailable;
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    return { rows_indexed: turns.length, ready: this.searchIndexUsable };
  }

  get searchMode(): "fts5" | "fallback" {
    return this.searchIndexUsable ? "fts5" : "fallback";
  }

  getSchemaInfo(): StorageSchemaInfo {
    return readStorageSchemaInfo(this.db);
  }

  private initialize(): StorageSchemaInitialization {
    return initializeStorageSchema(this.db);
  }

  private writeStorageBoundaryV2Sidecars(
    payload: SourceSyncPayload,
    options: {
      writeMode: "replace" | "merge";
      preserveOriginPaths?: readonly string[];
      observedOriginPaths?: readonly string[];
      skipGlobalScopes?: boolean;
    },
  ): { pruned_evidence_shas: string[] } {
    const result = writeStorageBoundaryV2Sidecars({
      db: this.db,
      payload,
      assetDir: this.assetDir,
      writeMode: options.writeMode,
      preserveOriginPaths: options.preserveOriginPaths,
      observedOriginPaths: options.observedOriginPaths,
      skipGlobalScopes: options.skipGlobalScopes,
    });
    // Unlink content-addressed files for blobs whose refs were dropped by
    // prepareReplace/Merge (mutated lineage, dropped session-scoped turns).
    // replace path already unlinks retireStorageBoundaryV2Sources output above;
    // the dedupe in unlinkEvidenceBlobFiles makes the double-call safe.
    this.unlinkEvidenceBlobFiles(result.pruned_evidence_shas);
    return result;
  }

  /**
   * B4: re-count `turns` from user_turns_v2 after writeStorageBoundaryV2Sidecars
   * has populated the V2 rows for incoming turns. The other axes (sessions,
   * records, fragments, atoms, blobs) are written inside the V1 merge/replace
   * transaction itself, so their pre-sidecar counts are already correct. Only
   * `turns` is racy because V2 sidecars are written in a follow-up transaction.
   *
   * Also refreshes source_instances.total_turns so listSources() reflects the
   * post-sidecar state. See [[dual-write-mutation-sync]].
   */
  private recountSourcePayloadAfterV2Sidecars(
    sourceId: string,
    previous: {
      sessions: number;
      turns: number;
      records: number;
      fragments: number;
      atoms: number;
      blobs: number;
    },
  ): {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  } {
    Queries.refreshSourceStatusCountsInTransaction(this.db, [sourceId]);
    const turns = Queries.countRowsBySource(this.db, "user_turns_v2", sourceId);
    return { ...previous, turns };
  }

  replaceSourcePayload(
    payload: SourceSyncPayload,
    options: {
      allow_host_rekey?: boolean;
      onProgress?: (event: StorageProgressEvent) => void;
      refreshDerived?: boolean;
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
    const sourceIdsBeforeReplace = this.listSources().map((source) => source.id);
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
    const sourceIdsAfterReplace = new Set(this.listSources().map((source) => source.id));
    const retirement = retireStorageBoundaryV2Sources({
      db: this.db,
      sourceIds: sourceIdsBeforeReplace.filter((sourceId) => !sourceIdsAfterReplace.has(sourceId)),
    });
    // A.2: unlink content-addressed evidence files whose rows were dropped.
    this.unlinkEvidenceBlobFiles(retirement.pruned_evidence_shas);
    this.writeStorageBoundaryV2Sidecars(payload, { writeMode: "replace" });

    // B4: countStoredSourcePayload (inside replacePersistedSourcePayloadWithOptions)
    // counts turns from user_turns_v2, but writeStorageBoundaryV2Sidecars runs
    // AFTER that count and is what actually populates V2 rows for the incoming
    // turns. Pre-B4 the count read V1 and was correct by accident; B4 switched
    // to V2 so the count survives the B.6 V1 drop, which exposed the ordering
    // gap. Refresh source_instances.total_turns from V2 and patch the return
    // value so callers (and tests) see the post-sidecar count. See
    // [[dual-write-mutation-sync]].
    //
    // Use the normalized source id (host-identity re-keying inside
    // replacePersistedSourcePayloadWithOptions may differ from payload.source.id;
    // V1/V2 rows are written under the normalized id, so the recount must use
    // it too or WHERE source_id = ? returns zero rows).
    const normalizedSourceId = normalizeSourcePayload(payload).source.id;
    result = this.recountSourcePayloadAfterV2Sidecars(normalizedSourceId, result);

    this.invalidateProjectLinkSnapshot();
    if (options.refreshDerived === false) {
      return result;
    }
    options.onProgress?.({ stage: "reindex_start", source_id: payload.source.id });
    this.refreshDerivedState();
    options.onProgress?.({ stage: "reindex_done", source_id: payload.source.id });
    return result;
  }

  mergeSourcePayloadByOriginPath(
    payload: SourceSyncPayload,
    options: {
      preserve_origin_paths?: readonly string[];
      observed_origin_paths?: readonly string[];
      onProgress?: (event: StorageProgressEvent) => void;
      refreshDerived?: boolean;
      skipGlobalScopes?: boolean;
    } = {},
  ): {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  } {
    const result = mergePersistedSourcePayloadByOriginPath(this.db, payload, {
      preserve_origin_paths: options.preserve_origin_paths,
      observed_origin_paths: options.observed_origin_paths,
      on_progress: options.onProgress,
    });
    this.writeStorageBoundaryV2Sidecars(payload, {
      writeMode: "merge",
      preserveOriginPaths: options.preserve_origin_paths,
      observedOriginPaths: options.observed_origin_paths,
      skipGlobalScopes: options.skipGlobalScopes,
    });

    // B4: same ordering gap as replaceSourcePayload above — countStoredSourcePayload
    // ran before V2 sidecars were written, so its `turns` field omits incoming
    // turns whose V2 rows don't exist yet. Recount from V2 now. Use the
    // normalized source id for the same host-identity re-keying reason.
    const normalizedSourceId = normalizeSourcePayload(payload).source.id;
    const recounted = this.recountSourcePayloadAfterV2Sidecars(normalizedSourceId, result);

    this.invalidateProjectLinkSnapshot();
    if (options.refreshDerived === false) {
      return recounted;
    }
    options.onProgress?.({ stage: "reindex_start", source_id: payload.source.id });
    this.refreshDerivedState();
    options.onProgress?.({ stage: "reindex_done", source_id: payload.source.id });
    return recounted;
  }

  /**
   * Streaming variant of `mergeSourcePayloadByOriginPath` for the sync hot
   * path. Consumes pre-projected per-file chunks (V1 + V2 writes per chunk)
   * so peak memory stays bounded by ~one file's worth of derived structures
   * regardless of source size. See `mergeSourcePayloadStreaming` in
   * evidence-store.ts for behavior parity and the cross-file-session
   * limitation.
   *
   * Caller supplies chunks via an async iterable. The CLI is the expected
   * caller — it owns the probe → project → storage orchestration.
   */
  async mergeSourcePayloadStreaming(
    source: SourceStatus,
    input: {
      chunks: AsyncIterable<SourcePayloadStreamingChunk>;
      preserve_origin_paths: ReadonlySet<string>;
      observed_origin_paths: ReadonlySet<string>;
      onProgress?: (event: StorageProgressEvent) => void;
    },
  ): Promise<{
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
    pruned_evidence_shas: string[];
  }> {
    const result = await mergeSourcePayloadStreaming(this.db, source, {
      chunks: input.chunks,
      preserve_origin_paths: input.preserve_origin_paths,
      observed_origin_paths: input.observed_origin_paths,
      asset_dir: this.assetDir,
      on_progress: input.onProgress,
    });
    this.unlinkEvidenceBlobFiles(result.pruned_evidence_shas);
    this.invalidateProjectLinkSnapshot();
    return result;
  }

  refreshGlobalDerivedCacheRefs(
    sourceId: string,
  ): void {
    refreshGlobalDerivedCacheRefsForSource({
      db: this.db,
      sourceId,
    });
  }

  updateSourceSyncMetadata(
    payload: SourceSyncPayload,
    options: {
      onProgress?: (event: StorageProgressEvent) => void;
    } = {},
  ): {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  } {
    return updatePersistedSourceSyncMetadata(this.db, payload, {
      on_progress: options.onProgress,
    });
  }

  pruneSourcePayloadByObservedOriginPaths(
    sourceId: string,
    observedOriginPaths: readonly string[],
    options: {
      refreshDerived?: boolean;
      onProgress?: (event: StorageProgressEvent) => void;
    } = {},
  ): {
    sessions: number;
    turns: number;
    records: number;
    fragments: number;
    atoms: number;
    blobs: number;
  } {
    const result = prunePersistedSourcePayloadByObservedOriginPaths(this.db, sourceId, observedOriginPaths, {
      on_progress: options.onProgress,
    });
    markStorageBoundaryV2SourceAbsentByObservedOrigins({
      db: this.db,
      sourceId,
      observedOriginPaths,
    });
    this.invalidateProjectLinkSnapshot();
    if (options.refreshDerived === false) {
      return result;
    }
    options.onProgress?.({ stage: "reindex_start", source_id: sourceId });
    this.refreshDerivedState();
    options.onProgress?.({ stage: "reindex_done", source_id: sourceId });
    return result;
  }

  refreshDerivedProjections(options: {
    source_id?: string;
    onProgress?: (event: { stage: "reindex_start" | "reindex_done"; source_id: string }) => void;
  } = {}): void {
    const sourceId = options.source_id ?? "all";
    options.onProgress?.({ stage: "reindex_start", source_id: sourceId });
    this.refreshDerivedState();
    options.onProgress?.({ stage: "reindex_done", source_id: sourceId });
  }

  planStorageBoundaryRebuildScope(selector: StorageBoundaryRebuildScopeSelector = {}): StorageBoundaryRebuildPlan {
    return planStorageBoundaryRebuildScope({
      db: this.db,
      selector,
      listResolvedTurns: () => this.listResolvedTurns(),
      listProjectTurns: (projectId) => this.listProjectTurns(projectId, "all"),
    });
  }

  annotateSourceStageRunStats(
    sourceId: string,
    statsByStage: Partial<Record<StageRun["stage_kind"], Record<string, number>>>,
  ): void {
    const rows = this.db.prepare("SELECT id, payload_json FROM stage_runs WHERE source_id = ?").all(sourceId) as Array<{
      id: string;
      payload_json: string;
    }>;
    const update = this.db.prepare("UPDATE stage_runs SET payload_json = ? WHERE id = ?");

    for (const row of rows) {
      const stageRun = fromJson<StageRun>(row.payload_json);
      const extraStats = statsByStage[stageRun.stage_kind];
      if (!extraStats) {
        continue;
      }
      update.run(toJson({ ...stageRun, stats: { ...stageRun.stats, ...extraStats } }), row.id);
    }
  }

  countSourceLossAuditsByStage(sourceId: string): Partial<Record<StageRun["stage_kind"], number>> {
    const rows = this.db.prepare(`
      SELECT stage_kind, COUNT(*) AS count
        FROM loss_audits INDEXED BY idx_loss_audits_source_failure_stage
       WHERE source_id = ?
         AND severity IN ('warning', 'error')
       GROUP BY stage_kind
    `).all(sourceId) as Array<{ stage_kind: string; count: number }>;
    const counts: Partial<Record<StageRun["stage_kind"], number>> = {};
    for (const row of rows) {
      if (!row.stage_kind) {
        continue;
      }
      counts[row.stage_kind as StageRun["stage_kind"]] = row.count;
    }
    return counts;
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
    const turns = this.db.prepare("SELECT COUNT(*) AS count FROM user_turns_v2").get() as { count: number };
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

  getSourceIncrementalPayload(sourceId: string): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourceIncrementalPayload(source.id) : undefined;
  }

  getSourceIncrementalPayloadForOriginPaths(
    sourceId: string,
    originPaths: readonly string[],
  ): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourceIncrementalPayloadForOriginPaths(source.id, originPaths) : undefined;
  }

  getSourceIncrementalMetadataPayload(sourceId: string): SourceSyncPayload | undefined {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    return source ? this.buildSourceIncrementalMetadataPayload(source.id) : undefined;
  }

  getSourceSyncStartedAt(sourceId: string): Date | undefined {
    const row = this.db
      .prepare("SELECT value_text FROM schema_meta WHERE key = ?")
      .get(`sync.started_at.${sourceId}`) as { value_text: string } | undefined;
    if (!row?.value_text) {
      return undefined;
    }
    const ms = Date.parse(row.value_text);
    return Number.isNaN(ms) ? undefined : new Date(ms);
  }

  recordSourceSyncStartedAt(sourceId: string, when: Date): void {
    const key = `sync.started_at.${sourceId}`;
    const value = when.toISOString();
    const existing = this.db
      .prepare("SELECT value_text FROM schema_meta WHERE key = ?")
      .get(key) as { value_text: string } | undefined;
    if (existing?.value_text === value) {
      return;
    }
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare("UPDATE schema_meta SET value_text = ?, updated_at = ? WHERE key = ?")
        .run(value, now, key);
      return;
    }
    this.db
      .prepare("INSERT INTO schema_meta (key, value_text, updated_at) VALUES (?, ?, ?)")
      .run(key, value, now);
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

    // C1: turns and contexts read from V2 to match buildSourcePayload. The V1
    // payload_json path for these tables is no longer consulted; once B.6
    // drops V1 user_turns/turn_contexts, only the V2 path remains. Other
    // tables (records/fragments/atoms/etc.) are not migrated and stay on V1
    // payload_json — the bundle surface is a hybrid until B.6.
    const turnsOrderBy = "ORDER BY submission_started_at DESC, created_at DESC";
    const turnsFromV2 = Queries.listUserTurnsFromV2BySource({
      db: this.db,
      sourceId,
      assetDir: this.assetDir,
      orderBy: turnsOrderBy,
      // Bundle export serializes the full projection; lineage must round-trip
      // byte-identically for B.4a bundle byte-diff to pass. Matches
      // buildSourcePayload exactly.
      withLineage: true,
    });
    const contextTurnIds = turnsFromV2.map((turn) => turn.id).sort((a, b) => a.localeCompare(b));
    const db = this.db;
    const assetDir = this.assetDir;
    function* streamTurnJson(): Iterable<string> {
      for (const turn of turnsFromV2) {
        yield JSON.stringify(turn);
      }
    }
    function* streamContextJson(): Iterable<string> {
      for (const turnId of contextTurnIds) {
        const context = readTurnContextFromV2Cache({ db, assetDir, turnId });
        if (context) {
          yield JSON.stringify(context);
        }
      }
    }

    // Table configs matching buildSourcePayload field order. `turns` and
    // `contexts` have no `table` because they are sourced from V2 above.
    const arrayFields: Array<{
      key: string;
      table?: string;
      orderBy?: string;
      countKey?: keyof typeof counts;
      transform?: (json: string) => string;
      v2Json?: () => Iterable<string>;
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
      {
        key: "turns",
        countKey: "turns",
        v2Json: streamTurnJson,
      },
      {
        key: "contexts",
        v2Json: streamContextJson,
      },
    ];

    write(`{"source":${JSON.stringify(source)}`);

    for (const field of arrayFields) {
      write(`,"${field.key}":[`);
      let first = true;
      if (field.v2Json) {
        for (const json of field.v2Json()) {
          if (!first) write(",");
          first = false;
          write(json);
          if (field.countKey) counts[field.countKey]++;
        }
      } else if (field.table) {
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
    // B.5.2: V2 read path. V1 payload_json no longer consulted for production
    // reads; Queries.listTurns (V1) is retained as the validator's reference.
    //
    // C1 fix: this method feeds computeProjectLinkSnapshot (linker consumes
    // turn.lineage.blob_refs in buildFallbackProjectObservationCandidates)
    // and Gc.performDeleteProject (cascade cleanup uses .candidate_refs and
    // .blob_refs), so lineage is required. UI list paths that don't need
    // lineage use listSessionTurnsForReadSurface / listTurnsForReadSurfaceProject
    // which pass withLineage:false.
    return Queries.listUserTurnsFromV2({ db: this.db, assetDir: this.assetDir, withLineage: true });
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

  listProjectTurnsForReadSurface(projectId: string, linkState: LinkState | "all" = "all"): UserTurnProjection[] {
    const project = this.getProject(projectId);
    if (!project) {
      return [];
    }

    const sessionIds = new Set(this.listProjectReadSurfaceSessionIds(project));
    const turnIds = new Set<string>();
    for (const override of this.listProjectOverrides().filter((entry) => entry.project_id === project.project_id)) {
      if (override.target_kind === "turn") {
        turnIds.add(override.target_ref);
      } else if (override.target_kind === "session") {
        sessionIds.add(override.target_ref);
      } else if (override.target_kind === "observation") {
        const row = this.db.prepare("SELECT session_ref FROM derived_candidates WHERE id = ?").get(override.target_ref) as
          | { session_ref: string }
          | undefined;
        if (row?.session_ref) {
          sessionIds.add(row.session_ref);
        }
      }
    }

    const turnsById = new Map<string, UserTurnProjection>();
    for (const sessionId of sessionIds) {
      for (const turn of Queries.listUserTurnsFromV2BySession({
        db: this.db,
        sessionId,
        assetDir: this.assetDir,
        withLineage: false,
      })) {
        const decorated = this.decorateTurnForReadSurfaceProject(turn, project);
        if (linkState === "all" || decorated.link_state === linkState) {
          turnsById.set(decorated.id, decorated);
        }
      }
    }

    for (const turnId of turnIds) {
      const rawTurn = this.getTurn(turnId);
      if (!rawTurn) {
        continue;
      }
      const turn = this.decorateTurnForReadSurfaceProject(rawTurn, {
        ...project,
        linkage_state: "committed",
      });
      if (linkState === "all" || turn.link_state === linkState) {
        turnsById.set(turn.id, turn);
      }
    }

    return [...turnsById.values()].sort((left, right) => {
      const sessionOrder = (this.getSession(right.session_id)?.created_at ?? right.submission_started_at).localeCompare(
        this.getSession(left.session_id)?.created_at ?? left.submission_started_at,
      );
      return sessionOrder || left.submission_started_at.localeCompare(right.submission_started_at);
    });
  }

  listSessionTurnsForReadSurface(sessionId: string): UserTurnProjection[] {
    // B.5.2: V2 read path; mirrors the V1 ORDER BY submission_started_at ASC.
    // C1 fix: UI list path — TUI/API session detail rendering doesn't
    // dereference .lineage, so skip the per-turn blob read.
    return Queries.listUserTurnsFromV2BySession({
      db: this.db,
      sessionId,
      assetDir: this.assetDir,
      withLineage: false,
    });
  }

  getTurn(turnId: string): UserTurnProjection | undefined {
    // B.5.2: V2 read path. Queries.getTurn (V1) is retained for the validator.
    return Queries.readUserTurnFromV2({ db: this.db, turnId, assetDir: this.assetDir });
  }

  getResolvedTurn(turnId: string): UserTurnProjection | undefined {
    return this.buildProjectLinkSnapshot().turns.find((turn) => turn.id === turnId);
  }

  getTurnContext(turnId: string): TurnContextProjection | undefined {
    if (!this.getTurn(turnId)) {
      return undefined;
    }
    // B.5.6: V1 fallback removed. Reads are strictly V2 — operators must
    // complete B.3 (write migration) and B.4 (validation) before deploying
    // this code, otherwise unmigrated turns return undefined. The B.4c
    // read-path parity validator is the gate that proves V2 == V1 across
    // every turn on the store.
    return readTurnContextFromV2Cache({
      db: this.db,
      assetDir: this.assetDir,
      turnId,
    });
  }

  getSession(sessionId: string): SessionProjection | undefined {
    return Queries.getSession(this.db, sessionId);
  }

  getResolvedSession(sessionId: string): SessionProjection | undefined {
    return this.buildProjectLinkSnapshot().sessions.find((session) => session.id === sessionId);
  }

  getSessionRelatedWork(sessionId: string): SessionRelatedWorkProjection[] {
    const session = this.getSession(sessionId) ?? this.getResolvedSession(sessionId);
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

  getReadOverviewCounts(): { sources: number; projects: number; sessions: number; turns: number } {
    const sources = this.db.prepare("SELECT COUNT(*) AS count FROM source_instances").get() as { count: number };
    const projects = this.db.prepare("SELECT COUNT(*) AS count FROM project_current").get() as { count: number };
    const sessions = this.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    // B.5.4: count from V2 sidecar so the overview stays correct after B.6
    // drops the V1 user_turns table. Row count is identical today (post-B.3).
    const turns = this.db.prepare("SELECT COUNT(*) AS count FROM user_turns_v2").get() as { count: number };
    return {
      sources: sources.count,
      projects: projects.count > 0 ? projects.count : this.listProjects().length,
      sessions: sessions.count,
      turns: turns.count,
    };
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
        /**
         * A.2: evidence blob shas whose rows were dropped from evidence_blobs
         * in the same transaction; the content-addressed files for these shas
         * were unlinked best-effort before this method returned.
         */
        pruned_evidence_shas: string[];
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
        pruned_evidence_shas: [],
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

    // A.2: unlink content-addressed evidence files whose evidence_blobs rows
    // were dropped in the same transaction. Best-effort: file unlink failures
    // are logged but do not raise — the DB rows are already gone, and a
    // dangling file is recoverable via `cchistory maintenance gc-evidence`.
    this.unlinkEvidenceBlobFiles(result.pruned_evidence_shas);

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return result;
  }

  /**
   * A.2: best-effort unlink of content-addressed evidence files. Silently
   * ignores ENOENT (file already gone or never written — normal for in-memory
   * stores or already-pruned shas). Other unlink errors (EACCES, EROFS, EBUSY,
   * ENOTDIR, …) are emitted as warnings rather than thrown: by the time we get
   * here the DB transaction has already committed, so throwing would leave the
   * operator with a half-applied state and no record of which shas still have
   * files on disk. The orphaned files become permanent disk usage but do not
   * corrupt reads (the DB rows are gone; nothing references the files).
   *
   * Operators observing these warnings should run a periodic
   * `reconcile-evidence-files` scan (not yet implemented) that compares dir
   * entries to `evidence_blobs.sha256` and unlinks orphans when the underlying
   * fs condition resolves.
   */
  private unlinkEvidenceBlobFiles(shas: readonly string[]): void {
    if (!this.assetDir || shas.length === 0) return;
    for (const sha of shas) {
      if (!/^[a-f0-9]{64}$/u.test(sha)) continue;
      const file = path.join(this.assetDir, "evidence", "blobs", sha.slice(0, 2), sha);
      try {
        unlinkSync(file);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        // DB transaction has already committed by the time unlink runs; throw
        // would not roll it back and would hide which shas are orphaned.
        process.emitWarning(
          `evidence blob file unlink failed (sha=${sha} code=${code ?? "UNKNOWN"}): ${
            error instanceof Error ? error.message : String(error)
          }. The DB row is gone; the file is now an orphan and will persist on disk until manually cleaned.`,
          {
            type: "CCHistoryEvidenceBlobOrphan",
            code: "CCHISTORY_EVIDENCE_BLOB_ORPHAN_FILE",
          },
        );
      }
    }
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
    let prunedEvidenceShas: string[] = [];

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
      if (mode === "purge" && candidates.length > 0) {
        // A.2: after all candidate turns are purged, find blobs that no
        // remaining turn references and cascade evidence cleanup once for
        // the whole batch. Group by source so the (source_id, blob_id)
        // index hits cleanly.
        const blobsBySource = new Map<string, string[]>();
        for (const turn of candidates) {
          const entry = blobsBySource.get(turn.source_id) ?? [];
          entry.push(...turn.lineage.blob_refs);
          blobsBySource.set(turn.source_id, entry);
        }
        for (const [sourceId, blobIds] of blobsBySource) {
          // B1: referenced set comes from V2 lineage blobs (loadReferencedBlobIdsBySource)
          // so the orphan check survives the B.6 V1 drop. The old V1 json_each path
          // silently returned empty post-B.6 and would have cascaded-deleted every
          // referenced blob.
          const referenced = this.loadReferencedBlobIdsBySource(sourceId);
          const orphaned = Gc.selectOrphanedBlobIds(blobIds, referenced);
          if (orphaned.length > 0) {
            prunedEvidenceShas.push(
              ...Gc.cascadeEvidenceCleanupForOrphanedBlobsInTransaction(this.db, {
                sourceId,
                blobIds: orphaned,
                deleteCapturedBlobs: true,
              }),
            );
          }
        }
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    // A.2: unlink the content-addressed evidence files for pruned shas. Done
    // outside the DB transaction; file unlink failures are best-effort.
    this.unlinkEvidenceBlobFiles(prunedEvidenceShas);

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
    let prunedEvidenceShas: string[] = [];
    try {
      tombstone = Gc.purgeTurnInTransaction(this.db, turn, reason);
      // A.2 + B1: compute orphaned blob ids after deleting the turn, while
      // still inside the same transaction. Otherwise the turn being purged
      // appears in the referenced set and pins its own last blob.
      const referencedForPurge = this.loadReferencedBlobIdsBySource(turn.source_id);
      const orphanedBlobIds = Gc.selectOrphanedBlobIds(turn.lineage.blob_refs, referencedForPurge);
      if (orphanedBlobIds.length > 0) {
        prunedEvidenceShas = Gc.cascadeEvidenceCleanupForOrphanedBlobsInTransaction(this.db, {
          sourceId: turn.source_id,
          blobIds: orphanedBlobIds,
          deleteCapturedBlobs: true,
        });
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    this.unlinkEvidenceBlobFiles(prunedEvidenceShas);

    this.invalidateProjectLinkSnapshot();
    this.refreshDerivedState();
    return tombstone;
  }

  /**
   * A.2: maintenance hook to reclaim orphaned evidence_blobs rows that
   * accumulated before evidence GC was wired into the purge paths, or that
   * were left behind by a crash mid-purge. Returns the count of dropped rows
   * and the shas whose files the caller should unlink.
   *
   * Safe to run any time; never throws on missing files (caller handles
   * unlink outside the transaction).
   */
  pruneOrphanEvidence(): { pruned_shas: string[]; pruned_count: number } {
    this.db.exec("BEGIN IMMEDIATE;");
    let shas: string[];
    try {
      shas = Gc.pruneUnreferencedEvidenceBlobsInTransaction(this.db);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    this.unlinkEvidenceBlobFiles(shas);
    return { pruned_shas: shas, pruned_count: shas.length };
  }

  /**
   * End-of-sync hook for the streaming hot path's deferred prune. The per-batch
   * merge inside `mergeSourcePayloadStreaming` passes `force: false` to
   * `pruneUnreferencedEvidenceBlobsInTransaction` so the expensive end-to-end
   * LEFT JOIN against six ref tables does not run inside every batch's
   * transaction. The sync orchestrator (CLI) must call this method exactly
   * once after the per-source batch loop completes; failing to do so leaves
   * orphaned evidence_blobs rows accumulating silently across syncs.
   *
   * Returns the dropped shas (best-effort file unlink already performed).
   */
  pruneEvidenceBlobsNow(): { pruned_shas: string[]; pruned_count: number } {
    this.db.exec("BEGIN IMMEDIATE;");
    let shas: string[];
    try {
      shas = Gc.pruneUnreferencedEvidenceBlobsInTransaction(this.db, { force: true });
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    this.unlinkEvidenceBlobFiles(shas);
    return { pruned_shas: shas, pruned_count: shas.length };
  }

  /**
   * B1: union of `lineage.blob_refs` across every V2 turn in the source. Used
   * by the GC orphan check (`selectOrphanedBlobIds`) to determine which
   * candidate blob ids are still referenced by some live turn.
   *
   * Pre-B.6 the orphan check read V1 `user_turns.payload_json` via `json_each`
   * over `$.lineage.blob_refs`. Post-B.6 that table is gone and the V1 query
   * silently returned zero rows — every candidate would be marked orphaned
   * and `cascadeEvidenceCleanupForOrphanedBlobsInTransaction` would delete
   * live evidence. Reading from V2 lineage blobs (B.5.0g) is correct under
   * both pre- and post-B.6.
   *
   * Filters to turns with `lineage_blob_count > 0` so text-only sources
   * don't pay the per-blob load cost for lineages that contribute no
   * blob_refs anyway.
   *
   * Throws if any lineage blob fails to load (H1 corruption case). Treating
   * a missing blob as "no blob_refs" would mark live blobs as orphaned —
   * the destructive direction. The operator must fix the corruption before
   * GC can safely proceed.
   */
  private loadReferencedBlobIdsBySource(sourceId: string): ReadonlySet<string> {
    if (!this.assetDir) {
      // In-memory store (no assetDir) cannot have lineage blobs on disk. The
      // source either has no blob_refs (empty result is correct) or the
      // operator never set up the asset dir (every GC call would throw). The
      // former is the common case in tests; treat the latter as "no refs
      // known" and let the caller decide whether to proceed.
      return new Set<string>();
    }
    const shaRows = this.db
      .prepare(
        `SELECT DISTINCT lineage_blob_sha256 AS sha
           FROM user_turns_v2
          WHERE source_id = ?
            AND lineage_blob_count > 0
            AND lineage_blob_sha256 != ''`,
      )
      .all(sourceId) as Array<{ sha: string }>;
    if (shaRows.length === 0) {
      return new Set<string>();
    }
    const shas = shaRows.map((row) => row.sha);
    const lineageBySha = loadLineageBlobsBySha({ assetDir: this.assetDir, shas });
    const missingShas = shas.filter((sha) => !lineageBySha.has(sha));
    if (missingShas.length > 0) {
      throw new Error(
        `Cannot determine blob orphan status for source ${sourceId}: ${missingShas.length} ` +
          `lineage blob(s) failed to load (first missing sha: ${missingShas[0]!.slice(0, 12)}…). ` +
          `Treating missing blobs as empty-refs would mark live blobs as orphaned and cascade-delete them. ` +
          `Fix the H1 integrity warning (or re-run B.3 backfill) before re-running GC.`,
      );
    }
    const referenced = new Set<string>();
    for (const lineage of lineageBySha.values()) {
      if (lineage?.blob_refs) {
        for (const ref of lineage.blob_refs) referenced.add(ref);
      }
    }
    return referenced;
  }

  /**
   * A.4: explicit `PRAGMA wal_checkpoint(TRUNCATE)`. Folds the WAL into the
   * main SQLite file and truncates the WAL to zero bytes. Useful between
   * long-running sync batches to bound the on-disk WAL footprint.
   *
   * The close() path already checkpoints best-effort; this method is the
   * operator hook for periodic checkpointing without closing the store.
   */
  checkpointStore(): {
    busy: number;
    locked: number;
    log_frames: number;
    checkpointed_frames: number;
    wal_frames: number;
  } {
    const row = this.db
      .prepare("PRAGMA wal_checkpoint(TRUNCATE);")
      .get() as { busy: number; log: number; checkpointed: number };
    return {
      busy: row.busy,
      locked: row.busy,
      log_frames: row.log,
      checkpointed_frames: row.checkpointed,
      wal_frames: row.log,
    };
  }

  /**
   * A.4: run VACUUM against the SQLite file. Required once per store to
   * materialize the new 16 KiB page size (set on every connection via
   * `PRAGMA page_size = 16384`); without VACUUM, the pragma is silently
   * ignored on existing databases.
   *
   * VACUUM holds an exclusive lock for the duration. On a multi-GB store this
   * can take minutes. Plan B.6b will later replace this with `VACUUM INTO`
   * for an atomic swap; for Phase A the in-place VACUUM is sufficient.
   */
  vacuumStore(): { page_size_before: number; page_size_after: number } {
    const before = this.db.prepare("PRAGMA page_size;").get() as { page_size: number };
    this.db.exec("VACUUM;");
    const after = this.db.prepare("PRAGMA page_size;").get() as { page_size: number };
    return {
      page_size_before: before.page_size,
      page_size_after: after.page_size,
    };
  }

  /**
   * B.3: backfill V2 sidecars for one source from the V1 view of the store.
   *
   * Streams V1 rows directly into V2 sidecar tables, blob-by-blob, so memory
   * use is bounded by the largest single blob rather than the whole source.
   * The previous non-streaming path (load full `SourceSyncPayload` then write)
   * OOM'd on sources with >100k records.
   *
   * V1 payloads are NOT touched. Existing V2 rows for this source are cleared
   * (replace semantics) before re-insert.
   *
   * Returns counts of the V1 rows that drove the backfill so the caller can
   * report progress.
   */
  backfillSourceV2Sidecars(sourceId: string): {
    source_id: string;
    records: number;
    fragments: number;
    atoms: number;
    candidates: number;
    turns: number;
    contexts: number;
    blobs: number;
    sessions: number;
  } {
    const counts = streamV2SidecarsFromV1({
      db: this.db,
      sourceId,
      assetDir: this.assetDir,
    });
    return { source_id: sourceId, ...counts };
  }

  /**
   * Internal: exposes the underlying DatabaseSync so sibling package modules
   * (migration-state, migration-write) can read/write migration_state rows
   * against the same connection. Not for external callers.
   */
  getDatabaseForMigration(): DatabaseSync {
    return this.db;
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
    const limit = Math.max(0, options.limit ?? 50);
    const offset = Math.max(0, options.offset ?? 0);
    const query = options.query?.trim() ?? "";
    const sourceIds = options.source_ids && options.source_ids.length > 0 ? new Set(options.source_ids) : undefined;
    const linkStates = options.link_states && options.link_states.length > 0 ? new Set(options.link_states) : undefined;
    const valueAxes = options.value_axes && options.value_axes.length > 0 ? new Set(options.value_axes) : undefined;
    const needsResolvedLinkage = Boolean(options.project_id || linkStates);
    const resolvedTurnsById = needsResolvedLinkage ? this.getSearchLinkedTurnsById() : undefined;
    const pageCapacity = offset + limit;
    const retained: RankedSearchCandidate[] = [];
    let total = 0;

    for (const candidate of scanSearchCandidateRows({ db: this.db, query })) {
      const resolvedTurn = resolvedTurnsById?.get(candidate.id);
      const projectId = resolvedTurn?.project_id ?? candidate.project_id;
      const linkState = resolvedTurn?.link_state ?? candidate.link_state;
      const valueAxis = resolvedTurn?.value_axis ?? candidate.value_axis;

      if (options.project_id && projectId !== options.project_id) {
        continue;
      }
      if (sourceIds && !sourceIds.has(candidate.source_id)) {
        continue;
      }
      if (linkStates && !linkStates.has(linkState)) {
        continue;
      }
      if (valueAxes && !valueAxes.has(valueAxis)) {
        continue;
      }

      total += 1;
      if (pageCapacity === 0) {
        continue;
      }

      const highlights = query.length > 0 ? findHighlights(candidate.canonical_text ?? "", query) : [];
      retained.push({
        candidate,
        resolvedTurn,
        highlights,
        relevance_score: computeRelevanceScore(candidate, highlights),
      });
      pruneRankedRetainedIfFull(retained, pageCapacity);
    }

    retained.sort(compareRankedSearchCandidates);
    const pageCandidates = retained.slice(offset, offset + limit);
    const pageTurnsById = this.resolveSearchPageTurnsById(pageCandidates);
    const projectsById = this.getProjectsById();
    const sessionCache = new Map<string, SessionProjection | undefined>();
    const results: TurnSearchResult[] = [];

    for (const entry of pageCandidates) {
      const turn = pageTurnsById.get(entry.candidate.id);
      if (!turn) {
        continue;
      }
      let session = sessionCache.get(turn.session_id);
      if (!sessionCache.has(turn.session_id)) {
        session = this.getSession(turn.session_id);
        sessionCache.set(turn.session_id, session);
      }
      results.push({
        turn,
        session,
        project: turn.project_id ? projectsById.get(turn.project_id) : undefined,
        highlights: entry.highlights,
        relevance_score: entry.relevance_score,
      });
    }

    return {
      results,
      total,
    };
  }

  searchTurnsReadSurfacePage(options: {
    query?: string;
    groupIndex?: number;
    offset?: number;
    limit?: number;
  } = {}): {
    results: TurnSearchResult[];
    total: number;
    groups: ReadSurfaceSearchGroup[];
    selectedGroupIndex: number;
    resultOffset: number;
  } {
    const query = options.query?.trim() ?? "";
    const requestedGroupIndex = Math.max(0, options.groupIndex ?? 0);
    const limit = Math.max(0, options.limit ?? 50);
    const requestedOffset = Math.max(0, options.offset ?? 0);
    const resolver = this.getReadSurfaceSearchProjectResolver();
    const groupMap = new Map<string, MutableReadSurfaceSearchGroup>();
    let total = 0;

    for (const candidate of scanSearchCandidateRows({ db: this.db, query })) {
      const project = this.resolveReadSurfaceSearchProject(candidate, resolver);
      const projectId = project?.project_id ?? UNLINKED_SEARCH_PROJECT_ID;
      const projectName = project?.display_name ?? "Unlinked";
      const group = groupMap.get(projectId) ?? {
        project_id: projectId,
        project_name: projectName,
        total: 0,
        latest_activity_at: "",
      };
      group.total += 1;
      if (candidate.submission_started_at > group.latest_activity_at) {
        group.latest_activity_at = candidate.submission_started_at;
      }
      groupMap.set(projectId, group);
      total += 1;
    }

    const groups = [...groupMap.values()]
      .sort((left, right) => {
        if (right.total !== left.total) {
          return right.total - left.total;
        }
        const activityOrder = right.latest_activity_at.localeCompare(left.latest_activity_at);
        if (activityOrder !== 0) {
          return activityOrder;
        }
        return left.project_name.localeCompare(right.project_name);
      })
      .map(({ latest_activity_at: _latestActivityAt, ...group }) => group);

    const selectedGroupIndex = groups.length === 0
      ? 0
      : Math.min(requestedGroupIndex, groups.length - 1);
    const selectedGroup = groups[selectedGroupIndex];
    const resultOffset = selectedGroup && limit > 0
      ? Math.min(requestedOffset, Math.max(0, selectedGroup.total - limit))
      : 0;
    const retained: RankedSearchCandidate[] = [];
    const pageCapacity = resultOffset + limit;

    if (selectedGroup && pageCapacity > 0) {
      for (const candidate of scanSearchCandidateRows({ db: this.db, query })) {
        const project = this.resolveReadSurfaceSearchProject(candidate, resolver);
        const projectId = project?.project_id ?? UNLINKED_SEARCH_PROJECT_ID;
        if (projectId !== selectedGroup.project_id) {
          continue;
        }

        const highlights = query.length > 0 ? findHighlights(candidate.canonical_text ?? "", query) : [];
        retained.push({
          candidate,
          highlights,
          relevance_score: computeRelevanceScore(candidate, highlights),
        });
        pruneRankedRetainedIfFull(retained, pageCapacity);
      }
    }

    retained.sort(compareRankedSearchCandidates);
    const pageCandidates = retained.slice(resultOffset, resultOffset + limit);
    const sessionCache = new Map<string, SessionProjection | undefined>();
    const results: TurnSearchResult[] = [];

    for (const entry of pageCandidates) {
      const rawTurn = this.getTurn(entry.candidate.id);
      if (!rawTurn) {
        continue;
      }
      const project = this.resolveReadSurfaceSearchProject(entry.candidate, resolver);
      const turn = project ? this.decorateTurnForReadSurfaceProject(rawTurn, project) : rawTurn;
      let session = sessionCache.get(turn.session_id);
      if (!sessionCache.has(turn.session_id)) {
        session = this.getSession(turn.session_id);
        sessionCache.set(turn.session_id, session);
      }
      results.push({
        turn,
        session,
        project,
        highlights: entry.highlights,
        relevance_score: entry.relevance_score,
      });
    }

    return {
      results,
      total,
      groups,
      selectedGroupIndex,
      resultOffset,
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
    // B.6: V1 user_turns is gone. Source-of-truth for "does this turn exist?"
    // is the V2 sidecar (user_turns_v2). Pre-B.6 this method read V1 first
    // to surface "V1 exists but V2 doesn't" drift via the assertion below;
    // post-B.6 the drift case is structurally impossible (no V1 to diverge
    // from), so we read V2 directly.
    const turn = Queries.readUserTurnFromV2({
      db: this.db,
      turnId,
      assetDir: this.assetDir,
      withLineage: false,
    });
    if (!turn) {
      return undefined;
    }
    const nextTurn = updater(turn);
    const boundedAt = nowIso();
    // M4 (retained post-B.6): assert the V2 UPDATE landed exactly one row.
    // changes === 0 means the sidecar was deleted out from under us between
    // the read and the write; changes > 1 means turn_id is no longer unique.
    // Either way, silently returning would leave the caller with a stale
    // projection.
    const v2Result = this.db
      .prepare(
        `UPDATE user_turns_v2 SET
          link_state = ?,
          value_axis = ?,
          retention_axis = ?,
          project_id = ?,
          project_ref = ?,
          project_link_state = ?,
          bounded_at = ?
        WHERE turn_id = ?`,
      )
      .run(
        nextTurn.link_state ?? "",
        nextTurn.value_axis ?? "",
        nextTurn.retention_axis ?? "",
        nextTurn.project_id ?? "",
        nextTurn.project_ref ?? "",
        nextTurn.project_link_state ?? "",
        boundedAt,
        turnId,
      );
    const v2Changes = Number(v2Result.changes ?? 0);
    if (v2Changes !== 1) {
      throw new Error(
        `rewriteStoredTurn V2 UPDATE affected ${v2Changes} rows for turn ${turnId} (expected 1). The row was deleted or turn_id uniqueness is broken between the read and the write.`,
      );
    }
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

    // B.5.5: bundle/export reads V2 for user turns + contexts. V1 payload_json
    // for these tables is no longer consulted; the bundle byte shape is now
    // derived from V2 sidecars + content-addressed cache. The B.4a bundle
    // byte-diff validator gate ensures the V2-exported bundle is byte-identical
    // to the V1-exported pre-bundle snapshot.
    const turns = Queries.listUserTurnsFromV2BySource({
      db: this.db,
      sourceId,
      assetDir: this.assetDir,
      orderBy: "ORDER BY submission_started_at DESC, created_at DESC",
      // Bundle export serializes the full projection; lineage must round-trip
      // byte-identically for B.4a bundle byte-diff to pass.
      withLineage: true,
    });
    const contexts = turns
      .map((turn) => this.getTurnContext(turn.id))
      .filter((context): context is TurnContextProjection => context !== undefined)
      .sort((a, b) => a.turn_id.localeCompare(b.turn_id));

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
      turns,
      contexts,
    };
  }

  private buildSourceIncrementalPayload(sourceId: string): SourceSyncPayload {
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
      sessions: Queries.selectPayloadsBySource<SessionProjection>(this.db, "sessions", sourceId, "ORDER BY created_at ASC, updated_at ASC"),
      candidates: [],
      turns: [],
      contexts: [],
    };
  }

  private buildSourceIncrementalPayloadForOriginPaths(
    sourceId: string,
    originPaths: readonly string[],
  ): SourceSyncPayload {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }

    const normalizedOriginPaths = originPaths.map((entry) => path.normalize(entry));
    const blobs = Queries.selectBlobsByOriginPaths(this.db, sourceId, normalizedOriginPaths);
    const records = blobs.flatMap((blob) => Queries.selectRecordsBySourceAndBlobId(this.db, sourceId, blob.id));
    const sessionRefs = uniqueStrings(records.map((record) => record.session_ref));
    const fragments = sessionRefs.flatMap((sessionRef) =>
      Queries.selectPayloadsBySourceAndSession<SourceFragment>(this.db, "source_fragments", sourceId, sessionRef),
    );
    const atoms = sessionRefs.flatMap((sessionRef) =>
      Queries.selectPayloadsBySourceAndSession<ConversationAtom>(
          this.db,
          "conversation_atoms",
          sourceId,
          sessionRef,
          "ORDER BY time_key ASC, seq_no ASC",
      ),
    );
    const edges = sessionRefs.flatMap((sessionRef) =>
      Queries.selectPayloadsBySourceAndSession<AtomEdge>(this.db, "atom_edges", sourceId, sessionRef),
    );
    const sessions = sessionRefs
      .map((sessionRef) => Queries.getSession(this.db, sessionRef))
      .filter((session): session is SessionProjection => session !== undefined && session.source_id === sourceId);
    const loss_audits = Queries.selectReusableLossAuditsByRefs(
      this.db,
      sourceId,
      {
        blobIds: new Set(blobs.map((blob) => blob.id)),
        recordIds: new Set(records.map((record) => record.id)),
        fragmentIds: new Set(fragments.map((fragment) => fragment.id)),
        atomIds: new Set(atoms.map((atom) => atom.id)),
        sessionRefs: new Set(sessionRefs),
      },
    );

    return {
      source,
      stage_runs: Queries.selectPayloadsBySource<StageRun>(this.db, "stage_runs", sourceId),
      loss_audits,
      blobs,
      records,
      fragments,
      atoms,
      edges,
      sessions,
      candidates: [],
      turns: [],
      contexts: [],
    };
  }

  private buildSourceIncrementalMetadataPayload(sourceId: string): SourceSyncPayload {
    const source = this.listSources().find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }

    return {
      source,
      stage_runs: Queries.selectPayloadsBySource<StageRun>(this.db, "stage_runs", sourceId),
      loss_audits: [],
      blobs: Queries.selectPayloadsBySource<CapturedBlob>(this.db, "captured_blobs", sourceId),
      records: [],
      fragments: [],
      atoms: [],
      edges: [],
      sessions: [],
      candidates: [],
      turns: [],
      contexts: [],
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
    this.cachedSearchLinkedTurnsById = undefined;
    this.cachedReadSurfaceSearchProjectResolver = undefined;
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

  private getSearchLinkedTurnsById(): Map<string, UserTurnProjection> {
    if (!this.cachedSearchLinkedTurnsById) {
      this.cachedSearchLinkedTurnsById = new Map(this.listResolvedTurns().map((turn) => [turn.id, turn]));
    }
    return this.cachedSearchLinkedTurnsById;
  }

  private getReadSurfaceSearchProjectResolver(): ReadSurfaceSearchProjectResolver {
    if (this.cachedReadSurfaceSearchProjectResolver) {
      return this.cachedReadSurfaceSearchProjectResolver;
    }

    const projectsById = this.getProjectsById();
    const projectBySessionId = new Map<string, ProjectIdentity>();
    const projectByTurnId = new Map<string, ProjectIdentity>();
    for (const project of projectsById.values()) {
      for (const sessionId of this.listProjectReadSurfaceSessionIds(project)) {
        const existing = projectBySessionId.get(sessionId);
        projectBySessionId.set(sessionId, preferReadSurfaceSearchProject(existing, project));
      }
    }

    for (const override of this.listProjectOverrides()) {
      const project = projectsById.get(override.project_id);
      if (!project) {
        continue;
      }
      if (override.target_kind === "turn") {
        projectByTurnId.set(override.target_ref, project);
      } else if (override.target_kind === "session") {
        const existing = projectBySessionId.get(override.target_ref);
        projectBySessionId.set(override.target_ref, preferReadSurfaceSearchProject(existing, project));
      } else if (override.target_kind === "observation") {
        const row = this.db.prepare("SELECT session_ref FROM derived_candidates WHERE id = ?").get(override.target_ref) as
          | { session_ref: string }
          | undefined;
        if (row?.session_ref) {
          const existing = projectBySessionId.get(row.session_ref);
          projectBySessionId.set(row.session_ref, preferReadSurfaceSearchProject(existing, project));
        }
      }
    }

    this.cachedReadSurfaceSearchProjectResolver = {
      projectsById,
      projectBySessionId,
      projectByTurnId,
    };
    return this.cachedReadSurfaceSearchProjectResolver;
  }

  private resolveReadSurfaceSearchProject(
    candidate: SearchScanCandidate,
    resolver: ReadSurfaceSearchProjectResolver,
  ): ProjectIdentity | undefined {
    return (
      resolver.projectByTurnId.get(candidate.id) ??
      resolver.projectsById.get(candidate.project_id ?? "") ??
      resolver.projectBySessionId.get(candidate.session_id)
    );
  }

  private resolveSearchPageTurnsById(entries: readonly RankedSearchCandidate[]): Map<string, UserTurnProjection> {
    const rawTurns: UserTurnProjection[] = [];
    for (const entry of entries) {
      if (entry.resolvedTurn) {
        rawTurns.push(entry.resolvedTurn);
        continue;
      }
      const turn = this.getTurn(entry.candidate.id);
      if (turn) {
        rawTurns.push(turn);
      }
    }
    if (rawTurns.length === 0) {
      return new Map();
    }

    const needsPageLinkage = rawTurns.some((turn) => !turn.project_id || !turn.path_text);
    const resolvedTurns = needsPageLinkage ? this.resolveSearchPageLinkage(rawTurns) : rawTurns;
    return new Map(resolvedTurns.map((turn) => [turn.id, turn]));
  }

  private resolveSearchPageLinkage(turns: readonly UserTurnProjection[]): UserTurnProjection[] {
    const sessions = this.listSessions();
    const candidates = Queries.selectAllPayloads<DerivedCandidate>(this.db, "derived_candidates");
    const snapshot = deriveProjectLinkSnapshot({
      sessions,
      turns: [...turns],
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
    return snapshot.turns;
  }

  private buildSessionRelatedWorkIndex(): Map<string, SessionRelatedWorkProjection[]> {
    if (!this.cachedRelatedWorkBySessionId) {
      const sessions = this.listSessions();
      const fragments = this.listSessionRelationFragments();
      this.cachedRelatedWorkBySessionId = buildSessionRelatedWorkIndex(sessions, fragments);
    }
    return this.cachedRelatedWorkBySessionId;
  }

  private listProjectReadSurfaceSessionIds(project: ProjectIdentity): string[] {
    const sessionIds = new Set<string>();
    const observationRows = this.db.prepare(`
      SELECT dc.session_ref,
             json_extract(dc.payload_json, '$.evidence.workspace_path') AS workspace_path,
             json_extract(dc.payload_json, '$.evidence.workspace_path_normalized') AS workspace_path_normalized,
             json_extract(dc.payload_json, '$.evidence.repo_root') AS repo_root,
             json_extract(dc.payload_json, '$.evidence.repo_remote') AS repo_remote,
             json_extract(dc.payload_json, '$.evidence.repo_fingerprint') AS repo_fingerprint,
             json_extract(dc.payload_json, '$.evidence.source_native_project_ref') AS source_native_project_ref,
             json_extract(s.payload_json, '$.host_id') AS host_id,
             json_extract(s.payload_json, '$.working_directory') AS session_workspace
        FROM derived_candidates dc
        LEFT JOIN sessions s ON s.id = dc.session_ref
       WHERE dc.candidate_kind = 'project_observation'
    `).all() as unknown as ProjectObservationReadRow[];

    for (const row of observationRows) {
      if (projectObservationMatchesReadProject(project, row)) {
        sessionIds.add(row.session_ref);
      }
    }

    const sessionRows = this.db.prepare(`
      SELECT id,
             json_extract(payload_json, '$.host_id') AS host_id,
             json_extract(payload_json, '$.working_directory') AS working_directory,
             json_extract(payload_json, '$.source_native_project_ref') AS source_native_project_ref
        FROM sessions
    `).all() as unknown as ProjectSessionReadRow[];
    for (const row of sessionRows) {
      if (fallbackSessionMatchesReadProject(project, row)) {
        sessionIds.add(row.id);
      }
    }

    return [...sessionIds];
  }

  private decorateTurnForReadSurfaceProject(turn: UserTurnProjection, project: ProjectIdentity): UserTurnProjection {
    return {
      ...turn,
      project_id: project.project_id,
      project_ref: project.slug,
      link_state: project.linkage_state,
      project_link_state: project.linkage_state,
      project_confidence: project.confidence,
      candidate_project_ids: project.linkage_state === "candidate" ? [project.project_id] : undefined,
      path_text: buildReadSurfaceTurnPathText(turn, this.getSession(turn.session_id), project),
    };
  }

  private listSessionRelationFragments(): SourceFragment[] {
    const rows = this.db.prepare(`
      SELECT payload_json
        FROM source_fragments
       WHERE json_extract(payload_json, '$.fragment_kind') = 'session_relation'
       ORDER BY session_ref ASC, id ASC
    `).all() as Array<{ payload_json: string }>;
    return rows.map((row) => fromJson<SourceFragment>(row.payload_json));
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

      // A.1: FTS5 search_index is no longer maintained on the refresh path.
      // The scan path (queries/search.ts scanSearchCandidateRows) reads
      // directly from user_turns.payload_json and does not consult FTS5;
      // the FTS5 schema entries remain inert on disk so a future read-path
      // switch is a one-line change. To repopulate FTS5 explicitly, call
      // `rebuildSearchIndex()` via the maintenance command.
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}

function compareRankedSearchCandidates(left: RankedSearchCandidate, right: RankedSearchCandidate): number {
  if (left.relevance_score !== right.relevance_score) {
    return right.relevance_score - left.relevance_score;
  }
  const timeOrder = right.candidate.submission_started_at.localeCompare(left.candidate.submission_started_at);
  if (timeOrder !== 0) {
    return timeOrder;
  }
  return left.candidate.id.localeCompare(right.candidate.id);
}

// Sort + truncate only when the retained buffer fills past pageCapacity, instead
// of on every push. Avoids O(N · K log K) behavior on large stores (K = page
// size, N = matching candidate count).
const RANKED_RETAINED_PRUNE_FACTOR = 2;
const RANKED_RETAINED_MIN_PRUNE_SLACK = 16;

function pruneRankedRetainedIfFull(
  retained: RankedSearchCandidate[],
  pageCapacity: number,
): void {
  const pruneThreshold = Math.max(
    pageCapacity * RANKED_RETAINED_PRUNE_FACTOR,
    pageCapacity + RANKED_RETAINED_MIN_PRUNE_SLACK,
  );
  if (retained.length < pruneThreshold) {
    return;
  }
  retained.sort(compareRankedSearchCandidates);
  if (retained.length > pageCapacity) {
    retained.length = pageCapacity;
  }
}

interface ProjectObservationReadRow {
  session_ref: string;
  workspace_path?: unknown;
  workspace_path_normalized?: unknown;
  repo_root?: unknown;
  repo_remote?: unknown;
  repo_fingerprint?: unknown;
  source_native_project_ref?: unknown;
  host_id?: unknown;
  session_workspace?: unknown;
}

interface ProjectSessionReadRow {
  id: string;
  host_id?: unknown;
  working_directory?: unknown;
  source_native_project_ref?: unknown;
}

function projectObservationMatchesReadProject(project: ProjectIdentity, row: ProjectObservationReadRow): boolean {
  const hostId = asOptionalString(row.host_id);
  const workspacePath =
    normalizePathKey(asOptionalString(row.workspace_path_normalized)) ??
    normalizePathKey(asOptionalString(row.workspace_path)) ??
    normalizePathKey(asOptionalString(row.session_workspace));
  const repoRoot = normalizePathKey(asOptionalString(row.repo_root));
  const repoRemote = asOptionalString(row.repo_remote);
  const repoFingerprint = asOptionalString(row.repo_fingerprint);
  const sourceNativeProjectRef = asOptionalString(row.source_native_project_ref);
  const workspaceIdentity = deriveReadSurfaceWorkspaceSubpath(workspacePath, repoRoot) ?? workspacePath;
  const candidateKeys: string[] = [];

  if (repoFingerprint && workspaceIdentity) {
    candidateKeys.push(`fingerprint:${repoFingerprint}|workspace:${workspaceIdentity}`);
  }
  if (repoRemote && hostId && workspaceIdentity) {
    candidateKeys.push(`host:${hostId}|remote:${repoRemote}|workspace:${workspaceIdentity}`);
  }
  if (repoRoot && hostId && workspaceIdentity) {
    candidateKeys.push(`host:${hostId}|repo_root:${repoRoot}|workspace:${workspaceIdentity}`);
  }
  if (sourceNativeProjectRef && hostId) {
    candidateKeys.push(`host:${hostId}|native:${sourceNativeProjectRef}`);
  }
  if (workspacePath && hostId) {
    candidateKeys.push(`host:${hostId}|workspace:${workspacePath}`);
  }
  if (repoRemote && hostId) {
    candidateKeys.push(`host:${hostId}|remote_hint:${repoRemote}`);
  }

  return candidateKeys.some((key) => stableReadSurfaceProjectId(key) === project.project_id);
}

function fallbackSessionMatchesReadProject(project: ProjectIdentity, row: ProjectSessionReadRow): boolean {
  const hostId = asOptionalString(row.host_id);
  const workspacePath = normalizePathKey(asOptionalString(row.working_directory));
  const sourceNativeProjectRef = asOptionalString(row.source_native_project_ref);
  if (sourceNativeProjectRef && hostId && stableReadSurfaceProjectId(`host:${hostId}|native:${sourceNativeProjectRef}`) === project.project_id) {
    return true;
  }
  if (workspacePath && hostId && stableReadSurfaceProjectId(`host:${hostId}|workspace:${workspacePath}`) === project.project_id) {
    return true;
  }
  return Boolean(project.primary_workspace_path && workspacePath && normalizePathKey(project.primary_workspace_path) === workspacePath);
}

function buildReadSurfaceTurnPathText(
  turn: UserTurnProjection,
  session: SessionProjection | undefined,
  project: ProjectIdentity,
): string | undefined {
  const parts = new Set<string>();
  addReadSurfacePathPart(parts, turn.path_text);
  addReadSurfacePathPart(parts, session?.working_directory);
  addReadSurfacePathPart(parts, session?.source_native_project_ref);
  addReadSurfacePathPart(parts, session?.resume_working_directory);
  addReadSurfacePathPart(parts, project.primary_workspace_path);
  addReadSurfacePathPart(parts, project.repo_root);
  addReadSurfacePathPart(parts, project.source_native_project_ref);
  return [...parts].join(" ").trim() || undefined;
}

function addReadSurfacePathPart(target: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }
  target.add(value);
  const baseName = value.split("/").filter(Boolean).at(-1);
  if (baseName) {
    target.add(baseName);
  }
}

function deriveReadSurfaceWorkspaceSubpath(workspacePath: string | undefined, repoRoot: string | undefined): string | undefined {
  if (!workspacePath || !repoRoot) {
    return undefined;
  }
  if (workspacePath === repoRoot) {
    return ".";
  }
  if (!workspacePath.startsWith(`${repoRoot}/`)) {
    return undefined;
  }
  return workspacePath.slice(repoRoot.length + 1) || ".";
}

function stableReadSurfaceProjectId(key: string): string {
  return `project-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function preferReadSurfaceSearchProject(
  existing: ProjectIdentity | undefined,
  incoming: ProjectIdentity,
): ProjectIdentity {
  if (!existing) {
    return incoming;
  }
  if (existing.linkage_state !== incoming.linkage_state) {
    return incoming.linkage_state === "committed" ? incoming : existing;
  }
  if (existing.confidence !== incoming.confidence) {
    return incoming.confidence > existing.confidence ? incoming : existing;
  }
  const existingTurns = existing.committed_turn_count + existing.candidate_turn_count;
  const incomingTurns = incoming.committed_turn_count + incoming.candidate_turn_count;
  if (existingTurns !== incomingTurns) {
    return incomingTurns > existingTurns ? incoming : existing;
  }
  return incoming.project_id.localeCompare(existing.project_id) < 0 ? incoming : existing;
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

function resolveStorageAssetDir(
  location: string | { dataDir?: string; dbPath?: string; assetDir?: string },
  dbPath: string,
): string | undefined {
  if (dbPath === ":memory:") {
    return undefined;
  }
  if (typeof location === "string") {
    return path.resolve(location);
  }
  if (location.assetDir) {
    return path.resolve(location.assetDir);
  }
  if (location.dataDir) {
    return path.resolve(location.dataDir);
  }
  return path.basename(dbPath) === "cchistory.sqlite"
    ? path.resolve(path.dirname(dbPath))
    : path.resolve(`${dbPath}.cchistory`);
}
