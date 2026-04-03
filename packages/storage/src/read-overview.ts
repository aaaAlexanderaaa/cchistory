import type { ProjectIdentity } from "@cchistory/domain";
import type { StorageSchemaInfo } from "./db/schema.js";
import type { CCHistoryStorage } from "./internal/storage.js";

export interface LocalReadOverviewCounts {
  sources: number;
  projects: number;
  sessions: number;
  turns: number;
}

export interface LocalReadProjectPreview {
  project_id: string;
  display_name: string;
  slug: string;
  project_last_activity_at?: string;
}

export interface LocalReadOverview {
  read_mode: "index" | "full";
  schema: StorageSchemaInfo;
  search_mode: CCHistoryStorage["searchMode"];
  counts: LocalReadOverviewCounts;
  recent_projects: LocalReadProjectPreview[];
}

export function buildLocalReadOverview(storage: CCHistoryStorage, options: { readMode?: "index" | "full" } = {}): LocalReadOverview {
  const projects = storage.listProjects();
  const sessions = storage.listResolvedSessions();
  const turns = storage.listResolvedTurns();
  const sources = storage.listSources();

  return {
    read_mode: options.readMode ?? "index",
    schema: storage.getSchemaInfo(),
    search_mode: storage.searchMode,
    counts: {
      sources: sources.length,
      projects: projects.length,
      sessions: sessions.length,
      turns: turns.length,
    },
    recent_projects: buildRecentProjectPreviews(projects),
  };
}

function buildRecentProjectPreviews(projects: ProjectIdentity[]): LocalReadProjectPreview[] {
  return projects
    .slice()
    .sort((left, right) => (right.project_last_activity_at ?? "").localeCompare(left.project_last_activity_at ?? ""))
    .slice(0, 3)
    .map((project) => ({
      project_id: project.project_id,
      display_name: project.display_name,
      slug: project.slug,
      project_last_activity_at: project.project_last_activity_at,
    }));
}
