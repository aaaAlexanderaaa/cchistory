import { homedir } from "node:os";
import path from "node:path";
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

/**
 * Token classification shared across all path-aware commands.
 *
 * `keyword` — the positional matches one of the command's reserved keywords
 *   (e.g. `projects` / `sessions` / `sources` for `ls`). Keyword form keeps
 *   the legacy "list everything" semantics.
 *
 * `path` — the positional looks like a filesystem path. Path-form inputs
 *   bypass keyword resolution entirely so a directory literally named
 *   `projects` can still be addressed via `./projects`.
 *
 * `ref` — anything else; falls through to the existing ref resolver
 *   (id / slug / display name / workspace path).
 *
 * Path-form detection: starts with `/`, `./`, `../`, `~/`, OR is exactly
 * `.` or `..`. A bare `foo` is NOT path-form — it's a ref. Users must write
 * `./foo` to force path interpretation. This matches git/POSIX convention.
 */
export type ProjectTokenKind = "keyword" | "path" | "ref";

export function classifyProjectToken(
  input: string,
  keywords: ReadonlySet<string>,
): ProjectTokenKind {
  if (keywords.has(input.toLowerCase())) return "keyword";
  if (isPathForm(input)) return "path";
  return "ref";
}

export function isPathForm(input: string): boolean {
  if (input === "." || input === "..") return true;
  return /^(?:\/|\.\.?\/|~\/)/.test(input);
}

/**
 * Expand a leading `~` or `~user` to the user's home directory. The shell
 * usually does this before exec, but we handle it as a courtesy for quoted
 * args and direct API invocation.
 */
export function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

/**
 * Resolve a path-like input to an absolute, normalized identity suitable for
 * comparison against `primary_workspace_path`. Returns the *display* form
 * (absolute, no file:// prefix, no trailing slash) so it can be echoed back
 * to the operator as `resolved_path`.
 */
export function resolvePathInput(input: string, cwd: string): { resolvedPath: string; normalizedIdentity: string } {
  const expanded = expandTilde(input);
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  const identity = normalizeLocalPathIdentity(absolute);
  if (!identity) {
    throw new Error(`Cannot resolve path: ${input}`);
  }
  return { resolvedPath: absolute, normalizedIdentity: identity };
}

/**
 * Result of resolving a project by ref OR by path.
 *
 * `mains` lists every project whose workspace EXACTLY matches the resolved
 * path (or, in ancestor-match mode, every project at the closest ancestor
 * workspace). Multiple mains happen when different sources / imports create
 * separate project rows at the same cwd — common in practice, so we surface
 * all of them rather than forcing the operator to disambiguate.
 *
 * `sub_projects` lists projects whose workspace is strictly below the
 * shared main workspace (descendants). Computed once across the union.
 *
 * `ancestor_note` is set only when the input path was inside (deeper than)
 * the main workspace — surfaced so the operator sees the implicit upward
 * resolution.
 */
export interface ProjectScope {
  mains: ProjectIdentity[];
  sub_projects: ProjectIdentity[];
  ancestor_note?: string;
  resolved_path: string;
  path_input: string;
}

/**
 * Convenience accessor: the first main when present, else undefined. Useful
 * for callers (show/tree) that render detail for a single project — they
 * pick the first main deterministically.
 */
export function scopeMain(scope: ProjectScope): ProjectIdentity | undefined {
  return scope.mains[0];
}

/**
 * Resolve a project by ref OR by filesystem path, returning the full scope
 * (main + descendant sub_projects). Used by `ls` / `tree` / `show` / `stats`
 * to render the path-first view.
 *
 * Resolution order:
 *   1. Ref-style resolution via {@link resolveProjectRef} (id / slug / name /
 *      workspace exact). On hit, that's `main`.
 *   2. Ancestor match — input path is *inside* a project's workspace. Pick
 *      the closest ancestor (longest matching prefix) as `main`, set
 *      `ancestor_note`.
 *   3. Descendant-only mode — input path is a parent of one or more project
 *      workspaces but no exact match exists. `main` is undefined; sub_projects
 *      lists every descendant.
 *
 * Sub_projects (when `main` is set) are computed from `main`'s workspace, not
 * the input path — so `cd`-deep paths still scope to the resolved project.
 */
export function resolveProjectScope(
  storage: CCHistoryStorage,
  input: string,
  cwd: string,
): ProjectScope {
  const projects = storage.listProjects();
  const { resolvedPath, normalizedIdentity } = resolvePathInput(input, cwd);

  let mains: ProjectIdentity[] = [];
  let mainWorkspaceIdentity: string | undefined;
  let ancestorNote: string | undefined;

  // 1. Ref-style resolution (id / slug / display name / source-native /
  //    prefix). SKIP for path-form inputs because normalizeLocalPathIdentity
  //    collapses "./foo" to "foo" which would false-positive on basename
  //    matches across unrelated absolute paths.
  if (!isPathForm(input)) {
    try {
      const ref = resolveProjectRef(storage, input);
      mains = [ref];
      mainWorkspaceIdentity = normalizeLocalPathIdentity(ref.primary_workspace_path);
    } catch {
      // Fall through to path-scope logic below.
    }
  } else {
    // Path-form: collect EVERY exact-workspace match. Multiple projects at
    // the same cwd are common (different sources, repeated imports) — list
    // them all as mains instead of forcing disambiguation.
    const exact = projects.filter(
      (project) => normalizeLocalPathIdentity(project.primary_workspace_path) === normalizedIdentity,
    );
    if (exact.length > 0) {
      mains = sortMainsStable(exact);
      mainWorkspaceIdentity = normalizedIdentity;
    }
  }

  // 2. If no mains yet, try ancestor match (input is inside a project's
  //    workspace). Pick the closest ancestor workspace by depth; collect
  //    every project at that workspace as mains.
  if (mains.length === 0) {
    const ancestors = projects
      .filter((project) => isAncestorOf(project.primary_workspace_path, normalizedIdentity))
      .sort((a, b) => workspaceDepth(b) - workspaceDepth(a));
    if (ancestors.length > 0) {
      const closestDepth = workspaceDepth(ancestors[0]!);
      const closestWorkspace = normalizeLocalPathIdentity(ancestors[0]!.primary_workspace_path);
      // All projects at the closest ancestor workspace are peers.
      const closest = ancestors.filter(
        (project) => normalizeLocalPathIdentity(project.primary_workspace_path) === closestWorkspace,
      );
      // `ancestors` is depth-sorted; closest are at the front, but the
      // filter above is on the closest workspace only. Equal-depth but
      // different workspace would be a tie that shouldn't happen for paths.
      mains = sortMainsStable(closest);
      mainWorkspaceIdentity = closestWorkspace;
      ancestorNote = `Resolved upward to ${ancestors[0]!.primary_workspace_path ?? "(unknown workspace)"}`;
      // Sanity: closestDepth only used to assert we picked the max-depth
      // workspace; keep the reference so future lint doesn't flag it.
      void closestDepth;
    }
  }

  // 3. Compute sub_projects from the shared main workspace (if mains exist)
  //    or fall back to descendant-only mode against the input path.
  if (mains.length > 0 && mainWorkspaceIdentity) {
    const mainIds = new Set(mains.map((project) => project.project_id));
    const sub_projects = projects.filter(
      (project) =>
        !mainIds.has(project.project_id) &&
        isStrictDescendant(project.primary_workspace_path, mainWorkspaceIdentity),
    );
    return {
      mains,
      sub_projects,
      ...(ancestorNote ? { ancestor_note: ancestorNote } : {}),
      resolved_path: resolvedPath,
      path_input: input,
    };
  }

  // No main found — try descendant-only mode against the input path.
  const descendants = projects.filter((project) =>
    isStrictDescendant(project.primary_workspace_path, normalizedIdentity),
  );
  if (descendants.length === 0) {
    throw new Error(formatNoProjectAtPathError(input, resolvedPath, projects));
  }
  return {
    mains: [],
    sub_projects: descendants,
    resolved_path: resolvedPath,
    path_input: input,
  };
}

/**
 * Stable sort for the mains list so the rendering is deterministic across
 * runs. Primary key: display name (so the operator sees a familiar order).
 * Tiebreaker: project_id (stable hash-derived identifier).
 */
function sortMainsStable(mains: ProjectIdentity[]): ProjectIdentity[] {
  return [...mains].sort((a, b) => {
    const nameCompare = (a.display_name ?? "").localeCompare(b.display_name ?? "");
    if (nameCompare !== 0) return nameCompare;
    return a.project_id.localeCompare(b.project_id);
  });
}

function isAncestorOf(workspacePath: string | undefined, descendantIdentity: string): boolean {
  const normalizedWorkspace = normalizeLocalPathIdentity(workspacePath);
  if (!normalizedWorkspace) return false;
  if (normalizedWorkspace === descendantIdentity) return false;
  return descendantIdentity.startsWith(`${normalizedWorkspace}/`);
}

function isStrictDescendant(workspacePath: string | undefined, ancestorIdentity: string): boolean {
  const normalizedWorkspace = normalizeLocalPathIdentity(workspacePath);
  if (!normalizedWorkspace) return false;
  if (normalizedWorkspace === ancestorIdentity) return false;
  return normalizedWorkspace.startsWith(`${ancestorIdentity}/`);
}

function workspaceDepth(project: ProjectIdentity): number {
  const normalized = normalizeLocalPathIdentity(project.primary_workspace_path);
  if (!normalized) return 0;
  return normalized.split("/").filter(Boolean).length;
}

function formatNoProjectAtPathError(input: string, resolvedPath: string, projects: ProjectIdentity[]): string {
  if (projects.length === 0) {
    return `No project at ${resolvedPath}. No projects are indexed yet. Run \`cchistory sync\` to ingest from local AI tools.`;
  }
  const known = projects
    .slice(0, 5)
    .map((project) => {
      const ws = project.primary_workspace_path ?? "(no workspace)";
      return `${project.display_name} → ${ws}`;
    })
    .join("\n  ");
  const more = projects.length > 5 ? `\n  (+${projects.length - 5} more)` : "";
  return [
    `No project at ${resolvedPath}.`,
    "",
    "Known project workspaces:",
    `  ${known}${more}`,
    "",
    "Pass a project ref, or `cd` into a project workspace and run `cchistory ls`.",
  ].join("\n");
}

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
