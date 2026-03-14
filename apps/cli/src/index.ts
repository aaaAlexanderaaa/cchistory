#!/usr/bin/env node

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type {
  ProjectIdentity,
  SourceDefinition,
  SourceSyncPayload,
  SourceStatus,
  TurnSearchResult,
  UsageStatsDimension,
  UserTurnProjection,
} from "@cchistory/domain";
import { getDefaultSources, getSourceFormatProfiles, runSourceProbe } from "@cchistory/source-adapters";
import { CCHistoryStorage } from "@cchistory/storage";
import {
  computePayloadChecksum,
  exportBundle,
  importBundleIntoStore,
  snapshotPayloadRawBlobs,
} from "./bundle.js";
import {
  formatNumber,
  formatRatio,
  indentBlock,
  renderBarChart,
  renderKeyValue,
  renderSection,
  renderTable,
  shortId,
  truncateText,
} from "./renderers.js";
import { openStorage, resolveStoreLayout, type StoreLayout } from "./store.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

interface CliIo {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface CommandOutput {
  text: string;
  json: unknown;
}

type ReadMode = "index" | "full";

interface OpenedReadStore {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  close: () => Promise<void>;
}

export async function runCli(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  const parsed = parseArgs(argv);
  const jsonMode = hasFlag(parsed, "json");
  const [rawCommand, ...restPositionals] = parsed.positionals;
  const command = normalizeCommand(rawCommand);

  if (!command) {
    printOutput(
      {
        text: renderHelp(),
        json: { help: true },
      },
      jsonMode,
      io,
    );
    return 0;
  }

  try {
    const commandArgs = { ...parsed, positionals: restPositionals };
    const output = await dispatchCommand(command, commandArgs, io);
    printOutput(output, jsonMode || command === "query" || command === "templates", io);
    return 0;
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return 1;
  }
}

async function dispatchCommand(command: string, parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  switch (command) {
    case "sync":
      return handleSync(parsed, io);
    case "ls":
      return handleLs(parsed, io);
    case "tree":
      return handleTree(parsed, io);
    case "show":
      return handleShow(parsed, io);
    case "search":
      return handleSearch(parsed, io);
    case "stats":
      return handleStats(parsed, io);
    case "export":
      return handleExport(parsed, io);
    case "import":
      return handleImport(parsed, io);
    case "merge":
      return handleMergeAlias(parsed, io);
    case "query":
      return handleQueryAlias(parsed, io);
    case "templates":
      return handleTemplates();
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleSync(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  await mkdir(layout.assetDir, { recursive: true });
  await mkdir(layout.rawDir, { recursive: true });

  const sourceRefs = getFlagValues(parsed, "source");
  const limitFiles = parseNumberFlag(parsed, "limit-files");
  const storage = openStorage(layout);

  try {
    const { host, persistedPayloads } = await syncSelectedSources({
      layout,
      storage,
      sourceRefs,
      limitFiles,
      snapshotRawBlobs: true,
    });

    const rows = persistedPayloads.map((payload) => [
      `${payload.source.display_name} (${payload.source.slot_id})`,
      shortId(payload.source.host_id),
      String(payload.sessions.length),
      String(payload.turns.length),
      payload.source.sync_status,
    ]);
    return {
      text: [
        `Synced ${persistedPayloads.length} source(s) into ${layout.dbPath}`,
        "",
        renderTable(["Source", "Host", "Sessions", "Turns", "Status"], rows),
      ].join("\n"),
      json: {
        command: "sync",
        db_path: layout.dbPath,
        host,
        sources: persistedPayloads.map((payload) => ({
          source: payload.source,
          counts: {
            sessions: payload.sessions.length,
            turns: payload.turns.length,
            records: payload.records.length,
            fragments: payload.fragments.length,
            atoms: payload.atoms.length,
            blobs: payload.blobs.length,
          },
        })),
      },
    };
  } finally {
    storage.close();
  }
}

async function handleLs(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  if (!target || !["projects", "sessions", "sources"].includes(target)) {
    throw new Error("Use `ls projects`, `ls sessions`, or `ls sources`.");
  }

  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    if (target === "projects") {
      const projects = listVisibleProjects(storage, parsed);
      return {
        text: renderTable(
          ["Name", "Status", "Hosts", "Sessions", "Turns", "Last Activity"],
          projects.map((project) => [
            `${project.display_name} (${project.slug})`,
            projectStatusLabel(project),
            String(project.host_ids.length),
            String(project.session_count),
            String(project.committed_turn_count + project.candidate_turn_count),
            project.project_last_activity_at ?? project.updated_at,
          ]),
        ),
        json: { kind: "projects", db_path: layout.dbPath, projects },
      };
    }

    if (target === "sessions") {
      const projectsById = new Map(storage.listProjects().map((project) => [project.project_id, project]));
      const sessions = storage.listResolvedSessions();
      return {
        text: renderTable(
          ["Session", "Project", "Source", "Host", "Model", "Updated"],
          sessions.map((session) => [
            session.id,
            projectLabel(projectsById.get(session.primary_project_id ?? "")),
            session.source_id,
            shortId(session.host_id),
            session.model ?? "unknown",
            session.updated_at,
          ]),
        ),
        json: { kind: "sessions", db_path: layout.dbPath, sessions },
      };
    }

    const sources = storage.listSources().sort((left, right) => (right.last_sync ?? "").localeCompare(left.last_sync ?? ""));
    return {
      text: renderTable(
        ["Source", "Handle", "Platform", "Sessions", "Turns", "Last Sync", "Status"],
        sources.map((source) => [
          source.display_name,
          formatSourceHandle(source),
          source.platform,
          String(source.total_sessions),
          String(source.total_turns),
          source.last_sync ?? "never",
          source.sync_status,
        ]),
      ),
      json: { kind: "sources", db_path: layout.dbPath, sources },
    };
  } finally {
    await readStore.close();
  }
}

async function handleTree(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target, ref] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
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
        const grouped = new Map<string, { label: string; count: number }>();
        for (const session of sessions.filter((entry) => entry.primary_project_id === project.project_id)) {
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
        lines.push(`  ${session.id} (${source?.slot_id ?? session.source_id}, ${shortId(session.host_id)}) ${session.updated_at}`);
        for (const turn of turns.filter((entry) => entry.session_id === session.id).slice(0, 3)) {
          lines.push(`    - ${turn.submission_started_at} ${truncateText(turn.canonical_text, 80)}`);
        }
      }

      return {
        text: lines.join("\n"),
        json: { kind: "project-tree", db_path: layout.dbPath, project, sessions: projectSessions },
      };
    }

    throw new Error("Use `tree projects` or `tree project <project-id-or-slug>`.");
  } finally {
    await readStore.close();
  }
}

async function handleShow(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
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
      const session = storage.getResolvedSession(ref) ?? storage.getSession(ref);
      if (!session) {
        throw new Error(`Unknown session: ${ref}`);
      }
      const turns = storage.listResolvedTurns().filter((turn) => turn.session_id === session.id);
      return {
        text: [
          renderSection(
            `Session ${session.id}`,
            renderKeyValue([
              ["Project", session.primary_project_id ?? "Unassigned"],
              ["Source", session.source_id],
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
              : turns.map((turn) => `${turn.id} ${turn.submission_started_at} ${truncateText(turn.canonical_text, 96)}`).join("\n"),
          ),
        ].join("\n"),
        json: { kind: "session", db_path: layout.dbPath, session, turns },
      };
    }

    if (target === "turn") {
      const turn = storage.getResolvedTurn(ref) ?? storage.getTurn(ref);
      if (!turn) {
        throw new Error(`Unknown turn: ${ref}`);
      }
      const context = storage.getTurnContext(turn.id);
      return {
        text: [
          renderSection(
            `Turn ${turn.id}`,
            renderKeyValue([
              ["Project", turn.project_id ?? "Unassigned"],
              ["Source", turn.source_id],
              ["Session", turn.session_id],
              ["Submitted", turn.submission_started_at],
              ["Model", turn.context_summary.primary_model ?? "unknown"],
              ["Tokens", formatNumber(turn.context_summary.total_tokens ?? turn.context_summary.token_usage?.total_tokens ?? 0)],
              ["Assistant Replies", String(turn.context_summary.assistant_reply_count)],
              ["Tool Calls", String(turn.context_summary.tool_call_count)],
            ]),
          ),
          "",
          renderSection("Prompt", turn.canonical_text || "(empty)"),
          "",
          renderSection(
            "Context",
            context
              ? [
                  `assistant replies: ${context.assistant_replies.length}`,
                  `tool calls: ${context.tool_calls.length}`,
                  `system messages: ${context.system_messages.length}`,
                ].join("\n")
              : "(no context)",
          ),
        ].join("\n"),
        json: { kind: "turn", db_path: layout.dbPath, turn, context, lineage: storage.getTurnLineage(turn.id) },
      };
    }

    if (target === "source") {
      const source = resolveSourceRef(storage, ref);
      const usage = storage.getUsageOverview({ source_ids: [source.id] });
      const sessions = storage.listResolvedSessions().filter((session) => session.source_id === source.id);
      return {
        text: renderSection(
          `${source.display_name} (${source.slot_id})`,
          renderKeyValue([
            ["Source ID", source.id],
            ["Handle", formatSourceHandle(source)],
            ["Platform", source.platform],
            ["Base Dir", source.base_dir],
            ["Sessions", String(source.total_sessions)],
            ["Turns", String(source.total_turns)],
            ["Last Sync", source.last_sync ?? "never"],
            ["Status", source.sync_status],
            ["Total Tokens", formatNumber(usage.total_tokens)],
            ["Coverage", formatRatio(usage.turn_coverage_ratio)],
            ["Resolved Sessions", String(sessions.length)],
          ]),
        ),
        json: { kind: "source", db_path: layout.dbPath, source, sessions, usage },
      };
    }

    throw new Error("Use `show project|session|turn|source <ref>`.");
  } finally {
    await readStore.close();
  }
}

async function handleSearch(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
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
    const results = storage.searchTurns({
      query,
      project_id: project?.project_id,
      source_ids: sourceIds,
      limit,
    });
    const groups = groupSearchResults(results);
    const lines: string[] = [];
    for (const group of groups) {
      lines.push(`${group.label} (${group.results.length})`);
      for (const result of group.results) {
        lines.push(
          `  ${result.turn.submission_started_at} ${shortId(result.turn.id)} ${truncateText(result.turn.canonical_text, 92)}`,
        );
      }
    }
    return {
      text: lines.length > 0 ? lines.join("\n") : "(no matches)",
      json: { kind: "search", db_path: layout.dbPath, query, results },
    };
  } finally {
    await readStore.close();
  }
}

async function handleStats(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { layout, storage } = readStore;
    if (!target) {
      const overview = storage.getUsageOverview();
      const sources = storage.listSources();
      const projects = storage.listProjects();
      const sessions = storage.listResolvedSessions();
      const turns = storage.listResolvedTurns();
      return {
        text: renderKeyValue([
          ["DB", layout.dbPath],
          ["Sources", String(sources.length)],
          ["Projects", String(projects.length)],
          ["Sessions", String(sessions.length)],
          ["Turns", String(turns.length)],
          ["Turns With Tokens", `${overview.turns_with_token_usage}/${overview.total_turns}`],
          ["Coverage", formatRatio(overview.turn_coverage_ratio)],
          ["Input Tokens", formatNumber(overview.total_input_tokens)],
          ["Cached Input Tokens", formatNumber(overview.total_cached_input_tokens)],
          ["Output Tokens", formatNumber(overview.total_output_tokens)],
          ["Reasoning Tokens", formatNumber(overview.total_reasoning_output_tokens)],
          ["Total Tokens", formatNumber(overview.total_tokens)],
        ]),
        json: {
          kind: "stats-overview",
          db_path: layout.dbPath,
          counts: {
            sources: sources.length,
            projects: projects.length,
            sessions: sessions.length,
            turns: turns.length,
          },
          overview,
        },
      };
    }

    if (target === "usage") {
      const dimension = (getFlag(parsed, "by") ?? "model") as UsageStatsDimension;
      if (!["model", "project", "source", "host", "day", "month"].includes(dimension)) {
        throw new Error("`stats usage --by` must be one of model, project, source, host, day, or month.");
      }
      const rollup = storage.listUsageRollup(dimension);
      const notesText = renderUsageNotes(rollup.rows, dimension);
      const chartText =
        dimension === "day" || dimension === "month" ? renderUsageCharts(rollup.rows, dimension) : undefined;
      return {
        text: [
          renderTable(
            ["Label", "Turns", "Covered", "Coverage", "Total Tokens", "Input", "Output"],
            rollup.rows.map((row) => [
              formatUsageRollupLabel(dimension, row.label),
              String(row.turn_count),
              String(row.turns_with_token_usage),
              formatRatio(row.turn_coverage_ratio),
              formatNumber(row.total_tokens),
              formatNumber(row.total_input_tokens),
              formatNumber(row.total_output_tokens),
            ]),
          ),
          chartText,
          notesText,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n\n"),
        json: {
          kind: "stats-usage",
          db_path: layout.dbPath,
          dimension,
          overview: storage.getUsageOverview(),
          rollup,
        },
      };
    }

    throw new Error("Use `stats` or `stats usage --by <dimension>`.");
  } finally {
    await readStore.close();
  }
}

function renderUsageCharts(
  rows: Array<{
    label: string;
    total_input_tokens: number;
    total_cached_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
  }>,
  dimension: "day" | "month",
): string {
  const metrics = [
    {
      title: "Input Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_input_tokens })),
    },
    {
      title: "Cached Input Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_cached_input_tokens })),
    },
    {
      title: "Output Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_output_tokens })),
    },
    {
      title: "Total Tokens",
      values: rows.map((row) => ({ label: row.label, value: row.total_tokens })),
    },
  ];

  return renderSection(
    `${dimension === "day" ? "Daily" : "Monthly"} Token Charts`,
    metrics
      .map((metric) => renderSection(metric.title, renderBarChart(metric.values)))
      .map((section) => indentBlock(section, 2))
      .join("\n\n"),
  );
}

function formatUsageRollupLabel(dimension: UsageStatsDimension, label: string): string {
  if (dimension === "model" && label === "<synthetic>") {
    return "Synthetic Error Reply";
  }
  return label;
}

function renderUsageNotes(
  rows: Array<{
    label: string;
  }>,
  dimension: UsageStatsDimension,
): string | undefined {
  if (dimension !== "model" || !rows.some((row) => row.label === "<synthetic>")) {
    return undefined;
  }

  return renderSection(
    "Notes",
    "Synthetic Error Reply rows are system-generated local/API error messages preserved as evidence, not provider model calls.",
  );
}

async function handleExport(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const outDir = requireFlag(parsed, "out");
  const includeRawBlobs = !hasFlag(parsed, "no-raw");
  const sourceRefs = getFlagValues(parsed, "source");
  const { layout, storage } = openExistingStore(parsed, io);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(storage, ref).id) : undefined;
    const result = await exportBundle({
      storage,
      bundleDir: path.resolve(io.cwd, outDir),
      sourceIds: selectedSourceIds,
      includeRawBlobs,
    });
    return {
      text: renderKeyValue([
        ["Bundle", path.resolve(io.cwd, outDir)],
        ["Bundle ID", result.manifest.bundle_id],
        ["Sources", String(result.manifest.counts.sources)],
        ["Sessions", String(result.manifest.counts.sessions)],
        ["Turns", String(result.manifest.counts.turns)],
        ["Blobs", String(result.manifest.counts.blobs)],
        ["Includes Raw", String(result.manifest.includes_raw_blobs)],
      ]),
      json: {
        kind: "export",
        db_path: layout.dbPath,
        manifest: result.manifest,
        checksums: result.checksums,
      },
    };
  } finally {
    storage.close();
  }
}

async function handleImport(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [bundleDir] = parsed.positionals;
  if (!bundleDir) {
    throw new Error("Import requires a bundle directory.");
  }
  const mode = (getFlag(parsed, "on-conflict") ?? "error") as "error" | "skip" | "replace";
  if (!["error", "skip", "replace"].includes(mode)) {
    throw new Error("`import --on-conflict` must be one of error, skip, replace.");
  }

  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  await mkdir(layout.assetDir, { recursive: true });
  await mkdir(layout.rawDir, { recursive: true });
  const storage = openStorage(layout);

  try {
    const result = await importBundleIntoStore({
      storage,
      bundleDir: path.resolve(io.cwd, bundleDir),
      rawDir: layout.rawDir,
      onConflict: mode,
    });
    return {
      text: renderKeyValue([
        ["DB", layout.dbPath],
        ["Bundle ID", result.manifest.bundle_id],
        ["Imported Sources", String(result.imported_source_ids.length)],
        ["Replaced Sources", String(result.replaced_source_ids.length)],
        ["Skipped Sources", String(result.skipped_source_ids.length)],
        ["Projects Before", String(result.project_count_before)],
        ["Projects After", String(result.project_count_after)],
      ]),
      json: {
        kind: "import",
        db_path: layout.dbPath,
        ...result,
      },
    };
  } finally {
    storage.close();
  }
}

async function handleMergeAlias(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const fromPath = requireFlag(parsed, "from");
  const toPath = requireFlag(parsed, "to");
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cchistory-merge-"));
  const fromLayout = resolveStoreLayout({ cwd: io.cwd, dbArg: fromPath });
  const toLayout = resolveStoreLayout({ cwd: io.cwd, dbArg: toPath });
  const sourceRefs = getFlagValues(parsed, "source");
  const conflictMode = (getFlag(parsed, "on-conflict") ?? "replace") as "skip" | "replace";

  const sourceStorage = openStorage(fromLayout);
  const targetStorage = openStorage(toLayout);
  try {
    const selectedSourceIds = sourceRefs.length > 0 ? sourceRefs.map((ref) => resolveSourceRef(sourceStorage, ref).id) : undefined;
    await exportBundle({
      storage: sourceStorage,
      bundleDir: tempDir,
      sourceIds: selectedSourceIds,
      includeRawBlobs: true,
    });
    const imported = await importBundleIntoStore({
      storage: targetStorage,
      bundleDir: tempDir,
      rawDir: toLayout.rawDir,
      onConflict: conflictMode === "replace" ? "replace" : "skip",
    });
    return {
      text: `Merged via bundle compatibility path: imported=${imported.imported_source_ids.length} replaced=${imported.replaced_source_ids.length} skipped=${imported.skipped_source_ids.length}`,
      json: imported,
    };
  } finally {
    sourceStorage.close();
    targetStorage.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function handleQueryAlias(parsed: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  const [target] = parsed.positionals;
  const readStore = await openReadStore(parsed, io);
  try {
    const { storage } = readStore;
    switch (target) {
      case "turns": {
        const query = getFlag(parsed, "search");
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const json = query
          ? storage.searchTurns({
              query,
              project_id: projectId,
              source_ids: sourceIds.length > 0 ? sourceIds : undefined,
              limit,
            })
          : storage
              .listResolvedTurns()
              .filter((turn) => (projectId ? turn.project_id === projectId : true))
              .filter((turn) => (sourceIds.length > 0 ? sourceIds.includes(turn.source_id) : true))
              .slice(0, limit);
        return {
          text: JSON.stringify(json, null, 2),
          json,
        };
      }
      case "turn": {
        const turnId = requireFlag(parsed, "id");
        const json = {
          turn: storage.getResolvedTurn(turnId) ?? storage.getTurn(turnId),
          context: storage.getTurnContext(turnId),
          lineage: storage.getTurnLineage(turnId),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "sessions": {
        const projectId = getFlag(parsed, "project");
        const sourceIds = getFlagValues(parsed, "source");
        const limit = parseNumberFlag(parsed, "limit") ?? 20;
        const json = storage
          .listResolvedSessions()
          .filter((session) => (projectId ? session.primary_project_id === projectId : true))
          .filter((session) => (sourceIds.length > 0 ? sourceIds.includes(session.source_id) : true))
          .slice(0, limit);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "session": {
        const sessionId = requireFlag(parsed, "id");
        const json = {
          session: storage.getResolvedSession(sessionId) ?? storage.getSession(sessionId),
          turns: storage.listResolvedTurns().filter((turn) => turn.session_id === sessionId),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "projects": {
        const json = listVisibleProjects(storage, parsed);
        return { text: JSON.stringify(json, null, 2), json };
      }
      case "project": {
        const projectId = requireFlag(parsed, "id");
        const json = {
          project: storage.getProject(projectId),
          turns: storage.listProjectTurns(projectId, (getFlag(parsed, "link-state") as "all" | "committed" | "candidate" | "unlinked" | undefined) ?? "all"),
        };
        return { text: JSON.stringify(json, null, 2), json };
      }
      default:
        throw new Error("Unsupported query target.");
    }
  } finally {
    await readStore.close();
  }
}

async function handleTemplates(): Promise<CommandOutput> {
  const json = getSourceFormatProfiles();
  return {
    text: JSON.stringify(json, null, 2),
    json,
  };
}

function groupSearchResults(results: TurnSearchResult[]): Array<{ label: string; results: TurnSearchResult[] }> {
  const groups = new Map<string, TurnSearchResult[]>();
  for (const result of results) {
    const label =
      result.project && result.project.linkage_state === "committed" ? result.project.display_name : "Unassigned";
    const current = groups.get(label) ?? [];
    current.push(result);
    groups.set(label, current);
  }
  return [...groups.entries()]
    .map(([label, groupedResults]) => ({ label, results: groupedResults }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function resolveProjectRef(storage: CCHistoryStorage, ref: string): ProjectIdentity {
  const projects = storage.listProjects();
  const direct = projects.find((project) => project.project_id === ref);
  if (direct) {
    return direct;
  }
  const slugMatches = projects.filter((project) => project.slug === ref);
  if (slugMatches.length === 1) {
    return slugMatches[0]!;
  }
  throw new Error(`Unknown project reference: ${ref}`);
}

function resolveSourceRef(storage: CCHistoryStorage, ref: string): SourceStatus {
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
  throw new Error(`Unknown source reference: ${ref}`);
}

async function openReadStore(parsed: ParsedArgs, io: CliIo): Promise<OpenedReadStore> {
  const baseLayout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  const readMode = resolveReadMode(parsed);
  if (readMode === "index") {
    const storage = openStorage(baseLayout);
    return {
      layout: baseLayout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  }

  const storage = new CCHistoryStorage({ dbPath: ":memory:" });
  const layout: StoreLayout = {
    ...baseLayout,
    dbPath: `${baseLayout.dbPath} (full scan in memory)`,
  };

  try {
    await syncSelectedSources({
      layout,
      storage,
      sourceRefs: getFlagValues(parsed, "source"),
      limitFiles: parseNumberFlag(parsed, "limit-files"),
      snapshotRawBlobs: false,
    });
    return {
      layout,
      storage,
      close: async () => {
        storage.close();
      },
    };
  } catch (error) {
    storage.close();
    throw error;
  }
}

function openExistingStore(parsed: ParsedArgs, io: CliIo): { layout: StoreLayout; storage: CCHistoryStorage } {
  const layout = resolveStoreLayout({
    cwd: io.cwd,
    storeArg: getFlag(parsed, "store"),
    dbArg: getFlag(parsed, "db"),
  });
  return {
    layout,
    storage: openStorage(layout),
  };
}

async function syncSelectedSources(input: {
  layout: StoreLayout;
  storage: CCHistoryStorage;
  sourceRefs: string[];
  limitFiles?: number;
  snapshotRawBlobs: boolean;
}): Promise<{ host: Awaited<ReturnType<typeof runSourceProbe>>["host"]; persistedPayloads: SourceSyncPayload[] }> {
  const sources = applySourceSelection(getDefaultSources(), input.sourceRefs);
  const result = await runSourceProbe(
    {
      source_ids: input.sourceRefs.length > 0 ? input.sourceRefs : undefined,
      limit_files_per_source: input.limitFiles,
    },
    sources,
  );
  const persistedPayloads: SourceSyncPayload[] = [];
  for (const payload of result.sources) {
    const persistedPayload = input.snapshotRawBlobs ? await snapshotPayloadRawBlobs(input.layout.rawDir, payload) : payload;
    input.storage.replaceSourcePayload(persistedPayload, { allow_host_rekey: true });
    persistedPayloads.push(persistedPayload);
  }

  return {
    host: result.host,
    persistedPayloads,
  };
}

function applySourceSelection(sources: SourceDefinition[], selectedRefs: string[]): SourceDefinition[] {
  if (selectedRefs.length === 0) {
    return sources;
  }
  return sources.filter((source) => selectedRefs.includes(source.id) || selectedRefs.includes(source.slot_id));
}

function resolveReadMode(parsed: ParsedArgs): ReadMode {
  const wantsIndex = hasFlag(parsed, "index");
  const wantsFull = hasFlag(parsed, "full");
  if (wantsIndex && wantsFull) {
    throw new Error("Use either --index or --full, not both.");
  }
  return wantsFull ? "full" : "index";
}

function normalizeCommand(command: string | undefined): string | undefined {
  if (!command || command === "help" || command === "--help") {
    return undefined;
  }
  if (command === "collect") {
    return "sync";
  }
  return command;
}

function projectStatusLabel(project: ProjectIdentity): string {
  return project.linkage_state === "committed" ? "ready" : "tentative";
}

function projectLabel(project: ProjectIdentity | undefined): string {
  return project ? `${project.display_name} [${projectStatusLabel(project)}]` : "Unassigned";
}

function listVisibleProjects(storage: CCHistoryStorage, parsed: ParsedArgs): ProjectIdentity[] {
  return sortProjectsForDisplay(filterProjectsForDisplay(storage.listProjects(), parsed));
}

function filterProjectsForDisplay(projects: ProjectIdentity[], parsed: ParsedArgs): ProjectIdentity[] {
  if (hasFlag(parsed, "showall")) {
    return projects;
  }
  return projects.filter((project) => !isEmptyProject(project));
}

function isEmptyProject(project: ProjectIdentity): boolean {
  return project.session_count === 0 && project.committed_turn_count === 0 && project.candidate_turn_count === 0;
}

function sortProjectsForDisplay(projects: ProjectIdentity[]): ProjectIdentity[] {
  return [...projects].sort((left, right) => {
    const leftTurns = left.committed_turn_count + left.candidate_turn_count;
    const rightTurns = right.committed_turn_count + right.candidate_turn_count;
    if (leftTurns !== rightTurns) {
      return rightTurns - leftTurns;
    }
    if (left.session_count !== right.session_count) {
      return right.session_count - left.session_count;
    }
    const activityCompare = (right.project_last_activity_at ?? right.updated_at).localeCompare(
      left.project_last_activity_at ?? left.updated_at,
    );
    if (activityCompare !== 0) {
      return activityCompare;
    }
    return left.display_name.localeCompare(right.display_name);
  });
}

function formatSourceHandle(source: SourceStatus): string {
  return `${source.slot_id}@${source.host_id}`;
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
}

function printOutput(output: CommandOutput, jsonMode: boolean, io: CliIo): void {
  const value = jsonMode ? JSON.stringify(output.json, null, 2) : output.text;
  io.stdout(`${value}\n`);
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let forcePositionals = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--") {
      if (index === 0) {
        continue;
      }
      forcePositionals = true;
      continue;
    }
    if (forcePositionals || !token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const separatorIndex = body.indexOf("=");
    const key = separatorIndex >= 0 ? body.slice(0, separatorIndex) : body;
    const inlineValue = separatorIndex >= 0 ? body.slice(separatorIndex + 1) : undefined;
    let value = inlineValue;
    if (value === undefined) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        index += 1;
      } else {
        value = "true";
      }
    }
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }
  return { positionals, flags };
}

function getFlag(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.flags.get(key)?.[0];
}

function getFlagValues(parsed: ParsedArgs, key: string): string[] {
  return parsed.flags.get(key) ?? [];
}

function hasFlag(parsed: ParsedArgs, key: string): boolean {
  return parsed.flags.has(key);
}

function requireFlag(parsed: ParsedArgs, key: string): string {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    throw new Error(`Missing required --${key} flag.`);
  }
  return value;
}

function parseNumberFlag(parsed: ParsedArgs, key: string): number | undefined {
  const value = getFlag(parsed, key);
  if (!value || value === "true") {
    return undefined;
  }
  const parsedNumber = Number(value);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }
  return parsedNumber;
}

function renderHelp(): string {
  return [
    "Usage:",
    "  cchistory sync [--store <dir> | --db <file>] [--source <slot-or-id>] [--limit-files <n>]",
    "  cchistory ls projects|sessions|sources [--store <dir> | --db <file>] [--index | --full] [--showall]",
    "  cchistory tree projects [--store <dir> | --db <file>] [--index | --full] [--showall]",
    "  cchistory tree project <project-id-or-slug> [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory show project|session|turn|source <ref> [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory search <query> [--store <dir> | --db <file>] [--index | --full] [--project <project>] [--source <source>] [--limit <n>]",
    "  cchistory stats [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory stats usage --by model|project|source|host|day|month [--store <dir> | --db <file>] [--index | --full]",
    "  cchistory export --out <bundle-dir> [--store <dir> | --db <file>] [--source <source>] [--no-raw]",
    "  cchistory import <bundle-dir> [--store <dir> | --db <file>] [--on-conflict error|skip|replace]",
    "",
    "Global options:",
    "  --store <dir>   Use a store directory (db is <dir>/cchistory.sqlite)",
    "  --db <file>     Use an explicit sqlite file; sidecar data lives beside it",
    "  --index         Read from the existing store only (default for read commands)",
    "  --full          Re-scan default source roots into a temporary store before reading",
    "  --showall       Include empty projects with 0 sessions and 0 turns in project listings",
    "  --json          Print machine-readable JSON",
    "  --verbose       Reserved for detailed diagnostics",
  ].join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
