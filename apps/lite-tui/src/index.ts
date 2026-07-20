#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import type {
  ProjectIdentity,
  SessionProjection,
  SourceStatus,
  UsageStatsDimension,
  UserTurnProjection,
} from "@cchistory/domain";
import {
  scanLiteHistory,
  type LiteSourceRoot,
  type LiveHistorySnapshot,
  type ScanLiteHistoryOptions,
} from "@cchistory/live-runtime";

const VERSION = "0.3.0";
const PROJECT_PAGE_SIZE = 50;
const SESSION_PAGE_SIZE = 100;
const TURN_PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 50;

export interface LiteTuiIo {
  cwd: string;
  homeDir?: string;
  hostname?: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isInteractiveTerminal: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  readLine?: (prompt: string) => Promise<string | undefined>;
  scan?: (options: ScanLiteHistoryOptions) => Promise<LiveHistorySnapshot>;
}

interface ParsedArgs {
  sourceRoots: LiteSourceRoot[];
  sourceRefs: string[];
  safeMode: boolean;
  limitFiles?: number;
  help: boolean;
}

class TuiUsageError extends Error {}

type PagedView =
  | { kind: "projects"; pageIndex: number }
  | { kind: "sessions"; pageIndex: number }
  | { kind: "turns"; pageIndex: number }
  | { kind: "search"; query: string; pageIndex: number }
  | { kind: "project"; projectId: string; pageIndex: number }
  | { kind: "session"; sessionId: string; pageIndex: number }
  | { kind: "source"; sourceId: string; pageIndex: number };

interface PagingState {
  current?: {
    view: PagedView;
    pageCount: number;
  };
}

interface PagedRender {
  output: string;
  pageCount: number;
}

export async function runLiteTui(argv: string[], io: LiteTuiIo = defaultIo()): Promise<number> {
  try {
    const parsed = parseArgs(argv, io.cwd);
    if (parsed.help) {
      io.stdout(renderHelp());
      return 0;
    }

    const scan = io.scan ?? scanLiteHistory;
    const scanOptions: ScanLiteHistoryOptions = {
      homeDir: io.homeDir,
      hostname: io.hostname,
      sourceRoots: parsed.sourceRoots,
      sourceRefs: parsed.sourceRefs,
      safeMode: parsed.safeMode,
      limitFiles: parsed.limitFiles,
      onProgress: io.isInteractiveTerminal
        ? (event) => {
            if (event.stage === "source_start") {
              io.stderr(`Scanning ${event.display_name} (${event.slot_id})…\n`);
            } else if (event.stage === "source_missing") {
              io.stderr(`Source missing: ${event.display_name} (${event.slot_id})\n`);
            } else if (event.stage === "file_error") {
              io.stderr(`Read error in ${event.display_name}: ${event.message ?? event.file_path ?? "unknown file"}\n`);
            }
          }
        : undefined,
    };

    let snapshot = await scan(scanOptions);
    const paging: PagingState = {};
    io.stdout(renderSnapshot(snapshot));
    if (!io.isInteractiveTerminal) {
      return 0;
    }

    io.stdout(renderCommandHelp());
    const readline = io.readLine
      ? undefined
      : createInterface({
          input: io.input ?? process.stdin,
          output: io.output ?? process.stdout,
          terminal: true,
        });
    const readLine = io.readLine ?? (async (prompt: string) => readline!.question(prompt));
    // readline/promises never settles a pending question() once the interface
    // closes, so Ctrl+C and EOF need a close sentinel to unblock the loop.
    const readlineClosed = readline
      ? new Promise<undefined>((resolve) => {
          readline.once("close", () => resolve(undefined));
        })
      : undefined;
    if (readline) {
      readline.on("SIGINT", () => {
        io.stdout("\nInterrupted; releasing snapshot.\n");
        readline.close();
      });
    }
    const terminalInput = (io.input ?? process.stdin) as NodeJS.ReadableStream & {
      isRaw?: boolean;
      setRawMode?(mode: boolean): void;
    };
    const restoreTerminal = () => {
      if (typeof terminalInput.setRawMode === "function" && terminalInput.isRaw) {
        terminalInput.setRawMode(false);
      }
    };
    if (readline) process.once("exit", restoreTerminal);
    // readline only emits SIGINT internally; cover SIGTERM/SIGHUP so an
    // outer supervisor signal still restores the terminal before exit.
    const signalShutdown = (signal: NodeJS.Signals) => {
      io.stdout(`\nReceived ${signal}; releasing snapshot.\n`);
      restoreTerminal();
      readline?.close();
    };
    const sigtermListener = () => signalShutdown("SIGTERM");
    const sighupListener = () => signalShutdown("SIGHUP");
    process.once("SIGTERM", sigtermListener);
    process.once("SIGHUP", sighupListener);

    try {
      while (true) {
        const input = readlineClosed
          ? await Promise.race([readLine("lite> "), readlineClosed])
          : await readLine("lite> ");
        if (input === undefined) break;
        const command = input.trim();
        if (!command) continue;
        if (command === "q" || command === "quit" || command === "exit") break;
        if (command === "h" || command === "help" || command === "?") {
          io.stdout(renderCommandHelp());
          continue;
        }
        if (command === "r" || command === "refresh") {
          io.stdout("Refreshing from native source data…\n");
          try {
            const replacement = await scan(scanOptions);
            snapshot = replacement;
            delete paging.current;
            io.stdout(renderSnapshot(snapshot));
          } catch (error) {
            io.stderr(`Refresh failed; previous snapshot retained: ${errorMessage(error)}\n`);
          }
          continue;
        }
        try {
          runSnapshotCommand(command, snapshot, io, paging);
        } catch (error) {
          io.stderr(`${errorMessage(error)}\n`);
        }
      }
    } finally {
      readline?.close();
      if (readline) process.removeListener("exit", restoreTerminal);
      process.removeListener("SIGTERM", sigtermListener);
      process.removeListener("SIGHUP", sighupListener);
    }
    io.stdout("CC History Lite snapshot released.\n");
    return 0;
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);
    return error instanceof TuiUsageError ? 2 : 1;
  }
}

function runSnapshotCommand(
  command: string,
  snapshot: LiveHistorySnapshot,
  io: LiteTuiIo,
  paging: PagingState,
): void {
  if (command === "p" || command === "projects") {
    showPagedView({ kind: "projects", pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  if (command === "s" || command === "sessions") {
    showPagedView({ kind: "sessions", pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  if (command === "u" || command === "turns") {
    showPagedView({ kind: "turns", pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  if (command === "n" || command === "next") {
    movePage(1, snapshot, io, paging);
    return;
  }
  if (command === "b" || command === "prev" || command === "previous") {
    movePage(-1, snapshot, io, paging);
    return;
  }
  if (command.startsWith("page ")) {
    jumpToPage(command.slice("page ".length).trim(), snapshot, io, paging);
    return;
  }
  if (command === "o" || command === "sources") {
    io.stdout(renderSources(snapshot.listSources()));
    return;
  }
  if (command === "t" || command === "stats") {
    io.stdout(renderStats(snapshot));
    return;
  }
  if (command.startsWith("stats ")) {
    const dimension = parseStatsDimension(command.slice("stats ".length).trim());
    io.stdout(renderStats(snapshot, dimension));
    return;
  }
  if (command.startsWith("/")) {
    startSearch(command.slice(1), snapshot, io, paging);
    return;
  }
  if (command.startsWith("search ")) {
    startSearch(command.slice("search ".length), snapshot, io, paging);
    return;
  }
  if (command.startsWith("project ")) {
    const ref = command.slice("project ".length).trim();
    const project = snapshot.getProject(ref);
    if (!project) throw new TuiUsageError(`Project not found: ${ref}.`);
    showPagedView({ kind: "project", projectId: project.project_id, pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  if (command.startsWith("session ")) {
    const ref = command.slice("session ".length).trim();
    const session = snapshot.getSession(ref);
    if (!session) throw new TuiUsageError(`Session not found: ${ref}.`);
    showPagedView({ kind: "session", sessionId: session.id, pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  if (command.startsWith("turn ")) {
    const ref = command.slice("turn ".length).trim();
    const turn = snapshot.getTurn(ref);
    if (!turn) throw new TuiUsageError(`UserTurn not found: ${ref}.`);
    io.stdout(renderTurnDetail(snapshot, turn));
    return;
  }
  if (command.startsWith("source ")) {
    const ref = command.slice("source ".length).trim();
    const source = snapshot.getSource(ref);
    if (!source) throw new TuiUsageError(`Source not found: ${ref}.`);
    showPagedView({ kind: "source", sourceId: source.id, pageIndex: 0 }, snapshot, io, paging);
    return;
  }
  throw new TuiUsageError(`Unknown command: ${command}. Type help for available commands.`);
}

function startSearch(
  queryInput: string,
  snapshot: LiveHistorySnapshot,
  io: LiteTuiIo,
  paging: PagingState,
): void {
  const query = queryInput.trim();
  if (!query) throw new TuiUsageError("Search query cannot be empty.");
  showPagedView({ kind: "search", query, pageIndex: 0 }, snapshot, io, paging);
}

function movePage(delta: -1 | 1, snapshot: LiveHistorySnapshot, io: LiteTuiIo, paging: PagingState): void {
  const current = paging.current;
  if (!current) {
    throw new TuiUsageError("No pageable view is active. Run projects, sessions, turns, search, or a detail command first.");
  }
  const nextPageIndex = current.view.pageIndex + delta;
  if (nextPageIndex < 0) {
    throw new TuiUsageError(`Already on the first page of ${pagedViewLabel(current.view)}.`);
  }
  if (nextPageIndex >= current.pageCount) {
    throw new TuiUsageError(`Already on the last page of ${pagedViewLabel(current.view)}.`);
  }
  showPagedView({ ...current.view, pageIndex: nextPageIndex }, snapshot, io, paging);
}

function jumpToPage(pageInput: string, snapshot: LiveHistorySnapshot, io: LiteTuiIo, paging: PagingState): void {
  const current = paging.current;
  if (!current) {
    throw new TuiUsageError("No pageable view is active. Run projects, sessions, turns, search, or a detail command first.");
  }
  const page = Number(pageInput);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new TuiUsageError(`Page must be an integer >= 1; received ${JSON.stringify(pageInput)}.`);
  }
  if (page > current.pageCount) {
    throw new TuiUsageError(`Page ${page} is out of range for ${pagedViewLabel(current.view)} (1-${current.pageCount}).`);
  }
  showPagedView({ ...current.view, pageIndex: page - 1 }, snapshot, io, paging);
}

function showPagedView(
  view: PagedView,
  snapshot: LiveHistorySnapshot,
  io: LiteTuiIo,
  paging: PagingState,
): void {
  const rendered = renderPagedView(view, snapshot);
  if (view.pageIndex >= rendered.pageCount) {
    throw new TuiUsageError(
      `Page ${view.pageIndex + 1} is out of range for ${pagedViewLabel(view)} (1-${rendered.pageCount}).`,
    );
  }
  paging.current = { view, pageCount: rendered.pageCount };
  io.stdout(rendered.output);
}

function renderPagedView(view: PagedView, snapshot: LiveHistorySnapshot): PagedRender {
  if (view.kind === "projects") return renderProjects(snapshot.listProjects(), view.pageIndex);
  if (view.kind === "sessions") return renderSessions(snapshot.listResolvedSessions(), view.pageIndex);
  if (view.kind === "turns") return renderTurns(snapshot.listResolvedTurns(), view.pageIndex);
  if (view.kind === "search") return renderSearchPage(view.query, snapshot, view.pageIndex);
  if (view.kind === "project") {
    const project = snapshot.getProject(view.projectId);
    if (!project) throw new TuiUsageError(`Project not found: ${view.projectId}.`);
    return renderProjectDetail(snapshot, project, view.pageIndex);
  }
  if (view.kind === "session") {
    const session = snapshot.getSession(view.sessionId);
    if (!session) throw new TuiUsageError(`Session not found: ${view.sessionId}.`);
    return renderSessionDetail(snapshot, session, view.pageIndex);
  }
  const source = snapshot.getSource(view.sourceId);
  if (!source) throw new TuiUsageError(`Source not found: ${view.sourceId}.`);
  return renderSourceDetail(snapshot, source, view.pageIndex);
}

function renderSearchPage(query: string, snapshot: LiveHistorySnapshot, pageIndex: number): PagedRender {
  const offset = pageIndex * SEARCH_PAGE_SIZE;
  const result = snapshot.search({ query, limit: SEARCH_PAGE_SIZE, offset });
  const pageCount = collectionPageCount(result.total, SEARCH_PAGE_SIZE);
  const range = collectionRange(result.total, pageIndex, SEARCH_PAGE_SIZE);
  const matchLabel = result.total === 0 ? "0 matches" : `${range.start}-${range.end} of ${result.total} matches`;
  const lines = [`Search ${JSON.stringify(query)} (${matchLabel})`];
  for (const entry of result.results) {
    const label = entry.project?.display_name ?? entry.session?.title ?? entry.turn.session_id;
    lines.push(
      `- ${entry.turn.submission_started_at} · ${label}`,
      `  ${singleLine(entry.turn.canonical_text, 160)}`,
      `  turn ${entry.turn.id}`,
    );
  }
  lines.push(renderPageNavigation(pageIndex, pageCount));
  return { output: `${lines.join("\n")}\n`, pageCount };
}

function renderSnapshot(snapshot: LiveHistorySnapshot): string {
  return `CC History Lite TUI ${VERSION}
Ephemeral live snapshot · single machine · no Full store

Sources   ${snapshot.listSources().length}
Projects  ${snapshot.listProjects().length}
Sessions  ${snapshot.listResolvedSessions().length}
Turns     ${snapshot.listResolvedTurns().length}

${renderProjectPreview(snapshot.listProjects(), 8)}${renderRecentTurns(snapshot.listResolvedTurns(), 8)}`;
}

function renderProjectPreview(projects: ProjectIdentity[], limit: number): string {
  const lines = [`Projects (${projects.length})`];
  for (const project of projects.slice(0, limit)) {
    lines.push(
      `- ${project.display_name} [${project.linkage_state}] · ${project.committed_turn_count + project.candidate_turn_count} turns`,
      `  project ${project.project_id}`,
    );
  }
  if (projects.length > limit) lines.push(`Browse all ${projects.length} projects: projects`);
  return `${lines.join("\n")}\n\n`;
}

function renderProjects(projects: ProjectIdentity[], pageIndex: number): PagedRender {
  const pageCount = collectionPageCount(projects.length, PROJECT_PAGE_SIZE);
  const lines = renderProjectLines(projects, pageIndex, PROJECT_PAGE_SIZE);
  lines.push(renderPageNavigation(pageIndex, pageCount));
  return { output: `${lines.join("\n")}\n`, pageCount };
}

function renderProjectLines(projects: ProjectIdentity[], pageIndex: number, pageSize: number): string[] {
  const lines = [collectionHeading("Projects", projects.length, pageIndex, pageSize)];
  for (const project of pageSlice(projects, pageIndex, pageSize)) {
    lines.push(
      `- ${project.display_name} [${project.linkage_state}] · ${project.committed_turn_count + project.candidate_turn_count} turns`,
      `  project ${project.project_id}`,
    );
  }
  return lines;
}

function renderRecentTurns(turns: UserTurnProjection[], limit: number): string {
  const lines = [`Recent Turns (${turns.length})`];
  for (const turn of turns.slice(0, limit)) {
    lines.push(
      `- ${turn.submission_started_at} · ${singleLine(turn.canonical_text, 110)}`,
      `  turn ${turn.id}`,
    );
  }
  if (turns.length > limit) lines.push(`Browse all ${turns.length} turns: turns`);
  return `${lines.join("\n")}\n`;
}

function renderSessions(sessions: SessionProjection[], pageIndex: number): PagedRender {
  const pageCount = collectionPageCount(sessions.length, SESSION_PAGE_SIZE);
  const lines = renderSessionLines(sessions, pageIndex, SESSION_PAGE_SIZE);
  lines.push(renderPageNavigation(pageIndex, pageCount));
  return { output: `${lines.join("\n")}\n`, pageCount };
}

function renderSessionLines(sessions: SessionProjection[], pageIndex: number, pageSize: number): string[] {
  const lines = [collectionHeading("Sessions", sessions.length, pageIndex, pageSize)];
  for (const session of pageSlice(sessions, pageIndex, pageSize)) {
    lines.push(
      `- ${session.title ?? session.source_session_id ?? session.id} · ${session.source_platform} · ${session.turn_count} turns`,
      `  session ${session.id}`,
    );
  }
  return lines;
}

function renderTurns(turns: UserTurnProjection[], pageIndex: number): PagedRender {
  const pageCount = collectionPageCount(turns.length, TURN_PAGE_SIZE);
  const lines = renderTurnLines(turns, pageIndex, TURN_PAGE_SIZE);
  lines.push(renderPageNavigation(pageIndex, pageCount));
  return { output: `${lines.join("\n")}\n`, pageCount };
}

function renderTurnLines(turns: UserTurnProjection[], pageIndex: number, pageSize: number): string[] {
  const lines = [collectionHeading("Turns", turns.length, pageIndex, pageSize)];
  for (const turn of pageSlice(turns, pageIndex, pageSize)) {
    lines.push(
      `- ${turn.submission_started_at} · ${singleLine(turn.canonical_text, 140)}`,
      `  turn ${turn.id}`,
    );
  }
  return lines;
}

function renderSources(sources: SourceStatus[]): string {
  const lines = [`Sources (${sources.length})`];
  for (const source of sources) {
    lines.push(
      `- ${source.display_name} [${source.slot_id}] ${source.sync_status} · ${source.total_sessions} sessions · ${source.total_turns} turns`,
      `  source ${source.id}`,
      `  ${source.base_dir}`,
    );
    if (source.error_message) lines.push(`  error: ${source.error_message}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderStats(snapshot: LiveHistorySnapshot, dimension?: UsageStatsDimension): string {
  const overview = snapshot.getUsageOverview();
  const lines = [
    "Stats",
    `- Turns: ${overview.total_turns}`,
    `- Token coverage: ${overview.turns_with_token_usage}/${overview.total_turns} (${formatPercent(overview.turn_coverage_ratio)})`,
    `- Input tokens: ${formatNumber(overview.total_input_tokens)}`,
    `- Cached input tokens: ${formatNumber(overview.total_cached_input_tokens)}`,
    `- Output tokens: ${formatNumber(overview.total_output_tokens)}`,
    `- Reasoning output tokens: ${formatNumber(overview.total_reasoning_output_tokens)}`,
    `- Total tokens: ${formatNumber(overview.total_tokens)}`,
  ];
  if (dimension) {
    const rollup = snapshot.getUsageRollup(dimension);
    lines.push("", `By ${dimension}`);
    for (const row of rollup.rows) {
      lines.push(`- ${row.label}: ${row.turn_count} turns · ${formatNumber(row.total_tokens)} tokens`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderProjectDetail(snapshot: LiveHistorySnapshot, project: ProjectIdentity, pageIndex: number): PagedRender {
  const turns = snapshot.listProjectTurns(project.project_id);
  const sessionIds = new Set(turns.map((turn) => turn.session_id));
  const sessions = snapshot.listResolvedSessions().filter((session) => sessionIds.has(session.id));
  const pageCount = Math.max(
    collectionPageCount(sessions.length, SESSION_PAGE_SIZE),
    collectionPageCount(turns.length, TURN_PAGE_SIZE),
  );
  const sections = [
    renderSessionLines(sessions, pageIndex, SESSION_PAGE_SIZE).join("\n"),
    renderTurnLines(turns, pageIndex, TURN_PAGE_SIZE).join("\n"),
  ];
  return { output: `Project · ${project.display_name}
ID: ${project.project_id}
Link: ${project.linkage_state} (${project.link_reason}, ${project.confidence})
Workspace: ${project.primary_workspace_path ?? project.repo_root ?? "—"}
Sessions: ${sessions.length}
Turns: ${turns.length}

${sections.join("\n\n")}
${renderPageNavigation(pageIndex, pageCount)}
`, pageCount };
}

function renderSessionDetail(snapshot: LiveHistorySnapshot, session: SessionProjection, pageIndex: number): PagedRender {
  const turns = snapshot.listSessionTurns(session.id);
  const pageCount = collectionPageCount(turns.length, TURN_PAGE_SIZE);
  return { output: `Session · ${session.title ?? session.source_session_id ?? session.id}
ID: ${session.id}
Source: ${session.source_platform}
Workspace: ${session.working_directory ?? "—"}
Updated: ${session.updated_at}
Resume: ${session.resume_command ?? "—"}

${renderTurnLines(turns, pageIndex, TURN_PAGE_SIZE).join("\n")}
${renderPageNavigation(pageIndex, pageCount)}
`, pageCount };
}

function renderTurnDetail(snapshot: LiveHistorySnapshot, turn: UserTurnProjection): string {
  const context = snapshot.getTurnContext(turn.id);
  return `UserTurn · ${turn.id}
Time: ${turn.submission_started_at}
Session: ${turn.session_id}
Project: ${turn.project_id ?? turn.link_state}

${turn.canonical_text}

Context
- Assistant replies: ${context?.assistant_replies.length ?? 0}
- Tool calls: ${context?.tool_calls.length ?? 0}

${context ? JSON.stringify(context, null, 2) : "No context"}
`;
}

function renderSourceDetail(snapshot: LiveHistorySnapshot, source: SourceStatus, pageIndex: number): PagedRender {
  const sessions = snapshot.listResolvedSessions().filter((session) => session.source_id === source.id);
  const audits = snapshot.listLossAudits().filter((audit) => audit.source_id === source.id);
  const pageCount = collectionPageCount(sessions.length, SESSION_PAGE_SIZE);
  return { output: `Source · ${source.display_name}
ID: ${source.id}
Adapter: ${source.platform} [${source.slot_id}]
Root: ${source.base_dir}
Status: ${source.sync_status}${source.error_message ? ` · ${source.error_message}` : ""}
Sessions: ${source.total_sessions}
Turns: ${source.total_turns}
Loss audits: ${audits.length}

${renderSessionLines(sessions, pageIndex, SESSION_PAGE_SIZE).join("\n")}
${renderPageNavigation(pageIndex, pageCount)}
`, pageCount };
}

function collectionPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function collectionRange(
  total: number,
  pageIndex: number,
  pageSize: number,
): { start: number; end: number } {
  const offset = pageIndex * pageSize;
  if (total === 0 || offset >= total) return { start: 0, end: 0 };
  return { start: offset + 1, end: Math.min(total, offset + pageSize) };
}

function collectionHeading(label: string, total: number, pageIndex: number, pageSize: number): string {
  const range = collectionRange(total, pageIndex, pageSize);
  if (total === 0) return `${label} (0)`;
  if (range.start === 0) return `${label} (${total} total · no entries on this page)`;
  return `${label} (${range.start}-${range.end} of ${total})`;
}

function pageSlice<T>(values: readonly T[], pageIndex: number, pageSize: number): T[] {
  const offset = pageIndex * pageSize;
  return values.slice(offset, offset + pageSize);
}

function renderPageNavigation(pageIndex: number, pageCount: number): string {
  const controls = [`Page ${pageIndex + 1}/${pageCount}`];
  if (pageIndex > 0) controls.push("previous: b | prev");
  if (pageIndex + 1 < pageCount) controls.push("next: n | next");
  if (pageCount > 1) controls.push("jump: page <n>");
  return controls.join(" · ");
}

function pagedViewLabel(view: PagedView): string {
  if (view.kind === "projects") return "projects";
  if (view.kind === "sessions") return "sessions";
  if (view.kind === "turns") return "turns";
  if (view.kind === "search") return `search ${JSON.stringify(view.query)}`;
  if (view.kind === "project") return `project ${view.projectId}`;
  if (view.kind === "session") return `session ${view.sessionId}`;
  return `source ${view.sourceId}`;
}

function parseArgs(argv: string[], cwd: string): ParsedArgs {
  const sourceRoots: LiteSourceRoot[] = [];
  const sourceRefs: string[] = [];
  let safeMode = false;
  let limitFiles: number | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--safe") {
      safeMode = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--store" || argument.startsWith("--store=") || argument === "--db" || argument.startsWith("--db=")) {
      throw new TuiUsageError("CC History Lite TUI does not accept --store or --db and never reads the Full store.");
    }
    if (argument === "--source-root" || argument.startsWith("--source-root=")) {
      const raw = readOptionValue(argv, index, argument, "source-root");
      if (argument === "--source-root") index += 1;
      sourceRoots.push(parseSourceRoot(raw, cwd));
      continue;
    }
    if (argument === "--source" || argument.startsWith("--source=")) {
      const raw = readOptionValue(argv, index, argument, "source");
      if (argument === "--source") index += 1;
      sourceRefs.push(raw);
      continue;
    }
    if (argument === "--limit-files" || argument.startsWith("--limit-files=")) {
      const raw = readOptionValue(argv, index, argument, "limit-files");
      if (argument === "--limit-files") index += 1;
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TuiUsageError("--limit-files must be an integer >= 1.");
      limitFiles = parsed;
      continue;
    }
    throw new TuiUsageError(`Unknown Lite TUI argument: ${argument}.`);
  }
  return { sourceRoots, sourceRefs, safeMode, limitFiles, help };
}

function readOptionValue(argv: string[], index: number, argument: string, name: string): string {
  const inlineIndex = argument.indexOf("=");
  const value = inlineIndex === -1 ? argv[index + 1] : argument.slice(inlineIndex + 1);
  if (!value || (inlineIndex === -1 && value.startsWith("--"))) {
    throw new TuiUsageError(`--${name} requires a value.`);
  }
  return value;
}

function parseSourceRoot(value: string, cwd: string): LiteSourceRoot {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex <= 0 || equalsIndex === value.length - 1) {
    throw new TuiUsageError(`--source-root must use <slot-or-id>=<path>; received ${JSON.stringify(value)}.`);
  }
  return {
    sourceRef: value.slice(0, equalsIndex),
    baseDir: path.resolve(cwd, value.slice(equalsIndex + 1)),
  };
}

function parseStatsDimension(value: string): UsageStatsDimension {
  if (value === "source" || value === "project" || value === "model" || value === "day") return value;
  throw new TuiUsageError(`Stats dimension must be source, project, model, or day; received ${JSON.stringify(value)}.`);
}

function renderCommandHelp(): string {
  return `
Commands
  p | projects             list projects
  s | sessions             list sessions
  u | turns                list UserTurns
  /<query> | search <q>    search canonical turn text and paths
  n | next                 next page of the active list, search, or detail
  b | prev                 previous page of the active view
  page <n>                 jump to a page of the active view
  project <ref>            project detail
  session <ref>            session and turn detail
  turn <ref>               UserTurn and full context detail
  o | sources              source status
  t | stats                usage overview
  stats source|project|model|day
  r | refresh              rescan; old snapshot remains if refresh fails
  h | help                 show commands
  q | quit                 release the in-memory snapshot

`;
}

function renderHelp(): string {
  return `CC History Lite TUI ${VERSION}

Usage:
  cchistory-lite-tui [--source-root <slot-or-id>=<path>] [--source <slot-or-id>] [--safe]

The TUI reads registered native source adapters into one process-lifetime snapshot.
It never reads or creates a CC History Full store. There is no import surface.
`;
}

function defaultIo(): LiteTuiIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    isInteractiveTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    input: process.stdin,
    output: process.stdout,
  };
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved: string;
  try {
    resolved = realpathSync(entry);
  } catch {
    return false;
  }
  return import.meta.url === pathToFileURL(resolved).href;
}

if (isDirectEntry()) {
  runLiteTui(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      // The main catch already reports errors; the only throws that escape are
      // io failures (broken pipe, closed stderr). Keep the nonzero exit code
      // instead of crashing with an unhandled rejection.
      process.exitCode = 1;
    },
  );
}
