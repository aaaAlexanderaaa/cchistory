import {
  getLocalPathBasename,
  normalizeLocalPathIdentity,
  type ProjectIdentity,
  type SessionProjection,
  type SourceStatus,
  type UserTurnProjection,
} from "@cchistory/domain";
import type { CCHistoryStorage } from "@cchistory/storage";
import { truncateText } from "./renderers.js";

export function resolveProjectRef(storage: CCHistoryStorage, ref: string): ProjectIdentity {
  const projects = storage.listProjects();
  const direct = projects.find((project) => project.project_id === ref);
  if (direct) {
    return direct;
  }

  const normalizedRef = normalizeProjectRefToken(ref);
  const normalizedPathRef = normalizeLocalPathIdentity(ref);

  const exactSlugMatch = resolveUniqueProjectMatch(
    ref,
    projects.filter((project) => project.slug === ref),
    "slug",
  );
  if (exactSlugMatch) {
    return exactSlugMatch;
  }

  const displayNameMatch = resolveUniqueProjectMatch(
    ref,
    projects.filter((project) => normalizeProjectRefToken(project.display_name) === normalizedRef),
    "display name",
  );
  if (displayNameMatch) {
    return displayNameMatch;
  }

  const workspaceMatch = resolveUniqueProjectMatch(
    ref,
    projects.filter((project) => {
      const normalizedWorkspace = normalizeLocalPathIdentity(project.primary_workspace_path);
      const normalizedBasename = normalizeProjectRefToken(getLocalPathBasename(project.primary_workspace_path));
      return Boolean(
        (normalizedPathRef && normalizedWorkspace === normalizedPathRef) ||
          (normalizedBasename && normalizedBasename === normalizedRef),
      );
    }),
    "workspace",
  );
  if (workspaceMatch) {
    return workspaceMatch;
  }

  const sourceNativeMatch = resolveUniqueProjectMatch(
    ref,
    normalizedRef
      ? projects.filter((project) => normalizeProjectRefToken(project.source_native_project_ref) === normalizedRef)
      : [],
    "source-native project reference",
  );
  if (sourceNativeMatch) {
    return sourceNativeMatch;
  }

  const projectIdPrefixMatch = resolveUniqueProjectMatch(
    ref,
    projects.filter((project) => project.project_id.startsWith(ref)),
    "ID prefix",
  );
  if (projectIdPrefixMatch) {
    return projectIdPrefixMatch;
  }

  const slugPrefixMatch = resolveUniqueProjectMatch(
    ref,
    projects.filter((project) => project.slug.startsWith(ref)),
    "slug prefix",
  );
  if (slugPrefixMatch) {
    return slugPrefixMatch;
  }

  throw new Error(formatUnknownProjectRefError(ref, projects));
}

export function resolveSessionRef(storage: CCHistoryStorage, ref: string): SessionProjection {
  const direct = storage.getResolvedSession(ref) ?? storage.getSession(ref);
  if (direct) {
    return direct;
  }

  const sessions = storage.listResolvedSessions();
  const normalizedRef = normalizeSessionRefToken(ref);

  const prefixMatch = resolveUniqueSessionMatch(ref, sessions.filter((session) => session.id.startsWith(ref)), "ID prefix");
  if (prefixMatch) {
    return prefixMatch;
  }

  const titleMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => normalizeSessionRefToken(session.title) === normalizedRef),
    "title",
  );
  if (titleMatch) {
    return titleMatch;
  }

  const normalizedWorkspaceRef = normalizeSessionPathRefToken(ref);
  const workspaceMatch = resolveUniqueSessionMatch(
    ref,
    sessions.filter((session) => {
      if (!session.working_directory || !normalizedWorkspaceRef) {
        return false;
      }
      const normalizedWorkspace = normalizeSessionPathRefToken(session.working_directory);
      const normalizedBasename = normalizeSessionPathRefToken(getLocalPathBasename(session.working_directory));
      return normalizedWorkspace === normalizedWorkspaceRef || normalizedBasename === normalizedWorkspaceRef;
    }),
    "workspace",
  );
  if (workspaceMatch) {
    return workspaceMatch;
  }

  throw new Error(formatUnknownSessionRefError(ref, sessions));
}

export function resolveTurnRef(storage: CCHistoryStorage, ref: string): UserTurnProjection {
  const direct = storage.getResolvedTurn(ref) ?? storage.getTurn(ref);
  if (direct) {
    return direct;
  }

  const turns = storage.listResolvedTurns();

  const exactAliasMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        (turn.turn_id != null && turn.turn_id === ref) ||
        turn.revision_id === ref ||
        turn.turn_revision_id === ref,
    ),
    "ID",
  );
  if (exactAliasMatch) {
    return exactAliasMatch;
  }

  const prefixMatch = resolveUniqueTurnMatch(
    ref,
    turns.filter(
      (turn) =>
        turn.id.startsWith(ref) ||
        turn.turn_id?.startsWith(ref) ||
        turn.revision_id.startsWith(ref) ||
        turn.turn_revision_id?.startsWith(ref),
    ),
    "ID prefix",
  );
  if (prefixMatch) {
    return prefixMatch;
  }

  throw new Error(formatUnknownTurnRefError(ref, turns));
}

export function resolveSourceRef(storage: CCHistoryStorage, ref: string): SourceStatus {
  const sources = storage.listSources();
  const direct = sources.find((source) => source.id === ref);
  if (direct) {
    return direct;
  }
  const handleMatches = sources.filter((source) => formatSourceHandle(source) === ref);
  if (handleMatches.length === 1) {
    return handleMatches[0]!;
  }
  const slotMatches = sources.filter((source) => source.slot_id === ref);
  if (slotMatches.length === 1) {
    return slotMatches[0]!;
  }
  throw new Error(formatUnknownSourceRefError(ref, sources));
}

function formatUnknownSessionRefError(ref: string, sessions: SessionProjection[]): string {
  if (sessions.length === 0) {
    return `Unknown session reference: ${ref}. No sessions are indexed yet. Run \`cchistory sync\` or \`cchistory ls sessions\` to see what is available.`;
  }
  const recent = [...sessions]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, 5);
  const preview = recent.map(formatSessionRefPreview).join("; ");
  const more = sessions.length > recent.length ? `; +${sessions.length - recent.length} more` : "";
  return `Unknown session reference: ${ref}. Recent sessions: ${preview}${more}. Use \`cchistory ls sessions\` to enumerate.`;
}

function formatUnknownTurnRefError(ref: string, turns: UserTurnProjection[]): string {
  if (turns.length === 0) {
    return `Unknown turn reference: ${ref}. No turns are indexed yet. Run \`cchistory sync\` or \`cchistory search\` to see what is available.`;
  }
  const recent = [...turns]
    .sort((a, b) => (b.submission_started_at ?? "").localeCompare(a.submission_started_at ?? ""))
    .slice(0, 5);
  const preview = recent.map(formatTurnRefPreview).join("; ");
  const more = turns.length > recent.length ? `; +${turns.length - recent.length} more` : "";
  return `Unknown turn reference: ${ref}. Recent turns: ${preview}${more}. Use \`cchistory search\` to find a turn by text.`;
}

function formatUnknownSourceRefError(ref: string, sources: SourceStatus[]): string {
  if (sources.length === 0) {
    return `Unknown source reference: ${ref}. No sources are registered yet. Run \`cchistory sync\` to ingest from local AI tools.`;
  }
  const preview = sources.slice(0, 8).map((source) => `${source.display_name} handle=${formatSourceHandle(source)} id=${source.id}`).join("; ");
  const more = sources.length > 8 ? `; +${sources.length - 8} more` : "";
  return `Unknown source reference: ${ref}. Known sources: ${preview}${more}. Use \`cchistory ls sources\` to enumerate handles.`;
}

function resolveUniqueSessionMatch(
  ref: string,
  matches: SessionProjection[],
  matchKind: string,
): SessionProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatSessionRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous session reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function resolveUniqueProjectMatch(
  ref: string,
  matches: ProjectIdentity[],
  matchKind: string,
): ProjectIdentity | undefined {
  const uniqueMatches = dedupeProjects(matches);
  if (uniqueMatches.length === 0) {
    return undefined;
  }
  if (uniqueMatches.length === 1) {
    return uniqueMatches[0]!;
  }
  const preview = uniqueMatches.slice(0, 3).map(formatProjectRefPreview).join(", ");
  const remainder = uniqueMatches.length > 3 ? ` (+${uniqueMatches.length - 3} more)` : "";
  throw new Error(`Ambiguous project reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function resolveUniqueTurnMatch(
  ref: string,
  matches: UserTurnProjection[],
  matchKind: string,
): UserTurnProjection | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0]!;
  }
  const preview = matches.slice(0, 3).map(formatTurnRefPreview).join(", ");
  const remainder = matches.length > 3 ? ` (+${matches.length - 3} more)` : "";
  throw new Error(`Ambiguous turn reference: ${ref}. Matched ${matchKind} ${preview}${remainder}`);
}

function dedupeProjects(projects: ProjectIdentity[]): ProjectIdentity[] {
  const byId = new Map<string, ProjectIdentity>();
  for (const project of projects) {
    byId.set(project.project_id, project);
  }
  return [...byId.values()];
}

function normalizeProjectRefToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}

function formatUnknownProjectRefError(ref: string, projects: ProjectIdentity[]): string {
  const knownProjects = projects.slice(0, 5).map(formatProjectRefPreview);
  const knownSection =
    knownProjects.length > 0
      ? ` Known projects: ${knownProjects.join("; ")}${projects.length > knownProjects.length ? `; +${projects.length - knownProjects.length} more` : ""}.`
      : " No projects are indexed yet.";
  return `Unknown project reference: ${ref}. Use a project ID, Ref/slug from \`cchistory ls projects\`, display name, or workspace path.${knownSection}`;
}

function formatProjectRefPreview(project: ProjectIdentity): string {
  const parts = [`${project.display_name} ref=${project.slug}`, `id=${project.project_id}`];
  if (project.primary_workspace_path) {
    parts.push(`workspace=${JSON.stringify(project.primary_workspace_path)}`);
  }
  return parts.join(" ");
}

function formatSessionRefPreview(session: SessionProjection): string {
  const parts = [session.id];
  if (session.title) {
    parts.push(`title=${JSON.stringify(session.title)}`);
  }
  if (session.working_directory) {
    parts.push(`workspace=${JSON.stringify(session.working_directory)}`);
  }
  return parts.join(" ");
}

function formatTurnRefPreview(turn: UserTurnProjection): string {
  return `${turn.id} submitted=${turn.submission_started_at} prompt=${JSON.stringify(truncateText(turn.canonical_text, 48))}`;
}

function normalizeSessionRefToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeSessionPathRefToken(value: string | undefined): string {
  const normalizedPath = normalizeLocalPathIdentity(value);
  return (normalizedPath ?? value)?.trim().toLowerCase() ?? "";
}

export function formatSourceHandle(source: SourceStatus): string {
  return `${source.slot_id}@${source.host_id}`;
}
