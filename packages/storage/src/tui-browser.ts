import {
  statusRank,
  type ProjectIdentity,
  type SearchHighlight,
  type SessionProjection,
  type SessionRelatedWorkProjection,
  type SourceStatus,
  type TurnContextProjection,
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
}

export function buildLocalTuiBrowser(storage: CCHistoryStorage, options: { readMode?: "index" | "full" } = {}): LocalTuiBrowser {
  const projects = storage
    .listProjects()
    .slice()
    .sort((left, right) => (right.project_last_activity_at ?? "").localeCompare(left.project_last_activity_at ?? ""));
  const sources = storage
    .listSources()
    .slice()
    .sort((left, right) => compareSourceHealth(left, right));

  return {
    overview: buildLocalReadOverview(storage, { readMode: options.readMode }),
    projects: projects.map((project) => ({
      project,
      turns: storage
        .listProjectTurns(project.project_id, "all")
        .slice()
        .sort((left, right) => right.submission_started_at.localeCompare(left.submission_started_at))
        .map((turn) => {
          const session = storage.getResolvedSession(turn.session_id) ?? storage.getSession(turn.session_id)
          return {
            turn,
            session,
            context: storage.getTurnContext(turn.id),
            related_work: session ? storage.getSessionRelatedWork(session.id) : [],
          }
        }),
    })),
    sourceHealth: {
      counts: {
        healthy: sources.filter((source) => source.sync_status === "healthy").length,
        stale: sources.filter((source) => source.sync_status === "stale").length,
        error: sources.filter((source) => source.sync_status === "error").length,
      },
      sources,
    },
    search: (query, limit = 25) => storage.searchTurns({ query, limit }).map((result) => ({
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
