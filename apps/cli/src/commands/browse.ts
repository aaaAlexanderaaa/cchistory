import {
  type ProjectIdentity,
  type TurnSearchResult,
} from "@cchistory/domain";
import {
  getFlag,
  getFlagValues,
  hasFlag,
  parseNumberFlag,
  type ParsedArgs,
} from "../args.js";
import {
  formatBrowseSnippet,
  formatRelatedWorkEntry,
  formatRelatedWorkRollup,
  formatSearchResultContext,
  formatSearchResultPivots,
  formatSessionListModel,
  formatSessionListSource,
  formatSessionListTitle,
  formatSessionListWorkspace,
  formatTreeSourceLabel,
  indentBlock,
  listVisibleProjects,
  mergeRelatedWorkRollups,
  projectLabel,
  renderKeyValue,
  renderSection,
  renderTable,
  rollupRelatedWork,
  shortId,
  summarizeLabelCounts,
  truncateText,
  formatNumber,
  formatRatio,
  filterProjectsForDisplay,
  sortProjectsForDisplay,
  type RelatedWorkRollup,
} from "../renderers.js";
import {
  type CliIo,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import {
  resolveProjectRef,
  resolveSessionRef,
  resolveSourceRef,
  resolveTurnRef,
} from "../resolvers.js";
import { createSourcesListOutput } from "./sync.js";
import { bold, dim, cyan, magenta, muted } from "../colors.js";

export async function handleLs(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  if (!target || !["projects", "sessions", "sources"].includes(target)) {
    throw new Error("Use `ls projects`, `ls sessions`, or `ls sources`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(parsed);
    if (target === "projects") {
      const projects = listVisibleProjects(storage, parsed);
      const sessions = storage.listResolvedSessions();
      const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
      return {
        text: renderTable(
          longListing
            ? ["Name", "Status", "Hosts", "Sessions", "Turns", "Source Mix", "Related Work", "Last Activity"]
            : ["Name", "Status", "Hosts", "Sessions", "Turns", "Last Activity"],
          projects.map((project) => {
            if (!longListing) {
              return [
                `${project.display_name} (${project.slug})`,
                projectStatusLabel(project),
                String(project.host_ids.length),
                String(project.session_count),
                String(project.committed_turn_count + project.candidate_turn_count),
                project.project_last_activity_at ?? project.updated_at,
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
              `${project.display_name} (${project.slug})`,
              projectStatusLabel(project),
              String(project.host_ids.length),
              String(project.session_count),
              String(project.committed_turn_count + project.candidate_turn_count),
              sourceMix,
              formatRelatedWorkRollup(relatedWork),
              project.project_last_activity_at ?? project.updated_at,
            ];
          }),
        ),
        json: { kind: "projects", db_path: layout.dbPath, projects },
      };
    }

    if (target === "sessions") {
      const projectsById = new Map(storage.listProjects().map((project) => [project.project_id, project]));
      const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
      const sessions = storage.listResolvedSessions();
      return {
        text: renderTable(
          longListing
            ? ["Session", "Title", "Workspace", "Project", "Source", "Model", "Turns", "Related Work", "Updated"]
            : ["Session", "Title", "Workspace", "Project", "Source", "Host", "Model", "Updated"],
          sessions.map((session) => {
            if (!longListing) {
              return [
                session.id,
                session.title ?? "",
                session.working_directory ?? "",
                projectLabel(projectsById.get(session.primary_project_id ?? "")),
                session.source_id,
                shortId(session.host_id),
                session.model ?? "unknown",
                session.updated_at,
              ];
            }
            const relatedWork = rollupRelatedWork(storage.getSessionRelatedWork(session.id));
            return [
              session.id,
              formatSessionListTitle(session.title),
              formatSessionListWorkspace(session.working_directory),
              projectLabel(projectsById.get(session.primary_project_id ?? "")),
              formatSessionListSource(sourcesById.get(session.source_id), session),
              formatSessionListModel(session.model),
              String(session.turn_count),
              formatRelatedWorkRollup(relatedWork),
              session.updated_at,
            ];
          }),
        ),
        json: { kind: "sessions", db_path: layout.dbPath, sessions },
      };
    }

    return createSourcesListOutput(layout, storage);
  } finally {
    await readStore.close();
  }
}

export async function handleTree(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const longListing = wantsLongListing(parsed);
    const projects = storage.listProjects();
    const sessions = storage.listResolvedSessions();
    const turns = storage.listResolvedTurns();
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    if (target === "projects") {
      const visibleProjects = sortProjectsForDisplay(filterProjectsForDisplay(projects, parsed));
      const lines: string[] = [];
      for (const project of visibleProjects) {
        lines.push(
          `${project.display_name} [${projectStatusLabel(project)}] sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count}`,
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
      const lines: string[] = [
        `${project.display_name} [${projectStatusLabel(project)}]`,
        `hosts=${project.host_ids.join(", ") || "none"} sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count}`,
      ];

      for (const session of projectSessions) {
        const source = sourcesById.get(session.source_id);
        const relatedWork = rollupRelatedWork(storage.getSessionRelatedWork(session.id));
        lines.push(
          longListing
            ? `  ${session.id} (${formatTreeSourceLabel(source, session)}, ${shortId(session.host_id)}) turns=${session.turn_count} related=${formatRelatedWorkRollup(relatedWork)} updated=${session.updated_at}`
            : `  ${session.id} (${formatTreeSourceLabel(source, session)}, ${shortId(session.host_id)}) ${session.updated_at}`,
        );
        if (longListing) {
          lines.push(`    title=${session.title ?? "(untitled)"}`);
          lines.push(`    workspace=${session.working_directory ?? "unknown"}`);
        }
        for (const turn of turns.filter((entry) => entry.session_id === session.id).slice(0, 3)) {
          lines.push(`    - ${turn.submission_started_at} ${formatBrowseSnippet(turn.canonical_text, 80)}`);
        }
      }

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
        `Session ${session.id}`,
        `  title=${session.title ?? "(untitled)"}`,
        `  project=${projectLabel(projects.find((p) => p.project_id === session.primary_project_id))}`,
        `  source=${formatTreeSourceLabel(sourcesById.get(session.source_id), session)}`,
        `  workspace=${session.working_directory ?? "unknown"}`,
        `  model=${session.model ?? "unknown"} turns=${session.turn_count} related=${formatRelatedWorkRollup(relatedRollup)} updated=${session.updated_at}`,
      ];
      lines.push("  Turns");
      if (sessionTurns.length === 0) {
        lines.push("    (no turns)");
      } else {
        for (const turn of sessionTurns) {
          lines.push(`    - ${turn.submission_started_at} ${formatBrowseSnippet(turn.canonical_text, longListing ? 120 : 80)}`);
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

    throw new Error("Use `tree projects`, `tree project <project-id-or-slug>`, or `tree session <session-ref>`.");
  } finally {
    await readStore.close();
  }
}

export async function handleShow(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  if (!target || !ref) {
    throw new Error("Use `show project|session|turn|source <ref>`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    if (target === "project") {
      const project = resolveProjectRef(storage, ref);
      const turns = storage.listProjectTurns(project.project_id);
      const usage = storage.getUsageOverview({ project_id: project.project_id });
      return {
        text: [
          renderSection(
            project.display_name,
            renderKeyValue([
              ["Project ID", project.project_id],
              ["Slug", project.slug],
              ["Status", projectStatusLabel(project)],
              ["Hosts", project.host_ids.join(", ") || "none"],
              ["Sessions", String(project.session_count)],
              ["Turns", String(project.committed_turn_count + project.candidate_turn_count)],
              ["Last Activity", project.project_last_activity_at ?? project.updated_at],
              ["Total Tokens", formatNumber(usage.total_tokens)],
              ["Coverage", formatRatio(usage.turn_coverage_ratio)],
            ]),
          ),
          "",
          renderSection(
            "Recent Turns",
            turns.length === 0
              ? "(no turns)"
              : turns
                  .slice(0, 10)
                  .map((turn) => `${turn.submission_started_at} ${truncateText(turn.canonical_text, 96)}`)
                  .join("\n"),
          ),
        ].join("\n"),
        json: { kind: "project", db_path: layout.dbPath, project, turns, usage },
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
      return {
        text: [
          renderSection(
            `Session ${session.id}`,
            renderKeyValue([
              ["Title", session.title ?? "(untitled)"],
              ["Workspace", session.working_directory ?? "unknown"],
              ["Project", projectLabel(project)],
              ...(project ? [["Project ID", project.project_id] as [string, string]] : []),
              ["Source", source ? `${source.display_name} (${source.platform})` : session.source_id],
              ...(source ? [["Source ID", source.id] as [string, string]] : []),
              ["Host", session.host_id],
              ["Model", session.model ?? "unknown"],
              ["Turns", String(session.turn_count)],
              ["Updated", session.updated_at],
            ]),
          ),
          "",
          renderSection(
            "Turns",
            turns.length === 0
              ? "(no turns)"
              : turns
                  .map((turn) => `${turn.submission_started_at} ${truncateText(turn.canonical_text, 96)}`)
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
      const context = storage.getTurnContext(turn.id);
      const assistantReply = context?.assistant_replies?.[0];

      return {
        text: [
          renderSection(
            `Turn ${turn.id}`,
            renderKeyValue([
              ["Session ID", turn.session_id],
              ["Project", projectLabel(project)],
              ["Source", source ? `${source.display_name} (${source.platform})` : turn.source_id],
              ["Model", turn.context_summary.primary_model ?? "unknown"],
              ["Submitted", turn.submission_started_at],
              ["Tokens", `${formatNumber(turn.context_summary.total_tokens ?? 0)} (in=${formatNumber(turn.context_summary.token_usage?.input_tokens ?? 0)}, out=${formatNumber(turn.context_summary.token_usage?.output_tokens ?? 0)})`],
            ]),
          ),
          "",
          renderSection("Text", turn.canonical_text),
          ...(assistantReply ? ["", renderSection("Response", assistantReply.content)] : []),
          "",
          renderSection(
            "Context",
            renderKeyValue([
              ["Turn ID", turn.turn_id ?? "unknown"],
              ["Revision ID", turn.revision_id],
            ]),
          ),
        ].join("\n"),
        json: { kind: "turn", db_path: layout.dbPath, turn, session, project, context },
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
            ["Last Sync", source.last_sync ?? "never"],
            ["Status", source.sync_status],
          ]),
        ),
        json: { kind: "source", db_path: layout.dbPath, source },
      };
    }

    throw new Error("Use `show project|session|turn|source <ref>`.");
  } finally {
    await readStore.close();
  }
}

export async function handleSearch(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const query = parsed.positionals.join(" ").trim();
  if (!query) {
    throw new Error("Search requires a query string.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const projectRef = getFlag(parsed, "project");
    const sourceRefs = getFlagValues(parsed, "source");
    const limit = parseNumberFlag(parsed, "limit") ?? 20;
    const project = projectRef ? resolveProjectRef(storage, projectRef) : undefined;
    const sourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    const results = storage.searchTurns({
      query,
      project_id: project?.project_id,
      source_ids: sourceIds,
      limit,
    });
    const groups = groupSearchResults(results);
    const lines: string[] = [];
    for (const group of groups) {
      lines.push(bold(`${group.label} (${group.results.length})`));
      for (const result of group.results) {
        const relatedWork = result.session
          ? rollupRelatedWork(storage.getSessionRelatedWork(result.session.id))
          : { delegated_sessions: 0, automation_runs: 0 };
        lines.push(
          `  ${dim(result.turn.submission_started_at)} ${magenta(shortId(result.turn.id))} ${formatBrowseSnippet(result.turn.canonical_text, 92)}`,
        );
        lines.push(`    ${formatSearchResultContext(result, relatedWork, sourcesById)}`);
        lines.push(`    ${dim("pivots:")} ${formatSearchResultPivots(result)}`);
      }
    }
    if (lines.length > 0) {
      lines.push("");
      lines.push(muted("Use `cchistory show turn <shown-id>` to inspect a full turn."));
      lines.push(muted("Use `cchistory tree session <session-ref> --long` when you want nearby turns and related work together."));
    }
    return {
      text: lines.length > 0 ? lines.join("\n") : "(no matches)",
      json: { kind: "search", db_path: layout.dbPath, query, results },
    };
  } finally {
    await readStore.close();
  }
}

export function wantsLongListing(parsed: ParsedArgs): boolean {
  return hasFlag(parsed, "long");
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
    const label = result.project ? `${result.project.display_name} (${result.project.slug})` : "unassigned";
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, results: [] };
      groups.push(currentGroup);
    }
    currentGroup.results.push(result);
  }
  return groups;
}
