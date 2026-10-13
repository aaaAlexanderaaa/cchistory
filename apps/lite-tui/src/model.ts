/**
 * Read model for the Lite TUI.
 *
 * Wraps one ephemeral {@link LiveHistorySnapshot} in the project-first shape
 * the browser panes need. It derives nothing new: ordering, linkage, search,
 * and usage all come from the shared canonical pipeline, so Lite and Full
 * answer the same question the same way.
 */

import type {
  ProjectIdentity,
  SessionProjection,
  SessionRelatedWorkProjection,
  SourceStatus,
  TurnContextProjection,
  TurnSearchResult,
  UsageStatsDimension,
  UsageStatsOverview,
  UsageStatsRollup,
  UserTurnProjection,
} from "@cchistory/domain";
import type { LiveHistorySnapshot } from "@cchistory/live-runtime";

export const UNLINKED_PROJECT_KEY = "__unlinked__";

export interface LiteTurnEntry {
  turn: UserTurnProjection;
  session?: SessionProjection;
}

export interface LiteProjectEntry {
  key: string;
  displayName: string;
  /** Absent for the synthetic unlinked bucket. */
  project?: ProjectIdentity;
  linkageState: string;
  workspacePath?: string;
  sessionCount: number;
  turnCount: number;
  lastActivityAt?: string;
  turns: LiteTurnEntry[];
}

export interface LiteSessionEntry {
  session: SessionProjection;
  sourceName: string;
  turns: LiteTurnEntry[];
  relatedWorkCount: number;
}

export interface LiteSourceHealth {
  counts: { healthy: number; stale: number; error: number };
  sources: SourceStatus[];
}

export interface LiteCounts {
  sources: number;
  projects: number;
  sessions: number;
  turns: number;
}

export interface LiteSearchPage {
  results: TurnSearchResult[];
  total: number;
}

export class LiteBrowserModel {
  readonly snapshot: LiveHistorySnapshot;
  readonly projects: LiteProjectEntry[];
  /**
   * Every session, including sessions that derived no `UserTurn`.
   *
   * Delegated sessions and automation runs routinely carry related work but no
   * user ask; a project/turn-only browser would make them unreachable.
   */
  readonly sessions: LiteSessionEntry[];
  readonly counts: LiteCounts;
  readonly sourceHealth: LiteSourceHealth;

  private readonly sessionsById: Map<string, SessionProjection>;
  /** Additive cache for contexts fetched on demand after the initial scan. */
  private readonly contextOverlay = new Map<string, TurnContextProjection>();
  private readonly searchCache = new Map<string, LiteSearchPage>();

  constructor(snapshot: LiveHistorySnapshot) {
    this.snapshot = snapshot;
    const sessions = snapshot.listResolvedSessions();
    this.sessionsById = new Map(sessions.map((session) => [session.id, session]));
    this.projects = buildProjectEntries(snapshot, this.sessionsById);
    const sourceNames = new Map(snapshot.listSources().map((source) => [source.id, source.display_name]));
    this.sessions = sessions.map((session) => ({
      session,
      sourceName: sourceNames.get(session.source_id) ?? session.source_platform,
      turns: snapshot.listSessionTurns(session.id).map((turn) => ({ turn, session })),
      relatedWorkCount: snapshot.listSessionRelatedWork(session.id).length,
    }));
    this.counts = {
      sources: snapshot.listSources().length,
      projects: this.projects.filter((entry) => entry.project).length,
      sessions: sessions.length,
      turns: snapshot.listResolvedTurns().length,
    };
    this.sourceHealth = buildSourceHealth(snapshot.listSources());
  }

  getSession(sessionId: string): SessionProjection | undefined {
    return this.sessionsById.get(sessionId);
  }

  /** All turns of one session, chronologically, as browser entries. */
  listSessionTurns(sessionId: string): LiteTurnEntry[] {
    return this.snapshot
      .listSessionTurns(sessionId)
      .map((turn) => ({ turn, session: this.sessionsById.get(turn.session_id) }));
  }

  getSessionRelatedWork(sessionId: string): SessionRelatedWorkProjection[] {
    return this.snapshot.listSessionRelatedWork(sessionId);
  }

  getTurnContext(turnId: string): TurnContextProjection | undefined {
    return this.contextOverlay.get(turnId) ?? this.snapshot.getTurnContext(turnId);
  }

  /**
   * Record contexts fetched by a targeted rescan. Purely additive: an overlay
   * never replaces or hides context that the base snapshot already carries.
   */
  putContexts(contexts: readonly TurnContextProjection[]): void {
    for (const context of contexts) {
      if (!this.contextOverlay.has(context.turn_id)) {
        this.contextOverlay.set(context.turn_id, context);
      }
    }
  }

  hasContext(turnId: string): boolean {
    return this.getTurnContext(turnId) !== undefined;
  }

  /**
   * Every ranked match for `query`.
   *
   * The snapshot ranks the whole corpus once and memoizes it, so asking for
   * all rows costs one array slice. The TUI needs the full set to group hits
   * by project the way the Full TUI does.
   */
  searchAll(query: string): LiteSearchPage {
    const cached = this.searchCache.get(query);
    if (cached) return cached;
    const page = this.snapshot.search({ query, limit: Number.MAX_SAFE_INTEGER, offset: 0 });
    this.searchCache.set(query, page);
    return page;
  }

  getUsageOverview(): UsageStatsOverview {
    return this.snapshot.getUsageOverview();
  }

  getUsageRollup(dimension: UsageStatsDimension): UsageStatsRollup {
    return this.snapshot.getUsageRollup(dimension);
  }
}

function buildProjectEntries(
  snapshot: LiveHistorySnapshot,
  sessionsById: Map<string, SessionProjection>,
): LiteProjectEntry[] {
  const entries: LiteProjectEntry[] = [];
  const linkedTurnIds = new Set<string>();

  for (const project of snapshot.listProjects()) {
    const turns = snapshot.listProjectTurns(project.project_id);
    for (const turn of turns) linkedTurnIds.add(turn.id);
    entries.push({
      key: project.project_id,
      displayName: project.display_name,
      project,
      linkageState: project.linkage_state,
      workspacePath: project.primary_workspace_path ?? project.repo_root,
      sessionCount: new Set(turns.map((turn) => turn.session_id)).size,
      turnCount: turns.length,
      lastActivityAt: project.project_last_activity_at ?? project.updated_at,
      turns: turns.map((turn) => ({ turn, session: sessionsById.get(turn.session_id) })),
    });
  }

  const unlinkedTurns = snapshot.listResolvedTurns().filter((turn) => !linkedTurnIds.has(turn.id));
  if (unlinkedTurns.length > 0) {
    entries.push({
      key: UNLINKED_PROJECT_KEY,
      displayName: "Unlinked / candidate-only",
      linkageState: "unlinked",
      sessionCount: new Set(unlinkedTurns.map((turn) => turn.session_id)).size,
      turnCount: unlinkedTurns.length,
      lastActivityAt: unlinkedTurns.at(-1)?.last_context_activity_at,
      turns: unlinkedTurns.map((turn) => ({ turn, session: sessionsById.get(turn.session_id) })),
    });
  }

  return entries;
}

function buildSourceHealth(sources: SourceStatus[]): LiteSourceHealth {
  const counts = { healthy: 0, stale: 0, error: 0 };
  for (const source of sources) {
    if (source.sync_status === "healthy") counts.healthy += 1;
    else if (source.sync_status === "stale") counts.stale += 1;
    else counts.error += 1;
  }
  return { counts, sources };
}
