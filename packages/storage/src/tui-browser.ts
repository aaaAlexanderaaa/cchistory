import {
  statusRank,
  type ProjectIdentity,
  type SearchHighlight,
  type SessionProjection,
  type SessionRelatedWorkProjection,
  type SourceStatus,
  type TurnContextProjection,
  type UsageStatsDimension,
  type UsageStatsOverview,
  type UsageStatsRollup,
  type UserTurnProjection,
} from "@cchistory/domain";
import { buildProjectDisplayList } from "@cchistory/canonical";
import type { CCHistoryStorage } from "./internal/storage.js";
import { buildLocalReadOverview, type LocalReadOverview } from "./read-overview.js";

export interface LocalTuiBrowserTurn {
  turn: UserTurnProjection;
  session?: SessionProjection;
  context?: TurnContextProjection;
  related_work?: SessionRelatedWorkProjection[];
}

export interface LocalTuiBrowserProject {
  project: ProjectIdentity;
  turns: LocalTuiBrowserTurn[];
}

export interface LocalTuiSearchResult {
  turn: UserTurnProjection;
  session?: SessionProjection;
  context?: TurnContextProjection;
  project?: ProjectIdentity;
  highlights: SearchHighlight[];
  relevance_score: number;
  related_work?: SessionRelatedWorkProjection[];
}

export interface LocalTuiSearchGroup {
  projectName: string;
  projectId: string;
  total: number;
}

export interface LocalTuiSearchPage {
  results: LocalTuiSearchResult[];
  total: number;
  groups: LocalTuiSearchGroup[];
  selectedGroupIndex: number;
  resultOffset: number;
}

export interface LocalTuiSourceHealth {
  counts: {
    healthy: number;
    stale: number;
    error: number;
  };
  sources: SourceStatus[];
}

export interface LocalTuiBrowser {
  searchMode: "fts5" | "fallback";
  overview: LocalReadOverview;
  projects: LocalTuiBrowserProject[];
  sourceHealth: LocalTuiSourceHealth;
  search: (query: string, limit?: number) => LocalTuiSearchResult[];
  searchPage: (query: string, options?: { groupIndex?: number; offset?: number; limit?: number }) => LocalTuiSearchPage;
  getSessionTurns: (sessionId: string) => LocalTuiBrowserTurn[];
  getTurnContext: (turnId: string) => TurnContextProjection | undefined;
  getSessionRelatedWork: (sessionId: string) => SessionRelatedWorkProjection[];
  getUsageOverview: (afterDate?: string) => UsageStatsOverview;
  getUsageRollup: (dimension: UsageStatsDimension, afterDate?: string) => UsageStatsRollup;
}

export function buildLocalTuiBrowser(storage: CCHistoryStorage, options: { readMode?: "index" | "full" } = {}): LocalTuiBrowser {
  const projects = buildProjectDisplayList(storage.listProjects());
  const sources = storage
    .listSources()
    .slice()
    .sort((left, right) => compareSourceHealth(left, right));
  const turnsByProjectId = new Map<string, LocalTuiBrowserTurn[]>();
  const turnsBySessionId = new Map<string, LocalTuiBrowserTurn[]>();
  const contextByTurnId = new Map<string, TurnContextProjection | undefined>();
  const relatedWorkBySessionId = new Map<string, SessionRelatedWorkProjection[]>();
  const getProjectTurns = (projectId: string): LocalTuiBrowserTurn[] => {
    const cached = turnsByProjectId.get(projectId);
    if (cached) {
      return cached;
    }
    const orderedTurns = materializeProjectTurns(storage, projectId);
    turnsByProjectId.set(projectId, orderedTurns);
    const groupedBySessionId = new Map<string, LocalTuiBrowserTurn[]>();
    for (const turn of orderedTurns) {
      const sessionTurns = groupedBySessionId.get(turn.turn.session_id) ?? [];
      sessionTurns.push(turn);
      groupedBySessionId.set(turn.turn.session_id, sessionTurns);
    }
    for (const [sessionId, sessionTurns] of groupedBySessionId) {
      turnsBySessionId.set(sessionId, sessionTurns);
    }
    return orderedTurns;
  };
  const getSessionTurns = (sessionId: string): LocalTuiBrowserTurn[] => {
    const cached = turnsBySessionId.get(sessionId);
    if (cached) {
      return cached;
    }
    const sessionTurns = storage.listSessionTurnsForReadSurface(sessionId).map((turn) => ({
      turn,
      session: storage.getSession(turn.session_id),
    }));
    turnsBySessionId.set(sessionId, sessionTurns);
    return sessionTurns;
  };
  const getTurnContext = (turnId: string): TurnContextProjection | undefined => {
    if (!contextByTurnId.has(turnId)) {
      contextByTurnId.set(turnId, storage.getTurnContext(turnId));
    }
    return contextByTurnId.get(turnId);
  };
  const getSessionRelatedWork = (sessionId: string): SessionRelatedWorkProjection[] => {
    if (!relatedWorkBySessionId.has(sessionId)) {
      relatedWorkBySessionId.set(sessionId, storage.getSessionRelatedWork(sessionId));
    }
    return relatedWorkBySessionId.get(sessionId) ?? [];
  };

  return {
    searchMode: storage.searchMode,
    overview: buildLocalReadOverview(storage, { readMode: options.readMode }),
    projects: projects.map((project) => ({
      project,
      get turns() {
        return getProjectTurns(project.project_id);
      },
    })),
    sourceHealth: {
      counts: {
        healthy: sources.filter((source) => source.sync_status === "healthy").length,
        stale: sources.filter((source) => source.sync_status === "stale").length,
        error: sources.filter((source) => source.sync_status === "error").length,
      },
      sources,
    },
    getSessionTurns,
    getTurnContext,
    getSessionRelatedWork,
    getUsageOverview: (afterDate) => storage.getUsageOverview(afterDate ? { after_date: afterDate } : {}),
    getUsageRollup: (dimension, afterDate) => storage.listUsageRollup(dimension, afterDate ? { after_date: afterDate } : {}),
    search: (query, limit = 500) => storage.searchTurns({ query, limit }).map((result) => ({
      turn: result.turn,
      session: result.session,
      project: result.project,
      highlights: result.highlights,
      relevance_score: result.relevance_score,
    })),
    searchPage: (query, pageOptions = {}) => {
      const page = storage.searchTurnsReadSurfacePage({
        query,
        groupIndex: pageOptions.groupIndex,
        offset: pageOptions.offset,
        limit: pageOptions.limit,
      });
      return {
        total: page.total,
        selectedGroupIndex: page.selectedGroupIndex,
        resultOffset: page.resultOffset,
        groups: page.groups.map((group) => ({
          projectName: group.project_name,
          projectId: group.project_id,
          total: group.total,
        })),
        results: page.results.map((result) => ({
          turn: result.turn,
          session: result.session,
          project: result.project,
          highlights: result.highlights,
          relevance_score: result.relevance_score,
        })),
      };
    },
  };
}

function materializeProjectTurns(storage: CCHistoryStorage, projectId: string): LocalTuiBrowserTurn[] {
  const rawTurns = storage
    .listProjectTurnsForReadSurface(projectId, "all")
    .slice()
    .map((turn) => ({
      turn,
      session: storage.getSession(turn.session_id),
    }));

  const sessionMap = new Map<string, LocalTuiBrowserTurn[]>();
  const sessionOrder = new Map<string, string>();
  for (const t of rawTurns) {
    const sid = t.turn.session_id;
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, []);
      sessionOrder.set(sid, t.session?.created_at ?? t.turn.submission_started_at);
    }
    sessionMap.get(sid)!.push(t);
  }
  for (const turns of sessionMap.values()) {
    turns.sort((a, b) => a.turn.submission_started_at.localeCompare(b.turn.submission_started_at));
  }

  const sortedSessionIds = [...sessionOrder.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map((entry) => entry[0]);
  const orderedTurns: LocalTuiBrowserTurn[] = [];
  for (const sid of sortedSessionIds) {
    orderedTurns.push(...sessionMap.get(sid)!);
  }
  return orderedTurns;
}

function compareSourceHealth(left: SourceStatus, right: SourceStatus): number {
  const statusDiff = statusRank[left.sync_status] - statusRank[right.sync_status];
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return (right.last_sync ?? "").localeCompare(left.last_sync ?? "");
}
