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
import type { CCHistoryStorage } from "./internal/storage.js";
import { buildLocalReadOverview, type LocalReadOverview } from "./read-overview.js";

export interface LocalTuiBrowserTurn {
  turn: UserTurnProjection;
  session?: SessionProjection;
  context?: TurnContextProjection;
  related_work: SessionRelatedWorkProjection[];
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
  related_work: SessionRelatedWorkProjection[];
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
  overview: LocalReadOverview;
  projects: LocalTuiBrowserProject[];
  sourceHealth: LocalTuiSourceHealth;
  search: (query: string, limit?: number) => LocalTuiSearchResult[];
  getUsageOverview: (afterDate?: string) => UsageStatsOverview;
  getUsageRollup: (dimension: UsageStatsDimension, afterDate?: string) => UsageStatsRollup;
}

export function buildLocalTuiBrowser(storage: CCHistoryStorage, options: { readMode?: "index" | "full" } = {}): LocalTuiBrowser {
  const projects = storage
    .listProjects()
    .slice()
    .filter((project) => project.committed_turn_count + project.candidate_turn_count > 0)
    .sort((left, right) => {
      const leftTurns = left.committed_turn_count + left.candidate_turn_count;
      const rightTurns = right.committed_turn_count + right.candidate_turn_count;
      if (rightTurns !== leftTurns) return rightTurns - leftTurns;
      return (right.project_last_activity_at ?? "").localeCompare(left.project_last_activity_at ?? "");
    });
  const sources = storage
    .listSources()
    .slice()
    .sort((left, right) => compareSourceHealth(left, right));

  return {
    overview: buildLocalReadOverview(storage, { readMode: options.readMode }),
    projects: projects.map((project) => {
      const rawTurns = storage
        .listProjectTurns(project.project_id, "all")
        .slice()
        .map((turn) => {
          const session = storage.getResolvedSession(turn.session_id) ?? storage.getSession(turn.session_id)
          return {
            turn,
            session,
            context: storage.getTurnContext(turn.id),
            related_work: session ? storage.getSessionRelatedWork(session.id) : [],
          }
        });
      // Group by session, sort sessions by created_at DESC, turns within session by time DESC
      const sessionMap = new Map<string, LocalTuiBrowserTurn[]>();
      const sessionOrder = new Map<string, string>(); // session_id -> created_at
      for (const t of rawTurns) {
        const sid = t.turn.session_id;
        if (!sessionMap.has(sid)) {
          sessionMap.set(sid, []);
          sessionOrder.set(sid, t.session?.created_at ?? t.turn.submission_started_at);
        }
        sessionMap.get(sid)!.push(t);
      }
      // Sort turns within each session by time ASC (chronological order within session)
      for (const turns of sessionMap.values()) {
        turns.sort((a, b) => a.turn.submission_started_at.localeCompare(b.turn.submission_started_at));
      }
      // Sort sessions by created_at DESC
      const sortedSessionIds = [...sessionOrder.entries()]
        .sort((a, b) => b[1].localeCompare(a[1]))
        .map(e => e[0]);
      const orderedTurns: LocalTuiBrowserTurn[] = [];
      for (const sid of sortedSessionIds) {
        orderedTurns.push(...sessionMap.get(sid)!);
      }
      return { project, turns: orderedTurns };
    }).filter((entry) => entry.turns.length > 0),
    sourceHealth: {
      counts: {
        healthy: sources.filter((source) => source.sync_status === "healthy").length,
        stale: sources.filter((source) => source.sync_status === "stale").length,
        error: sources.filter((source) => source.sync_status === "error").length,
      },
      sources,
    },
    getUsageOverview: (afterDate) => storage.getUsageOverview(afterDate ? { after_date: afterDate } : {}),
    getUsageRollup: (dimension, afterDate) => storage.listUsageRollup(dimension, afterDate ? { after_date: afterDate } : {}),
    search: (query, limit = 500) => storage.searchTurns({ query, limit }).map((result) => ({
      turn: result.turn,
      session: result.session,
      context: storage.getTurnContext(result.turn.id),
      project: result.project,
      highlights: result.highlights,
      relevance_score: result.relevance_score,
      related_work: result.session ? storage.getSessionRelatedWork(result.session.id) : [],
    })),
  };
}

function compareSourceHealth(left: SourceStatus, right: SourceStatus): number {
  const statusDiff = statusRank[left.sync_status] - statusRank[right.sync_status];
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return (right.last_sync ?? "").localeCompare(left.last_sync ?? "");
}
