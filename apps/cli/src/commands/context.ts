import type {
  ProjectIdentity,
  SessionProjection,
  SourceStatus,
  UserTurnProjection,
} from "@cchistory/domain";
import {
  getFlag,
  parseNumberFlag,
  type ParsedArgs,
} from "../args.js";
import {
  type CliIo,
  type CommandOutput,
  openReadStore,
} from "../main.js";
import { cyan, dim, magenta } from "../colors.js";
import { resolveProjectRef } from "../resolvers.js";
import {
  formatBrowseSnippet,
  formatCompactDate,
  formatCompactDateRelative,
  formatNumber,
  formatRelatedWorkRollup,
  mergeRelatedWorkRollups,
  renderKeyValue,
  renderSection,
  rollupRelatedWork,
  shortId,
  summarizeLabelCounts,
  truncatePathMiddle,
  truncateText,
  type RelatedWorkRollup,
} from "../renderers.js";

interface ContextAsk {
  id: string;
  prompt: string;
  submitted_at: string;
  session_id: string;
  session_title?: string;
  source_id: string;
  source_label: string;
  model?: string;
  assistant_replies: number;
  tool_calls: number;
  has_errors: boolean;
  inspect: {
    show_turn: string;
    show_session: string;
  };
}

interface ContextSession {
  id: string;
  title?: string;
  source_label: string;
  updated_at: string;
  asks: number;
  latest_prompt?: string;
  inspect: {
    show_session: string;
    tree_session: string;
  };
}

export async function handleContext(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  if (target !== "project" || !ref) {
    throw new Error("Use `context project <project-ref>`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    const project = resolveProjectRef(storage, ref);
    const limit = normalizeLimit(getFlag(parsed, "limit") ? parseNumberFlag(parsed, "limit") : undefined);
    const longListing = parsed.flags.has("long");
    const promptWidth = longListing ? 180 : 110;

    const sourcesById = new Map(storage.listSources().map((source) => [source.id, source]));
    const sessionsById = new Map(storage.listResolvedSessions().map((session) => [session.id, session]));
    const allProjectSessions = storage
      .listResolvedSessions()
      .filter((session) => session.primary_project_id === project.project_id)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const allProjectTurns = storage
      .listProjectTurns(project.project_id, "all")
      .sort((left, right) => right.submission_started_at.localeCompare(left.submission_started_at));

    const recentAsks = allProjectTurns
      .slice(0, limit)
      .map((turn) => buildContextAsk(turn, sessionsById.get(turn.session_id), sourcesById, promptWidth));
    const sessionThreads = buildContextSessions(allProjectSessions, allProjectTurns, sourcesById, Math.min(limit, 8), promptWidth);
    const relatedWork = allProjectSessions.reduce<RelatedWorkRollup>(
      (totals, session) => mergeRelatedWorkRollups(totals, rollupRelatedWork(storage.getSessionRelatedWork(session.id))),
      { delegated_sessions: 0, automation_runs: 0 },
    );
    const sourceMix = summarizeLabelCounts(
      allProjectSessions.map((session) => sourceLabel(sourcesById.get(session.source_id), session)),
      5,
    );
    const workspace = pickWorkspace(project, allProjectSessions);
    const projectRef = project.slug || project.project_id;
    const text = renderProjectContextText({
      project,
      projectRef,
      workspace,
      sourceMix,
      relatedWork,
      recentAsks,
      sessionThreads,
      totalTurns: allProjectTurns.length,
      totalSessions: allProjectSessions.length,
    });

    return {
      text,
      json: {
        kind: "project-context",
        db_path: layout.dbPath,
        project: {
          id: project.project_id,
          name: project.display_name,
          slug: project.slug,
          workspace,
          last_activity_at: project.project_last_activity_at ?? project.updated_at,
          asks: allProjectTurns.length,
          sessions: allProjectSessions.length,
          source_mix: sourceMix,
          related_work: relatedWork,
        },
        recent_asks: recentAsks,
        session_threads: sessionThreads,
        next: {
          inspect_project: `cchistory tree project ${projectRef} --long`,
          search_project: `cchistory search <query> --project ${projectRef}`,
        },
      },
    };
  } finally {
    await readStore.close();
  }
}

function renderProjectContextText(input: {
  project: ProjectIdentity;
  projectRef: string;
  workspace: string | undefined;
  sourceMix: string;
  relatedWork: RelatedWorkRollup;
  recentAsks: ContextAsk[];
  sessionThreads: ContextSession[];
  totalTurns: number;
  totalSessions: number;
}): string {
  const overview = renderKeyValue([
    ["Asks", formatNumber(input.totalTurns)],
    ["Sessions", formatNumber(input.totalSessions)],
    ["Sources", input.sourceMix],
    ["Last active", formatCompactDateRelative(input.project.project_last_activity_at ?? input.project.updated_at)],
    ["Workspace", input.workspace ? truncatePathMiddle(input.workspace, 80) : "unknown"],
    ["Related work", formatRelatedWorkRollup(input.relatedWork)],
  ]);

  return [
    renderSection(`Project Context: ${input.project.display_name}`, overview),
    "",
    renderSection("Recent Asks", renderRecentAsks(input.recentAsks)),
    "",
    renderSection("Session Threads", renderSessionThreads(input.sessionThreads)),
    "",
    renderSection(
      "Open Next",
      [
        `Inspect project: cchistory tree project ${input.projectRef} --long`,
        `Search project:  cchistory search <query> --project ${input.projectRef}`,
        input.recentAsks[0] ? `Latest ask:      ${input.recentAsks[0].inspect.show_turn}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    ),
  ].join("\n");
}

function renderRecentAsks(asks: ContextAsk[]): string {
  if (asks.length === 0) {
    return "No asks found for this project yet.";
  }
  return asks
    .map((ask, index) => {
      const details = [
        formatCompactDate(ask.submitted_at),
        ask.source_label,
        ask.model,
        ask.tool_calls > 0 ? `${ask.tool_calls} tools` : undefined,
        ask.has_errors ? "has errors" : undefined,
        `turn ${shortId(ask.id)}`,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" · ");
      return [
        `${cyan(String(index + 1).padStart(2, " "))}. ${ask.prompt}`,
        `    ${dim(details)}`,
      ].join("\n");
    })
    .join("\n");
}

function renderSessionThreads(sessions: ContextSession[]): string {
  if (sessions.length === 0) {
    return "No sessions found for this project yet.";
  }
  return sessions
    .map((session) => {
      const title = session.title ? truncateText(session.title, 64) : "(untitled session)";
      const details = [
        `${formatNumber(session.asks)} asks`,
        session.source_label,
        formatCompactDateRelative(session.updated_at),
        `session ${shortId(session.id)}`,
      ].join(" · ");
      return [
        `- ${magenta(title)}`,
        `  ${dim(details)}`,
        session.latest_prompt ? `  Latest: ${session.latest_prompt}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    })
    .join("\n");
}

function buildContextAsk(
  turn: UserTurnProjection,
  session: SessionProjection | undefined,
  sourcesById: Map<string, SourceStatus>,
  promptWidth: number,
): ContextAsk {
  const source = sourcesById.get(session?.source_id ?? turn.source_id);
  return {
    id: turn.id,
    prompt: formatBrowseSnippet(turn.canonical_text, promptWidth),
    submitted_at: turn.submission_started_at,
    session_id: turn.session_id,
    session_title: session?.title,
    source_id: turn.source_id,
    source_label: sourceLabel(source, session),
    model: turn.context_summary.primary_model,
    assistant_replies: turn.context_summary.assistant_reply_count,
    tool_calls: turn.context_summary.tool_call_count,
    has_errors: turn.context_summary.has_errors,
    inspect: {
      show_turn: `cchistory show turn ${turn.id}`,
      show_session: `cchistory show session ${session?.id ?? turn.session_id}`,
    },
  };
}

function buildContextSessions(
  sessions: SessionProjection[],
  turns: UserTurnProjection[],
  sourcesById: Map<string, SourceStatus>,
  limit: number,
  promptWidth: number,
): ContextSession[] {
  const turnsBySession = new Map<string, UserTurnProjection[]>();
  for (const turn of turns) {
    turnsBySession.set(turn.session_id, [...(turnsBySession.get(turn.session_id) ?? []), turn]);
  }

  return sessions.slice(0, limit).map((session) => {
    const sessionTurns = turnsBySession.get(session.id) ?? [];
    const latestTurn = sessionTurns[0];
    return {
      id: session.id,
      title: session.title,
      source_label: sourceLabel(sourcesById.get(session.source_id), session),
      updated_at: session.updated_at,
      asks: sessionTurns.length || session.turn_count,
      latest_prompt: latestTurn ? formatBrowseSnippet(latestTurn.canonical_text, promptWidth) : undefined,
      inspect: {
        show_session: `cchistory show session ${session.id}`,
        tree_session: `cchistory tree session ${session.id} --long`,
      },
    };
  });
}

function sourceLabel(source: SourceStatus | undefined, session: SessionProjection | undefined): string {
  return source?.display_name ?? session?.source_platform ?? "unknown source";
}

function pickWorkspace(project: ProjectIdentity, sessions: SessionProjection[]): string | undefined {
  if (project.primary_workspace_path) {
    return project.primary_workspace_path;
  }
  return sessions.find((session) => session.working_directory)?.working_directory;
}

function normalizeLimit(value: number | undefined): number {
  if (!value || value < 1) {
    return 12;
  }
  return Math.min(50, Math.floor(value));
}
