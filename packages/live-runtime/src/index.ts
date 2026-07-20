import { access, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  deriveHostId,
  deriveSourceInstanceId,
  normalizeLocalPathIdentity,
  type AskUserQuestionTurn,
  type DerivedCandidate,
  type Host,
  type LossAuditRecord,
  type ProjectIdentity,
  type SessionProjection,
  type SourceDefinition,
  type SourcePlatform,
  type SourceStatus,
  type SourceSyncPayload,
  type TurnContextProjection,
  type TurnSearchResult,
  type UsageStatsDimension,
  type UsageStatsOverview,
  type UsageStatsRollup,
  type UserTurnProjection,
} from "@cchistory/domain";
import {
  buildFallbackProjectObservationCandidates,
  buildProjectDisplayList,
  compareSessionsByRecency,
  compareTurnsByChronology,
  compareTurnsByRecency,
  computeUsageOverview,
  computeUsageRollup,
  deriveProjectLinkSnapshot,
  installRuntimeWarningFilter,
  searchTurnsInMemory,
  type UsageFilters,
} from "@cchistory/canonical";
import type { SourceProbeProgressEvent } from "@cchistory/source-adapters";

installRuntimeWarningFilter();

export interface LiteSourceRoot {
  sourceRef: string;
  baseDir: string;
}

export interface ResolveLiteSourcesOptions {
  homeDir?: string;
  hostname?: string;
  platform?: NodeJS.Platform;
  appDataDir?: string;
  sourceRefs?: readonly string[];
  sourceRoots?: readonly LiteSourceRoot[];
}

export interface ScanLiteHistoryOptions extends ResolveLiteSourcesOptions {
  limitFiles?: number;
  safeMode?: boolean;
  contextMode?: LiteContextMode;
  onProgress?: (event: SourceProbeProgressEvent) => void;
}

export type LiteContextMode = "full" | "none";

type LiveSourcePayload = Pick<
  SourceSyncPayload,
  | "source"
  | "blobs"
  | "candidates"
  | "sessions"
  | "turns"
  | "contexts"
  | "ask_user_question_turns"
  | "loss_audits"
>;

export interface LiveSnapshotData {
  host: Host;
  sources: SourceStatus[];
  projects: ProjectIdentity[];
  sessions: SessionProjection[];
  turns: UserTurnProjection[];
  contexts: TurnContextProjection[];
  ask_user_question_turns: AskUserQuestionTurn[];
  loss_audits: LossAuditRecord[];
}

export interface LiveSearchOptions {
  query?: string;
  projectId?: string;
  sourceIds?: readonly string[];
  limit?: number;
  offset?: number;
}

export class LiveHistorySnapshot {
  readonly data: LiveSnapshotData;
  private readonly sourcesById: Map<string, SourceStatus>;
  private readonly projectsById: Map<string, ProjectIdentity>;
  private readonly sessionsById: Map<string, SessionProjection>;
  private readonly turnsById: Map<string, UserTurnProjection>;
  private readonly contextsByTurnId: Map<string, TurnContextProjection>;
  private readonly searchCandidates: readonly DerivedCandidate[];
  // Snapshot data is immutable, so derived indexes and ranked searches are
  // memoized for the lifetime of the instance (a refresh builds a new one).
  private turnsBySessionId?: Map<string, UserTurnProjection[]>;
  private turnsByProjectId?: Map<string, UserTurnProjection[]>;
  private searchRankCache?: Map<string, readonly TurnSearchResult[]>;

  constructor(data: LiveSnapshotData, searchCandidates: readonly DerivedCandidate[] = []) {
    this.data = data;
    this.sourcesById = new Map(data.sources.map((source) => [source.id, source]));
    this.projectsById = new Map(data.projects.map((project) => [project.project_id, project]));
    this.sessionsById = new Map(data.sessions.map((session) => [session.id, session]));
    this.turnsById = new Map(data.turns.map((turn) => [turn.id, turn]));
    this.contextsByTurnId = new Map(data.contexts.map((context) => [context.turn_id, context]));
    this.searchCandidates = searchCandidates;
  }

  listSources(): SourceStatus[] {
    return [...this.data.sources];
  }

  listProjects(): ProjectIdentity[] {
    return buildProjectDisplayList(this.data.projects);
  }

  listResolvedSessions(): SessionProjection[] {
    return [...this.data.sessions];
  }

  listResolvedTurns(): UserTurnProjection[] {
    return [...this.data.turns];
  }

  listAskUserQuestionTurns(filter: { sourceId?: string; sessionId?: string } = {}): AskUserQuestionTurn[] {
    return this.data.ask_user_question_turns.filter((turn) => {
      if (filter.sourceId && turn.source_id !== filter.sourceId) return false;
      if (filter.sessionId && turn.session_id !== filter.sessionId) return false;
      return true;
    });
  }

  listLossAudits(): LossAuditRecord[] {
    return [...this.data.loss_audits];
  }

  getSource(ref: string): SourceStatus | undefined {
    const exact = this.sourcesById.get(ref);
    if (exact) return exact;
    return resolveUnique(
      this.data.sources,
      ref,
      (source) => source.id,
      (source) => [source.slot_id, source.platform, source.display_name, source.base_dir],
    );
  }

  getProject(ref: string): ProjectIdentity | undefined {
    const exact = this.projectsById.get(ref);
    if (exact) return exact;
    return resolveUnique(
      this.data.projects,
      ref,
      (project) => project.project_id,
      (project) => [
        project.slug,
        project.display_name,
        project.primary_workspace_path,
        path.basename(project.primary_workspace_path ?? ""),
      ],
    );
  }

  getSession(ref: string): SessionProjection | undefined {
    const exact = this.sessionsById.get(ref);
    if (exact) return exact;
    return resolveUnique(
      this.data.sessions,
      ref,
      (session) => session.id,
      (session) => [
        session.source_session_id,
        session.title,
        session.working_directory,
        path.basename(session.working_directory ?? ""),
      ],
    );
  }

  getTurn(ref: string): UserTurnProjection | undefined {
    const exact = this.turnsById.get(ref);
    if (exact) return exact;
    return resolveUnique(this.data.turns, ref, (turn) => turn.id, () => []);
  }

  getTurnContext(turnRef: string): TurnContextProjection | undefined {
    const turn = this.getTurn(turnRef);
    return turn ? this.contextsByTurnId.get(turn.id) : undefined;
  }

  listProjectTurns(projectRef: string): UserTurnProjection[] {
    const project = this.getProject(projectRef);
    if (!project) return [];
    return [...(this.projectTurnBuckets().get(project.project_id) ?? [])];
  }

  listSessionTurns(sessionRef: string): UserTurnProjection[] {
    const session = this.getSession(sessionRef);
    if (!session) return [];
    return [...(this.sessionTurnBuckets().get(session.id) ?? [])];
  }

  search(options: LiveSearchOptions = {}): { results: TurnSearchResult[]; total: number } {
    const limit = Math.max(0, options.limit ?? 50);
    const offset = Math.max(0, options.offset ?? 0);
    const cacheKey = JSON.stringify([options.query ?? "", options.projectId ?? null, options.sourceIds ?? null]);
    this.searchRankCache ??= new Map();
    let ranked = this.searchRankCache.get(cacheKey);
    if (!ranked) {
      ranked = searchTurnsInMemory({
        turns: this.data.turns,
        sessions: this.data.sessions,
        projects: this.data.projects,
        candidates: this.searchCandidates,
        query: options.query,
        project_id: options.projectId,
        source_ids: options.sourceIds,
        limit: Infinity,
        offset: 0,
      }).results;
      this.searchRankCache.set(cacheKey, ranked);
    }
    return { results: ranked.slice(offset, offset + limit), total: ranked.length };
  }

  private sessionTurnBuckets(): Map<string, UserTurnProjection[]> {
    if (!this.turnsBySessionId) {
      const buckets = new Map<string, UserTurnProjection[]>();
      for (const turn of this.data.turns) {
        const bucket = buckets.get(turn.session_id);
        if (bucket) bucket.push(turn);
        else buckets.set(turn.session_id, [turn]);
      }
      for (const bucket of buckets.values()) bucket.sort(compareTurnsByChronology);
      this.turnsBySessionId = buckets;
    }
    return this.turnsBySessionId;
  }

  private projectTurnBuckets(): Map<string, UserTurnProjection[]> {
    if (!this.turnsByProjectId) {
      const buckets = new Map<string, UserTurnProjection[]>();
      for (const turn of this.data.turns) {
        if (!turn.project_id) continue;
        const bucket = buckets.get(turn.project_id);
        if (bucket) bucket.push(turn);
        else buckets.set(turn.project_id, [turn]);
      }
      this.turnsByProjectId = buckets;
    }
    return this.turnsByProjectId;
  }

  getUsageOverview(filters: UsageFilters = {}): UsageStatsOverview {
    return computeUsageOverview({
      filters,
      listResolvedTurns: () => this.data.turns,
      listResolvedSessions: () => this.data.sessions,
      listSources: () => this.data.sources,
      listProjects: () => this.data.projects,
    });
  }

  getUsageRollup(dimension: UsageStatsDimension, filters: UsageFilters = {}): UsageStatsRollup {
    return computeUsageRollup({
      dimension,
      filters,
      listResolvedTurns: () => this.data.turns,
      listResolvedSessions: () => this.data.sessions,
      listSources: () => this.data.sources,
      listProjects: () => this.data.projects,
    });
  }
}

export async function scanLiteHistory(options: ScanLiteHistoryOptions = {}): Promise<LiveHistorySnapshot> {
  const sources = await resolveLiteSources(options);
  const sourceAdapters = await import("@cchistory/source-adapters");
  const contextMode = options.contextMode ?? "full";
  const payloads: LiveSourcePayload[] = [];
  let host: Host | undefined;

  // Scan one source at a time so raw adapter payloads from a completed source
  // can be released before the next source begins. Adapters that declare a
  // canonical logical-session grouping boundary are projected one session at
  // a time; all other adapters retain the source-level canonical fallback.
  for (const source of sources) {
    const adapter = sourceAdapters.listPlatformAdapters().find((entry) => entry.platform === source.platform);
    const result = adapter?.logicalSessionGrouping === "source_session_id"
      ? await scanLogicalSessionGroups(
          source,
          options,
          contextMode,
          sourceAdapters,
          (filePath) => sourceAdapters.deriveSourceFileLogicalSessionKey(source.platform, filePath),
        )
      : await scanSourceWithCollector(source, options, contextMode, sourceAdapters);
    host ??= result.host;
    payloads.push(result.payload);
  }

  if (!host) {
    const emptyProbe = await sourceAdapters.runSourceProbe({}, []);
    host = emptyProbe.host;
  }

  return buildLiveSnapshot({ host, sources: payloads });
}

export function buildLiveSnapshot(probe: { host: Host; sources: readonly LiveSourcePayload[] }): LiveHistorySnapshot {
  const sources = probe.sources.map((payload) => payload.source);
  const sessions = probe.sources
    .flatMap((payload) => payload.sessions)
    .sort(compareSessionsByRecency);
  const turns = probe.sources
    .flatMap((payload) => payload.turns)
    .sort(compareTurnsByRecency);
  const candidates = probe.sources.flatMap((payload) => payload.candidates);
  const blobs = probe.sources.flatMap((payload) => payload.blobs);
  const blobsById = new Map(blobs.map((blob) => [blob.id, blob]));
  const fallbackCandidates = buildFallbackProjectObservationCandidates({
    sessions,
    turns,
    candidates,
    sources,
    selectBlobsByIds: (ids) => ids.flatMap((id) => {
      const blob = blobsById.get(id);
      return blob ? [blob] : [];
    }),
  });
  const linked = deriveProjectLinkSnapshot({
    sessions,
    turns,
    candidates: [...candidates, ...fallbackCandidates],
  });

  return new LiveHistorySnapshot(normalizeJsonShapeForJsonOutputMutating({
    host: probe.host,
    sources,
    projects: linked.projects,
    sessions: linked.sessions,
    turns: linked.turns,
    contexts: probe.sources.flatMap((payload) => payload.contexts),
    ask_user_question_turns: probe.sources.flatMap((payload) => payload.ask_user_question_turns),
    loss_audits: probe.sources.flatMap((payload) => payload.loss_audits),
  }), candidates);
}

async function scanSourceWithCollector(
  source: SourceDefinition,
  options: ScanLiteHistoryOptions,
  contextMode: LiteContextMode,
  sourceAdapters: typeof import("@cchistory/source-adapters"),
): Promise<{ host: Host; payload: LiveSourcePayload }> {
  const probe = await sourceAdapters.runSourceProbe(
    buildProbeOptions(source, options),
    [source],
  );
  const payload = probe.sources[0];
  if (!payload) {
    throw new Error(`Lite source probe produced no payload for ${source.display_name}.`);
  }
  return {
    host: probe.host,
    payload: compactSourcePayload(payload, contextMode),
  };
}

async function scanLogicalSessionGroups(
  source: SourceDefinition,
  options: ScanLiteHistoryOptions,
  contextMode: LiteContextMode,
  sourceAdapters: typeof import("@cchistory/source-adapters"),
  getGroupKey: (filePath: string) => Promise<string>,
): Promise<{ host: Host; payload: LiveSourcePayload }> {
  const files = await sourceAdapters.listSourceFiles(source.platform, source.base_dir, options.limitFiles);
  if (files.length === 0) {
    return scanSourceWithCollector(source, options, contextMode, sourceAdapters);
  }

  const filesByGroup = new Map<string, string[]>();
  for (const filePath of files) {
    const key = await getGroupKey(filePath);
    const group = filesByGroup.get(key);
    if (group) group.push(filePath);
    else filesByGroup.set(key, [filePath]);
  }

  const blobsById = new Map<string, SourceSyncPayload["blobs"][number]>();
  const candidatesById = new Map<string, SourceSyncPayload["candidates"][number]>();
  const sessionsById = new Map<string, SessionProjection>();
  const turnsById = new Map<string, UserTurnProjection>();
  const contextsByTurnId = new Map<string, TurnContextProjection>();
  const askTurnsById = new Map<string, SourceSyncPayload["ask_user_question_turns"][number]>();
  const lossAudits: LossAuditRecord[] = [];
  const fileProcessingErrors: string[] = [];
  let totalRecords = 0;
  let totalFragments = 0;
  let totalAtoms = 0;
  let requiresSourceCollector = false;
  let forwardedSourceStart = false;
  let host: Host | undefined;

  for (const groupFiles of filesByGroup.values()) {
    const probe = await sourceAdapters.runSourceProbe(
      {
        ...buildProbeOptions(source, options),
        source_file_paths: { [source.id]: groupFiles },
        on_progress: (event) => {
          if (event.stage === "source_start") {
            if (forwardedSourceStart) return;
            forwardedSourceStart = true;
          }
          if (event.stage === "source_done") return;
          if (event.stage === "file_error" && event.message) {
            fileProcessingErrors.push(event.message);
          }
          options.onProgress?.(event);
        },
      },
      [source],
    );
    host ??= probe.host;
    const groupPayload = probe.sources[0];
    if (!groupPayload) {
      throw new Error(`Lite source probe produced no payload for ${source.display_name}.`);
    }
    totalRecords += groupPayload.source.total_records;
    totalFragments += groupPayload.source.total_fragments;
    totalAtoms += groupPayload.source.total_atoms;
    for (const blob of groupPayload.blobs) blobsById.set(blob.id, blob);
    for (const candidate of groupPayload.candidates) {
      if (candidate.candidate_kind === "project_observation") {
        candidatesById.set(candidate.id, candidate);
      }
    }
    for (const session of groupPayload.sessions) {
      if (sessionsById.has(session.id)) requiresSourceCollector = true;
      sessionsById.set(session.id, session);
    }
    for (const turn of groupPayload.turns) turnsById.set(turn.id, turn);
    if (contextMode === "full") {
      for (const context of groupPayload.contexts) contextsByTurnId.set(context.turn_id, context);
    }
    for (const askTurn of groupPayload.ask_user_question_turns) askTurnsById.set(askTurn.id, askTurn);
    lossAudits.push(...groupPayload.loss_audits);
  }

  if (requiresSourceCollector) {
    return scanSourceWithCollector(source, options, contextMode, sourceAdapters);
  }
  if (!host) {
    throw new Error(`Lite logical-session scan produced no host for ${source.display_name}.`);
  }

  const sessions = [...sessionsById.values()];
  const turns = [...turnsById.values()];
  const firstError = fileProcessingErrors[0];
  return {
    host,
    payload: {
      source: {
        id: source.id,
        slot_id: source.slot_id,
        family: source.family,
        platform: source.platform,
        display_name: source.display_name,
        base_dir: source.base_dir,
        host_id: host.id,
        last_sync: new Date().toISOString(),
        sync_status:
          sessions.length > 0 || turns.length > 0
            ? "healthy"
            : fileProcessingErrors.length > 0
              ? "error"
              : "stale",
        error_message: firstError
          ? `${firstError}${fileProcessingErrors.length > 1 ? ` (+${fileProcessingErrors.length - 1} more)` : ""}`
          : undefined,
        total_blobs: blobsById.size,
        total_records: totalRecords,
        total_fragments: totalFragments,
        total_atoms: totalAtoms,
        total_sessions: sessions.length,
        total_turns: turns.length,
      },
      blobs: [...blobsById.values()],
      candidates: [...candidatesById.values()],
      sessions,
      turns,
      contexts: [...contextsByTurnId.values()],
      ask_user_question_turns: [...askTurnsById.values()],
      loss_audits: lossAudits,
    },
  };
}

function buildProbeOptions(source: SourceDefinition, options: ScanLiteHistoryOptions) {
  return {
    source_ids: [source.id],
    limit_files_per_source: options.limitFiles,
    safe_mode: options.safeMode,
    on_progress: options.onProgress,
  };
}

function compactSourcePayload(payload: SourceSyncPayload, contextMode: LiteContextMode): LiveSourcePayload {
  return {
    source: payload.source,
    blobs: payload.blobs,
    candidates: payload.candidates.filter((candidate) => candidate.candidate_kind === "project_observation"),
    sessions: payload.sessions,
    turns: payload.turns,
    contexts: contextMode === "full" ? payload.contexts : [],
    ask_user_question_turns: payload.ask_user_question_turns,
    loss_audits: payload.loss_audits,
  };
}

export async function resolveLiteSources(options: ResolveLiteSourcesOptions = {}): Promise<SourceDefinition[]> {
  const { getDefaultSourcesForHost } = await import("@cchistory/source-adapters");
  const sourceRoots = options.sourceRoots ?? [];
  const sourceRefs = options.sourceRefs ?? [];
  const discoveryOptions = {
    homeDir: options.homeDir,
    hostname: options.hostname,
    platform: options.platform,
    appDataDir: options.appDataDir,
  };
  const discoveredRoster = getDefaultSourcesForHost(discoveryOptions);
  const completeRoster = getDefaultSourcesForHost({
    ...discoveryOptions,
    includeMissing: true,
  });
  const hostId = deriveHostId(options.hostname ?? os.hostname());
  const overrideRefs = new Set<string>();
  const overridesBySlotId = new Map<string, SourceDefinition>();

  for (const override of sourceRoots) {
    if (overrideRefs.has(override.sourceRef)) {
      throw new Error(`Duplicate --source-root for ${override.sourceRef}.`);
    }
    overrideRefs.add(override.sourceRef);
    await assertLiteSourceRoot(override.baseDir, { homeDir: options.homeDir });
    const source = findSource(completeRoster, override.sourceRef);
    if (!source) {
      throw new Error(`Unknown Lite source adapter: ${override.sourceRef}.`);
    }
    if (overridesBySlotId.has(source.slot_id)) {
      throw new Error(`Duplicate --source-root for ${source.platform}.`);
    }
    const baseDir = path.resolve(override.baseDir);
    overridesBySlotId.set(source.slot_id, {
      ...source,
      base_dir: baseDir,
      id: deriveSourceInstanceId({
        host_id: hostId,
        slot_id: source.slot_id,
        base_dir: baseDir,
      }),
    });
  }

  const resolvedRoster = completeRoster.map((source) => overridesBySlotId.get(source.slot_id) ?? source);
  let result: SourceDefinition[];
  if (sourceRefs.length === 0) {
    const discoveredSlots = new Set(discoveredRoster.map((source) => source.slot_id));
    result = resolvedRoster.filter(
      (source) => discoveredSlots.has(source.slot_id) || overridesBySlotId.has(source.slot_id),
    );
  } else {
    const selected: SourceDefinition[] = [];
    for (const ref of sourceRefs) {
      const source = findSource(resolvedRoster, ref);
      if (!source) {
        throw new Error(`Unknown Lite source adapter: ${ref}.`);
      }
      if (!selected.some((entry) => entry.id === source.id)) {
        selected.push(source);
      }
    }
    result = selected;
  }

  for (const source of result) {
    await assertLiteSourceRoot(source.base_dir, { homeDir: options.homeDir });
  }
  return result;
}

export async function assertLiteSourceRoot(
  inputPath: string,
  options: { homeDir?: string } = {},
): Promise<void> {
  const requestedPath = path.resolve(inputPath);
  const resolved = await resolveExistingRealPath(requestedPath);
  const normalized = normalizeLocalPathIdentity(resolved) ?? resolved.replace(/\\/g, "/");
  // Case-insensitive on purpose: macOS/Windows filesystems resolve `.CCHISTORY`
  // and `CCHistory.sqlite` to the Full store too.
  const lowerNormalized = normalized.toLowerCase();
  const segments = lowerNormalized.split("/").filter(Boolean);
  if (segments.includes(".cchistory") || path.basename(lowerNormalized) === "cchistory.sqlite") {
    throw new Error(`Full store paths are not Lite sources: ${resolved}`);
  }

  const canonicalFullStoreRoot = path.resolve(options.homeDir ?? os.homedir(), ".cchistory");
  const resolvedFullStoreRoot = await resolveExistingRealPath(canonicalFullStoreRoot);
  if (
    await pathExists(canonicalFullStoreRoot) &&
    [requestedPath, resolved].some((sourceRoot) =>
      [canonicalFullStoreRoot, resolvedFullStoreRoot].some((fullStoreRoot) =>
        pathsOverlap(sourceRoot, fullStoreRoot),
      ),
    )
  ) {
    throw new Error(`Source roots overlapping the Full store are not allowed in Lite: ${resolved}`);
  }

  if (await pathExists(path.join(resolved, "cchistory.sqlite"))) {
    throw new Error(`Full store paths are not Lite sources: ${resolved}`);
  }
  if (
    await pathExists(path.join(resolved, "manifest.json")) &&
    await pathExists(path.join(resolved, "payloads"))
  ) {
    throw new Error(`Full bundle paths are not Lite sources: ${resolved}`);
  }
}

function findSource(sources: SourceDefinition[], ref: string): SourceDefinition | undefined {
  return sources.find(
    (source) =>
      source.id === ref ||
      source.slot_id === ref ||
      source.platform === (ref as SourcePlatform),
  );
}

function resolveUnique<T>(
  values: readonly T[],
  ref: string,
  getId: (value: T) => string,
  getAliases: (value: T) => readonly (string | undefined)[],
): T | undefined {
  const normalizedRef = normalizeLookup(ref);
  // A blank ref would otherwise match every alias-less object (and every id
  // prefix), returning an arbitrary object or a confusing "Ambiguous" error.
  if (normalizedRef === "") return undefined;
  const exact = values.filter((value) => {
    if (getId(value) === ref) return true;
    return getAliases(value).some((alias) => normalizeLookup(alias) === normalizedRef);
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Ambiguous reference ${JSON.stringify(ref)} matched ${exact.length} objects.`);
  }

  const prefix = values.filter((value) => getId(value).startsWith(ref));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1) {
    throw new Error(`Ambiguous ID prefix ${JSON.stringify(ref)} matched ${prefix.length} objects.`);
  }
  return undefined;
}

function normalizeLookup(value: string | undefined): string {
  return (normalizeLocalPathIdentity(value) ?? value ?? "").trim().toLowerCase();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingRealPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    return targetPath;
  }
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  return isPathWithin(leftPath, rightPath) || isPathWithin(rightPath, leftPath);
}

// Mutates the input so it matches what JSON.stringify would produce: arrays
// have undefined slots replaced with null and object keys with undefined
// values are deleted. This keeps Lite's in-memory snapshot byte-identical to
// what Full persists and reads back from SQLite payload_json.
function normalizeJsonShapeForJsonOutputMutating<T>(value: T): T {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === undefined) {
        value[index] = null;
      } else {
        normalizeJsonShapeForJsonOutputMutating(value[index]);
      }
    }
    return value;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        delete (value as Record<string, unknown>)[key];
      } else {
        normalizeJsonShapeForJsonOutputMutating(child);
      }
    }
  }
  return value;
}
