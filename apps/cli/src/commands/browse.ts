import {
  normalizeLocalPathIdentity,
  type ProjectIdentity,
  type SessionProjection,
  type SourceStatus,
  type TurnSearchResult,
  type UserTurnProjection,
} from "@cchistory/domain";
import {
  formatBrowseSnippet,
  formatCompactDate,
  formatCompactDateRelative,
  formatRelatedWorkEntry,
  formatRelatedWorkRollup,
  formatSearchResultContext,
  formatSearchResultPivots,
  pickSearchSnippet,
  formatSessionListModel,
  formatSessionListSource,
  formatSessionListTitle,
  formatSessionListWorkspace,
  formatTreeSourceLabel,
  listVisibleProjects,
  mergeRelatedWorkRollups,
  projectCommandRef,
  projectLabel,
  renderKeyValue,
  renderSection,
  renderTable,
  rollupRelatedWork,
  shortId,
  smartSessionId,
  summarizeLabelCounts,
  truncateText,
  formatNumber,
  formatRatio,
  filterProjectsForDisplay,
  sortProjectsForDisplay,
  colorizeStatus,
  clusterSearchResults,
  type RelatedWorkRollup,
} from "../renderers.js";
import { decodeCursor, encodeCursor } from "../pagination.js";
import {
  type CommandContext,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import { usageError } from "../errors.js";
import {
  classifyProjectToken,
  resolveProjectRef,
  resolveProjectScope,
  resolveSessionRef,
  resolveSourceRef,
  resolveTurnRef,
  scopeMain,
  type ProjectScope,
} from "../resolvers.js";
import { createSourcesListOutput } from "./sync.js";
import { bold, dim, cyan, magenta, muted } from "../colors.js";

const LS_KEYWORDS = new Set(["projects", "sessions", "sources"]);

export async function handleLs(context: CommandContext): Promise<CommandOutput> {
  // Resolve the positional: prefer `ls <child>` form, fall back to the first
  // positional, then default to `.` (cwd) for bare `cchistory ls`.
  const positional = context.commandPath[1] ?? context.positionals[0] ?? ".";
  const tokenKind = classifyProjectToken(positional, LS_KEYWORDS);

  if (tokenKind === "keyword") {
    return handleLsKeyword(context, positional);
  }
  return handleLsPath(context, positional);
}

async function handleLsKeyword(context: CommandContext, target: string): Promise<CommandOutput> {
  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(context);
    if (target === "projects") {
      const projects = listVisibleProjects(storage, context);
      const sessions = storage.listResolvedSessions();
      const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
      return {
        text: renderTable(
          longListing
            ? ["Name", "Ref", "Sessions", "Turns", "Source Mix", "Related Work", "Last Active"]
            : ["Name", "Ref", "Sessions", "Turns", "Last Active"],
          projects.map((project) => {
            if (!longListing) {
              return [
                cyan(project.display_name),
                projectCommandRef(project),
                String(project.session_count),
                String(project.committed_turn_count + project.candidate_turn_count),
                formatCompactDateRelative(project.project_last_activity_at ?? project.updated_at),
              ];
            }
            const projectSessions = sessions.filter((session) => session.primary_project_id === project.project_id);
            const sourceMix = summarizeLabelCounts(
              projectSessions.map((session) => sourcesById.get(session.source_id)?.slot_id ?? session.source_platform),
            );
            const relatedWork = projectSessions.reduce<RelatedWorkRollup>(
              (totals, session) => mergeRelatedWorkRollups(totals, rollupRelatedWork(storage.getSessionRelatedWork(session.id))),
              { delegated_sessions: 0, automation_runs: 0 },
            );
            return [
              cyan(project.display_name),
              projectCommandRef(project),
              String(project.session_count),
              String(project.committed_turn_count + project.candidate_turn_count),
              sourceMix,
              formatRelatedWorkRollup(relatedWork),
              formatCompactDateRelative(project.project_last_activity_at ?? project.updated_at),
            ];
          }),
          { align: longListing ? ["left", "left", "right", "right", "left", "left", "left"] : ["left", "left", "right", "right", "left"] },
        ),
        json: { kind: "projects", db_path: layout.dbPath, projects },
      };
    }

    if (target === "sessions") {
      const projectsById = new Map(storage.listProjects().map((project) => [project.project_id, project]));
      const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
      const allSessions = storage.listResolvedSessions();
      const defaultLimit = 30;
      const showAll = context.options.all;
      const limit = context.options.limit ?? (showAll ? allSessions.length : defaultLimit);
      const sessions = allSessions.slice(0, limit);
      const truncated = allSessions.length > sessions.length;
      const table = renderTable(
          longListing
            ? ["ID", "Title", "Project", "Source", "Model", "Turns", "Related Work", "Updated"]
            : ["ID", "Title", "Project", "Model", "Updated"],
          sessions.map((session) => {
            const project = projectsById.get(session.primary_project_id ?? "");
            if (!longListing) {
              return [
                magenta(smartSessionId(session.id)),
                truncateText(session.title ?? "", 30),
                cyan(truncateText(projectLabel(project), 18)),
                formatSessionListModel(session.model),
                formatCompactDateRelative(session.updated_at),
              ];
            }
            const relatedWork = rollupRelatedWork(storage.getSessionRelatedWork(session.id));
            return [
              magenta(smartSessionId(session.id)),
              formatSessionListTitle(session.title),
              cyan(projectLabel(project)),
              formatSessionListSource(sourcesById.get(session.source_id), session),
              formatSessionListModel(session.model),
              String(session.turn_count),
              formatRelatedWorkRollup(relatedWork),
              formatCompactDateRelative(session.updated_at),
            ];
          }),
          {
            align: longListing
              ? ["left", "left", "left", "left", "left", "right", "left", "left"]
              : ["left", "left", "left", "left", "left"],
          },
        );
      const footer = truncated
        ? `\n${dim(`Showing ${sessions.length} of ${allSessions.length} sessions. Use --all or --limit=N to see more.`)}`
        : "";
      return {
        text: table + footer,
        json: { kind: "sessions", db_path: layout.dbPath, sessions: allSessions },
      };
    }

    return createSourcesListOutput(layout, storage);
  } finally {
    await readStore.close();
  }
}

/**
 * Path-form `ls <path>` (or bare `ls`, which defaults to `.`).
 *
 * Renders main(s) + sub_projects. JSON uses the "option C" shape:
 * `projects[]` flat array (backward compatible) + `hierarchy` view +
 * `path_scope` / `resolved_path` so consumers can route on path scope.
 *
 * Multiple mains: when two or more projects share the same workspace path
 * (different sources, repeated imports), every main is rendered as a top
 * row and disambiguated with `(id=...)` so the operator can pick one for
 * follow-up `show project <id>` etc.
 */
async function handleLsPath(context: CommandContext, input: string): Promise<CommandOutput> {
  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(context);
    const scope = resolveProjectScope(storage, input, context.io.cwd);
    const sessions = storage.listResolvedSessions();
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));

    const allProjects = [...scope.mains, ...scope.sub_projects];
    const subIds = new Set(scope.sub_projects.map((project) => project.project_id));
    const ambiguous = scope.mains.length > 1;

    const mainRows = scope.mains.map((project) =>
      formatProjectLsRow(project, sessions, sourcesById, {
        long: longListing,
        isMain: true,
        ambiguous,
        scope,
      }),
    );
    const subRows = scope.sub_projects
      .slice()
      .sort((a, b) => relativeDepth(scope, a) - relativeDepth(scope, b))
      .map((project) =>
        formatProjectLsRow(project, sessions, sourcesById, { long: false, isMain: false, scope }),
      );

    const headerLines: string[] = [];
    if (scope.ancestor_note) {
      headerLines.push(muted(scope.ancestor_note));
    }
    if (ambiguous) {
      headerLines.push(
        muted(`${scope.mains.length} projects share workspace ${scope.resolved_path}; pass an id to disambiguate.`),
      );
    }
    if (scope.mains.length === 0 && scope.sub_projects.length > 0) {
      headerLines.push(
        muted(`No project at ${scope.resolved_path}; showing ${scope.sub_projects.length} descendant project${scope.sub_projects.length === 1 ? "" : "s"}.`),
      );
    }

    const bodyLines: string[] = [...mainRows, ...subRows];
    if (bodyLines.length === 0) {
      bodyLines.push(muted(`(no projects at or under ${scope.resolved_path})`));
    }

    const firstMain = scopeMain(scope);
    const hierarchy = {
      ...(firstMain ? { main: { project_id: firstMain.project_id, relative_path: "." } } : {}),
      ...(ambiguous
        ? { mains: scope.mains.map((project) => ({ project_id: project.project_id, relative_path: "." })) }
        : {}),
      sub_projects: scope.sub_projects.map((project) => ({
        project_id: project.project_id,
        relative_path: formatRelativePath(scope, project),
        depth: relativeDepth(scope, project),
      })),
    };

    return {
      text: [...headerLines, ...bodyLines].filter(Boolean).join("\n"),
      json: {
        kind: "projects",
        db_path: layout.dbPath,
        path_scope: scope.path_input,
        resolved_path: scope.resolved_path,
        ...(scope.ancestor_note ? { ancestor_note: scope.ancestor_note } : {}),
        projects: allProjects,
        hierarchy,
        ...(subIds.size > 0 ? { sub_project_ids: [...subIds] } : {}),
      },
    };
  } finally {
    await readStore.close();
  }
}

function formatProjectLsRow(
  project: ProjectIdentity,
  sessions: SessionProjection[],
  sourcesById: Map<string, SourceStatus>,
  options: {
    long: boolean;
    isMain: boolean;
    ambiguous?: boolean;
    scope?: ProjectScope;
  },
): string {
  const projectSessions = sessions.filter((session) => session.primary_project_id === project.project_id);
  const totalTurns = project.committed_turn_count + project.candidate_turn_count;
  const lastActive = formatCompactDateRelative(project.project_last_activity_at ?? project.updated_at);

  if (options.isMain) {
    const ref = projectCommandRef(project);
    const nameCol = cyan(project.display_name);
    const refCol = dim(`[${ref}]`);
    // When multiple mains share the workspace, append `(id=...)` so the
    // operator can copy-paste to disambiguate follow-up commands.
    const disambig = options.ambiguous ? ` ${dim(`(id=${shortId(project.project_id)})`)}` : "";
    const sourceMix = summarizeLabelCounts(
      projectSessions.map((session) => sourcesById.get(session.source_id)?.slot_id ?? session.source_platform),
    );
    if (options.long) {
      return `${nameCol}${disambig} ${refCol}  ${sourceMix}  ${project.session_count} sessions  ${totalTurns} turns  ${lastActive}`;
    }
    return `${nameCol}${disambig} ${refCol}  ${project.session_count} sessions  ${totalTurns} turns  ${lastActive}`;
  }

  const relativePath = options.scope ? formatRelativePath(options.scope, project) : project.display_name;
  return `  ${dim("↳")} ${cyan(relativePath)}  ${project.session_count} sessions  ${totalTurns} turns  ${lastActive}`;
}

function formatRelativePath(scope: ProjectScope, project: ProjectIdentity): string {
  const mainWorkspace = scopeMain(scope)?.primary_workspace_path ?? scope.resolved_path;
  const mainIdentity = normalizeLocalPathIdentity(mainWorkspace);
  const projectWorkspace = normalizeLocalPathIdentity(project.primary_workspace_path);
  if (!mainIdentity || !projectWorkspace) return project.display_name;
  if (!projectWorkspace.startsWith(`${mainIdentity}/`)) return project.display_name;
  const relative = projectWorkspace.slice(mainIdentity.length + 1);
  return `./${relative}`;
}

function relativeDepth(scope: ProjectScope, project: ProjectIdentity): number {
  const mainWorkspace = scopeMain(scope)?.primary_workspace_path ?? scope.resolved_path;
  const baseIdentity = normalizeLocalPathIdentity(mainWorkspace);
  const projectWorkspace = normalizeLocalPathIdentity(project.primary_workspace_path);
  if (!baseIdentity || !projectWorkspace) return 0;
  if (!projectWorkspace.startsWith(`${baseIdentity}/`)) return 0;
  return projectWorkspace.slice(baseIdentity.length + 1).split("/").filter(Boolean).length;
}

const TREE_KEYWORDS = new Set(["projects", "project", "session"]);

export async function handleTree(context: CommandContext): Promise<CommandOutput> {
  // Default to `.` (cwd) for bare `cchistory tree`. Keyword form keeps the
  // legacy `tree projects|project|session <ref>` dispatch.
  const target = context.commandPath[1] ?? context.positionals[0] ?? ".";
  const ref = context.commandPath[1] ? context.positionals[0] : context.positionals[1];
  const tokenKind = classifyProjectToken(target, TREE_KEYWORDS);
  if (tokenKind !== "keyword") {
    return handleTreePath(context, target);
  }
  validateTreeArity(context, target);

  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(context);
    const projects = storage.listProjects();
    const sessions = storage.listResolvedSessions();
    const turns = storage.listResolvedTurns();
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    if (target === "projects") {
      const visibleProjects = sortProjectsForDisplay(filterProjectsForDisplay(projects, context));
      const lines: string[] = [];
      for (const project of visibleProjects) {
        const lastActive = formatCompactDateRelative(project.project_last_activity_at ?? project.updated_at);
        lines.push(
          `${cyan(project.display_name)} ${dim(`[${projectStatusLabel(project)}]`)} sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count} ${dim(lastActive)}`,
        );
        const projectSessions = sessions.filter((entry) => entry.primary_project_id === project.project_id);
        if (longListing) {
          const sourceMix = summarizeLabelCounts(
            projectSessions.map((session) => sourcesById.get(session.source_id)?.slot_id ?? session.source_platform),
          );
          const relatedWork = projectSessions.reduce<RelatedWorkRollup>(
            (totals, session) => mergeRelatedWorkRollups(totals, rollupRelatedWork(storage.getSessionRelatedWork(session.id))),
            { delegated_sessions: 0, automation_runs: 0 },
          );
          lines.push(`  source_mix=${sourceMix} related=${formatRelatedWorkRollup(relatedWork)}`);
        }
        const grouped = new Map<string, { label: string; count: number }>();
        for (const session of projectSessions) {
          const source = sourcesById.get(session.source_id);
          const label = `${session.host_id} / ${source?.slot_id ?? session.source_id}`;
          const current = grouped.get(label) ?? { label, count: 0 };
          current.count += 1;
          grouped.set(label, current);
        }
        for (const group of [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label))) {
          lines.push(`  ${group.label}: ${group.count} session(s)`);
        }
      }

      const unassignedSessions = sessions.filter((session) => !session.primary_project_id);
      if (unassignedSessions.length > 0) {
        lines.push(`Unassigned sessions=${unassignedSessions.length}`);
      }

      return {
        text: lines.length > 0 ? lines.join("\n") : "(no projects)",
        json: {
          kind: "projects-tree",
          db_path: layout.dbPath,
          projects: visibleProjects,
          unassigned_sessions: unassignedSessions.length,
        },
      };
    }

    if (target === "project" && ref) {
      const project = resolveProjectRef(storage, ref);
      const projectSessions = sessions.filter((session) => session.primary_project_id === project.project_id);
      const projectTurns = storage.listProjectTurns(project.project_id, "all");
      const relatedWorkBySession = new Map(
        projectSessions.map((session) => [session.id, rollupRelatedWork(storage.getSessionRelatedWork(session.id))] as const),
      );
      const relatedWork = [...relatedWorkBySession.values()].reduce<RelatedWorkRollup>(
        (totals, rollup) => mergeRelatedWorkRollups(totals, rollup),
        { delegated_sessions: 0, automation_runs: 0 },
      );
      const overviewRows: Array<[string, string]> = [
        ["Status", colorizeStatus(projectStatusLabel(project))],
        ["Sessions", String(project.session_count)],
        ["Asks", String(project.committed_turn_count + project.candidate_turn_count)],
        ["Last Activity", formatCompactDate(project.project_last_activity_at ?? project.updated_at)],
      ];
      if (longListing) {
        const sourceMix = summarizeLabelCounts(
          projectSessions.map((session) => sourcesById.get(session.source_id)?.slot_id ?? session.source_platform),
        );
        overviewRows.push(
          ["Project ID", project.project_id],
          ["Slug", project.slug],
          ["Hosts", project.host_ids.join(", ") || "none"],
          ["Source Mix", sourceMix],
          ["Related Work", formatRelatedWorkRollup(relatedWork)],
        );
      }
      const lines: string[] = [
        renderSection(project.display_name, renderKeyValue(overviewRows)),
        "",
        renderSection("Session Threads", renderProjectSessionThreads(projectSessions, projectTurns, sourcesById, relatedWorkBySession, longListing)),
      ];

      return {
        text: lines.join("\n"),
        json: { kind: "project-tree", db_path: layout.dbPath, project, sessions: projectSessions },
      };
    }

    if (target === "session" && ref) {
      const session = resolveSessionRef(storage, ref);
      const sessionTurns = turns.filter((turn) => turn.session_id === session.id);
      const relatedWork = storage.getSessionRelatedWork(session.id);
      const relatedRollup = rollupRelatedWork(relatedWork);
      const lines: string[] = [
        longListing ? `Session ${magenta(session.id)}` : "Session",
        `  title=${session.title ?? "(untitled)"}`,
        `  project=${cyan(projectLabel(projects.find((p) => p.project_id === session.primary_project_id)))}`,
        `  source=${formatTreeSourceLabel(sourcesById.get(session.source_id), session)}`,
        `  workspace=${session.working_directory ?? "unknown"}`,
        `  model=${session.model ?? "unknown"} asks=${session.turn_count} related=${formatRelatedWorkRollup(relatedRollup)} updated=${formatCompactDate(session.updated_at)}`,
      ];
      if (longListing) {
        lines.push(`  host=${session.host_id}`);
      }
      lines.push("  Asks");
      if (sessionTurns.length === 0) {
        lines.push("    (no asks)");
      } else {
        for (const turn of sessionTurns) {
          lines.push(`    - ${dim(formatCompactDate(turn.submission_started_at))} ${formatBrowseSnippet(turn.canonical_text, longListing ? 120 : 80)}`);
        }
      }
      lines.push("  Related Work");
      if (relatedWork.length === 0) {
        lines.push("    (no related work)");
      } else {
        for (const entry of relatedWork) {
          lines.push(`    - ${formatRelatedWorkEntry(entry)}`);
        }
      }

      return {
        text: lines.join("\n"),
        json: { kind: "session-tree", db_path: layout.dbPath, session, turns: sessionTurns, related_work: relatedWork },
      };
    }

    throw usageError("Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`.");
  } finally {
    await readStore.close();
  }
}

/**
 * Path-form `tree <path>` (or bare `tree`). Resolves the project scope and
 * renders the main project's session threads (like `tree project <ref>`)
 * followed by a compact sub-project summary. Falls back to descendant-only
 * listing when no main project matches the path.
 */
async function handleTreePath(context: CommandContext, input: string): Promise<CommandOutput> {
  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(context);
    const scope = resolveProjectScope(storage, input, context.io.cwd);
    const sessions = storage.listResolvedSessions();
    const turns = storage.listResolvedTurns();
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));

    const headerLines: string[] = [];
    if (scope.ancestor_note) headerLines.push(muted(scope.ancestor_note));
    if (scope.mains.length > 1) {
      headerLines.push(
        muted(`${scope.mains.length} projects share workspace ${scope.resolved_path}; rendering each as a top block.`),
      );
    }

    const bodyLines: string[] = [];
    const mainPayload: ProjectIdentity[] = [];
    const subPayload: ProjectIdentity[] = [];

    for (const project of scope.mains) {
      mainPayload.push(project);
      const projectSessions = sessions.filter((session) => session.primary_project_id === project.project_id);
      const projectTurns = storage.listProjectTurns(project.project_id, "all");
      const relatedWorkBySession = new Map(
        projectSessions.map((session) => [session.id, rollupRelatedWork(storage.getSessionRelatedWork(session.id))] as const),
      );
      const relatedWork = [...relatedWorkBySession.values()].reduce<RelatedWorkRollup>(
        (totals, rollup) => mergeRelatedWorkRollups(totals, rollup),
        { delegated_sessions: 0, automation_runs: 0 },
      );
      const titleSuffix = scope.mains.length > 1 ? ` ${dim(`(id=${shortId(project.project_id)})`)}` : "";
      const overviewRows: Array<[string, string]> = [
        ["Ref", projectCommandRef(project)],
        ["Sessions", String(project.session_count)],
        ["Asks", String(project.committed_turn_count + project.candidate_turn_count)],
        ["Last Activity", formatCompactDate(project.project_last_activity_at ?? project.updated_at)],
      ];
      if (longListing) {
        const sourceMix = summarizeLabelCounts(
          projectSessions.map((session) => sourcesById.get(session.source_id)?.slot_id ?? session.source_platform),
        );
        overviewRows.push(
          ["Project ID", project.project_id],
          ["Slug", project.slug],
          ["Source Mix", sourceMix],
          ["Related Work", formatRelatedWorkRollup(relatedWork)],
        );
      }
      bodyLines.push(
        renderSection(`${project.display_name}${titleSuffix}`, renderKeyValue(overviewRows)),
        "",
        renderSection(
          "Session Threads",
          renderProjectSessionThreads(projectSessions, projectTurns, sourcesById, relatedWorkBySession, longListing),
        ),
      );
    }

    if (scope.sub_projects.length > 0) {
      bodyLines.push("");
      bodyLines.push(renderSection("Sub-Projects", ""));
      for (const sub of scope.sub_projects) {
        subPayload.push(sub);
        const totalTurns = sub.committed_turn_count + sub.candidate_turn_count;
        const lastActive = formatCompactDateRelative(sub.project_last_activity_at ?? sub.updated_at);
        const rel = formatRelativePath(scope, sub);
        bodyLines.push(`  ${dim("↳")} ${cyan(rel)} ${dim(`[${projectCommandRef(sub)}]`)} sessions=${sub.session_count} turns=${totalTurns} ${dim(lastActive)}`);
      }
      bodyLines.push(muted("Drill into a sub-project via `tree <sub-path>`."));
    }

    if (bodyLines.length === 0) {
      bodyLines.push(muted(`(no projects at or under ${scope.resolved_path})`));
    }

    return {
      text: [...headerLines, ...bodyLines].filter(Boolean).join("\n"),
      json: {
        kind: "tree-scope",
        db_path: layout.dbPath,
        path_scope: scope.path_input,
        resolved_path: scope.resolved_path,
        ...(scope.ancestor_note ? { ancestor_note: scope.ancestor_note } : {}),
        ...(mainPayload.length > 0 ? { mains: mainPayload, main: mainPayload[0] } : {}),
        sub_projects: subPayload,
        sessions,
        turns_count: turns.length,
      },
    };
  } finally {
    await readStore.close();
  }
}

function validateTreeArity(context: CommandContext, target: string | undefined): void {
  const expectedPositionals =
    target === "projects" ? (context.commandPath[1] ? 0 : 1) :
    target === "project" || target === "session" ? (context.commandPath[1] ? 1 : 2) :
    -1;
  if (expectedPositionals < 0 || context.positionals.length !== expectedPositionals) {
    throw usageError("Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`.");
  }
}

const SHOW_KEYWORDS = new Set(["project", "session", "turn", "source"]);

export async function handleShow(context: CommandContext): Promise<CommandOutput> {
  // `show <path>` is shorthand for `show project <path>` — the project kind
  // is implied whenever the first positional looks like a filesystem path.
  const rawTarget = context.commandPath[1] ?? context.positionals[0];
  const tokenKind = rawTarget ? classifyProjectToken(rawTarget, SHOW_KEYWORDS) : "ref";
  let target: string;
  let ref: string | undefined;
  if (tokenKind === "keyword") {
    target = rawTarget!;
    ref = context.commandPath[1] ? context.positionals[0] : context.positionals[1];
  } else {
    // Path-form or ref-form positional → treat as project ref.
    target = "project";
    ref = rawTarget;
  }
  if (!target || !ref) {
    throw usageError("Use `show project|session|turn|source <ref>` or `show <path>`.");
  }
  validateShowArityForTarget(context, target, tokenKind);

  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    if (target === "project") {
      // Path-form input: resolve via scope so we can surface sub_projects in
      // the JSON. Ref-form input: keep using the legacy single-project resolver.
      const scope = (tokenKind === "path")
        ? resolveProjectScope(storage, ref, context.io.cwd)
        : undefined;
      const project = scope ? scopeMain(scope) ?? resolveProjectRef(storage, ref) : resolveProjectRef(storage, ref);
      const turns = storage.listProjectTurns(project.project_id);
      const usage = storage.getUsageOverview({ project_id: project.project_id });
      const longListing = wantsLongListing(context);
      const overviewRows: Array<[string, string]> = [
        ["Status", colorizeStatus(projectStatusLabel(project))],
        ["Sessions", String(project.session_count)],
        ["Asks", String(project.committed_turn_count + project.candidate_turn_count)],
        ["Last Activity", formatCompactDate(project.project_last_activity_at ?? project.updated_at)],
        ["Input Tokens", formatNumber(usage.total_input_tokens)],
        ["Cached Input Tokens", formatNumber(usage.total_cached_input_tokens)],
        ["Output Tokens", formatNumber(usage.total_output_tokens)],
        ["Reasoning Tokens", formatNumber(usage.total_reasoning_output_tokens)],
        ["Total Tokens", formatNumber(usage.total_tokens)],
        ["Coverage", formatRatio(usage.turn_coverage_ratio)],
      ];
      if (longListing) {
        overviewRows.push(
          ["Project ID", project.project_id],
          ["Slug", project.slug],
          ["Hosts", project.host_ids.join(", ") || "none"],
        );
      }
      return {
        text: [
          renderSection(
            project.display_name,
            renderKeyValue(overviewRows),
          ),
          "",
          renderSection(
            "Recent Asks",
            turns.length === 0
              ? "(no asks)"
              : turns
                  .slice(0, 10)
                  .map((turn) => `${dim(formatCompactDate(turn.submission_started_at))} ${formatBrowseSnippet(turn.canonical_text, 96)}`)
                  .join("\n"),
          ),
        ].join("\n"),
        json: {
          kind: "project",
          db_path: layout.dbPath,
          project,
          turns,
          usage,
          ...(scope ? {
            path_scope: scope.path_input,
            resolved_path: scope.resolved_path,
            ...(scope.ancestor_note ? { ancestor_note: scope.ancestor_note } : {}),
            sub_projects: scope.sub_projects,
          } : {}),
        },
      };
    }

    if (target === "session") {
      const session = resolveSessionRef(storage, ref);
      const turns = storage.listResolvedTurns().filter((turn) => turn.session_id === session.id);
      const relatedWork = storage.getSessionRelatedWork(session.id);
      const project = session.primary_project_id
        ? storage.listProjects().find((entry) => entry.project_id === session.primary_project_id)
        : undefined;
      const source = storage.listSources().find((entry) => entry.id === session.source_id);
      const longListing = wantsLongListing(context);
      const sessionRows: Array<[string, string]> = [
        ["Title", session.title ?? "(untitled)"],
        ["Workspace", session.working_directory ?? "unknown"],
        ...(session.resume_command ? [["Resume Command", session.resume_command] as [string, string]] : []),
        ["Project", projectLabel(project)],
        ["Source", source ? source.display_name : session.source_platform],
        ["Model", session.model ?? "unknown"],
        ["Asks", String(session.turn_count)],
        ["Updated", formatCompactDate(session.updated_at)],
      ];
      if (longListing) {
        sessionRows.push(
          ["Session ID", session.id],
          ...(session.source_session_id ? [["Source Session ID", session.source_session_id] as [string, string]] : []),
          ...(session.resume_working_directory ? [["Resume CWD", session.resume_working_directory] as [string, string]] : []),
          ...(project ? [["Project ID", project.project_id] as [string, string]] : []),
          ["Source Platform", session.source_platform],
          ...(source ? [["Source ID", source.id] as [string, string]] : []),
          ["Host", session.host_id],
        );
      }
      return {
        text: [
          renderSection(
            longListing ? `Session ${session.id}` : "Session",
            renderKeyValue(sessionRows),
          ),
          "",
          renderSection(
            "Asks",
            turns.length === 0
              ? "(no asks)"
              : turns
                  .map((turn) => `${dim(formatCompactDate(turn.submission_started_at))} ${truncateText(turn.canonical_text, 96)}`)
                  .join("\n"),
          ),
          "",
          renderSection(
            "Related Work",
            relatedWork.length === 0 ? "(no related work)" : relatedWork.map((entry) => formatRelatedWorkEntry(entry)).join("\n"),
          ),
        ].join("\n"),
        json: { kind: "session", db_path: layout.dbPath, session, turns, related_work: relatedWork },
      };
    }

    if (target === "turn") {
      const turn = resolveTurnRef(storage, ref);
      const session = storage.listResolvedSessions().find((entry) => entry.id === turn.session_id);
      const project = session?.primary_project_id
        ? storage.listProjects().find((entry) => entry.project_id === session.primary_project_id)
        : undefined;
      const source = storage.listSources().find((entry) => entry.id === turn.source_id);
      const turnContext = storage.getTurnContext(turn.id);
      const assistantReply = turnContext?.assistant_replies?.[0];
      const longListing = wantsLongListing(context);

      const tokenUsage = turn.context_summary.token_usage;
      const cachedInput = tokenUsage?.cached_input_tokens
        ?? ((tokenUsage?.cache_read_input_tokens ?? 0) + (tokenUsage?.cache_creation_input_tokens ?? 0));

      const overviewRows: Array<[string, string]> = [
        ["Project", projectLabel(project)],
        ["Source", source ? `${source.display_name} (${source.platform})` : turn.source_id],
        ["Model", turn.context_summary.primary_model ?? "unknown"],
        ["Submitted", formatCompactDate(turn.submission_started_at)],
        ["Tokens", `${formatNumber(turn.context_summary.total_tokens ?? 0)} (in=${formatNumber(tokenUsage?.input_tokens ?? 0)}, cached=${formatNumber(cachedInput)}, out=${formatNumber(tokenUsage?.output_tokens ?? 0)})`],
      ];
      if (session?.resume_command) {
        overviewRows.push(["Resume Command", session.resume_command]);
      }
      if (longListing) {
        overviewRows.push(["Session ID", turn.session_id]);
        if (session?.source_session_id) {
          overviewRows.push(["Source Session ID", session.source_session_id]);
        }
      }
      const traceability = longListing
        ? [
            "",
            renderSection(
              "Traceability",
              renderKeyValue([
                ["Turn ID", turn.turn_id],
                ["Revision ID", turn.revision_id],
                ["Context Ref", turn.context_ref],
              ]),
            ),
          ]
        : [];

      return {
        text: [
          renderSection(
            longListing ? `Ask ${turn.id}` : "Ask",
            renderKeyValue(overviewRows),
          ),
          "",
          renderSection("Prompt", formatTurnPromptForDisplay(turn, longListing)),
          ...(assistantReply ? ["", renderSection("Response", formatTurnResponseForDisplay(assistantReply.content, longListing))] : []),
          ...traceability,
        ].join("\n"),
        json: { kind: "turn", db_path: layout.dbPath, turn, session, project, context: turnContext },
      };
    }

    if (target === "source") {
      const source = resolveSourceRef(storage, ref);
      return {
        text: renderSection(
          `${source.display_name} (${source.platform})`,
          renderKeyValue([
            ["Source ID", source.id],
            ["Slot", source.slot_id],
            ["Host", source.host_id],
            ["Sessions", String(source.total_sessions)],
            ["Turns", String(source.total_turns)],
            ["Last Sync", source.last_sync ? formatCompactDate(source.last_sync) : "never"],
            ["Status", colorizeStatus(source.sync_status)],
          ]),
        ),
        json: { kind: "source", db_path: layout.dbPath, source },
      };
    }

    throw usageError("Use `show project|session|turn|source <ref>`.");
  } finally {
    await readStore.close();
  }
}

function validateShowArityForTarget(
  context: CommandContext,
  target: string,
  tokenKind: "keyword" | "path" | "ref",
): void {
  const validTarget = target === "project" || target === "session" || target === "turn" || target === "source";
  if (!validTarget) {
    throw usageError("Use `show project|session|turn|source <ref>` or `show <path>`.");
  }
  // Keyword form: 1 positional when invoked as `show project <ref>` (commandPath
  // has the kind), 2 positionals when invoked as `show <kind> <ref>`.
  // Path/ref form: 1 positional (just the path/ref; kind defaults to project).
  const expectedPositionals = tokenKind === "keyword" ? (context.commandPath[1] ? 1 : 2) : 1;
  if (context.positionals.length !== expectedPositionals) {
    throw usageError("Use `show project|session|turn|source <ref>` or `show <path>`.");
  }
}

export async function handleSearch(context: CommandContext): Promise<CommandOutput> {
  const query = context.positionals.join(" ").trim();
  if (!query) {
    throw usageError("Search requires a query string.");
  }
  // Cursor takes precedence over --offset for resuming a previous query. The
  // cursor encodes only the offset today; keeping it opaque lets us add
  // filter-state hashing later without breaking the wire format.
  //
  // Check the conflict before decoding so a malformed cursor paired with
  // --offset still surfaces the actionable "choose one" message.
  if (context.options.cursor && context.options.offset !== undefined) {
    throw usageError("Choose either --cursor or --offset, not both.");
  }
  const cursorOffset = decodeCursor(context.options.cursor);

  const readStore = await openReadStore(context);
  try {
    const { layout, storage } = readStore;
    const projectRef = context.options.project;
    const sourceRefs = context.options.source;
    const wantAll = context.options.all;
    const limit = wantAll ? 1000 : (context.options.limit ?? 50);
    const offset = cursorOffset ?? context.options.offset ?? 0;
    const project = projectRef ? resolveProjectRef(storage, projectRef) : undefined;
    const sourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    const { results, total: totalMatches } = storage.searchTurnsPaginated({
      query,
      project_id: project?.project_id,
      source_ids: sourceIds,
      limit,
      offset,
    });
    const longListing = wantsLongListing(context);
    const snippetMaxLength = longListing ? 120 : 76;
    const groups = groupSearchResults(results);
    const lines: string[] = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!;
      if (gi > 0) lines.push("");
      lines.push(bold(`${group.label}`) + dim(` (${group.results.length})`));

      const clusterItems = clusterSearchResults(group.results, snippetMaxLength);
      for (const item of clusterItems) {
        if (item.clustered) {
          // Render cluster summary
          const count = item.results.length;
          lines.push(
            `  ${dim(`${count}×`)} ${truncateText(item.snippet, snippetMaxLength)} ${dim(`(${item.dateRange})`)}`,
          );
          // Collect unique context labels for the cluster
          const models = new Set<string>();
          const sourceLabels = new Set<string>();
          const turnIds: string[] = [];
          for (const r of item.results) {
            const m = r.turn.context_summary.primary_model;
            if (m) models.add(m);
            const src = r.session?.source_id ? sourcesById.get(r.session.source_id) : undefined;
            sourceLabels.add(src ? src.display_name : r.session?.source_platform ?? "unknown");
            turnIds.push(shortId(r.turn.id));
          }
          const contextParts = [...sourceLabels];
          if (models.size > 0) contextParts.push(...models);
          lines.push(`    ${dim(contextParts.join(" · "))}`);
          const maxShowIds = 4;
          const shownIds = turnIds.slice(0, maxShowIds).map((tid) => magenta(tid)).join(dim(" | "));
          const idSuffix = turnIds.length > maxShowIds ? dim(` +${turnIds.length - maxShowIds} more`) : "";
          lines.push(`    ${dim("show turn")} ${shownIds}${idSuffix}`);
        } else {
          const result = item.result;
          const relatedWork = result.session
            ? rollupRelatedWork(storage.getSessionRelatedWork(result.session.id))
            : { delegated_sessions: 0, automation_runs: 0 };
          const snippet = truncateText(pickSearchSnippet(result.turn), snippetMaxLength);
          lines.push(
            `  ${dim(formatCompactDate(result.turn.submission_started_at))} ${magenta(shortId(result.turn.id))} ${snippet}`,
          );
          lines.push(`    ${formatSearchResultContext(result, relatedWork, sourcesById, { long: longListing })}`);
          if (longListing) {
            lines.push(`    ${formatSearchResultPivots(result, { long: true })}`);
          }
        }
      }
    }
    if (lines.length > 0) {
      lines.push("");
      const pageStart = offset + 1;
      const pageEnd = offset + results.length;
      if (totalMatches > results.length || offset > 0) {
        const paginationParts = [`Showing ${pageStart}-${pageEnd} of ${totalMatches} results.`];
        if (pageEnd < totalMatches) {
          const nextCursor = encodeCursor(pageEnd);
          paginationParts.push(`Use ${dim(`--cursor ${nextCursor}`)} for next page.`);
        }
        lines.push(muted(paginationParts.join(" ")));
      } else {
        lines.push(muted(`${totalMatches} result${totalMatches === 1 ? "" : "s"}. Use ${dim("show turn <id>")} to inspect, ${dim("--long")} for full detail.`));
      }
    }
    const nextCursor = offset + results.length < totalMatches ? encodeCursor(offset + results.length) : null;
    return {
      text: lines.length > 0 ? lines.join("\n") : "(no matches)",
      json: { kind: "search", db_path: layout.dbPath, query, results, total: totalMatches, offset, next_cursor: nextCursor },
    };
  } finally {
    await readStore.close();
  }
}

export function wantsLongListing(context: CommandContext): boolean {
  return context.globals.long;
}

export function projectStatusLabel(project: ProjectIdentity): string {
  if (project.session_count === 0 && project.committed_turn_count === 0) {
    return "empty";
  }
  return "active";
}

export function groupSearchResults(results: TurnSearchResult[]): Array<{ label: string; results: TurnSearchResult[] }> {
  const groups: Array<{ label: string; results: TurnSearchResult[] }> = [];
  let currentGroup: { label: string; results: TurnSearchResult[] } | undefined;
  for (const result of results) {
    const label = result.project ? result.project.display_name : "unassigned";
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, results: [] };
      groups.push(currentGroup);
    }
    currentGroup.results.push(result);
  }
  return groups;
}

function renderProjectSessionThreads(
  projectSessions: SessionProjection[],
  projectTurns: UserTurnProjection[],
  sourcesById: Map<string, SourceStatus>,
  relatedWorkBySession: Map<string, RelatedWorkRollup>,
  longListing: boolean,
): string {
  if (projectSessions.length === 0) {
    return "(no sessions)";
  }
  const turnsBySession = new Map<string, UserTurnProjection[]>();
  for (const turn of projectTurns) {
    const entries = turnsBySession.get(turn.session_id) ?? [];
    entries.push(turn);
    turnsBySession.set(turn.session_id, entries);
  }
  for (const sessionTurns of turnsBySession.values()) {
    sessionTurns.sort((left, right) => right.submission_started_at.localeCompare(left.submission_started_at));
  }

  const lines: string[] = [];
  const orderedSessions = [...projectSessions].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  for (const session of orderedSessions) {
    const sessionTurns = turnsBySession.get(session.id) ?? [];
    const title = formatSessionThreadTitle(session, sessionTurns);
    const askCount = sessionTurns.length || session.turn_count;
    lines.push(`- ${cyan(title)} ${dim(`· ${askCount} ask${askCount === 1 ? "" : "s"} · ${formatCompactDate(session.updated_at)}`)}`);
    if (longListing) {
      const source = sourcesById.get(session.source_id);
      const relatedWork = formatRelatedWorkRollup(relatedWorkBySession.get(session.id) ?? { delegated_sessions: 0, automation_runs: 0 });
      lines.push(`  session_id=${session.id}`);
      lines.push(`  source=${formatTreeSourceLabel(source, session)} host=${shortId(session.host_id)} workspace=${formatSessionListWorkspace(session.working_directory) || "unknown"} related=${relatedWork}`);
    }
    if (sessionTurns.length === 0) {
      lines.push("  (no asks)");
      continue;
    }
    for (const turn of sessionTurns.slice(0, longListing ? 5 : 3)) {
      lines.push(`  ${dim(formatCompactDate(turn.submission_started_at))} ${formatBrowseSnippet(turn.canonical_text, longListing ? 120 : 88)}`);
    }
  }
  return lines.join("\n");
}

function formatSessionThreadTitle(session: SessionProjection, turns: UserTurnProjection[]): string {
  const title = session.title?.trim();
  if (title) {
    return formatSessionListTitle(title);
  }
  const latest = turns[0]?.canonical_text;
  if (latest) {
    return formatBrowseSnippet(latest, 56);
  }
  return formatSessionListWorkspace(session.working_directory) || "Untitled session";
}

function formatTurnPromptForDisplay(turn: TurnSearchResult["turn"], longListing: boolean): string {
  return formatPreviewBlock(longListing ? turn.canonical_text : pickSearchSnippet(turn), {
    long: longListing,
    maxChars: 1600,
  });
}

function formatTurnResponseForDisplay(content: string, longListing: boolean): string {
  return formatPreviewBlock(content, {
    long: longListing,
    maxChars: 2400,
  });
}

function formatPreviewBlock(value: string | null | undefined, options: { long: boolean; maxChars: number }): string {
  const text = (value ?? "").trim();
  if (text.length === 0) {
    return "(empty)";
  }
  if (options.long || text.length <= options.maxChars) {
    return text;
  }
  const omitted = text.length - options.maxChars;
  return [
    text.slice(0, options.maxChars).trimEnd(),
    dim(`... (${omitted} more chars, use --long for complete text)`),
  ].join("\n");
}
