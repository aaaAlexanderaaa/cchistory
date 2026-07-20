#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { lstat, open, realpath, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
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
} from "@cchistory/live-runtime";

const VERSION = "0.3.0";
const EXPORT_SCHEMA = "cchistory-lite-export/v1";
const JSON_SCHEMA = "cchistory-lite/v1";
const VALUE_FLAGS = new Set([
  "source-root",
  "source",
  "limit-files",
  "limit",
  "offset",
  "project",
  "by",
  "format",
  "out",
]);
const BOOLEAN_FLAGS = new Set(["safe", "json", "help", "version"]);
const FORBIDDEN_COMMANDS = new Set([
  "sync",
  "import",
  "backup",
  "restore",
  "restore-check",
  "merge",
  "gc",
  "migration",
  "agent",
]);
const KNOWN_COMMANDS = new Set(["sources", "ls", "tree", "search", "show", "stats", "export", "tui"]);

export interface LiteCliIo {
  cwd: string;
  homeDir?: string;
  hostname?: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  isTTY: boolean;
  spawnTui?: (args: string[]) => Promise<number>;
}

interface ParsedArgs {
  command: string;
  positionals: string[];
  values: Map<string, string[]>;
  booleans: Set<string>;
}

class UsageError extends Error {}

export async function runLiteCli(argv: string[], io: LiteCliIo = defaultIo()): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.booleans.has("version")) {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    if (parsed.command === "help" || parsed.booleans.has("help")) {
      io.stdout(renderHelp(parsed.positionals[0]));
      return 0;
    }
    if (FORBIDDEN_COMMANDS.has(parsed.command)) {
      throw new UsageError(
        `${parsed.command} is not available in CC History Lite; Lite only reads live source data and exports one-way output. ` +
          `For ${parsed.command}, install and run the Full \`cchistory\` binary instead.`,
      );
    }
    if (!KNOWN_COMMANDS.has(parsed.command)) {
      throw new UsageError(`Unknown Lite command: ${parsed.command}. Run cchistory-lite help.`);
    }
    validateCommandOptions(parsed);
    if (parsed.command === "tui") {
      assertNoPositionals(parsed, "tui");
      return await launchTui(parsed, io);
    }

    validateCommandShape(parsed);
    const sourceRoots = values(parsed, "source-root").map((value) => parseSourceRoot(value, io.cwd));
    const sourceRefs = values(parsed, "source");
    const json = parsed.booleans.has("json");
    const snapshot = await scanLiteHistory({
      homeDir: io.homeDir,
      hostname: io.hostname,
      sourceRoots,
      sourceRefs,
      safeMode: parsed.booleans.has("safe"),
      limitFiles: optionalInteger(parsed, "limit-files", 1),
      contextMode: requiresFullContextSnapshot(parsed) ? "full" : "none",
      onProgress: io.isTTY && !json
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
    });

    switch (parsed.command) {
      case "sources":
        output(io, json, buildSourcesPayload(snapshot), renderSources(snapshot.listSources()));
        return 0;
      case "ls":
        runList(parsed, snapshot, io, json);
        return 0;
      case "tree":
        runTree(parsed, snapshot, io, json);
        return 0;
      case "search":
        runSearch(parsed, snapshot, io, json);
        return 0;
      case "show":
        runShow(parsed, snapshot, io, json);
        return 0;
      case "stats":
        runStats(parsed, snapshot, io, json);
        return 0;
      case "export":
        await runExport(parsed, snapshot, io);
        return 0;
    }
    throw new UsageError(`Unhandled Lite command: ${parsed.command}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

function runList(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo, json: boolean): void {
  const target = parsed.positionals[0] ?? "projects";
  if (target === "projects") {
    const projects = snapshot.listProjects();
    output(io, json, { schema: JSON_SCHEMA, kind: "projects", total: projects.length, projects }, renderProjects(projects));
    return;
  }
  if (target === "sessions") {
    const sessions = snapshot.listResolvedSessions();
    output(io, json, { schema: JSON_SCHEMA, kind: "sessions", total: sessions.length, sessions }, renderSessions(sessions));
    return;
  }
  if (target === "sources") {
    output(io, json, buildSourcesPayload(snapshot), renderSources(snapshot.listSources()));
    return;
  }
  throw new UsageError(`ls target must be projects, sessions, or sources; received ${JSON.stringify(target)}.`);
}

function runTree(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo, json: boolean): void {
  const target = parsed.positionals[0] ?? "projects";
  if (target === "projects") {
    const tree = buildProjectsTree(snapshot);
    output(io, json, { schema: JSON_SCHEMA, kind: "project_tree", ...tree }, renderProjectTree(tree));
    return;
  }
  const ref = parsed.positionals[1];
  if (!ref) {
    throw new UsageError(`tree ${target} requires a reference.`);
  }
  if (target === "project") {
    const project = requireProject(snapshot, ref);
    const node = buildProjectNode(snapshot, project);
    output(io, json, { schema: JSON_SCHEMA, kind: "project_tree", project: node }, renderProjectTree({ projects: [node], unlinked: [] }));
    return;
  }
  if (target === "session") {
    const session = requireSession(snapshot, ref);
    const node = buildSessionNode(snapshot, session);
    output(io, json, { schema: JSON_SCHEMA, kind: "session_tree", session: node }, renderSessionTree(node));
    return;
  }
  throw new UsageError(`tree target must be projects, project, or session; received ${JSON.stringify(target)}.`);
}

function runSearch(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo, json: boolean): void {
  const query = parsed.positionals.join(" ").trim();
  if (!query) {
    throw new UsageError("search requires a query.");
  }
  const projectRef = value(parsed, "project");
  const projectId = projectRef ? requireProject(snapshot, projectRef).project_id : undefined;
  const sourceIds = values(parsed, "source").map((ref) => requireSource(snapshot, ref).id);
  const result = snapshot.search({
    query,
    projectId,
    sourceIds,
    limit: optionalInteger(parsed, "limit", 1) ?? 50,
    offset: optionalInteger(parsed, "offset", 0) ?? 0,
  });
  output(
    io,
    json,
    { schema: JSON_SCHEMA, kind: "search", query, total: result.total, results: result.results },
    renderSearch(query, result.total, result.results),
  );
}

function runShow(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo, json: boolean): void {
  const [kind, ref] = parsed.positionals;
  if (!kind || !ref) {
    throw new UsageError("show requires project|session|turn|source and a reference.");
  }
  let detail: Record<string, unknown>;
  if (kind === "project") {
    const project = requireProject(snapshot, ref);
    detail = buildProjectNode(snapshot, project);
  } else if (kind === "session") {
    const session = requireSession(snapshot, ref);
    const turns = snapshot.listSessionTurns(session.id);
    detail = {
      session,
      turns: turns.map((turn) => ({ turn, context: snapshot.getTurnContext(turn.id) })),
    };
  } else if (kind === "turn") {
    const turn = requireTurn(snapshot, ref);
    detail = {
      turn,
      session: snapshot.getSession(turn.session_id),
      project: turn.project_id ? snapshot.getProject(turn.project_id) : undefined,
      context: snapshot.getTurnContext(turn.id),
    };
  } else if (kind === "source") {
    const source = requireSource(snapshot, ref);
    detail = {
      source,
      sessions: snapshot.listResolvedSessions().filter((session) => session.source_id === source.id),
      loss_audits: snapshot.listLossAudits().filter((audit) => audit.source_id === source.id),
    };
  } else {
    throw new UsageError(`show target must be project, session, turn, or source; received ${JSON.stringify(kind)}.`);
  }
  output(io, json, { schema: JSON_SCHEMA, kind: `${kind}_detail`, ...detail }, `${titleCase(kind)} detail\n${JSON.stringify(detail, null, 2)}\n`);
}

function runStats(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo, json: boolean): void {
  const projectRef = value(parsed, "project");
  const sourceIds = values(parsed, "source").map((ref) => requireSource(snapshot, ref).id);
  const filters = {
    project_id: projectRef ? requireProject(snapshot, projectRef).project_id : undefined,
    source_ids: sourceIds.length > 0 ? sourceIds : undefined,
  };
  const overview = snapshot.getUsageOverview(filters);
  const by = value(parsed, "by");
  const dimension = by ? parseStatsDimension(by) : undefined;
  const rollup = dimension ? snapshot.getUsageRollup(dimension, filters) : undefined;
  output(
    io,
    json,
    { schema: JSON_SCHEMA, kind: "stats", overview, rollup },
    renderStats(overview, rollup),
  );
}

function requiresFullContextSnapshot(parsed: ParsedArgs): boolean {
  if (parsed.command === "show") {
    return parsed.positionals[0] === "session" || parsed.positionals[0] === "turn";
  }
  if (parsed.command === "export") {
    return (value(parsed, "format") ?? "jsonl") !== "markdown";
  }
  return false;
}

async function runExport(parsed: ParsedArgs, snapshot: LiveHistorySnapshot, io: LiteCliIo): Promise<void> {
  const format = value(parsed, "format") ?? "jsonl";
  if (format !== "jsonl" && format !== "json" && format !== "markdown") {
    throw new UsageError(`export format must be jsonl, json, or markdown; received ${JSON.stringify(format)}.`);
  }
  const destination = value(parsed, "out") ?? "-";
  if (destination === "-") {
    if (format === "jsonl") {
      for (const row of iterateJsonlRows(snapshot)) io.stdout(`${JSON.stringify(row)}\n`);
    } else {
      io.stdout(formatExport(snapshot, format));
    }
    return;
  }
  const outputPath = path.resolve(io.cwd, destination);
  await assertSafeExportDestination(outputPath, snapshot, io.homeDir);
  if (format === "jsonl") {
    const handle = await open(outputPath, "w");
    try {
      for (const row of iterateJsonlRows(snapshot)) {
        await handle.write(`${JSON.stringify(row)}\n`);
      }
    } finally {
      await handle.close();
    }
  } else {
    await writeFile(outputPath, formatExport(snapshot, format), "utf8");
  }
  io.stdout(`Wrote one-way ${format} export to ${outputPath}\n`);
}

function buildSourcesPayload(snapshot: LiveHistorySnapshot): Record<string, unknown> {
  const sources = snapshot.listSources();
  return { schema: JSON_SCHEMA, kind: "sources", total: sources.length, sources };
}

function buildProjectsTree(snapshot: LiveHistorySnapshot): {
  projects: ReturnType<typeof buildProjectNode>[];
  unlinked: ReturnType<typeof buildSessionNode>[];
} {
  const projects = snapshot.listProjects().map((project) => buildProjectNode(snapshot, project));
  const linkedSessionIds = new Set(projects.flatMap((project) => project.sessions.map((session) => session.session.id)));
  const unlinked = snapshot.listResolvedSessions()
    .filter((session) => !linkedSessionIds.has(session.id))
    .map((session) => buildSessionNode(snapshot, session));
  return { projects, unlinked };
}

function buildProjectNode(snapshot: LiveHistorySnapshot, project: ProjectIdentity): {
  project: ProjectIdentity;
  sessions: ReturnType<typeof buildSessionNode>[];
  turns: UserTurnProjection[];
} {
  const turns = snapshot.listProjectTurns(project.project_id);
  const sessionIds = new Set(turns.map((turn) => turn.session_id));
  const sessions = snapshot.listResolvedSessions()
    .filter((session) => sessionIds.has(session.id))
    .map((session) => buildSessionNode(snapshot, session, project.project_id));
  return { project, sessions, turns };
}

function buildSessionNode(snapshot: LiveHistorySnapshot, session: SessionProjection, projectId?: string): {
  session: SessionProjection;
  turns: UserTurnProjection[];
} {
  const turns = snapshot.listSessionTurns(session.id).filter((turn) => projectId ? turn.project_id === projectId : true);
  return { session, turns };
}

function formatExport(snapshot: LiveHistorySnapshot, format: "json" | "markdown"): string {
  const data = snapshot.data;
  if (format === "json") {
    return `${JSON.stringify({ schema: EXPORT_SCHEMA, kind: "export", ...data }, null, 2)}\n`;
  }

  const lines = [
    "# CC History Lite Export",
    "",
    `Schema: \`${EXPORT_SCHEMA}\``,
    "",
    "> One-way canonical export. This is not a CC History Full backup and cannot be imported by Lite.",
    "",
    `- Sources: ${data.sources.length}`,
    `- Projects: ${data.projects.length}`,
    `- Sessions: ${data.sessions.length}`,
    `- UserTurns: ${data.turns.length}`,
    "",
    "## UserTurns",
    "",
  ];
  for (const turn of data.turns) {
    lines.push(`### ${turn.submission_started_at} · ${turn.id}`, "", turn.canonical_text, "");
  }
  return `${lines.join("\n")}\n`;
}

function* iterateJsonlRows(snapshot: LiveHistorySnapshot): Iterable<unknown> {
  const data = snapshot.data;
  yield { schema: EXPORT_SCHEMA, kind: "manifest" };
  yield { schema: EXPORT_SCHEMA, kind: "host", value: data.host };
  for (const value of data.sources) yield { schema: EXPORT_SCHEMA, kind: "source", value };
  for (const value of data.projects) yield { schema: EXPORT_SCHEMA, kind: "project", value };
  for (const value of data.sessions) yield { schema: EXPORT_SCHEMA, kind: "session", value };
  for (const value of data.turns) yield { schema: EXPORT_SCHEMA, kind: "turn", value };
  for (const value of data.contexts) yield { schema: EXPORT_SCHEMA, kind: "context", value };
  for (const value of data.ask_user_question_turns) {
    yield { schema: EXPORT_SCHEMA, kind: "ask_user_question", value };
  }
  for (const value of data.loss_audits) yield { schema: EXPORT_SCHEMA, kind: "loss_audit", value };
}

function renderSources(sources: SourceStatus[]): string {
  const lines = [`Sources (${sources.length})`];
  for (const source of sources) {
    lines.push(
      `- ${source.display_name} [${source.slot_id}] ${source.sync_status} · ${source.total_sessions} sessions · ${source.total_turns} turns`,
      `  ${source.base_dir}`,
    );
    if (source.error_message) lines.push(`  error: ${source.error_message}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderProjects(projects: ProjectIdentity[]): string {
  const lines = [`Projects (${projects.length})`];
  for (const project of projects) {
    lines.push(
      `- ${project.display_name} [${project.linkage_state}] · ${project.committed_turn_count + project.candidate_turn_count} turns · ${project.session_count} sessions`,
      `  ${project.primary_workspace_path ?? project.repo_root ?? project.project_id}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderSessions(sessions: SessionProjection[]): string {
  const lines = [`Sessions (${sessions.length})`];
  for (const session of sessions) {
    lines.push(
      `- ${session.title ?? session.source_session_id ?? session.id} · ${session.source_platform} · ${session.turn_count} turns · ${session.updated_at}`,
      `  ${session.working_directory ?? session.id}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderSearch(query: string, total: number, results: ReturnType<LiveHistorySnapshot["search"]>["results"]): string {
  const lines = [`Search ${JSON.stringify(query)} (${total} matches)`];
  for (const result of results) {
    const label = result.project?.display_name ?? result.session?.title ?? result.turn.session_id;
    lines.push(
      `- ${result.turn.submission_started_at} · ${label} · ${result.turn.id}`,
      `  ${singleLine(result.turn.canonical_text, 180)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderStats(
  overview: ReturnType<LiveHistorySnapshot["getUsageOverview"]>,
  rollup: ReturnType<LiveHistorySnapshot["getUsageRollup"]> | undefined,
): string {
  const lines = [
    "Stats",
    `- Turns: ${overview.total_turns}`,
    `- Turns with token usage: ${overview.turns_with_token_usage} (${formatPercent(overview.turn_coverage_ratio)})`,
    `- Input tokens: ${formatNumber(overview.total_input_tokens)}`,
    `- Cached input tokens: ${formatNumber(overview.total_cached_input_tokens)}`,
    `- Output tokens: ${formatNumber(overview.total_output_tokens)}`,
    `- Reasoning output tokens: ${formatNumber(overview.total_reasoning_output_tokens)}`,
    `- Total tokens: ${formatNumber(overview.total_tokens)}`,
  ];
  if (rollup) {
    lines.push("", `By ${rollup.dimension}`);
    for (const row of rollup.rows) {
      lines.push(`- ${row.label}: ${row.turn_count} turns · ${formatNumber(row.total_tokens)} tokens`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderProjectTree(tree: ReturnType<typeof buildProjectsTree>): string {
  const lines = ["Project tree"];
  for (const node of tree.projects) {
    lines.push(`├─ ${node.project.display_name} [${node.project.linkage_state}]`);
    for (const sessionNode of node.sessions) {
      lines.push(...renderSessionTreeLines(sessionNode, "│  "));
    }
  }
  if (tree.unlinked.length > 0) {
    lines.push("└─ Unlinked / candidate-only sessions");
    for (const sessionNode of tree.unlinked) {
      lines.push(...renderSessionTreeLines(sessionNode, "   "));
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderSessionTree(node: ReturnType<typeof buildSessionNode>): string {
  return `${["Session tree", ...renderSessionTreeLines(node, "")].join("\n")}\n`;
}

function renderSessionTreeLines(node: ReturnType<typeof buildSessionNode>, prefix: string): string[] {
  const lines = [`${prefix}├─ ${node.session.title ?? node.session.source_session_id ?? node.session.id}`];
  for (const turn of node.turns) {
    lines.push(`${prefix}│  └─ ${turn.submission_started_at} ${singleLine(turn.canonical_text, 100)}`);
  }
  return lines;
}

function output(io: LiteCliIo, json: boolean, payload: unknown, text: string): void {
  io.stdout(json ? `${JSON.stringify(payload, null, 2)}\n` : text);
}

function requireSource(snapshot: LiveHistorySnapshot, ref: string): SourceStatus {
  const value = snapshot.getSource(ref);
  if (!value) throw new UsageError(`Lite source not found: ${ref}.`);
  return value;
}

function requireProject(snapshot: LiveHistorySnapshot, ref: string): ProjectIdentity {
  const value = snapshot.getProject(ref);
  if (!value) throw new UsageError(`Project not found: ${ref}.`);
  return value;
}

function requireSession(snapshot: LiveHistorySnapshot, ref: string): SessionProjection {
  const value = snapshot.getSession(ref);
  if (!value) throw new UsageError(`Session not found: ${ref}.`);
  return value;
}

function requireTurn(snapshot: LiveHistorySnapshot, ref: string): UserTurnProjection {
  const value = snapshot.getTurn(ref);
  if (!value) throw new UsageError(`UserTurn not found: ${ref}.`);
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const valuesMap = new Map<string, string[]>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (argument === "-h") {
      booleans.add("help");
      continue;
    }
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    const name = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    if (name === "store" || name === "db") {
      throw new UsageError("CC History Lite does not accept --store or --db and never reads the Full store.");
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (equalsIndex !== -1) throw new UsageError(`--${name} does not take a value.`);
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new UsageError(`Unknown Lite option: --${name}.`);
    }
    const nextValue = equalsIndex === -1 ? argv[index + 1] : argument.slice(equalsIndex + 1);
    if (nextValue === undefined || nextValue === "" || (equalsIndex === -1 && nextValue.startsWith("--"))) {
      throw new UsageError(`--${name} requires a value.`);
    }
    if (equalsIndex === -1) index += 1;
    const entries = valuesMap.get(name) ?? [];
    entries.push(nextValue);
    valuesMap.set(name, entries);
  }

  const command = positionals.shift() ?? "help";
  return { command, positionals, values: valuesMap, booleans };
}

function validateCommandShape(parsed: ParsedArgs): void {
  switch (parsed.command) {
    case "sources":
      assertNoPositionals(parsed, "sources");
      break;
    case "ls":
      if (parsed.positionals.length > 1) throw new UsageError("ls accepts at most one target.");
      break;
    case "tree": {
      const target = parsed.positionals[0] ?? "projects";
      const expected = target === "projects" ? 1 : 2;
      if (parsed.positionals.length > expected) throw new UsageError(`tree ${target} received too many arguments.`);
      break;
    }
    case "search":
      break;
    case "show":
      if (parsed.positionals.length !== 2) throw new UsageError("show requires exactly a kind and reference.");
      break;
    case "stats":
    case "export":
      assertNoPositionals(parsed, parsed.command);
      break;
    default:
      break;
  }
}

function validateCommandOptions(parsed: ParsedArgs): void {
  const allowedValues = new Set(["source-root", "source", "limit-files"]);
  if (parsed.command === "search") {
    for (const name of ["limit", "offset", "project"]) allowedValues.add(name);
  } else if (parsed.command === "stats") {
    for (const name of ["project", "by"]) allowedValues.add(name);
  } else if (parsed.command === "export") {
    for (const name of ["format", "out"]) allowedValues.add(name);
  }
  for (const name of parsed.values.keys()) {
    if (!allowedValues.has(name)) {
      throw new UsageError(`--${name} is not valid for ${parsed.command}.`);
    }
  }
}

function assertNoPositionals(parsed: ParsedArgs, command: string): void {
  if (parsed.positionals.length > 0) throw new UsageError(`${command} does not accept positional arguments.`);
}

function parseSourceRoot(value: string, cwd: string): LiteSourceRoot {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex <= 0 || equalsIndex === value.length - 1) {
    throw new UsageError(`--source-root must use <slot-or-id>=<path>; received ${JSON.stringify(value)}.`);
  }
  return {
    sourceRef: value.slice(0, equalsIndex),
    baseDir: path.resolve(cwd, value.slice(equalsIndex + 1)),
  };
}

function value(parsed: ParsedArgs, name: string): string | undefined {
  const entries = values(parsed, name);
  if (entries.length > 1 && name !== "source" && name !== "source-root") {
    throw new UsageError(`--${name} may only be specified once.`);
  }
  return entries.at(-1);
}

function values(parsed: ParsedArgs, name: string): string[] {
  return parsed.values.get(name) ?? [];
}

function optionalInteger(parsed: ParsedArgs, name: string, minimum: number): number | undefined {
  const raw = value(parsed, name);
  if (raw === undefined) return undefined;
  const parsedValue = Number(raw);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum) {
    throw new UsageError(`--${name} must be an integer >= ${minimum}.`);
  }
  return parsedValue;
}

function parseStatsDimension(value: string): UsageStatsDimension {
  if (value === "source" || value === "project" || value === "model" || value === "day") return value;
  throw new UsageError(`--by must be source, project, model, or day; received ${JSON.stringify(value)}.`);
}

async function launchTui(parsed: ParsedArgs, io: LiteCliIo): Promise<number> {
  const args = [
    ...values(parsed, "source-root").flatMap((entry) => ["--source-root", entry]),
    ...values(parsed, "source").flatMap((entry) => ["--source", entry]),
    ...(value(parsed, "limit-files") ? ["--limit-files", value(parsed, "limit-files")!] : []),
    ...(parsed.booleans.has("safe") ? ["--safe"] : []),
  ];
  if (io.spawnTui) return io.spawnTui(args);
  return new Promise<number>((resolve, reject) => {
    const child = spawn("cchistory-lite-tui", args, { cwd: io.cwd, stdio: "inherit" });
    child.once("error", (error) => reject(new Error(formatTuiLaunchError(error))));
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`cchistory-lite-tui exited on signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

export function formatTuiLaunchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const hint = code === "ENOENT"
    ? " Install it globally with `pnpm run lite:tui:link` (or run via `pnpm lite:tui`)."
    : "";
  return `Unable to launch cchistory-lite-tui: ${message}.${hint}`;
}

function renderHelp(command?: string): string {
  if (command) return `Run cchistory-lite ${command} --help through the command synopsis below.\n\n${renderHelp()}`;
  return `CC History Lite ${VERSION}

Live, single-machine history inspection with shared Full/Lite canonical semantics.
Lite never reads or creates a CC History Full store.

Usage:
  cchistory-lite sources [options]
  cchistory-lite ls [projects|sessions|sources] [options]
  cchistory-lite tree [projects|project <ref>|session <ref>] [options]
  cchistory-lite search <query> [--project <ref>] [--limit <n>] [options]
  cchistory-lite show project|session|turn|source <ref> [options]
  cchistory-lite stats [--by source|project|model|day] [options]
  cchistory-lite export --format jsonl|json|markdown [--out <file>|-] [options]
  cchistory-lite tui [options]

Source options:
  --source-root <slot-or-id>=<path>  Override one registered adapter root; repeatable
  --source <slot-or-id>              Select registered adapters; repeatable
  --limit-files <n>                  Limit source files per adapter
  --safe                             Enable adapter safe mode

Output options:
  --json                             Machine-readable output for read commands
  --help                             Show this help
  --version                          Show version

There is no sync, import, backup, restore, merge, GC, migration, --store, or --db surface.
`;
}

function defaultIo(): LiteCliIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    isTTY: Boolean(process.stdout.isTTY),
  };
}

function singleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertSafeExportDestination(
  outputPath: string,
  snapshot: LiveHistorySnapshot,
  homeDir: string | undefined,
): Promise<void> {
  assertNotFullStorePath(outputPath);

  try {
    const outputInfo = await lstat(outputPath);
    if (outputInfo.isSymbolicLink()) {
      throw new UsageError("Lite export destination cannot be a symbolic link.");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  const resolvedOutputPath = await resolvePathForContainment(outputPath);
  assertNotFullStorePath(resolvedOutputPath);

  const fullStoreRoot = await resolvePathForContainment(
    path.resolve(homeDir ?? os.homedir(), ".cchistory"),
  );
  if (isPathWithin(fullStoreRoot, resolvedOutputPath)) {
    throw new UsageError("Lite export cannot write into a Full store path.");
  }

  for (const source of snapshot.listSources()) {
    const sourceRoot = await resolvePathForContainment(path.resolve(source.base_dir));
    if (isPathWithin(sourceRoot, resolvedOutputPath)) {
      throw new UsageError("Lite export must be written outside native source roots.");
    }
  }
}

function assertNotFullStorePath(targetPath: string): void {
  const normalized = targetPath.replace(/\\/g, "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  if (path.basename(normalized) === "cchistory.sqlite" || segments.includes(".cchistory")) {
    throw new UsageError("Lite export cannot write into a Full store path.");
  }
}

async function resolvePathForContainment(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const resolved = await realpath(current);
      return path.resolve(resolved, ...missingSegments);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(targetPath);
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR"),
  );
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
  runLiteCli(process.argv.slice(2)).then(
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
