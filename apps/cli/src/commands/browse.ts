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
  indentBlock,
  listVisibleProjects,
  mergeRelatedWorkRollups,
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
  type ClusterOrResult,
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
            ? ["Name", "Sessions", "Turns", "Source Mix", "Related Work", "Last Active"]
            : ["Name", "Sessions", "Turns", "Last Active"],
          projects.map((project) => {
            if (!longListing) {
              return [
                cyan(project.display_name),
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
              String(project.session_count),
              String(project.committed_turn_count + project.candidate_turn_count),
              sourceMix,
              formatRelatedWorkRollup(relatedWork),
              formatCompactDateRelative(project.project_last_activity_at ?? project.updated_at),
            ];
          }),
          { align: longListing ? ["left", "right", "right", "left", "left", "left"] : ["left", "right", "right", "left"] },
        ),
        json: { kind: "projects", db_path: layout.dbPath, projects },
      };
    }

    if (target === "sessions") {
      const projectsById = new Map(storage.listProjects().map((project) => [project.project_id, project]));
      const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
      const allSessions = storage.listResolvedSessions();
      const defaultLimit = 30;
      const showAll = hasFlag(parsed, "all");
      const limit = parseNumberFlag(parsed, "limit") ?? (showAll ? allSessions.length : defaultLimit);
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
      const lines: string[] = [
        `${cyan(project.display_name)} [${projectStatusLabel(project)}]`,
        `hosts=${project.host_ids.join(", ") || "none"} sessions=${project.session_count} turns=${project.committed_turn_count + project.candidate_turn_count}`,
      ];

      for (const session of projectSessions) {
        const source = sourcesById.get(session.source_id);
        const relatedWork = rollupRelatedWork(storage.getSessionRelatedWork(session.id));
        lines.push(
          longListing
            ? `  ${magenta(shortId(session.id, 8))} (${formatTreeSourceLabel(source, session)}, ${shortId(session.host_id)}) turns=${session.turn_count} related=${formatRelatedWorkRollup(relatedWork)} updated=${formatCompactDate(session.updated_at)}`
            : `  ${magenta(shortId(session.id, 8))} (${formatTreeSourceLabel(source, session)}, ${shortId(session.host_id)}) ${formatCompactDate(session.updated_at)}`,
        );
        if (longListing) {
          lines.push(`    title=${session.title ?? "(untitled)"}`);
          lines.push(`    workspace=${session.working_directory ?? "unknown"}`);
        }
        for (const turn of turns.filter((entry) => entry.session_id === session.id).slice(0, 3)) {
          lines.push(`    - ${dim(formatCompactDate(turn.submission_started_at))} ${formatBrowseSnippet(turn.canonical_text, 80)}`);
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
        `Session ${magenta(session.id)}`,
        `  title=${session.title ?? "(untitled)"}`,
        `  project=${cyan(projectLabel(projects.find((p) => p.project_id === session.primary_project_id)))}`,
        `  source=${formatTreeSourceLabel(sourcesById.get(session.source_id), session)}`,
        `  workspace=${session.working_directory ?? "unknown"}`,
        `  model=${session.model ?? "unknown"} turns=${session.turn_count} related=${formatRelatedWorkRollup(relatedRollup)} updated=${formatCompactDate(session.updated_at)}`,
      ];
      lines.push("  Turns");
      if (sessionTurns.length === 0) {
        lines.push("    (no turns)");
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
              ["Status", colorizeStatus(projectStatusLabel(project))],
              ["Hosts", project.host_ids.join(", ") || "none"],
              ["Sessions", String(project.session_count)],
              ["Turns", String(project.committed_turn_count + project.candidate_turn_count)],
              ["Last Activity", formatCompactDate(project.project_last_activity_at ?? project.updated_at)],
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
                  .map((turn) => `${dim(formatCompactDate(turn.submission_started_at))} ${truncateText(turn.canonical_text, 96)}`)
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
              ["Updated", formatCompactDate(session.updated_at)],
            ]),
          ),
          "",
          renderSection(
            "Turns",
            turns.length === 0
              ? "(no turns)"
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
              ["Submitted", formatCompactDate(turn.submission_started_at)],
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
              ["Turn ID", turn.turn_id],
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
            ["Last Sync", source.last_sync ? formatCompactDate(source.last_sync) : "never"],
            ["Status", colorizeStatus(source.sync_status)],
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
    const wantAll = hasFlag(parsed, "all");
    const limit = wantAll ? 1000 : (parseNumberFlag(parsed, "limit") ?? 50);
    const offset = parseNumberFlag(parsed, "offset") ?? 0;
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
    const longListing = wantsLongListing(parsed);
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
          paginationParts.push(`Use ${dim(`--offset ${pageEnd}`)} for next page.`);
        }
        lines.push(muted(paginationParts.join(" ")));
      } else {
        lines.push(muted(`${totalMatches} result${totalMatches === 1 ? "" : "s"}. Use ${dim("show turn <id>")} to inspect, ${dim("--long")} for full detail.`));
      }
    }
    return {
      text: lines.length > 0 ? lines.join("\n") : "(no matches)",
      json: { kind: "search", db_path: layout.dbPath, query, results, total: totalMatches, offset },
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
    const label = result.project ? result.project.display_name : "unassigned";
    if (!currentGroup || currentGroup.label !== label) {
      currentGroup = { label, results: [] };
      groups.push(currentGroup);
    }
    currentGroup.results.push(result);
  }
  return groups;
}
